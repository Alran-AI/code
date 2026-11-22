/**
 * `alran ultra …` — the Ultra command surface.
 *
 * plan | run | status | pause | kill | resume | report. All decisions come from
 * the @alran/ultra core; this file is the CLI adapter: it reads the working
 * tree, persists run state under `.alran/ultra/`, executes the packets through
 * the runtime adapters, and prints. Integrate is a later step: execution stops
 * with every done packet on its own branch and nothing merged.
 */

import { existsSync, readFileSync, readSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import * as ultra from '@alran/ultra';
import {
  createUltraAcceptanceAdapter,
  createUltraAuditAdapter,
  createUltraExecAdapters,
  createUltraIntegrateAdapters,
  createUltraSpecTestAdapter,
} from './ultra-exec-adapters.js';
import { createUltraGoalAdapter, createUltraPlanAdapters } from './ultra-plan-adapters.js';
import { renderUltraRunDiff, ultraRefExists } from './ultra-diff.js';
import { reviewUltraRun } from './ultra-review.js';
import { baseRefForRun, commitSpecTestsAsBase } from './ultra-spec-base.js';
import { launchUltraRun, startUltraRunInBackground } from './ultra-launch.js';

export interface UltraCommandOptions {
  readonly cwd?: string;
  /**
   * The command that starts Alran Code; defaults to the running entry point.
   * Injected by tests so a review does not reach for the real binary.
   */
  readonly alranCommand?: readonly string[];
  readonly write?: (text: string) => void;
  readonly exit?: (code: number) => void;
  readonly now?: () => Date;
  /** Injected so `plan` can be exercised in tests without a model call. */
  readonly planPhase?: (input: ultra.PlanRunInput) => Promise<ultra.PlanRunResult>;
  readonly planPorts?: ultra.UltraPlanPorts;
  readonly roles?: ultra.PlannerRoleConfig;
  /** Execution adapters; injected by tests, built from the runtime otherwise. */
  readonly execAdapters?: Omit<ultra.ExecutePorts, 'store' | 'ledger' | 'evidence'>;
  /** Integrate adapters; injected by tests, built from the runtime otherwise. */
  readonly integrateAdapters?: ultra.IntegratePorts;
  /**
   * Goal-loop adapters (accept, planNextRound). Injected by tests; the runtime
   * builds them from headless calls when a goal-driven run starts.
   */
  readonly goalLoop?: Partial<ultra.LoopPorts>;
  /** Injected by tests so a goal-driven run does not need a model to plan. */
  readonly goalPlanner?: (input: {
    readonly round: number;
    readonly goal: ultra.GoalDocument;
  }) => Promise<{ readonly packets: ultra.PlanPacket[]; readonly goal?: string }>;
  /** Injected by tests: builds the goal document from the task. */
  readonly goalBuilder?: (input: { readonly task: string }) => Promise<ultra.GoalDocument>;
  /**
   * Injected by tests: the authoring turn that writes the criteria (spec 13.1).
   * Separate from `goalBuilder` because a test can then exercise the real wiring
   * — ledger record, goal.json, the printout — without calling a model.
   */
  readonly goalAuthor?: (input: {
    readonly goal: string;
    readonly recipe: string;
    readonly structure?: string;
    readonly model: string;
  }) => Promise<{ readonly goal: ultra.GoalDocument; readonly costUsd?: number }>;
  /** Injected by tests: authors the frozen spec tests before workers start. */
  readonly specTestAuthor?: (input: {
    readonly goal: ultra.GoalDocument;
    readonly testCommands?: readonly string[];
  }) => Promise<{ readonly files: ultra.SpecTestFile[] }>;
  /** Injected by tests: the interim auditor (spec 13.4). */
  readonly goalAudit?: (input: {
    readonly round: number;
    readonly goal: ultra.GoalDocument;
    readonly notes: string;
  }) => Promise<{ readonly findings: ultra.AuditFinding[] }>;
  /** Injected by tests: the review fleet's ports, so a review needs no model. */
  readonly reviewPorts?: ultra.ReviewPorts;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * Starts a detached runner. Injected so a test can assert what a background
   * run would launch without spawning a process.
   */
  readonly launch?: typeof launchUltraRun;
  /** Creates the run and starts it detached; injected by tests. */
  readonly startBackground?: typeof startUltraRunInBackground;
  /** Asks the human to confirm a plan; injected by tests, real TTY prompt otherwise. */
  readonly confirm?: () => Promise<boolean>;
  /**
   * Liveness probe for a background runner. Injected so a test can decide
   * whether a pid is alive instead of depending on the machine's process table.
   */
  readonly isAlive?: (pid: number) => boolean;
}

const STATE_DIR = '.alran/ultra';

/** Run statuses a board can no longer change; used to freeze its elapsed time. */
const TERMINAL_RUN_STATUSES: ReadonlySet<ultra.RunStatus> = new Set([
  'succeeded',
  'partial',
  'failed',
  'killed',
  'stalled',
]);

function runId(now: Date): string {
  // Sortable timestamp plus 8 random hex chars. The space is large enough that a
  // collision means "practically never", but `RunStore.create` refuses to reuse
  // an id anyway, so a collision can never overwrite another run's state.
  const stamp = now.toISOString().replace(/[-:T]/gu, '').slice(0, 12);
  const suffix = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, '0');
  return `run-${stamp}-${suffix}`;
}

/**
 * Parses `--budget` once, here, so both the single-round and goal paths agree
 * on what `none` and a typo mean. Throws on a typo: a bad cap must not silently
 * become an unlimited run.
 */
/**
 * The model every Ultra role uses unless one is configured.
 *
 * Empty means "the model this CLI is configured with", which is what the rest of
 * the product does when you pass no `--model`. A hard-coded provider-qualified id
 * here is a silent assumption about which providers the user is signed in to, and
 * that is exactly what a live run hit: the explorers, which pass no model, worked
 * while the planner died with `401 This session is not valid`.
 */
export const DEFAULT_ROLE_MODEL = '';

/**
 * The recipe files for a repository, or nothing if there are none (spec §8).
 *
 * A broken file throws, which the command turns into a failed run: a rule the
 * author wrote and nobody followed is exactly what this must not allow.
 */
function loadRecipeOverridesFor(cwd: string): ultra.RecipeOverrides {
  return ultra.loadRecipeOverrides(path.join(cwd, '.alran', 'recipes')).overrides;
}

/**
 * Reports paths a read-only role changed and the guard reverted.
 *
 * Loud on purpose: a planning agent that writes files is a model doing something
 * it was told not to do, and the human running the plan should know it happened
 * rather than finding out from a diff later.
 */
function reportUnexpectedWrite(write: (text: string) => void, paths: readonly string[]): void {
  const shown = paths.slice(0, 5).join(', ');
  const rest = paths.length > 5 ? `, +${String(paths.length - 5)} more` : '';
  write(
    `warning: a read-only planning step changed ${String(paths.length)} file(s) (${shown}${rest}); ` +
      'the change was reverted.\n',
  );
}

function parseBudget(raw: string | boolean | undefined): number | null {
  return ultra.parseBudgetUsd(typeof raw === 'string' ? raw : raw === undefined ? '2' : String(raw));
}

/**
 * Parses `--recipe` once, here, so a typo is a usage error instead of a label.
 * A wrong value that reached the planner would drop the recipe's ordering rules
 * and extra verifier checks while the plan still claimed to be, say, a migration.
 */
function parseRecipe(raw: string | boolean | undefined): ultra.UltraRecipeChoice {
  return ultra.parseRecipeChoice(typeof raw === 'string' ? raw : 'auto');
}

