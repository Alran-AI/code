/**
 * Packet execution (build steps 3 and 4).
 *
 * For each packet in dependency order: WORKER → SCOPE → GATE → VERIFIER, with a
 * repair loop on any failure. The scheduler starts a packet only when all of its
 * `depends_on` are `done`, up to `workers` at a time, and it is the only place
 * that decides a packet's status — a packet becomes `done` only after both the
 * gate and the verifier pass, which the state machine also enforces.
 *
 * Everything outside this module is a port: worktrees, the worker agent, the
 * gate commands, the verifier, the run store and the ledger. That keeps the
 * scheduling, scope, repair, backoff and skip logic pure and testable, and it is
 * why the same code can run behind the CLI adapter or a future cloud runner.
 */

import { guardFixDiff } from '@alran/ci-fix';
import { packetBranchFor } from './branches.js';
import { BudgetTracker } from './budget.js';
import type { Ledger } from './ledger.js';
import { RunStore } from './run-state.js';
import { recipeReadonlyPaths } from './recipes.js';
import {
  checkScope,
  describeScopeViolations,
  ULTRA_DENY_PATHS,
} from './scope-guard.js';
import { describeSpecTestViolation, isSpecTestPath, specTestDenyPaths } from './spec-tests.js';
import { buildWorkerPrompt, buildWorkerSystemPrompt } from './worker-prompt.js';
import type {
  ExecuteRunResult,
  GateResult,
  LedgerEntry,
  PacketExecutionOutcome,
  PacketStatus,
  PlanPacket,
  RepairFailure,
  RunStatus,
  UltraPlan,
  VerifierVerdictResult,
  WorkerOutcome,
} from './types.js';

/** Ports the scheduler drives. Every one is supplied by the CLI adapter or a test. */
export interface ExecutePorts {
  readonly worktree: {
    create(input: {
      readonly packetId: string;
      readonly runId: string;
      readonly branch: string;
      readonly baseRef: string;
    }): Promise<{ readonly dir: string }>;
    /** Discards the worker's work and returns the tree to its base commit. */
    reset(input: {
      readonly packetId: string;
      readonly dir: string;
      readonly baseRef: string;
    }): Promise<void>;
    remove(input: { readonly packetId: string; readonly dir: string }): Promise<void>;
    /** Unified diff of the worktree against its base commit. */
    diff(input: {
      readonly packetId: string;
      readonly dir: string;
      readonly baseRef: string;
    }): Promise<string>;
    /** Repo-relative paths the worker changed. */
    changedFiles(input: {
      readonly packetId: string;
      readonly dir: string;
      readonly baseRef: string;
    }): Promise<readonly string[]>;
  };
  readonly worker: {
    run(input: {
      readonly packet: PlanPacket;
      readonly worktreeDir: string;
      readonly attempt: number;
      readonly systemPrompt: string;
      readonly prompt: string;
      readonly model: string;
      readonly failure?: RepairFailure;
    }): Promise<WorkerOutcome>;
  };
  readonly gate: {
    /** Runs each command in the worktree; the exit code decides, not the text. */
    run(input: {
      readonly packet: PlanPacket;
      readonly worktreeDir: string;
      readonly commands: readonly string[];
    }): Promise<GateResult>;
  };
  readonly verifier: {
    verify(input: {
      readonly packet: PlanPacket;
      readonly diff: string;
      readonly gate: GateResult;
      readonly model: string;
      /**
       * The run's recipe, so the verifier can apply the recipe's extra checks
       * (spec 8) on top of the fixed fake-fix checklist. A verifier that does
       * not know the recipe would pass a migration that left old call sites.
       */
      readonly recipe: UltraPlan['recipe'];
    }): Promise<VerifierVerdictResult>;
  };
  readonly store: RunStore;
  readonly ledger: Ledger;
  /**
   * Durable per-packet evidence (spec 4.3): the prompt, the diff, the gate
   * output and the verifier verdict. A port rather than direct `fs` so the
   * scheduler stays pure and a cloud runner can store evidence elsewhere.
   */
  readonly evidence: {
    write(input: { readonly packetId: string; readonly name: string; readonly content: string }): void;
  };
}

