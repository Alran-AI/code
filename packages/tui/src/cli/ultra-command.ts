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
import { baseRefForRun, commitSpecTestsAsBase } from './ultra-spec-base.js';
import { launchUltraRun, startUltraRunInBackground } from './ultra-launch.js';

export interface UltraCommandOptions {
  readonly cwd?: string;
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
  store.transition('running');
  write(`Executing ${plan.packets.length} packet(s)…\n`);

  const result = await ultra.runExecute({
    plan,
    ports: { ...adapters, store, ledger, evidence: ultra.createFileEvidenceWriter(store.paths.packets) },
    config: {
      workers: input.workers,
      maxRepairs: input.maxRepairs,
      workerModel: input.roles?.planner ?? 'alran/Alran-Werk',
      verifierModel: input.roles?.critic ?? 'alran/Alran-Werk',
    },
    ...(input.sleep ? { sleep: input.sleep } : {}),
    ...(input.baseRef ? { baseRef: input.baseRef } : {}),
    skipPacketIds: store.state.packets
      .filter((packet) => packet.status === 'done')
      .map((packet) => packet.id),
  });

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
      reviewModel: input.roles?.critic ?? 'alran/Alran-Werk',
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
  'board',
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
            : `several Ultra runs exist; pass a run id: ${ids.join(', ')}`,
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
      .option('--yes', 'skip the cost confirmation (the budget cap still applies)')
      .option('--detach', 'start the run in the background and return at once')
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
    });
    if (integrated !== 'succeeded') exit(1);
  };

  const planAction = async (
    goal: string,
    commandOptions: Record<string, string | boolean | undefined>,
    executeAfter: boolean,
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

    let result: ultra.PlanRunResult;
    try {
      result = await planner({
        goal,
        recipe,
        roles: options.roles ?? {
          // `alran/Alran-Werk` is the provider-qualified identity `alran exec
          // --model` resolves; the gateway id `ottili/werk-1.1` is not a
          // configured provider and the run would fail before planning.
          planner: 'alran/Alran-Werk',
          critic: 'alran/Alran-Werk',
          explorers: 3,
        },
        ports: options.planPorts as ultra.UltraPlanPorts,
      });
    } catch (error) {
      // A failed planner call is a failed run, not an unhandled rejection: the
      // human needs the reason and the run directory to inspect.
      write(`Planning failed: ${error instanceof Error ? error.message : String(error)}\n`);
      store.transition('failed');
      exit(1);
      return;
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
          model: options.roles?.planner ?? 'alran/Alran-Werk',
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
        const result = await ultra.runExecute({
          plan,
          ports: {
            ...adapters,
            store,
            ledger,
            evidence: ultra.createFileEvidenceWriter(store.paths.packets),
          },
          config: {
            // The stored cap wins when the caller did not pass `--workers`, so
            // the board's `+`/`-` keys and a later `resume` agree on one number.
            workers: Number(commandOptions.workers ?? store.state.workers ?? 4),
            maxRepairs: Number(commandOptions.maxRepairs ?? 2),
            workerModel: options.roles?.planner ?? 'alran/Alran-Werk',
            verifierModel: options.roles?.critic ?? 'alran/Alran-Werk',
            specTestDir: ultra.SPEC_TEST_DIR,
          },
          ...(options.sleep ? { sleep: options.sleep } : {}),
          baseRef,
          skipPacketIds: store.state.packets
            .filter((packet) => packet.status === 'done')
            .map((packet) => packet.id),
        });
        return { donePacketIds: result.packets.filter((p) => p.status === 'done').map((p) => p.id) };
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
            reviewModel: options.roles?.critic ?? 'alran/Alran-Werk',
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
      const gates = ultra.detectUltraGates(gateSources);
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
      const remaining = store.resumablePacketIds();
      if (remaining.length > 0) write(`Resumable: ${remaining.join(', ')}\n`);
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

  root
    .command('pause')
    .description('Pause a running run at the next safe point')
    .argument('<run-id>', 'run to pause')
    .action((id: string) => {
      const store = ultra.RunStore.open(stateDir, id);
      if (store.state.status !== 'running') {
        throw new Error(`run ${id} is ${store.state.status}, not running`);
      }
      store.transition('paused');
      write(`Paused ${id}. Resume with \`alran ultra resume ${id}\`.\n`);
    });

  root
    .command('kill')
    .description('Stop a run but keep its worktrees and ledger for inspection')
    .argument('<run-id>', 'run to stop')
    .action((id: string) => {
      const store = ultra.RunStore.open(stateDir, id);
      store.transition('killed');
      write(`Killed ${id}. Worktrees and ledger are kept for inspection.\n`);
    });

  root
    .command('resume')
    .description('Resume a paused or killed run without repeating finished packets')
    .option('--budget <usd>', 'raise the hard cost cap for this resumed pass (or "none")')
    .argument('<run-id>', 'run to resume')
    .action(async (id: string, commandOptions: Record<string, string | boolean | undefined>) => {
      const store = ultra.RunStore.open(stateDir, id);

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
      if (!existsSync(store.paths.plan)) {
        throw new Error(
          `run ${id} has no plan.json; it stopped before a plan was written, so there is nothing to resume`,
        );
      }
      write(`Resuming ${id}. Pending packets: ${resumable.length > 0 ? resumable.join(', ') : 'none'}\n`);
      if (resumable.length === 0) {
        store.transition('running');
        write('Nothing left to execute; every packet already reached a terminal state.\n');
        return;
      }
      const plan = JSON.parse(readFileSync(store.paths.plan, 'utf8')) as ultra.UltraPlan;
      await executeRun(store, plan, {});
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
