/**
 * INTEGRATE (spec §3.6, build step 5).
 *
 * Integrate is where a multi-packet run becomes one reviewable branch. It merges
 * the `done` packet branches into `ultra/<run>` in dependency order, runs the
 * project-wide gate on the combined tree, and puts the combined diff through a
 * final review pass.
 *
 * Two rules make this the only honest place to end a run:
 *
 *   1. Only this module may set `succeeded` (spec 6, ULT-10). The state layer
 *      also refuses any other `running → succeeded` transition, so a caller that
 *      skips integrate cannot claim success even by accident.
 *   2. Nothing here is allowed to call a run `succeeded` when the evidence does
 *      not support it. A conflicted merge, a failing suite, a failed review or a
 *      packet that never finished all end `partial` or `failed`, and the reason
 *      is written into the report rather than inferred from a status word.
 *
 * Like execute, every side effect is a port. The core decides the order and the
 * verdict; the CLI adapter supplies git, the shell and the review model.
 */

import type { Ledger } from './ledger.js';
import { buildNotes } from './notes.js';
import { RunStore } from './run-state.js';
import type {
  GateResult,
  PlanPacket,
  ReviewVerdict,
  RunStatus,
  UltraPlan,
} from './types.js';

/** One packet's merge result inside the run branch. */
export interface PacketMergeOutcome {
  readonly id: string;
  readonly title: string;
  readonly status: 'merged' | 'unmerged' | 'skipped';
  readonly reason?: string;
  readonly conflicts?: readonly string[];
}

export interface IntegratePorts {
  readonly git: {
    /** Creates (or resets) `ultra/<run>` at the base commit before merging. */
    createRunBranch(input: { readonly runId: string; readonly branch: string; readonly baseRef: string }): Promise<void>;
    /** Merges one packet branch; conflicts are reported, never resolved silently. */
    merge(input: {
      readonly runId: string;
      readonly packetId: string;
      readonly branch: string;
      readonly packetBranch: string;
    }): Promise<{ readonly ok: boolean; readonly conflicts: readonly string[]; readonly output: string }>;
    /** Aborts a conflicted merge so the run branch is left clean for inspection. */
    abortMerge(input: { readonly runId: string }): Promise<void>;
    /** Combined diff of the run branch against its base, for the review pass. */
    diff(input: { readonly runId: string; readonly baseRef: string }): Promise<string>;
    /** Creates the per-round checkpoint tag (spec 13.5). */
    tag(input: { readonly runId: string; readonly tag: string }): Promise<void>;
  };
  readonly gates: {
    /** Runs the project-wide gate commands on the merged tree. */
    run(input: {
      readonly runId: string;
      readonly commands: readonly string[];
    }): Promise<GateResult>;
  };
  readonly review: {
    review(input: {
      readonly goal: string;
      readonly diff: string;
      readonly gate: GateResult;
      readonly model: string;
    }): Promise<ReviewVerdict>;
  };
  /** Optional: writes `notes.md` after a round. Absent in tests that do not care. */
  readonly notes?: {
    write(input: { readonly runId: string; readonly content: string }): void;
  };
}

export interface IntegrateConfig {
  /** Commit the packets were built from. */
  readonly baseRef: string;
  /** The integration branch, `ultra/<run-id>`. */
  readonly runBranch: string;
  readonly reviewModel: string;
  /** Round number, used for the checkpoint tag; defaults to 1. */
  readonly round?: number;
}

/**
 * Curated run memory for the rounds that follow (spec 13.5). Integrate writes it
 * because the notes are the harness's account of what actually merged, not a
 * worker's claim about what it meant to do.
 */
export interface IntegrateNotes {
  readonly notes: readonly { readonly round: number; readonly kind: 'decision' | 'convention' | 'interface'; readonly text: string }[];
  readonly interfaces?: readonly { readonly packetId: string; readonly module: string; readonly summary: string }[];
}

export interface IntegrateInput {
  readonly plan: UltraPlan;
  readonly ports: IntegratePorts;
  readonly store: RunStore;
  readonly ledger: Ledger;
  readonly config: IntegrateConfig;
  /** Prior rounds' notes, carried forward; this round's are appended. */
  readonly notes?: IntegrateNotes;
}

export interface IntegrateResult {
  readonly runStatus: RunStatus;
  readonly packets: readonly PacketMergeOutcome[];
  readonly gate: GateResult;
  readonly review: ReviewVerdict;
  readonly diff: string;
  readonly costUsd: number;
}

/** The project-wide gate commands, in a stable order, from the plan or the repo. */
function fullSuiteCommands(plan: UltraPlan): string[] {
  const gates = plan.gates;
  if (!gates) return [];
  return [...gates.test, ...gates.lint, ...gates.build];
}