export interface ExecuteConfig {
  /** Parallel worker cap; the CLI clamps to 1..8. */
  readonly workers: number;
  readonly maxRepairs: number;
  readonly workerModel: string;
  /** Prefer a different model than the worker; the CLI resolves it from config. */
  readonly verifierModel: string;
  /** Paths the diff-guard treats as never-editable, added to each packet's readonly. */
  readonly denyPaths?: readonly string[];
  /** Directory holding the frozen spec tests; read-only for every worker. */
  readonly specTestDir?: string;
  /** Hard budget in USD; a null means unlimited. Defaults to the run's stored cap. */
  readonly budgetUsd?: number | null;
  /**
   * Consecutive 429 retries per attempt before the packet treats the limit as a
   * real failure. Without a cap a permanently throttled upstream would spin.
   */
  readonly maxRateLimitRetries?: number;
}

export interface ExecuteInput {
  readonly plan: UltraPlan;
  readonly ports: ExecutePorts;
  readonly config: ExecuteConfig;
  /** Injected so tests do not wait; production passes a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Base commit each packet worktree branches from. */
  readonly baseRef?: string;
  /** Packets to skip entirely (already `done`), so resume does not repeat them. */
  readonly skipPacketIds?: readonly string[];
}

const MAX_CONCURRENCY = 8;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 5;

function clampWorkers(requested: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(requested)));
}

/** A non-finite repair budget would make `repairs >= max` never true: clamp it. */
function clampRepairs(requested: number): number {
  if (!Number.isFinite(requested)) return 0;
  return Math.max(0, Math.floor(requested));
}

/**
 * Runs the execute phase to the end of the packets. It never integrates and
 * never pushes: every `done` packet is left on its own branch for the human.
 *
 * The scheduler is wave-by-wave in dependency order but bounded by `workers`,
 * so an independent packet never waits for a blocked one. A 429 from the worker
 * lowers the effective worker count, backs off, and retries the same packet; a
 * run that hits its budget pauses instead of killing.
 */