function hasGateCommands(gates: ultra.UltraGates): boolean {
  return gates.test.length > 0 || gates.lint.length > 0 || gates.build.length > 0;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export interface ExecuteUltraPlanInput {
  /** Per-repository recipe files (spec §8); loaded from cwd when absent. */
  readonly recipeOverrides?: ultra.RecipeOverrides;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly store: ultra.RunStore;
  readonly plan: ultra.UltraPlan;
  readonly write: (text: string) => void;
  readonly execAdapters?: Omit<ultra.ExecutePorts, 'store' | 'ledger' | 'evidence'>;
  readonly integrateAdapters?: ultra.IntegratePorts;
  readonly roles?: ultra.PlannerRoleConfig;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Parallel worker cap for this pass; the caller resolves it against the run. */
  readonly workers: number;
  readonly maxRepairs: number;
  readonly baseRef?: string;
  /** Whether this pass belongs to a single-run or a goal-driven run. */
  readonly mode?: 'run' | 'goal';
  /** Liveness probe for the driver record; injected so a test need not use a real pid. */
  readonly isAlive?: (pid: number) => boolean;
}

/**
 * Executes a validated plan and integrates it — everything `alran ultra run`
 * does after planning.
 *
 * It is exported so the TUI board's resume key runs the same code as the CLI
 * instead of growing a second, quietly diverging implementation of the same
 * execute-and-merge sequence.
 */
export async function executeUltraPlan(input: ExecuteUltraPlanInput): Promise<ultra.RunStatus> {
  const { store, plan, write } = input;
  // The plan is checked here, at the one place every surface goes through, so
  // the CLI and the TUI cannot disagree about what may run. A plan that was
  // edited after the planner wrote it — or a plan that was written by an
  // older, broken version of Ultra — is refused before a single worktree
  // exists, with the reasons spelled out.
  const validation = ultra.validatePlan(plan);
  if (!validation.ok) {
    write('The plan of this run is not valid, so nothing was executed:\n');
    for (const problem of validation.problems) write(`  - ${problem}\n`);
    store.transition('failed');
    return 'failed';
  }
  // A stop request that was left behind — by a run that was killed before it
  // could read it, or by a `pause` that arrived between the last safe point
  // and the end of the pass — must not stop this pass before it starts. The
  // request belongs to the pass that was running; this one is a new one.
  ultra.clearControl(store.paths);
  // Recipe files are loaded before anything runs: a broken file must stop the
  // run, not quietly fall back to the built-in rules.
  let recipeOverrides: ultra.RecipeOverrides;
  try {
    recipeOverrides = input.recipeOverrides ?? loadRecipeOverridesFor(input.cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`Recipe file error: ${message}\n`);
    store.transition('failed');
    return 'failed';
  }
  const ledger = ultra.Ledger.open(store.paths.ledger);
  const adapters =
    input.execAdapters ??
    createUltraExecAdapters({ cwd: input.cwd, env: input.env, recipeOverrides });
  // Only one process may drive a run. Two passes over the same worktrees
  // would fight over the same files, and the loser would merge a half-written
  // branch into the run.
  if (
    !claimDriver(
      store,
      input.mode ?? 'run',
      store.state.goal,
      plan.recipe,
      input.isAlive,
    )
  ) {
    write(
      'Another process is already driving this run; this pass did not start. ' +
        'Wait for that one to finish, or stop it first.\n',
    );
    return store.state.status;
  }
  store.transition('running');
  write(`Executing ${plan.packets.length} packet(s)…\n`);

  const result = await (async () => {
    // Ctrl+C must pause the run, not kill the process. A dead process leaves
    // the run saying `running` with nobody behind it, and `resume` refuses a
    // running run — the work would be stranded until somebody edited the state
    // by hand. The handler writes the stop request; the scheduler stops at its
    // next safe point and leaves a run that `resume` can pick up.
    const releaseInterrupt = installInterruptHandler({ store, write });
    try {
      return await ultra.runExecute({
        plan,
        ports: {
          ...adapters,
          store,
          ledger,
          evidence: ultra.createFileEvidenceWriter(store.paths.packets),
          // A long pass must not look frozen. Every decision point the scheduler
          // makes is written out as it happens; the same lines land in the
          // detached runner's log, so `alran ultra attach` shows them too.
          progress: (event) => write(`${ultra.renderProgressEvent(event)}\n`),
          // The stop request: `alran ultra pause`/`kill` from another terminal
          // and the Ctrl+C handler below both arrive as a file next to the run.
          // It is consumed when it is read, so a request that this pass has
          // already honoured cannot stop the next one.
          control: () => ultra.takeControl(store.paths),
        },
        config: {
          workers: input.workers,
          maxRepairs: input.maxRepairs,
          workerModel: input.roles?.planner ?? DEFAULT_ROLE_MODEL,
          verifierModel: input.roles?.critic ?? DEFAULT_ROLE_MODEL,
        },
        ...(input.sleep ? { sleep: input.sleep } : {}),
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
        skipPacketIds: store.state.packets
          .filter((packet) => packet.status === 'done')
          .map((packet) => packet.id),
      });
    } finally {
      releaseInterrupt();
    }
  })();

  // Persist the outcome so `status` and `report` reflect the real run state
  // instead of leaving the run stuck on `running` after this pass returns.
  store.transition(result.runStatus);

  write(formatExecution(result));
  const blocked = result.packets.filter((packet) => packet.status === 'blocked');
  const done = result.packets.filter((packet) => packet.status === 'done');
  write(
    `\nPackets: ${String(done.length)} done, ${String(blocked.length)} blocked, ` +
      `${String(result.packets.filter((p) => p.status === 'skipped').length)} skipped.\n`,
  );

  // A stopped pass is not integrated. The packets that did not run are still to
  // do, and integrating a half-finished plan would merge a partial tree and
  // write a verdict over a run that is waiting to be resumed — the very thing
  // the stop was for.
  if (result.runStatus === 'paused' || result.runStatus === 'killed') {
    writeFileSync(
      store.paths.report,
      ultra.buildReport({
        state: store.state,
        ledger,
        plan,
        ...(result.runStatus === 'killed' ? { killed: true } : {}),
      }),
    );
    write(
      `\nRun ${store.state.runId} is ${result.runStatus}. ` +
        `Resume it with \`alran ultra resume ${store.state.runId}\`; the packets that already passed are not repeated.\n`,
    );
    return result.runStatus;
  }

  // INTEGRATE (spec 3.6): merge the done packets into the run branch, run the
  // full suite and put the combined diff through a final review. This is the
  // only step that may call the run `succeeded`.
  const integrateAdapters =
    input.integrateAdapters ??
    createUltraIntegrateAdapters({
      cwd: input.cwd,
      env: input.env,
      recipeOverrides,
    });
  const integrated = await ultra.runIntegrate({
    plan,
    ports: integrateAdapters,
    store,
    ledger,
    config: {
      baseRef: input.baseRef ?? 'HEAD',
      runBranch: ultra.runBranchFor(store.state.runId),
      reviewModel: input.roles?.critic ?? DEFAULT_ROLE_MODEL,
    },
  });

  // The report is written from durable state plus the integrate verdict, so
  // its cost is the ledger's arithmetic and not a second counter.
  writeFileSync(
    store.paths.report,
    ultra.buildReport({ state: store.state, ledger, plan, integrate: integrated }),
  );
  write(formatIntegrate(integrated));
  write(`\nReport: ${store.paths.report}\n`);
  write(
    `Review the branch with \`git merge ${ultra.runBranchFor(store.state.runId)}\`; nothing was pushed.\n`,
  );

  return integrated.runStatus;
}

/**
 * Records that this process is the one driving the run.
 *
 * A run started in the foreground has no runner record, so `status` cannot tell
 * whether it is still going — it says "running" about a run whose process died
 * with the terminal. The record says who is driving it, so an interrupted run
 * can be reported as interrupted and resumed.
 *
 * Only the first writer wins: a detached child was already recorded by the
 * process that spawned it, and a child that claimed the run would make
 * `status` call a background run a foreground one.
 *
 * The return value is the claim. `false` means another live process is already
 * driving the run, and the caller must not start a second pass.
 */
function claimDriver(
  store: ultra.RunStore,
  mode: 'run' | 'goal',
  task: string,
  recipe: string,
  isAlive?: (pid: number) => boolean,
): boolean {
  return ultra.claimRunner(
    store.paths,
    {
      runId: store.state.runId,
      mode,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      logPath: 'runner.log',
      task,
      budgetUsd: store.state.budgetUsd,
      recipe: recipe as ultra.UltraRecipeChoice,
      workers: store.state.workers ?? 4,
      foreground: true,
    },
    isAlive ?? ultra.processAlive,
  );
}

/** The plan's project-wide gates, or `undefined` when there is no plan yet. */
function planGatesOf(store: ultra.RunStore): ultra.UltraGates | undefined {
  if (!existsSync(store.paths.plan)) return undefined;
  try {
    const plan = JSON.parse(readFileSync(store.paths.plan, 'utf8')) as ultra.UltraPlan;
    return plan.gates;
  } catch {
    // A malformed plan file must not hide the rest of the status.
    return undefined;
  }
}

/**
 * Collects a repeatable option into a list.
 *
 * Commander overwrites a plain option when it is given twice, so a repeatable
 * one needs a collector that keeps what came before.
 */
function collectGate(value: string, previous: readonly string[]): string[] {
  return [...previous, value];
}

/**
 * The gate groups the reader overrode, or `undefined` when none were.
 *
 * An override replaces the detected group rather than adding to it: a reader
 * who says `--test-gate "pnpm test:unit"` means that command and not the one
 * detection guessed.
 */
function gateOverridesFrom(
  options: Record<string, string | boolean | undefined>,
): Partial<ultra.UltraGates> | undefined {
  const test = toCommandList(options.testGate);
  const lint = toCommandList(options.lintGate);
  const build = toCommandList(options.buildGate);
  if (test.length === 0 && lint.length === 0 && build.length === 0) return undefined;
  return {
    ...(test.length > 0 ? { test } : {}),
    ...(lint.length > 0 ? { lint } : {}),
    ...(build.length > 0 ? { build } : {}),
  };
}

/** One option, given once or many times, as a list of commands. */
function toCommandList(value: string | boolean | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/**
 * Turns Ctrl+C into a pause request instead of a dead process.
 *
 * Without a handler the terminal's SIGINT kills the CLI outright: the run stays
 * `running` in its state file with nobody behind it, and `resume` refuses a
 * running run. The work is then stranded until somebody edits the state by
 * hand. With the handler the request travels to the scheduler, which stops at
 * the next safe point and leaves a run that `resume` can pick up.
 *
 * A second signal means the person is not willing to wait for a safe point: it
 * quits at once. The run stays resumable either way, because the request was
 * already written before the second signal.
 */
export function installInterruptHandler(input: {
  readonly store: ultra.RunStore;
  readonly write: (text: string) => void;
}): () => void {
  let asked = false;
  const handler = (signal: NodeJS.Signals): void => {
    const stoppedRunId = input.store.state.runId;
    if (asked) {
      // The process is about to die, so the run must not be left saying
      // `running`: nobody would be behind it, and a run in that state cannot
      // be resumed. The state is written here, because the scheduler will not
      // get the chance to.
      try {
        input.store.transition('paused');
      } catch {
        // The state machine refused it; the run keeps the status it has.
      }
      // The person is not waiting for a safe point. Our handler steps aside and
      // the signal is raised again, so whatever the host does with it — the
      // TUI's graceful stop, or the default terminate — still happens. An
      // abrupt exit here would skip the host's own shutdown.
      input.write(`\n${signal} again: leaving now. The run stays resumable — \`alran ultra resume ${stoppedRunId}\`.\n`);
      process.off(signal, handler);
      process.kill(process.pid, signal);
      return;
    }
    asked = true;
    try {
      ultra.writeControl(input.store.paths, 'pause');
    } catch {
      // The request could not be delivered. Saying so is better than a
      // cheerful message that the run is about to stop when it is not.
      input.write(`\n${signal} received, but the stop request could not be written; the run keeps going.\n`);
      return;
    }
    input.write(`\n${signal} received: the run stops at the next safe point. Press Ctrl+C again to quit now.\n`);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return () => {
    process.off('SIGINT', handler);
    process.off('SIGTERM', handler);
  };
}

function formatExecution(result: ultra.ExecuteRunResult): string {
  const lines: string[] = [];
  lines.push(`Execution: ${result.runStatus}  cost=${formatUsd(result.costUsd)}  workers=${String(result.effectiveWorkers)}`);
  if (result.rateLimitEvents > 0) {
    lines.push(`Upstream rate limits: ${String(result.rateLimitEvents)} (parallelism reduced, retried)`);
  }
  for (const packet of result.packets) {
    const repairs = packet.repairs > 0 ? `  repairs=${String(packet.repairs)}` : '';
    const reason = packet.reason ? `  ${packet.reason}` : '';
    lines.push(`  ${packet.id}  ${packet.status.padEnd(10)} ${packet.title}${repairs}${reason}`);
  }
  return lines.join('\n');
};

function formatIntegrate(result: ultra.IntegrateResult): string {
  const lines: string[] = [];
  lines.push(`\nIntegrate: ${result.runStatus}  cost=${formatUsd(result.costUsd)}`);
  for (const packet of result.packets) {
    const detail = packet.reason ? `  ${packet.reason}` : '';
    lines.push(`  ${packet.id}  ${packet.status.padEnd(10)} ${packet.title}${detail}`);
  }
  const failed = result.gate.commands.filter((command) => command.exitCode !== 0);
  if (failed.length > 0) {
    lines.push(`Full suite: ${String(failed.length)} command(s) failed`);
    for (const command of failed) lines.push(`  ${command.cmd} (exit ${String(command.exitCode)})`);
  }
  if (!result.review.ok) {
    lines.push('Final review rejected the combined diff:');
    for (const problem of result.review.problems) lines.push(`  - ${problem}`);
  }
  return lines.join('\n');
}

/**
 * The subcommands of `alran ultra`. Anything else after `ultra` is a task.
 *
 * Shared with the argv normalizer so the two cannot disagree about what counts
 * as a subcommand.
 */
export const ULTRA_SUBCOMMANDS: readonly string[] = Object.freeze([
  'plan',
  'run',
  'goal',
  'status',
  'runs',
  'board',
  'review',
  'attach',
  'pause',
  'kill',
  'resume',
  'report',
  'help',
]);

/**
 * Rewrites `alran ultra "<task>"` into `alran ultra run "<task>"` (spec 2).
 *
 * Commander cannot express "a subcommand with the same flags as the command it
 * sits under" without the parent's option defaults leaking into every child, so
 * the bare form is normalised once, before parsing, and every run then goes
 * through the single `run` implementation.
 */
export function normalizeUltraArgv(argv: readonly string[]): string[] {
  const out = [...argv];
  const index = out.indexOf('ultra');
  if (index === -1 || index + 1 >= out.length) return out;
  const next = out[index + 1];
  if (next === undefined) return out;
  // A flag means there is no subcommand to displace: `ultra --help`.
  if (next.startsWith('-')) return out;
  if ((ULTRA_SUBCOMMANDS as readonly string[]).includes(next)) return out;
  out.splice(index + 1, 0, 'run');
  return out;
}

/**
 * Reads one line from stdin without waiting for EOF.
 *
 * `readFileSync(0)` would block until the user pressed Ctrl+D, which is not what
 * a `y/N` question means. One byte at a time stops at the newline.
 */
function readAnswerFromStdin(): string {
  const buffer = Buffer.alloc(1);
  const chars: string[] = [];
  for (;;) {
    let bytes: number;
    try {
      bytes = readSync(0, buffer, 0, 1, null);
    } catch {
      break;
    }
    if (bytes === 0) break;
    const char = buffer.toString('utf8');
    if (char === '\n') break;
    if (char === '\r') continue;
    chars.push(char);
  }
  return chars.join('');
}

/** The lines that tell a reader what they attached to, and that it is following. */
function attachHeader(
  state: ultra.RunState,
  runner: ultra.UltraRunnerRecord | undefined,
  lines: number,
): string {
  // A live runner gets the full sentence (it names the pid); a finished or
  // interrupted one gets the short status word, because the footer explains how
  // it ended and repeating the whole sentence twice reads as two instructions.
  const classification = runner
    ? ultra.classifyRunner({ record: runner, runStatus: state.status })
    : undefined;
  const who = !classification
    ? 'started in the foreground'
    : classification.status === 'running'
      ? classification.detail
      : classification.status;
  const history =
    lines > 0
      ? `Last ${String(lines)} line(s); following. Press Ctrl+C to stop.`
      : 'No output yet; following.';
  return `${[
    `Attached to ${state.runId} — ${state.status} — ${who}`,
    `Goal: ${state.goal}`,
    history,
  ].join('\n')}\n`;
}

/**
 * What a reader sees when the process they followed goes away.
 *
 * Written as its own sentence rather than a copy of the header's status line: the
 * header described the run when the reader attached, and this says how it ended.
 * Repeating the same sentence twice would read like two different instructions.
 */
function attachFooter(
  state: ultra.RunState,
  runner: ultra.UltraRunnerRecord | undefined,
  paths: { readonly report: string; readonly log: string },
): string {
  const classification = ultra.classifyRunner({ record: runner, runStatus: state.status });
  if (classification.status === 'interrupted') {
    // The word `interrupted` is the same one `status` and the board use, so a
    // reader learns one vocabulary rather than three.
    return (
      `Detached: interrupted — the runner is gone and the run stopped at ${state.status}; ` +
      `resume it with \`alran ultra resume ${state.runId}\`.`
    );
  }
  if (classification.status === 'running') {
    return 'Detached: the process check was inconclusive; look at `alran ultra status`.';
  }
  // A run that stopped before INTEGRATE has no report; pointing at a file that
  // does not exist would be worse than pointing at the log that does.
  const output = existsSync(paths.report) ? paths.report : paths.log;
  return `Detached: the run ended as ${state.status}. Full output: ${output}`;
}

export function registerUltraCommand(program: Command, options: UltraCommandOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const exit = options.exit ?? ((code: number) => { process.exitCode = code; });
  const stateDir = path.join(cwd, STATE_DIR);

  /** Creates a run with a fresh id, retrying rather than ever reusing one. */
  const createFreshRun = (
    dir: string,
    input: { readonly goal: string; readonly budgetUsd: number | null; readonly now: Date },
  ): ultra.RunStore => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return ultra.RunStore.create(dir, {
          runId: runId(input.now),
          goal: input.goal,
          budgetUsd: input.budgetUsd,
          now: input.now,
        });
      } catch (error) {
        // Only an id collision is retryable; anything else is a real failure.
        if (!/already exists/iu.test(error instanceof Error ? error.message : '')) throw error;
      }
    }
    throw new Error(`could not allocate a unique Ultra run id in ${dir}`);
  };

  /**
   * Recipe files for this run (spec §8).
   *
   * Loaded once and handed to every adapter, so the planner's prompt, the
   * verifier's checklist and the packets' readonly paths all agree on the same
   * definition. A broken file fails the command instead of quietly running the
   * built-in: a rule the author wrote and nobody followed is the failure this
   * guards against.
   */
  let recipeOverrides: ultra.RecipeOverrides;
  try {
    recipeOverrides = loadRecipeOverridesFor(cwd);
  } catch (error) {
    write(`Recipe file error: ${error instanceof Error ? error.message : String(error)}\n`);
    exit(1);
    return;
  }

  const openRun = (id?: string): ultra.RunStore => {
    if (!existsSync(stateDir)) {
      throw new Error(`no Ultra runs in ${STATE_DIR}; run \`alran ultra "<task>"\` first`);
    }
    if (!id) {
      // `status`/`resume`/`kill` with no id act on the only run when exactly one exists.
      const ids = readdirSync(stateDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
      if (ids.length !== 1) {
        throw new Error(
          ids.length === 0
            ? `no Ultra runs in ${STATE_DIR}`
            : `several Ultra runs exist; pass a run id: ${ids.join(', ')} (see \`alran ultra runs\`)`,
        );
      }
      return ultra.RunStore.open(stateDir, ids[0]!);
    }
    return ultra.RunStore.open(stateDir, id);
  };

  const root = program
    .command('ultra')
    .description('Ultra: plan large multi-packet tasks and hand back a reviewable branch')
    .showHelpAfterError();

  const applyTaskOptions = (command: Command): Command =>
    command
      .option('--recipe <name>', 'migrate, bughunt, refactor, testgen or audit (default: auto)')
      .option('--budget <usd>', 'hard cost cap in USD', '2')
      .option('--workers <count>', 'max parallel workers (1-8)', '4')
      .option('--max-repairs <count>', 'repair attempts per packet', '2')
      .option('--base <ref>', 'commit to branch from (default: current HEAD)')
      .option('--stash', 'allow starting on a dirty tree by snapshotting it')
      .option('--model <id>', 'model for every Ultra role (default: the configured model)')
      .option(
        '--force-scope',
        'plan and run even when the scope check says the task does not need Ultra',
      )
      .option(
        '--force-critic',
        'execute a plan the critic rejected (its objections are still printed)',
      )
      .option('--yes', 'skip the cost confirmation (the budget cap still applies)')
      .option('--detach', 'start the run in the background and return at once')
      // The project-wide gates are detected from the repository, which is a
      // guess about a project the harness has never seen. These replace the
      // detected group, so `--test-gate "pnpm test:unit"` means exactly that
      // command and nothing else.
      .option('--test-gate <cmd>', 'replace the detected project-wide test gate', collectGate, [])
      .option('--lint-gate <cmd>', 'replace the detected project-wide lint gate', collectGate, [])
      .option('--build-gate <cmd>', 'replace the detected project-wide build gate', collectGate, [])
      // Internal: the detached child continues the run the parent already
      // created instead of allocating a second one.
      .addOption(new Option('--adopt <run-id>', 'continue an existing run').hideHelp())
      .allowExcessArguments(false);

  const formatPlan = (result: ultra.PlanRunResult): string => {
    const lines: string[] = [];
    lines.push(`Plan for: ${result.plan.goal}`);
    lines.push(`Recipe: ${result.plan.recipe}`);
    lines.push(`Cost so far: ${formatUsd(result.costUsd)}`);
    const gates = result.plan.gates;
    if (gates) {
      lines.push(
        `Gates: test=[${gates.test.join(', ')}] lint=[${gates.lint.join(', ')}] build=[${gates.build.join(', ')}]`,
      );
    }
    lines.push('');
    for (const packet of result.plan.packets) {
      const deps = packet.depends_on.length > 0 ? ` (after ${packet.depends_on.join(', ')})` : '';
      lines.push(`  ${packet.id}  ${packet.title}  scope=${packet.scope.join(',')}${deps}`);
    }
    if (result.validation.ok) {
      const waves = result.validation.waves.map((wave) => wave.join('+')).join(' → ');
      lines.push(`\nParallel waves: ${waves}`);
    } else {
      lines.push('\nPlan problems:');
      for (const problem of result.validation.problems) lines.push(`  - ${problem}`);
    }
    if (!result.critic.ok) {
      lines.push('\nCritic objections:');
      for (const problem of result.critic.problems) lines.push(`  - ${problem}`);
    }
    return lines.join('\n');
  };

  /** Whether this run still has a process behind it, in one line. */
  const runnerDetail = (store: ultra.RunStore, runStatus: ultra.RunStatus): string =>
    ultra.classifyRunner({
      record: ultra.readRunner(store.paths),
      runStatus,
      ...(options.isAlive ? { isAlive: options.isAlive } : {}),
    }).detail;

  /** Reads a plan written by an earlier pass, or `undefined` when it is unusable. */
  const readExistingPlan = (store: ultra.RunStore): ultra.UltraPlan | undefined => {
    try {
      const plan = JSON.parse(readFileSync(store.paths.plan, 'utf8')) as ultra.UltraPlan;
      return Array.isArray(plan.packets) && plan.packets.length > 0 ? plan : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * Asks the human to confirm a plan (spec 2).
   *
   * A non-interactive stdin cannot answer, and guessing would spend money, so it
   * refuses and names the flag that skips the question. Only a real terminal is
   * asked.
   */
  const confirmExecution = async (): Promise<boolean> => {
    if (options.confirm) return options.confirm();
    if (!process.stdin.isTTY) {
      write('This shell cannot ask for confirmation; re-run with --yes to accept the plan.\n');
      return false;
    }
    const answer = readAnswerFromStdin();
    return ultra.isConfirmationAccepted(answer);
  };

  /** The confirmation text for a freshly planned run (spec 2, O-7). */
  const renderConfirmation = (store: ultra.RunStore, result: ultra.PlanRunResult): string => {
    let goalDoc: ultra.GoalDocument | undefined;
    if (existsSync(store.paths.goal)) {
      try {
        goalDoc = ultra.parseGoalDocument(JSON.parse(readFileSync(store.paths.goal, 'utf8')));
      } catch {
        // A malformed goal file must not block the plan from being shown.
      }
    }
    return ultra.renderUltraConfirmation({
      runId: store.state.runId,
      goal: store.state.goal,
      plan: result.plan,
      ...(goalDoc ? { goalDoc } : {}),
      budgetUsd: store.state.budgetUsd,
      workers: store.state.workers ?? 4,
      recipe: result.plan.recipe,
    });
  };

  /** Executes a validated plan to the end of its packets, then integrates. */
  const executeRun = async (
    store: ultra.RunStore,
    plan: ultra.UltraPlan,
    commandOptions: Record<string, string | boolean | undefined>,
  ): Promise<void> => {
    const integrated = await executeUltraPlan({
      cwd,
      env: process.env,
      store,
      plan,
      write,
      // The stored cap wins when the caller did not pass `--workers`, so the
      // board's `+`/`-` keys and a later `resume` agree on one number.
      workers: Number(commandOptions.workers ?? store.state.workers ?? 4),
      maxRepairs: Number(commandOptions.maxRepairs ?? 2),
      // A resumed run has no authoring step in front of it, so the base is read
      // from the branch that already carries the frozen checks. Passing a bare
      // `HEAD` here would bring the worktrees back without them and the resumed
      // run would quietly lose the checks it started with.
      baseRef: baseRefForRun({
        cwd,
        runId: store.state.runId,
        ...(typeof commandOptions.base === 'string' && commandOptions.base.length > 0
          ? { requested: commandOptions.base }
          : {}),
      }),
      ...(options.execAdapters ? { execAdapters: options.execAdapters } : {}),
      ...(options.integrateAdapters ? { integrateAdapters: options.integrateAdapters } : {}),
      ...(options.roles ? { roles: options.roles } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.isAlive ? { isAlive: options.isAlive } : {}),
    });
    if (integrated !== 'succeeded') exit(1);
  };

  const planAction = async (
    goal: string,
    commandOptions: Record<string, string | boolean | undefined>,
    executeAfter: boolean,
  ): Promise<void> => {
    // The gate overrides are read before anything else: they change the plan,
    // so they have to be in hand before the planner runs.
    const gateOverrides = gateOverridesFrom(commandOptions);
    const guard = ultra.evaluateStartGuard({
      ...ultra.probeWorkingTree(cwd),
      stash: commandOptions.stash === true,
    });
    if (!guard.ok) {
      for (const problem of guard.problems) write(`${problem}\n`);
      exit(1);
      return;
    }

    const now = options.now?.() ?? new Date();
    let budgetUsd: number | null;
    try {
      budgetUsd = parseBudget(commandOptions.budget);
    } catch (error) {
      // A bad `--budget` is a usage error, not a crash: say so and exit 1.
      write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
      return;
    }
    let recipe: ultra.UltraRecipeChoice;
    try {
      recipe = parseRecipe(commandOptions.recipe);
    } catch (error) {
      write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
      return;
    }
    const adopted = typeof commandOptions.adopt === 'string' ? commandOptions.adopt : undefined;

    // A background run returns here, before any planning: the detached child
    // does the work with its output going to the run's log file.
    if (commandOptions.detach === true && !adopted) {
      const started = (options.startBackground ?? startUltraRunInBackground)(
        {
          mode: 'run',
          task: goal,
          budgetUsd,
          recipe,
          workers: Number(commandOptions.workers ?? 4),
          maxRepairs: Number(commandOptions.maxRepairs ?? 2),
          ...(typeof commandOptions.base === 'string' && commandOptions.base.length > 0
            ? { baseRef: commandOptions.base }
            : {}),
          stash: commandOptions.stash === true,
        },
        { cwd, ...(options.now ? { now: options.now } : {}) },
      );
      write(
        `Ultra run ${started.runId} started in the background (pid ${String(started.pid)}).
` +
          `It keeps running when this shell closes. Log: ${started.logPath}
` +
          `Follow it with /ultra ${started.runId} or \`alran ultra board ${started.runId}\`.
`,
      );
      return;
    }

    const store = adopted
      ? ultra.RunStore.open(stateDir, adopted)
      : createFreshRun(stateDir, { goal, budgetUsd, now });
    if (!adopted) store.transition('planning');
    // Record the worker cap on the run itself, so the board shows the number the
    // run will really use and `resume` cannot silently fall back to a default.
    store.setWorkers(Number(commandOptions.workers ?? 4));

    // An adopted run that already has a plan continues from it rather than
    // planning twice: this is how a restarted child picks up where it stopped.
    if (adopted && existsSync(store.paths.plan)) {
      const existing = readExistingPlan(store);
      if (existing) {
        write(`Continuing ${store.state.runId} from its existing plan.
`);
        await executeRun(store, existing, commandOptions);
        return;
      }
    }

    // Planning needs model access through ports. The runtime adapter supplies
    // them from headless `alran exec` calls; a test can inject `planPorts`
    // instead, and `planPhase` short-circuits the whole phase.
    const planner =
      options.planPhase ??
      ((input: ultra.PlanRunInput) =>
        ultra.runPlanPhase({
          ...input,
          ports:
            options.planPorts ??
            createUltraPlanAdapters({
              cwd,
              env: process.env,
              recipeOverrides,
              // A reader who attaches should see the run move, not a silent
              // screen while the model works.
              onProgress: (message) => write(`  ${message}…\n`),
            }),
        }));
    if (!planner) {
      write(
        'Ultra planning needs a model adapter, which this build does not include yet.\n' +
          `The run ${store.state.runId} was created in ${STATE_DIR}, but no plan was produced.\n`,
      );
      store.transition('failed');
      exit(1);
      return;
    }

    // One model for every role unless `--model` names one. Empty means "the
    // configured default", so Ultra runs on the same model as the rest of the CLI.
    const roleModel =
      typeof commandOptions.model === 'string' && commandOptions.model.trim().length > 0
        ? commandOptions.model.trim()
        : DEFAULT_ROLE_MODEL;

    let result: ultra.PlanRunResult;
    try {
      result = await planner({
        goal,
        recipe,
        roles: options.roles ?? {
          planner: roleModel,
          critic: roleModel,
          explorers: 3,
        },
        ports: options.planPorts as ultra.UltraPlanPorts,
        ...(commandOptions.forceScope === true ? { forceScope: true } : {}),
        // The gates the reader overrode, if any. The plan carries whichever
        // wins, so the confirmation shows what will actually run.
        ...(gateOverrides ? { gateOverrides } : {}),
      });
    } catch (error) {
      // A failed planner call is a failed run, not an unhandled rejection: the
      // human needs the reason and the run directory to inspect.
      write(`Planning failed: ${error instanceof Error ? error.message : String(error)}\n`);
      store.transition('failed');
      exit(1);
      return;
    }

    if (result.forcedScope) {
      write(
        `Scope check said this task does not need Ultra (${result.forcedScope})\n` +
          'Continuing anyway because --force-scope was given.\n',
      );
    }

    if (result.declined) {
      write(`This task does not need Ultra: ${result.declined}\n`);
      store.transition('failed');
      return;
    }

    store.setPackets(result.plan.packets.map((packet) => ({ id: packet.id, title: packet.title })));
    // Planning is real spend: the explorers, the planner and the critic all cost
    // tokens. Recording it here is what makes the report's total the whole run
    // rather than only its workers, and what lets the budget cap account for the
    // work that happened before the first packet existed.
    if (result.costUsd > 0) {
      ultra.Ledger.open(store.paths.ledger).append({
        kind: 'run',
        role: 'planning',
        status: 'planned',
        costUsd: result.costUsd,
        note: 'explorers, planner and critic',
      });
    }
    write(formatPlan(result));
    write(`\nRun: ${store.state.runId}  (state written to ${STATE_DIR})\n`);
    if (!result.validation.ok) {
      store.transition('failed');
      exit(1);
      return;
    }
    // The critic is not a second opinion to print and ignore: every packet below
    // would be built on a plan it just rejected. Stop here, having shown the
    // plan and the objections, and let a human fix it or overrule it.
    if (!result.critic.ok && commandOptions.forceCritic !== true) {
      write(
        'The critic rejected this plan. Nothing was executed.\n' +
          'Rework the plan, or re-run with --force-critic to execute it anyway.\n',
      );
      store.transition('failed');
      exit(1);
      return;
    }
    if (!result.critic.ok) {
      write('Executing a plan the critic rejected, because --force-critic was given.\n');
    }
    // Persist the plan so a later `resume` can execute without re-planning.
    writeFileSync(store.paths.plan, `${JSON.stringify(result.plan, null, 2)}\n`);
    store.transition('awaiting_confirm');

    if (!executeAfter) {
      write('Plan is valid. Execution is separate; nothing has been changed.\n');
      return;
    }

    // Spec 2: the run waits here until a human says yes. `--yes` skips the
    // question, never the budget cap — the tracker still pauses at 100 %.
    if (commandOptions.yes !== true) {
      write(`\n${renderConfirmation(store, result)}\n`);
      const accepted = await confirmExecution();
      if (!accepted) {
        // The run keeps its plan and its state, so it can be executed later with
        // `--yes` or `resume`. Nothing was spent.
        write('Aborted. Nothing was changed; the plan is kept in the run directory.\n');
        return;
      }
    }

    await executeRun(store, result.plan, commandOptions);
  };

  /**
   * A goal-driven run (spec 13): plan against a goal document, then repeat
   * execute → integrate → accept → gap analysis until every `must` criterion is
   * met or a stop condition fires. This is the only command that can reach
   * `succeeded` through ACCEPT rather than a single INTEGRATE.
   */
  const goalAction = async (
    task: string,
    commandOptions: Record<string, string | boolean | undefined>,
  ): Promise<void> => {
    const guard = ultra.evaluateStartGuard({
      ...ultra.probeWorkingTree(cwd),
      stash: commandOptions.stash === true,
    });
    if (!guard.ok) {
      for (const problem of guard.problems) write(`${problem}\n`);
      exit(1);
      return;
    }

    const now = options.now?.() ?? new Date();
    let budgetUsd: number | null;
    try {
      budgetUsd = parseBudget(commandOptions.budget);
    } catch (error) {
      write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
      return;
    }
    let recipe: ultra.UltraRecipeChoice;
    try {
      recipe = parseRecipe(commandOptions.recipe);
    } catch (error) {
      write(`${error instanceof Error ? error.message : String(error)}\n`);
      exit(1);
      return;
    }
    const adopted = typeof commandOptions.adopt === 'string' ? commandOptions.adopt : undefined;

    // Same contract as `run`: a detached goal run returns before planning.
    if (commandOptions.detach === true && !adopted) {
      const started = (options.startBackground ?? startUltraRunInBackground)(
        {
          mode: 'goal',
          task,
          budgetUsd,
          recipe,
          workers: Number(commandOptions.workers ?? 4),
          maxRepairs: Number(commandOptions.maxRepairs ?? 2),
          maxRounds: Number(commandOptions.maxRounds ?? 10),
          stallRounds: Number(commandOptions.stallRounds ?? 2),
          maxHours: Number(commandOptions.maxHours ?? 0),
          auditEvery: Number(commandOptions.auditEvery ?? 3),
          ...(typeof commandOptions.base === 'string' && commandOptions.base.length > 0
            ? { baseRef: commandOptions.base }
            : {}),
          stash: commandOptions.stash === true,
        },
        { cwd, ...(options.now ? { now: options.now } : {}) },
      );
      write(
        `Ultra goal run ${started.runId} started in the background (pid ${String(started.pid)}).
` +
          `It keeps running when this shell closes. Log: ${started.logPath}
` +
          `Follow it with /ultra ${started.runId}.
`,
      );
      return;
    }

    const store = adopted
      ? ultra.RunStore.open(stateDir, adopted)
      : createFreshRun(stateDir, { goal: task, budgetUsd, now });
    if (!adopted) store.transition('planning');
    store.setWorkers(Number(commandOptions.workers ?? 4));

    // Build the goal document first: the criteria are what the run is judged
    // against, and everything after this is sized to them.
    //
    // This is a turn of its own, not a by-product of planning. The planner
    // answers "how do I split the work"; the author answers "what does done
    // mean". Deriving criteria from packet titles made every criterion a `must`
    // and every description a packet name, which is what made budget sizing
    // unable to drop anything and `partial` unreachable.
    const buildGoal =
      options.goalBuilder ??
      (async (): Promise<ultra.GoalDocument> => {
        // Injected plan ports win, so a caller that already has adapters (a test,
        // a cloud runner) does not pay for a second set behind its back.
        const ports =
          options.planPorts ??
          createUltraPlanAdapters({
            cwd,
            env: process.env,
            onProgress: (message) => write(`  ${message}…\n`),
            onUnexpectedWrite: (paths) => reportUnexpectedWrite(write, paths),
          });
        const structure = await ports.explore({
          role: 'structure',
          systemPrompt: '',
          userPrompt: `Task: ${task}`,
        });
        const author =
          options.goalAuthor ??
          ((input: { goal: string; recipe: string; structure?: string; model: string }) =>
            createUltraGoalAdapter({
              cwd,
              env: process.env,
              onProgress: (message) => write(`  ${message}…\n`),
            }).author(input));
        const authored = await author({
          goal: task,
          recipe,
          ...(structure.text.trim().length > 0 ? { structure: structure.text } : {}),
          model: options.roles?.planner ?? DEFAULT_ROLE_MODEL,
        });
        if (authored.costUsd !== undefined && authored.costUsd > 0) {
          ultra.Ledger.open(store.paths.ledger).append({
            kind: 'run',
            role: 'goal author',
            status: 'authored',
            costUsd: authored.costUsd,
          });
        }
        return authored.goal;
      });

    let goal: ultra.GoalDocument;
    try {
      goal = await buildGoal({ task });
    } catch (error) {
      write(`Could not build the goal document: ${String(error)}\n`);
      store.transition('failed');
      exit(1);
      return;
    }
    writeFileSync(store.paths.goal, `${JSON.stringify(goal, null, 2)}\n`);
    write(`Goal: ${goal.goal}\n`);
    for (const criterion of goal.criteria) {
      write(`  ${criterion.id} (${criterion.priority}) ${criterion.description}\n`);
    }

    // Author the frozen spec tests BEFORE any worker starts (spec 13.2, ULT-13).
    // They are written into the run directory for review; a failure here stops
    // the run, because starting workers without acceptance checks would mean
    // judging the run on the workers' own tests.
    const specAdapter = {
      author:
        options.specTestAuthor ??
        ((input: { goal: ultra.GoalDocument; testCommands?: readonly string[] }) =>
          createUltraSpecTestAdapter({ cwd, env: process.env }).author(input)),
    };
    const testCommands = ultra.detectUltraGates(
      await createUltraPlanAdapters({ cwd, env: process.env }).readGateSources(),
    ).test;
    // Every packet and the run branch start here, so the checks are in every
    // worktree (the gate can run them) and no worker can edit one (a diff that
    // touches them is a scope violation, as before).
    let baseRef =
      typeof commandOptions.base === 'string' && commandOptions.base.length > 0
        ? commandOptions.base
        : 'HEAD';
    try {
      const authored = await specAdapter.author({
        goal,
        ...(testCommands.length > 0 ? { testCommands } : {}),
      });
      ultra.createFileSpecTestWriter(path.join(store.paths.root, 'spec-tests')).write({
        files: authored.files,
      });
      const base = commitSpecTestsAsBase({
        cwd,
        env: process.env,
        runId: store.state.runId,
        baseRef,
        files: authored.files,
      });
      baseRef = base.branch;
      ultra.Ledger.open(store.paths.ledger).append({
        kind: 'run',
        role: 'spec tests',
        status: 'committed',
        note: `${String(authored.files.length)} check(s) frozen on ${base.branch} (${base.commit.slice(0, 7)})`,
      });
      write(
        `Spec tests: ${String(authored.files.length)} file(s) authored in ${ultra.SPEC_TEST_DIR}/ and ` +
          `frozen on ${base.branch} (read-only for workers)\n`,
      );
    } catch (error) {
      write(
        `Spec-test authoring failed: ${error instanceof Error ? error.message : String(error)}\n` +
          'No workers were started, because the run has no acceptance checks.\n',
      );
      store.transition('failed');
      exit(1);
      return;
    }

    // Interim audits default to every 3 rounds (spec 5, `audit_every`).
    const auditEvery = Number(commandOptions.auditEvery ?? 3);
    const adapters = options.execAdapters ?? createUltraExecAdapters({ cwd, env: process.env });
    const integrateAdapters =
      options.integrateAdapters ?? createUltraIntegrateAdapters({ cwd, env: process.env, recipeOverrides });
    const ledger = ultra.Ledger.open(store.paths.ledger);

    const ports: ultra.LoopPorts = {
      execute: async ({ round, plan, packets }) => {
        write(`\nRound ${String(round)}: executing ${String(packets.length)} packet(s)\n`);
        // Each round can introduce new packets (gap analysis), and the scheduler
        // reads a packet's status from state.json — so the round's packets are
        // registered before anything runs. Packets already terminal are kept,
        // which is what makes a round resumable.
        const existing = new Map(store.state.packets.map((packet) => [packet.id, packet]));
        store.setPackets(
          plan.packets.map((packet) => ({
            id: packet.id,
            title: packet.title,
            status: existing.get(packet.id)?.status ?? 'pending',
          })),
        );
        store.transition('running');
        // The same record a foreground run needs, so `status` can say whether
        // anything is still driving it. The claim is honoured: a second
        // process must not run a second pass over the same worktrees.
        if (!claimDriver(store, 'goal', store.state.goal, plan.recipe, options.isAlive)) {
          write(
            'Another process is already driving this run; this round did not start. ' +
              'The run stays resumable.\n',
          );
          return { donePacketIds: [], runStatus: 'paused' };
        }
        // The same stop channel as the single-round path: a pause request from
        // another terminal, or Ctrl+C, stops the round at its next safe point
        // and leaves the run resumable.
        const releaseInterrupt = installInterruptHandler({ store, write });
        let result: ultra.ExecuteRunResult;
        try {
          result = await ultra.runExecute({
            plan,
            ports: {
              ...adapters,
              store,
              ledger,
              evidence: ultra.createFileEvidenceWriter(store.paths.packets),
              // Same narration as the single-round path, so a goal run reads the
              // same way a run does.
              progress: (event) => write(`${ultra.renderProgressEvent(event)}\n`),
              // The stop request is consumed when it is read, so a request
              // this pass has honoured cannot stop the next one.
              control: () => ultra.takeControl(store.paths),
            },
            config: {
              // The stored cap wins when the caller did not pass `--workers`, so
              // the board's `+`/`-` keys and a later `resume` agree on one number.
              workers: Number(commandOptions.workers ?? store.state.workers ?? 4),
              maxRepairs: Number(commandOptions.maxRepairs ?? 2),
              workerModel: options.roles?.planner ?? DEFAULT_ROLE_MODEL,
              verifierModel: options.roles?.critic ?? DEFAULT_ROLE_MODEL,
              specTestDir: ultra.SPEC_TEST_DIR,
            },
            ...(options.sleep ? { sleep: options.sleep } : {}),
            baseRef,
            skipPacketIds: store.state.packets
              .filter((packet) => packet.status === 'done')
              .map((packet) => packet.id),
          });
        } finally {
          releaseInterrupt();
        }
        return {
          donePacketIds: result.packets.filter((p) => p.status === 'done').map((p) => p.id),
          runStatus: result.runStatus,
        };
      },
      integrate: async ({ round, plan }) => {
        const integrated = await ultra.runIntegrate({
          plan,
          ports: integrateAdapters,
          store,
          ledger,
          config: {
            baseRef,
            runBranch: ultra.runBranchFor(store.state.runId),
            reviewModel: options.roles?.critic ?? DEFAULT_ROLE_MODEL,
            round,
          },
          notes: {
            notes: [],
          },
        });
        // A failed integrate ends the run; the loop must not plan another round
        // on a tree that does not build.
        if (integrated.runStatus === 'failed') {
          throw new Error('integrate failed');
        }
        return integrated;
      },
      accept:
        options.goalLoop?.accept ??
        (async ({ round, goal: current }) => {
          // The runtime acceptor exercises the real result. Without one, an
          // unmet criterion stays unmet rather than being assumed met.
          const acceptance = createUltraAcceptanceAdapter({ cwd, env: process.env });
          return acceptance.accept({ round, goal: current });
        }),
      planNextRound:
        options.goalLoop?.planNextRound ??
        options.goalPlanner ??
        (async () => ({ packets: [] })),
    };

    let loopResult: ultra.LoopResult;
    try {
      // Round 1 needs packets before the loop can execute anything. The planner
      // is the same one the loop uses for gap analysis, so the first round is
      // planned by the same code path as every later one.
      const firstPlan =
        options.goalPlanner ??
        options.goalLoop?.planNextRound ??
        (async () => ({ packets: [] as ultra.PlanPacket[] }));
      const initial = await firstPlan({ round: 1, goal });

      // A plan with no gates cannot be integrated: the full-suite gate is what
      // decides whether the merged round is green. Detect the repo's own commands
      // so a plan that omitted them still has a real gate.
      const gateSources = await createUltraPlanAdapters({ cwd, env: process.env }).readGateSources();
      const detected = ultra.detectUltraGates(gateSources);
      // The reader's overrides replace the detected group, the same way they do
      // for a single-round run.
      const goalGateOverrides = gateOverridesFrom(commandOptions);
      const gates = ultra.applyGateOverrides(detected, goalGateOverrides ?? {});
      const firstRoundPlan: ultra.UltraPlan = {
        goal: task,
        recipe,
        packets: initial.packets,
        ...(hasGateCommands(gates) ? { gates } : {}),
      };
      if (!hasGateCommands(gates)) {
        write(
          'Warning: no project-wide gate commands were detected, so integrate will ' +
            'fail closed rather than claim a green run.\n',
        );
      }

      loopResult = await ultra.runGoalLoop({
        store,
        ledger,
        goal,
        plan: firstRoundPlan,
        ports,
        config: {
          maxRounds: Number(commandOptions.maxRounds ?? 10),
          stallRounds: Number(commandOptions.stallRounds ?? 2),
          ...(commandOptions.maxHours !== undefined ? { maxHours: Number(commandOptions.maxHours) } : {}),
          ...(auditEvery > 0 ? { auditEvery } : {}),
        },
        // Auditing is optional; without it no audit is run and none is claimed.
        ...(auditEvery > 0
          ? {
              auditPorts: {
                audit:
                  options.goalAudit ??
                  ((input: { round: number; goal: ultra.GoalDocument; notes: string }) =>
                    createUltraAuditAdapter({ cwd, env: process.env }).audit(input)),
              },
            }
          : {}),
      });
    } catch (error) {
      write(`Goal run stopped: ${String(error)}\n`);
      store.transition('failed');
      exit(1);
      return;
    }

    write(`\nGoal run: ${loopResult.runStatus} — ${loopResult.reason}\n`);
    for (const criterion of goal.criteria) {
      const mark = criterion.status === 'met' ? 'ok' : criterion.status;
      write(`  ${criterion.id}  ${mark.padEnd(12)} ${criterion.description}\n`);
    }
    writeFileSync(store.paths.goal, `${JSON.stringify(goal, null, 2)}\n`);
    writeFileSync(
      store.paths.report,
      ultra.buildReport({
        state: store.state,
        ledger,
        goal,
        plan: { goal: task, recipe: 'auto', packets: [] },
        rounds: loopResult.rounds.map((round) => ({
          round: round.round,
          costUsd: round.integrate.costUsd,
          result: round.integrate.runStatus,
        })),
      }),
    );
    write(`\nReport: ${store.paths.report}\n`);
    if (loopResult.runStatus === 'paused' || loopResult.runStatus === 'killed') {
      // A run that stopped on purpose is waiting to be continued, and the
      // command that continues it is named here rather than left to be guessed.
      write(
        `Resume it with \`alran ultra resume ${store.state.runId}\`; the criteria that are already met are not checked again.\n`,
      );
    }
    if (loopResult.runStatus !== 'succeeded') exit(1);
  };

  applyTaskOptions(
    root
      .command('plan')
      .description('Plan a task without executing it')
      .argument('<task>', 'the task to plan'),
  ).action((task: string, commandOptions: Record<string, string | boolean | undefined>) =>
    planAction(task, commandOptions, false),
  );

  applyTaskOptions(
    root
      // Bare `alran ultra "<task>"` is plan → confirm → execute; `plan` is the
      // explicit plan-only entry point.
      .command('run', { isDefault: true })
      .description('Plan, confirm, then execute every packet; leaves the run unmerged for review')
      .argument('<task>', 'the task to run'),
  ).action((task: string, commandOptions: Record<string, string | boolean | undefined>) =>
    planAction(task, commandOptions, true),
  );

  applyTaskOptions(
    root
      .command('goal')
      .description('Plan against a goal document, then loop rounds until every must criterion is met')
      .option('--max-rounds <count>', 'max rounds of the outer loop (0 = unlimited)', '10')
      .option('--stall-rounds <count>', 'stop as stalled after this many rounds without progress', '2')
      .option('--max-hours <hours>', 'optional wall-clock cap (0 = off)', '0')
      .option('--audit-every <count>', 'run an interim audit every N rounds (0 = off)', '3')
      .argument('<task>', 'the goal to reach'),
  ).action((task: string, commandOptions: Record<string, string | boolean | undefined>) =>
    goalAction(task, commandOptions),
  );

  root
    .command('status')
    .description('Show one run (or the only run) and what is left')
    .argument('[run-id]', 'run to inspect')
    .action((id?: string) => {
      const store = openRun(id);
      const state = store.state;
      write(`${state.runId}  ${state.status}  budget=${state.budgetUsd === null ? 'unlimited' : formatUsd(state.budgetUsd)}\n`);
      write(`Goal: ${state.goal}\n`);
      // The runner says whether this run still needs its shell. A run that was
      // started detached keeps going after the terminal closes, and a runner
      // that vanished without finishing is the case a user must hear about.
      write(`Runner: ${runnerDetail(store, state.status)}\n`);
      // Goal-driven runs are judged against criteria, not only packets, so show
      // both: the criteria say what the run is for, the packets say what it did.
      if (existsSync(store.paths.goal)) {
        try {
          const goal = ultra.parseGoalDocument(JSON.parse(readFileSync(store.paths.goal, 'utf8')));
          const counts = ultra.goalCounts(goal);
          write(
            `Criteria: ${String(counts.met)}/${String(counts.total)} met  ` +
              `must=${String(counts.must)} needs_human=${String(counts.needsHuman)} ` +
              `regressed=${String(counts.regressed)}\n`,
          );
          for (const criterion of goal.criteria) {
            write(
              `  ${criterion.id}  ${criterion.status.padEnd(12)} (${criterion.priority}) ${criterion.description}\n`,
            );
          }
        } catch {
          // A malformed goal file is reported by the goal command; status must
          // still show the packets rather than failing.
        }
      }
      for (const packet of state.packets) {
        const reason = packet.reason ? `  ${packet.reason}` : '';
        write(`  ${packet.id}  ${packet.status.padEnd(10)} ${packet.title}${reason}\n`);
      }
      // The commands the merge will be checked against. Detection is a guess
      // about a repository, so the reader is better off seeing it.
      const gates = planGatesOf(store);
      if (gates) {
        const commands = [...gates.test, ...gates.lint, ...gates.build];
        write(
          commands.length > 0
            ? `Gates: ${commands.join(' · ')}\n`
            : 'Gates: none detected\n',
        );
      }
      const remaining = store.resumablePacketIds();
      if (remaining.length > 0) write(`Resumable: ${remaining.join(', ')}\n`);
      // What to do next, so the status is the end of the answer and not the
      // beginning of another question.
      const step = ultra.nextStepFor(state, stopDriver(store));
      if (step.kind === 'resume') {
        write(`Next: resume it with \`alran ultra resume ${state.runId}\`\n`);
      } else if (step.kind === 'merge') {
        write(`Next: review the branch, then merge it with \`git merge ${step.branch}\`\n`);
      }
    });

  root
    .command('runs')
    .description('List every Ultra run on disk, newest first')
    .option('--width <columns>', 'list width in columns (40-200)', '100')
    .action((commandOptions: Record<string, string | boolean | undefined> = {}) => {
      // The listing is derived from the runs' own state files, so it cannot
      // claim a run that does not exist — and a run whose state cannot be read
      // is listed as unreadable instead of silently disappearing.
      const listing = ultra.listUltraRuns(stateDir);
      const requested = Number(commandOptions.width ?? 100);
      const width = Number.isFinite(requested)
        ? Math.min(200, Math.max(40, Math.floor(requested)))
        : 100;
      write(`${ultra.renderRunList(listing, width)}\n`);
    });

  root
    .command('review')
    .description('Review what a run produced: a fleet of independent reviewers, every finding verified')
    .option('--reviewers <count>', 'how many lenses to run (1-8)', '3')
    .option('--budget <usd>', 'hard cost cap in USD for the review', '2')
    .option('--model <id>', 'model for the reviewers and the verifier')
    .argument('[run-id]', 'run to review')
    .action(async (id: string | undefined, commandOptions: Record<string, string | boolean | undefined>) => {
      const store = openRun(id);
      let budgetUsd: number | null;
      try {
        budgetUsd = parseBudget(commandOptions.budget);
      } catch (error) {
        write(`${error instanceof Error ? error.message : String(error)}\n`);
        exit(1);
        return;
      }
      const requested = Number(commandOptions.reviewers ?? 3);
      const reviewers = Number.isFinite(requested)
        ? Math.min(ultra.MAX_REVIEWERS, Math.max(1, Math.floor(requested)))
        : 3;
      const model =
        typeof commandOptions.model === 'string' && commandOptions.model.trim().length > 0
          ? commandOptions.model.trim()
          : DEFAULT_ROLE_MODEL;

      write(
        `Reviewing ${store.state.runId} with ${String(reviewers)} reviewer(s): ` +
          `${ultra.REVIEW_LENSES.slice(0, reviewers).map((lens) => lens.title).join(', ')}\n`,
      );
      try {
        const { result, reportPath } = await reviewUltraRun({
          cwd,
          env: process.env,
          store,
          ...(options.alranCommand ? { alranCommand: options.alranCommand } : {}),
          ...(options.reviewPorts ? { ports: options.reviewPorts } : {}),
          reviewers,
          budgetUsd,
          model,
          onProgress: (message) => write(`  ${message}…\n`),
        });
        write(`${ultra.formatReviewSummary(result)}\n`);
        // A review of a run that is still going covers the change as it is now.
        // Saying so keeps the report from reading like a verdict on a finished
        // run.
        if (!ultra.isTerminalRunStatus(store.state.status)) {
          write(
            `\nThe run is ${store.state.status}: this review covers the change as it is now, not the finished run.\n`,
          );
        }
        write(`\nReview: ${reportPath}\n`);
      } catch (error) {
        write(`${error instanceof Error ? error.message : String(error)}\n`);
        exit(1);
      }
    });

  root
    .command('diff')
    .description('Show what the run produced: the diff against HEAD and the command for the full patch')
    .argument('[run-id]', 'run to inspect')
    .action((id?: string) => {
      const store = openRun(id);
      const runBranch = ultra.runBranchFor(store.state.runId);
      write(
        `${renderUltraRunDiff({
          cwd,
          runId: store.state.runId,
          packets: store.state.packets,
          runBranchExists: ultraRefExists(cwd, runBranch),
        })}\n`,
      );
    });

  root
    .command('board')
    .description('Render the run board: round, cost and every packet at a glance')
    .option('--width <columns>', 'board width in columns (40-200)', '100')
    .argument('[run-id]', 'run to show')
    .action((id?: string, commandOptions: Record<string, string | boolean | undefined> = {}) => {
      const store = openRun(id);
      const ledger = ultra.Ledger.open(store.paths.ledger);
      const state = store.state;

      // The board is built from the same durable files the report uses, so it
      // cannot claim progress that state.json does not record.
      let packets: readonly ultra.PlanPacket[] = [];
      if (existsSync(store.paths.plan)) {
        try {
          packets = (JSON.parse(readFileSync(store.paths.plan, 'utf8')) as ultra.UltraPlan).packets;
        } catch {
          // A corrupt plan must not hide the packets the run did run.
        }
      }
      let criteria: ultra.Criterion[] | undefined;
      if (existsSync(store.paths.goal)) {
        try {
          criteria = ultra.parseGoalDocument(JSON.parse(readFileSync(store.paths.goal, 'utf8'))).criteria;
        } catch {
          // A malformed goal file is reported by `status`; the board still shows packets.
        }
      }

      const requested = Number(commandOptions.width ?? 100);
      if (!Number.isFinite(requested)) {
        write(`invalid width: ${String(commandOptions.width)}\n`);
        exit(1);
        return;
      }
      const width = Math.min(200, Math.max(40, Math.floor(requested)));
      const rounds = packets.map((packet) => packet.round ?? 1);
      const round = rounds.length > 0 ? Math.max(...rounds) : undefined;

      // A live run counts up to now; a finished one freezes at its last ledger
      // entry, so the elapsed time does not keep growing after the run is over.
      const finished = TERMINAL_RUN_STATUSES.has(state.status);
      const entries = ledger.entries();
      const last = entries.length > 0 ? entries[entries.length - 1]?.at : undefined;
      const endMs = finished ? Date.parse(last ?? state.createdAt) : (options.now?.() ?? new Date()).getTime();
      const elapsedMs = Number.isFinite(endMs) ? endMs - Date.parse(state.createdAt) : undefined;

      write(
        `${ultra.renderUltraBoard({
          runId: state.runId,
          goal: state.goal,
          state,
          packets,
          ...(criteria ? { criteria } : {}),
          costUsd: ledger.totalCostUsd(),
          budgetUsd: state.budgetUsd,
          ...(round === undefined ? {} : { round }),
          phase: ultra.boardPhase(state.status),
          ...(elapsedMs === undefined ? {} : { elapsedMs }),
          workers: state.workers ?? 4,
          runner: runnerDetail(store, state.status),
          width,
          // A snapshot has no keys to offer; advertising [p]ause here would
          // suggest an interactive board that this command does not run.
          keys: [],
        })}\n`,
      );
    });

  /**
   * Who is driving this run right now.
   *
   * `live` means a process is behind it, `dead` that one was and is gone, and
   * `unknown` that the run was started in the foreground and nobody knows.
   */
  const stopDriver = (store: ultra.RunStore): ultra.UltraControlDriver => {
    const classification = ultra.classifyRunner({
      record: ultra.readRunner(store.paths),
      runStatus: store.state.status,
      ...(options.isAlive ? { isAlive: options.isAlive } : {}),
    });
    return ultra.driverFromRunnerStatus(classification.status);
  };

  /**
   * Decides what a stop request means for this run.
   *
   * The run's `state.json` belongs to the process that drives it, so a second
   * process cannot stop it by writing that file: the driver overwrites the
   * change with its next save. The request therefore travels through a file of
   * its own, and only a run with no driver gets its state changed here.
   */
  const stopDecision = (
    store: ultra.RunStore,
    request: ultra.UltraControlRequest,
  ): ultra.UltraControlDecision =>
    ultra.decideControl({
      request,
      runStatus: store.state.status,
      driver: stopDriver(store),
    });

  root
    .command('pause')
    .description('Pause a running run at the next safe point')
    .argument('<run-id>', 'run to pause')
    .action((id: string) => {
      const store = ultra.RunStore.open(stateDir, id);
      const decision = stopDecision(store, 'pause');
      if (decision.refusal) {
        write(`${decision.refusal}\n`);
        exit(1);
        return;
      }
      if (decision.request) ultra.writeControl(store.paths, 'pause');
      if (decision.apply) store.transition('paused');
      write(
        decision.request && decision.apply
          ? `Paused ${id}. A process that is still driving it stops at the next safe point. Resume with \`alran ultra resume ${id}\`.\n`
          : decision.request
            ? `Pause requested for ${id}. The run stops at the next safe point. Resume with \`alran ultra resume ${id}\`.\n`
            : `Paused ${id}. Resume with \`alran ultra resume ${id}\`.\n`,
      );
    });

  root
    .command('kill')
    .description('Stop a run but keep its worktrees and ledger for inspection')
    .argument('<run-id>', 'run to stop')
    .action((id: string) => {
      const store = ultra.RunStore.open(stateDir, id);
      const decision = stopDecision(store, 'kill');
      if (decision.refusal) {
        write(`${decision.refusal}\n`);
        exit(1);
        return;
      }
      if (decision.request) ultra.writeControl(store.paths, 'kill');
      if (decision.apply) store.transition('killed');
      write(
        decision.request && decision.apply
          ? `Killed ${id}. A process that is still driving it stops at the next safe point. Worktrees and ledger are kept for inspection.\n`
          : decision.request
            ? `Stop requested for ${id}. The run stops at the next safe point. Worktrees and ledger are kept for inspection.\n`
            : `Killed ${id}. Worktrees and ledger are kept for inspection.\n`,
      );
    });

  root
    .command('resume')
    .description('Resume a paused or killed run without repeating finished packets')
    .option('--budget <usd>', 'raise the hard cost cap for this resumed pass (or "none")')
    // A run that was planned before the reader knew which gate the project
    // uses can be corrected here, without planning the whole thing again.
    .option('--test-gate <cmd>', 'replace the project-wide test gate of the plan', collectGate, [])
    .option('--lint-gate <cmd>', 'replace the project-wide lint gate of the plan', collectGate, [])
    .option('--build-gate <cmd>', 'replace the project-wide build gate of the plan', collectGate, [])
    .argument('<run-id>', 'run to resume')
    .action(async (id: string, commandOptions: Record<string, string | boolean | undefined>) => {
      const store = ultra.RunStore.open(stateDir, id);

      // A run that has a verdict must not be relabelled as `running`: the
      // report and the board are written from that verdict. The TUI applies the
      // same rule, so the two surfaces cannot disagree about a run.
      const refusal = ultra.resumeRefusal(store.state, stopDriver(store));
      if (refusal) throw new Error(refusal);

      // A stop request that was left behind — by a run that was killed before
      // it could read it — must not pause this resume before it starts.
      ultra.clearControl(store.paths);

      // Spec 6: a budget pause is resumed by raising the cap. Without this the
      // run would immediately pause again at the old cap.
      if (commandOptions.budget !== undefined) {
        let raised: number | null;
        try {
          raised = parseBudget(commandOptions.budget);
        } catch (error) {
          write(`${error instanceof Error ? error.message : String(error)}\n`);
          exit(1);
          return;
        }
        store.setBudgetUsd(raised);
        write(
          `Budget cap set to ${raised === null ? 'none' : formatUsd(raised)} for the resumed pass.\n`,
        );
      }

      const resumable = store.resumablePacketIds();
      // The plan of record is read *and* checked here. A plan that was edited
      // after the planner wrote it — or a plan file that is not a plan any
      // more — is refused with its reasons, instead of a raw parse error.
      const read = ultra.readPlanFile(store.paths.plan);
      if (!read.ok) {
        write(`The plan of run ${id} cannot be used, because it is not valid:\n`);
        for (const problem of read.problems) write(`  - ${problem}\n`);
        exit(1);
        return;
      }
      const plan = read.plan;
      write(`Resuming ${id}. Pending packets: ${resumable.length > 0 ? resumable.join(', ') : 'none'}\n`);
      // Even when every packet is already done, the pass still integrates: a
      // run that was killed between the packets and the merge has finished its
      // work and would otherwise never be merged at all.
      const resumeGateOverrides = gateOverridesFrom(commandOptions);
      if (resumeGateOverrides) {
        // The plan of record is written back: the gates that ran are the gates
        // the plan says, so the report and the board read the truth.
        const gates = ultra.applyGateOverrides(plan.gates, resumeGateOverrides);
        writeFileSync(store.paths.plan, `${JSON.stringify({ ...plan, gates }, null, 2)}\n`);
        write(`Project-wide gates replaced: ${gates.test.join(' ')} ${gates.lint.join(' ')} ${gates.build.join(' ')}\n`);
        await executeRun(store, { ...plan, gates }, {});
      } else {
        // Even when every packet is already done, the pass still integrates: a
        // run that was killed between the packets and the merge has finished
        // its work and would otherwise never be merged at all.
        await executeRun(store, plan, {});
      }
    });

  root
    .command('attach')
    .description('Follow a run’s log live, the way you would attach to a process')
    .option('--lines <count>', 'how much history to show first', '20')
    .option('--no-follow', 'print the tail and exit instead of following')
    .option('--interval <ms>', 'how often to poll the log', '500')
    .argument('[run-id]', 'run to attach to')
    .action(async (id: string | undefined, commandOptions: Record<string, string | boolean | undefined>) => {
      const store = openRun(id);
      const requested = Number(commandOptions.lines ?? 20);
      const lines = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 20;
      const interval = Math.max(50, Number(commandOptions.interval ?? 500));
      const follow = commandOptions.follow !== false;
      // The run moves while a reader watches it, so state is re-read from disk
      // rather than carried over from the moment of attaching. A cached store
      // would keep reporting `planning` after the run had already finished.
      const readState = (): ultra.RunState => {
        try {
          return JSON.parse(readFileSync(store.paths.state, 'utf8')) as ultra.RunState;
        } catch {
          return store.state;
        }
      };

      // Start from the tail rather than EOF: a reader attaching to a running job
      // wants what it has done so far, not a blank screen.
      const initial = ultra.runnerLogTail(store.paths.runnerLog, lines);
      write(attachHeader(readState(), ultra.readRunner(store.paths), initial.lines.length));
      for (const line of initial.lines) write(`  ${line}\n`);
      if (!follow) return;

      let offset = initial.offset;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const chunk = ultra.readRunnerLogChunk(store.paths.runnerLog, offset);
        if (chunk.restarted) {
          write('\n  (the log was restarted)\n');
          offset = 0;
        }
        offset = chunk.offset;
        if (chunk.text.length > 0) {
          // A partial final line is printed as it arrives, so a task that is
          // still writing does not look frozen.
          write(chunk.text.endsWith('\n') ? chunk.text : `${chunk.text}\n`);
        }
        // The probe is injected in tests: a real pid would make the follow loop
        // depend on the machine's process table.
        const runner = ultra.readRunner(store.paths);
        if (!(options.isAlive ?? ultra.processAlive)(runner?.pid ?? 0)) {
          write(
            `\n${attachFooter(readState(), runner, {
              report: store.paths.report,
              log: store.paths.runnerLog,
            })}\n`,
          );
          return;
        }
      }
    });

  root
    .command('report')
    .description('Print the run report, rebuilding it from the ledger when missing')
    .argument('[run-id]', 'run to report on')
    .action((id?: string) => {
      const store = openRun(id);
      const ledger = ultra.Ledger.open(store.paths.ledger);

      // The report is derived from durable state, so a missing one is rebuilt
      // rather than reported as absent: the ledger and state.json are enough.
      if (!existsSync(store.paths.report)) {
        try {
          writeFileSync(
            store.paths.report,
            ultra.buildReport({
              state: store.state,
              ledger,
              ...(existsSync(store.paths.plan)
                ? {
                    plan: JSON.parse(readFileSync(store.paths.plan, 'utf8')) as {
                      goal: string;
                      recipe: string;
                      packets: readonly { id: string; title: string; est_tokens?: number }[];
                    },
                  }
                : {}),
              ...(existsSync(store.paths.goal)
                ? { goal: ultra.parseGoalDocument(JSON.parse(readFileSync(store.paths.goal, 'utf8'))) }
                : {}),
            }),
          );
        } catch (error) {
          write(
            `Could not rebuild the report: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          exit(1);
          return;
        }
      }

      // Print the report itself, then the live cost summary.
      write(readFileSync(store.paths.report, 'utf8'));
      write(`\nCost: ${formatUsd(ledger.totalCostUsd())}\n`);
      for (const [role, cost] of Object.entries(ledger.costByRole())) {
        write(`  ${role}: ${formatUsd(cost)}\n`);
      }
      write(`Report: ${store.paths.report}\n`);
    });
}