/**
 * Merges packets in dependency order.
 *
 * The plan's waves are the dependency order, but a blocked packet must not stop
 * an independent one, so the order is a topological sort over `depends_on` with
 * the packet id as a tie-break — deterministic, and independent of wave layout.
 */
function dependencyOrder(packets: readonly PlanPacket[]): PlanPacket[] {
  const byId = new Map(packets.map((packet) => [packet.id, packet]));
  const emitted = new Set<string>();
  const ordered: PlanPacket[] = [];
  const remaining = new Set(packets.map((packet) => packet.id));

  while (remaining.size > 0) {
    // Every packet whose dependencies are already emitted, smallest id first.
    const ready = [...remaining]
      .filter((id) => byId.get(id)!.depends_on.every((dep) => emitted.has(dep) || !remaining.has(dep)))
      .sort();
    if (ready.length === 0) {
      // Only reachable with a cycle, which plan validation rejects. Emit the
      // rest deterministically rather than looping forever.
      for (const id of [...remaining].sort()) {
        ordered.push(byId.get(id)!);
        remaining.delete(id);
      }
      break;
    }
    for (const id of ready) {
      ordered.push(byId.get(id)!);
      remaining.delete(id);
      emitted.add(id);
    }
  }
  return ordered;
}

/**
 * Runs INTEGRATE to a verdict. Never throws for an expected failure: every
 * failure mode is a status plus a reason, because the report has to be able to
 * say what happened.
 */