export async function runExecute(input: ExecuteInput): Promise<ExecuteRunResult> {
  const { plan, ports, config } = input;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const baseRef = input.baseRef ?? 'HEAD';
  const skip = new Set(input.skipPacketIds ?? []);
  // Spec 6: `.env*` and key files are never writable, whatever the scope says.
  // Spec 13.2: the spec tests are read-only for every worker. Spec 8: a recipe
  // can make a whole run read-only (an audit changes nothing). The packet's own
  // readonly paths and the configured deny list are added on top.
  const denyPaths = [
    ...ULTRA_DENY_PATHS,
    ...specTestDenyPaths(config.specTestDir),
    ...recipeReadonlyPaths(plan.recipe),
    ...(config.denyPaths ?? []),
  ];

  const budget = BudgetTracker.fromLedger(ports.ledger.entries(), config.budgetUsd ?? ports.store.state.budgetUsd);
  const maxRepairsFor = (packet: PlanPacket): number =>
    clampRepairs(packet.max_repairs ?? config.maxRepairs);

  const maxRateLimitRetries = Math.max(
    1,
    Math.floor(config.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES),
  );
  let effectiveWorkers = clampWorkers(config.workers);
  let rateLimitEvents = 0;
  /** Set when the budget stopped a packet; promotes the run to `paused` at the end. */
  let pausedByBudget = false;
  const outcomes = new Map<string, PacketExecutionOutcome>();

  const record = (entry: LedgerEntry): void => {
    ports.ledger.append(entry);
    if (typeof entry.costUsd === 'number' && entry.costUsd > 0) {
      budget.record({ usd: entry.costUsd, role: entry.role });
    }
  };

  /**
   * Evidence writes are for humans reading the run afterwards; a full disk must
   * not fail a packet that is otherwise fine, so a write error is recorded and
   * swallowed rather than propagated into the repair loop.
   */
  const writeEvidence = (packetId: string, name: string, content: string): void => {
    try {
      ports.evidence.write({ packetId, name, content });
    } catch (error) {
      record({
        kind: 'step',
        role: 'scheduler',
        packetId,
        status: 'evidence_error',
        note: `could not write ${name}: ${errorMessage(error)}`,
      });
    }
  };

  const setStatus = (id: string, status: PacketStatus, reason?: string, repairs?: number): void => {
    ports.store.setPacketStatus(id, status, reason, repairs);
  };

  const outcomeFor = (packet: PlanPacket, status: PacketStatus, repairs: number, reason?: string, dir?: string, branch?: string): PacketExecutionOutcome => ({
    id: packet.id,
    title: packet.title,
    status,
    repairs,
    ...(reason ? { reason } : {}),
    ...(dir ? { worktreeDir: dir } : {}),
    ...(branch ? { branch } : {}),
  });

  /** Blocks a packet and, separately, the dependents that can never start. */
  const block = (packet: PlanPacket, reason: string, repairs: number, dir?: string, branch?: string): void => {
    setStatus(packet.id, 'blocked', reason, repairs);
    outcomes.set(packet.id, outcomeFor(packet, 'blocked', repairs, reason, dir, branch));
    record({ kind: 'packet', packetId: packet.id, status: 'blocked', note: reason, role: 'scheduler' });
  };

  /** One packet end-to-end with the repair loop. Returns after setting a terminal status. */
  const runPacket = async (packet: PlanPacket): Promise<void> => {
    const branch = packetBranchFor(ports.store.state.runId, packet.id);
    let dir = '';
    try {
      ({ dir } = await ports.worktree.create({ packetId: packet.id, runId: ports.store.state.runId, branch, baseRef }));
    } catch (error) {
      block(packet, `worktree creation failed: ${errorMessage(error)}`, 0);
        return;
    }

    const maxRepairs = maxRepairsFor(packet);
    let repairs = 0;
    let failure: RepairFailure | undefined;
    let rateBackoff = BASE_BACKOFF_MS;
    let rateLimitRetries = 0;

    for (;;) {
      if (budget.shouldPause) {
        // Pause, never block: `blocked` is terminal for resume, so the packet
        // keeps its current status and a resume after raising the cap redoes it.
        const reason = 'budget paused the run at 100 %';
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'budget_paused', note: reason });
        pausedByBudget = true;
        return;
      }

      setStatus(packet.id, 'running', failure ? describeFailure(failure) : undefined);

      const prompt = buildWorkerPrompt({ packet, worktreeDir: dir, attempt: repairs, ...(failure ? { failure } : {}) });
      record({ kind: 'step', role: 'worker', packetId: packet.id, status: 'start', model: config.workerModel, ...(failure ? { note: failure.kind } : {}) });
      writeEvidence(packet.id, 'prompt.md', `# ${packet.title}\n\nAttempt ${repairs + 1}\n\n\`\`\`\n${prompt}\n\`\`\`\n`);

      let worker: WorkerOutcome;
      try {
        worker = await ports.worker.run({
          packet,
          worktreeDir: dir,
          attempt: repairs,
          systemPrompt: buildWorkerSystemPrompt(),
          prompt,
          model: config.workerModel,
          ...(failure ? { failure } : {}),
        });
      } catch (error) {
        worker = { ok: false, summary: errorMessage(error) };
      }

      record({
        kind: 'step',
        role: 'worker',
        packetId: packet.id,
        status: worker.ok ? 'ok' : 'error',
        model: worker.model ?? config.workerModel,
        ...(typeof worker.costUsd === 'number' ? { costUsd: worker.costUsd } : {}),
        ...(typeof worker.tokensUsed === 'number' ? { tokensUsed: worker.tokensUsed } : {}),
      });

      // ULT-06: a 429 is not a repair. Lower parallelism, back off, retry the
      // same attempt, and never count it against the repair budget.
      if (worker.rateLimited) {
        rateLimitEvents += 1;
        rateLimitRetries += 1;
        effectiveWorkers = Math.max(1, effectiveWorkers - 1);
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'rate_limited', note: `workers=${effectiveWorkers} retry=${rateLimitRetries}/${maxRateLimitRetries} backoff=${rateBackoff}ms` });
        if (rateLimitRetries >= maxRateLimitRetries) {
          // A permanently throttled upstream is a real failure, not an infinite
          // wait: spend a repair, or block when the repair budget is spent.
          const output = `upstream stayed rate limited after ${rateLimitRetries} retries`;
          if (repairs >= maxRepairs) {
            block(packet, output, repairs, dir, branch);
                    return;
          }
          repairs += 1;
          rateLimitRetries = 0;
          failure = { kind: 'gate', output };
          continue;
        }
        await sleep(rateBackoff);
        rateBackoff = Math.min(MAX_BACKOFF_MS, rateBackoff * 2);
        continue;
      }
      // A successful worker start clears the throttle streak for this attempt.
      rateLimitRetries = 0;

      // A worker that crashed without changing anything still goes through the
      // scope/gate check: an empty diff may legitimately pass a no-op gate.
      let changed: readonly string[];
      try {
        changed = await ports.worktree.changedFiles({ packetId: packet.id, dir, baseRef });
      } catch (error) {
        // Never read a git failure as "nothing changed": that passes scope and
        // the diff-guard on no evidence at all.
        const output = `could not read the worktree diff: ${errorMessage(error)}`;
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'diff_error', note: output });
        if (repairs >= maxRepairs) {
          block(packet, output, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'gate', output };
        continue;
      }

      // STEP 4: scope enforcement. A change outside scope or inside readonly
      // resets the worktree and restarts the worker with a violation note.
      // The default deny paths are merged in, so a broad scope can never make a
      // secret file writable.
      const scope = checkScope({
        changedFiles: changed,
        scope: packet.scope,
        readonly: [...denyPaths, ...(packet.readonly ?? [])],
      });
      if (!scope.ok) {
        // Name a spec-test violation for what it is: a worker editing its own
        // acceptance checks is the most serious scope failure there is.
        const specViolation = scope.violations.find((violation) =>
          isSpecTestPath(violation.file, config.specTestDir),
        );
        const detail = specViolation
          ? describeSpecTestViolation(specViolation.file)
          : describeScopeViolations(scope.violations);
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'scope_violation', note: detail });
        if (repairs >= maxRepairs) {
          block(packet, `scope violation after ${repairs} repair(s): ${detail}`, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'scope', output: detail };
        if (!(await safeReset(ports, packet.id, dir, baseRef))) {
          block(packet, 'worktree reset failed after a scope violation', repairs, dir, branch);
          return;
        }
        continue;
      }

      let diff: string;
      try {
        diff = await ports.worktree.diff({ packetId: packet.id, dir, baseRef });
      } catch (error) {
        const output = `could not produce the worktree diff: ${errorMessage(error)}`;
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'diff_error', note: output });
        if (repairs >= maxRepairs) {
          block(packet, output, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'gate', output };
        continue;
      }

      // The cheap, deterministic fake-fix pre-check runs before any model call.
      // The diff is evidence whether or not it passes, so it is written first.
      writeEvidence(packet.id, 'diff.patch', diff);
      const guard = guardFixDiff({
        diff,
        denyPaths: [...denyPaths, ...(packet.readonly ?? [])],
        forbidTestWeakening: true,
      });
      if (!guard.ok) {
        const output = guard.violations.map((v) => `${v.file}: ${v.detail}`).join('\n');
        record({ kind: 'step', role: 'scheduler', packetId: packet.id, status: 'diff_guard', note: output });
        if (repairs >= maxRepairs) {
          block(packet, `diff guard rejected the change: ${output}`, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'verifier', output };
        if (!(await safeReset(ports, packet.id, dir, baseRef))) {
          block(packet, 'worktree reset failed after a diff-guard rejection', repairs, dir, branch);
          return;
        }
        continue;
      }

      // GATE (no LLM): the CLI runs every accept command; the exit code decides.
      setStatus(packet.id, 'gating');
      const commands = (packet.accept ?? []).map((entry) => entry.cmd);
      record({ kind: 'gate', packetId: packet.id, status: 'start', note: commands.join(' && ') });
      const gate = await safeGate(ports, packet, dir, commands);
      writeEvidence(packet.id, 'gate.txt', gate.commands.length === 0
        ? 'no acceptance commands were run\n'
        : gate.commands
            .map((command) => `--- ${command.cmd} (exit ${String(command.exitCode)}) ---\n${command.output}`)
            .join('\n\n'));
      for (const command of gate.commands) {
        record({
          kind: 'gate',
          packetId: packet.id,
          status: command.exitCode === 0 ? 'ok' : 'fail',
          note: `${command.cmd} (exit ${String(command.exitCode)})`,
        });
      }

      if (!gate.ok) {
        const output = gateOutput(gate);
        if (repairs >= maxRepairs) {
          block(packet, `gate failed after ${repairs} repair(s): ${firstLine(output)}`, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'gate', output };
        continue;
      }

      // VERIFIER (separate agent, ideally a different model). Only after a green gate.
      setStatus(packet.id, 'verifying');
      // A throttled verifier retries the verifier only; it must never make the
      // worker redo work it already finished, and never spend a repair.
      let verdict: VerifierVerdictResult | undefined;
      let verifierRateLimitRetries = 0;
      while (verdict === undefined) {
        let attempt: VerifierVerdictResult;
        try {
          attempt = await ports.verifier.verify({
            packet,
            diff,
            gate,
            model: config.verifierModel,
            recipe: plan.recipe,
          });
        } catch (error) {
          attempt = { pass: false, reasons: [`verifier failed: ${errorMessage(error)}`] };
        }
        record({
          kind: 'step',
          role: 'verifier',
          packetId: packet.id,
          status: attempt.rateLimited ? 'rate_limited' : attempt.pass ? 'ok' : 'fail',
          model: attempt.model ?? config.verifierModel,
          ...(typeof attempt.costUsd === 'number' ? { costUsd: attempt.costUsd } : {}),
          ...(typeof attempt.tokensUsed === 'number' ? { tokensUsed: attempt.tokensUsed } : {}),
          ...(!attempt.pass && !attempt.rateLimited && attempt.reasons.length > 0
            ? { note: attempt.reasons.join('; ') }
            : {}),
        });

        if (!attempt.rateLimited) {
          verdict = attempt;
          break;
        }
        verifierRateLimitRetries += 1;
        rateLimitEvents += 1;
        effectiveWorkers = Math.max(1, effectiveWorkers - 1);
        if (verifierRateLimitRetries >= maxRateLimitRetries) {
          block(packet, `verifier stayed rate limited after ${verifierRateLimitRetries} retries`, repairs, dir, branch);
          return;
        }
        await sleep(rateBackoff);
        rateBackoff = Math.min(MAX_BACKOFF_MS, rateBackoff * 2);
      }

      if (!verdict.pass) {
        const output = verdict.reasons.join('\n');
        writeEvidence(
          packet.id,
          'verdict.json',
          `${JSON.stringify({ pass: false, reasons: verdict.reasons, model: config.verifierModel }, null, 2)}\n`,
        );
        if (repairs >= maxRepairs) {
          block(packet, `verifier rejected the change: ${firstLine(output)}`, repairs, dir, branch);
          return;
        }
        repairs += 1;
        failure = { kind: 'verifier', output };
        continue;
      }

      // Tiny worker that crashed with no diff but a green gate: the verifier
      // still saw the diff and passed, so honour the gate as the decider.
      writeEvidence(
        packet.id,
        'verdict.json',
        `${JSON.stringify({ pass: true, reasons: [], model: config.verifierModel }, null, 2)}\n`,
      );
      setStatus(packet.id, 'done', undefined, repairs);
      outcomes.set(packet.id, outcomeFor(packet, 'done', repairs, undefined, dir, branch));
      record({ kind: 'packet', packetId: packet.id, status: 'done', note: worker.summary, role: 'scheduler' });
      return;
    }
  };

  // Dependency-ordered scheduling. A packet becomes eligible when every
  // dependency is `done`; the end-of-loop pass below marks everything else
  // `skipped`, so blocked work never stalls the packets that can still run.
  const terminalFor = (id: string): string | undefined => outcomes.get(id)?.status;

  // A packet that already reached a terminal state in a previous pass is
  // history, not work: `resume` reports it and never runs it again. Seeding the
  // outcomes from `state.json` is what makes that true — without it a blocked
  // packet would be eligible again and its worker would re-run.
  for (const packet of ports.store.state.packets) {
    if (packet.status === 'blocked' || packet.status === 'skipped' || packet.status === 'cancelled') {
      // Prefer the plan's title and scope so the report reads like the plan.
      const planned = plan.packets.find((entry) => entry.id === packet.id);
      outcomes.set(
        packet.id,
        outcomeFor(
          planned ?? { id: packet.id, title: packet.title, goal: '', scope: [], depends_on: [] },
          packet.status,
          packet.repairs ?? 0,
          packet.reason,
        ),
      );
    }
  }

  const doneIds = new Set(
    ports.store.state.packets.filter((packet) => packet.status === 'done').map((packet) => packet.id),
  );
  for (const id of skip) doneIds.add(id);

  while (true) {
    const eligible = plan.packets.filter(
      (packet) =>
        !outcomes.has(packet.id) &&
        !doneIds.has(packet.id) &&
        packet.depends_on.every((dep) => doneIds.has(dep) || terminalFor(dep) === 'done'),
    );

    if (eligible.length === 0) {
      // A budget pause is not a dependency failure: leave the remaining
      // packets untouched (they stay `pending`, so resume redoes them) and stop.
      if (pausedByBudget) break;
      // Anything left with a blocked/skipped dependency can never start.
      const stuck = plan.packets.filter(
        (packet) => !outcomes.has(packet.id) && !doneIds.has(packet.id),
      );
      if (stuck.length === 0) break;
      for (const packet of stuck) {
        const blockedDep = packet.depends_on.find(
          (dep) => terminalFor(dep) === 'blocked' || terminalFor(dep) === 'skipped',
        );
        const reason = blockedDep ? `dependency ${blockedDep} did not complete` : 'dependency cycle left it unschedulable';
        setStatus(packet.id, 'skipped', reason);
        outcomes.set(packet.id, outcomeFor(packet, 'skipped', 0, reason));
        record({ kind: 'packet', packetId: packet.id, status: 'skipped', note: reason, role: 'scheduler' });
      }
      break;
    }

    if (pausedByBudget) break;

    // Take up to `effectiveWorkers` eligible packets. Independent packets run
    // together; dependent ones are still gated by depends_on above.
    const batch = eligible.slice(0, effectiveWorkers);
    await Promise.all(batch.map((packet) => runPacket(packet)));

    for (const packet of batch) {
      if (outcomes.get(packet.id)?.status === 'done') doneIds.add(packet.id);
    }
  }

  const packets = plan.packets.map(
    (packet) =>
      outcomes.get(packet.id) ??
      // `skipPacketIds` (already done before this pass) and a done packet from a
      // wave are both `done`; only genuinely untouched work is `pending`.
      outcomeFor(packet, doneIds.has(packet.id) ? 'done' : 'pending', 0, doneIds.has(packet.id) ? undefined : 'not attempted'),
  );
  const anyBlocked = packets.some((entry) => entry.status === 'blocked');
  const allDone = packets.every((entry) => entry.status === 'done');
  // A completed packet pass is `partial` even when every packet is done: only
  // INTEGRATE may set `succeeded`, and integrate is a later step. A run that
  // still has pending work (budget pause) is `paused`, not `failed`.
  const anyPending = packets.some((entry) => entry.status === 'pending');
  const runStatus: RunStatus = pausedByBudget && anyPending
    ? 'paused'
    : allDone || anyBlocked || packets.some((entry) => entry.status === 'skipped')
      ? 'partial'
      : 'failed';

  const costUsd = ports.ledger
    .entries()
    .reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);

  return { runStatus, packets, rateLimitEvents, effectiveWorkers, costUsd };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeFailure(failure: RepairFailure): string {
  return `repairing after ${failure.kind} failure`;
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim().length > 0) ?? text;
}

function gateOutput(gate: GateResult): string {
  return gate.commands
    .filter((command) => command.exitCode !== 0)
    .map((command) => `--- ${command.cmd} (exit ${String(command.exitCode)}) ---\n${command.output}`)
    .join('\n\n');
}

/** Resets the worktree; returns false instead of throwing so the packet is still reported. */
async function safeReset(
  ports: ExecutePorts,
  packetId: string,
  dir: string,
  baseRef: string,
): Promise<boolean> {
  try {
    await ports.worktree.reset({ packetId, dir, baseRef });
    return true;
  } catch {
    return false;
  }
}

async function safeGate(
  ports: ExecutePorts,
  packet: PlanPacket,
  dir: string,
  commands: readonly string[],
): Promise<GateResult> {
  // A packet with no acceptance command has nothing to gate on. Failing closed
  // is the only honest answer: an empty `every()` would pass vacuously and let
  // the packet reach `done` without a single command having run.
  if (commands.length === 0) {
    return {
      ok: false,
      commands: [],
    };
  }
  try {
    return await ports.gate.run({ packet, worktreeDir: dir, commands });
  } catch (error) {
    return {
      ok: false,
      commands: [{ cmd: commands[0] ?? 'gate', exitCode: null, output: errorMessage(error) }],
    };
  }
}