export async function runIntegrate(input: IntegrateInput): Promise<IntegrateResult> {
  const { plan, ports, store, ledger, config } = input;
  const round = config.round ?? 1;
  const record = (entry: Parameters<Ledger['append']>[0]): void => {
    ledger.append(entry);
  };

  // INTEGRATE owns the run status from here: `integrating` is the only state
  // from which `succeeded` is reachable (see RunStore.assertRunTransition).
  if (store.state.status !== 'integrating') store.transition('integrating');

  const doneIds = new Set(
    store.state.packets.filter((packet) => packet.status === 'done').map((packet) => packet.id),
  );

  try {
    await ports.git.createRunBranch({ runId: store.state.runId, branch: config.runBranch, baseRef: config.baseRef });
  } catch (error) {
    const reason = `could not create the run branch: ${errorMessage(error)}`;
    record({ kind: 'run', role: 'integrate', status: 'failed', note: reason });
    store.transition('failed');
    return {
      runStatus: 'failed',
      packets: plan.packets.map((packet) => ({ id: packet.id, title: packet.title, status: 'skipped', reason })),
      gate: { ok: false, commands: [] },
      review: { ok: false, problems: [reason] },
      diff: '',
      costUsd: totalCost(ledger),
    };
  }

  const packets: PacketMergeOutcome[] = [];
  let conflict: string | undefined;

  for (const packet of dependencyOrder(plan.packets)) {
    const branch = `${config.runBranch}/${packet.id}`;
    if (!doneIds.has(packet.id)) {
      // Not merged and not an error: the packet never finished, so integrate
      // reports it with the reason the scheduler recorded and leaves the branch
      // for the human.
      const state = store.state.packets.find((entry) => entry.id === packet.id);
      packets.push({
        id: packet.id,
        title: packet.title,
        status: 'skipped',
        reason: state?.reason ?? `packet is ${state?.status ?? 'not done'}, not done`,
      });
      continue;
    }

    let merge: { ok: boolean; conflicts: readonly string[]; output: string };
    try {
      merge = await ports.git.merge({
        runId: store.state.runId,
        packetId: packet.id,
        branch: config.runBranch,
        packetBranch: branch,
      });
    } catch (error) {
      merge = { ok: false, conflicts: [], output: errorMessage(error) };
    }

    if (!merge.ok) {
      conflict ??= `${packet.id}: ${merge.conflicts.length > 0 ? merge.conflicts.join(', ') : merge.output}`;
      packets.push({
        id: packet.id,
        title: packet.title,
        status: 'unmerged',
        reason: merge.conflicts.length > 0 ? `merge conflict in ${merge.conflicts.join(', ')}` : merge.output,
        ...(merge.conflicts.length > 0 ? { conflicts: merge.conflicts } : {}),
      });
      record({
        kind: 'packet',
        packetId: packet.id,
        status: 'unmerged',
        role: 'integrate',
        note: conflict,
      });
      // Leave the run branch clean: a half-merged tree is worse than none,
      // because the human cannot tell what landed.
      try {
        await ports.git.abortMerge({ runId: store.state.runId });
      } catch {
        // Best effort; the conflicts are already recorded above.
      }
      continue;
    }

    packets.push({ id: packet.id, title: packet.title, status: 'merged' });
    record({ kind: 'packet', packetId: packet.id, status: 'merged', role: 'integrate' });
  }

  // A conflict does not necessarily end the run: the packets that merged are
  // still worth reporting. It does end any claim of `succeeded`.
  const anyUnmerged = packets.some((entry) => entry.status === 'unmerged');
  // A packet that never reached `done` is equally disqualifying: a run that
  // merged everything it could and quietly dropped a blocked packet has not
  // finished the task, whatever the suite says.
  const anySkipped = packets.some((entry) => entry.status === 'skipped');

  const commands = fullSuiteCommands(plan);
  let gate: GateResult;
  if (commands.length === 0) {
    // Failing closed, for the same reason as a packet with no accept command:
    // an empty command list would pass vacuously and let a merged run be called
    // green without a single check having run.
    gate = { ok: false, commands: [] };
    record({ kind: 'gate', role: 'integrate', status: 'fail', note: 'no project-wide gate commands' });
  } else {
    try {
      gate = await ports.gates.run({ runId: store.state.runId, commands });
    } catch (error) {
      gate = {
        ok: false,
        commands: [{ cmd: commands[0] ?? 'gate', exitCode: null, output: errorMessage(error) }],
      };
    }
  }
  for (const command of gate.commands) {
    record({
      kind: 'gate',
      role: 'integrate',
      status: command.exitCode === 0 ? 'ok' : 'fail',
      note: `${command.cmd} (exit ${String(command.exitCode)})`,
    });
  }

  // The combined diff is what the final review pass sees: no packet's change is
  // reviewed only in isolation.
  let diff = '';
  try {
    diff = await ports.git.diff({ runId: store.state.runId, baseRef: config.baseRef });
  } catch (error) {
    record({ kind: 'step', role: 'integrate', status: 'diff_error', note: errorMessage(error) });
  }

  let review: ReviewVerdict = { ok: true, problems: [] };
  if (gate.ok) {
    try {
      review = await ports.review.review({
        goal: plan.goal,
        diff,
        gate,
        model: config.reviewModel,
      });
    } catch (error) {
      review = { ok: false, problems: [`final review failed to run: ${errorMessage(error)}`] };
    }
    record({
      kind: 'step',
      role: 'review',
      status: review.ok ? 'ok' : 'fail',
      model: config.reviewModel,
      ...(typeof review.costUsd === 'number' ? { costUsd: review.costUsd } : {}),
      ...(typeof review.tokensUsed === 'number' ? { tokensUsed: review.tokensUsed } : {}),
      ...(!review.ok ? { note: review.problems.join('; ') } : {}),
    });
  }

  const runStatus: RunStatus = !gate.ok
    ? 'failed'
    : !review.ok || anyUnmerged || anySkipped
      ? 'partial'
      : 'succeeded';

  if (runStatus === 'succeeded') {
    // The checkpoint is only meaningful for a round that actually landed.
    try {
      const tag = `ultra/${store.state.runId}/round-${round}`;
      await ports.git.tag({ runId: store.state.runId, tag });
      record({ kind: 'run', role: 'integrate', status: 'tagged', note: tag });
    } catch (error) {
      // A failed tag is not a failed integrate: the branch is the artifact.
      record({ kind: 'run', role: 'integrate', status: 'tag_failed', note: errorMessage(error) });
    }
  }

  // Curated run memory (spec 13.5): written by integrate, because the notes are
  // the harness's account of what landed, not a worker's claim about it. A write
  // failure is recorded and never fails a round that merged cleanly.
  if (ports.notes) {
    try {
      ports.notes.write({
        runId: store.state.runId,
        content: buildNotes({
          runId: store.state.runId,
          goal: plan.goal,
          notes: input.notes?.notes ?? [],
          interfaces: input.notes?.interfaces,
          rounds: round,
        }),
      });
    } catch (error) {
      record({ kind: 'step', role: 'integrate', status: 'notes_error', note: errorMessage(error) });
    }
  }

  store.transition(runStatus);
  record({
    kind: 'run',
    role: 'integrate',
    status: runStatus,
    note: anyUnmerged ? `unmerged: ${String(conflict)}` : undefined,
  });

  return { runStatus, packets, gate, review, diff, costUsd: totalCost(ledger) };
}

function totalCost(ledger: Ledger): number {
  return ledger.entries().reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
}

/**
 * Writes a run's terminal verdict.
 *
 * This lives here, next to INTEGRATE, because it is the only place allowed to
 * set `succeeded` (spec 6, ULT-10): the goal loop decides *whether* the run is
 * done, but the write goes through the one module that owns the run verdict. The
 * state layer still refuses any transition into `succeeded` from a state other
 * than `integrating`/`accepting`, so a caller that skips integrate and accept
 * cannot reach it even by calling this directly.
 */
export function finalizeRun(store: RunStore, status: RunStatus): void {
  store.transition(status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
