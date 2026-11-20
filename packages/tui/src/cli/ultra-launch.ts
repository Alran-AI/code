/**
 * Starting an Ultra run in the background.
 *
 * A run must not depend on an open shell, so `alran ultra …` and the TUI do not
 * run the work themselves: they start a **detached child of this same CLI** and
 * return. The child runs the ordinary foreground path, which means there is
 * exactly one implementation of "run Ultra" — the background case is the same
 * code with its output redirected to a file.
 *
 * This follows the pattern the updater already uses for a detached restart:
 * `spawn(..., { detached: true })` then `unref()`, so the child survives the
 * parent's exit and is not killed with its process group. On POSIX the child
 * leads its own session; on Windows `detached` gives it its own console.
 *
 * Two records make the run observable without the child cooperating:
 *
 *   - `runner.json` names the pid that is driving the run, so a surface can say
 *     "still going" or "the runner is gone" (see `@alran/ultra`'s runner module).
 *   - `runner.log` receives the child's stdout and stderr, so nothing the run
 *     printed is lost when the terminal closes.
 *
 * The child is told to `--adopt` the run id instead of creating a run, because
 * the parent already created the directory to have somewhere to put the log.
 */

import { closeSync, mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as ultra from '@alran/ultra';

export interface UltraLaunchRequest {
  readonly mode: ultra.UltraRunMode;
  readonly task: string;
  readonly runId: string;
  readonly budgetUsd: number | null;
  readonly recipe: ultra.UltraRecipeChoice;
  readonly workers: number;
  readonly maxRepairs: number;
  readonly baseRef?: string;
  readonly stash?: boolean;
  readonly maxRounds?: number;
  readonly stallRounds?: number;
  readonly maxHours?: number;
  readonly auditEvery?: number;
}

export interface UltraLaunchOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Overrides the command that starts Alran Code; tests inject a stub. */
  readonly alranCommand?: readonly string[];
  /** Injected so a run id is deterministic in tests. */
  readonly now?: () => Date;
}

/** Everything a caller decides about a new run, before it exists. */
export type UltraStartInput = Omit<UltraLaunchRequest, 'runId'>;

export interface UltraLaunchResult {
  readonly runId: string;
  readonly pid: number;
  readonly logPath: string;
}

/**
 * How to invoke this CLI again.
 *
 * Prefers the running entry point (`node dist/cli.js`) so a checkout under
 * development drives itself rather than whatever `alran` is on PATH. Falls back
 * to `alran` when the entry point is not recognisable.
 */
export function alranCommandFor(entry: string | undefined = process.argv[1]): readonly string[] {
  if (entry && /cli\.[cm]?js$/u.test(entry)) return [process.execPath, entry];
  return ['alran'];
}

/** The argv the detached child runs, after the command itself. */
export function ultraChildArgs(request: UltraLaunchRequest): readonly string[] {
  const args: string[] = [request.mode === 'goal' ? 'goal' : 'run', request.task];
  // The child must continue this run, not allocate a second one.
  args.push('--adopt', request.runId);
  args.push('--budget', request.budgetUsd === null ? 'none' : String(request.budgetUsd));
  args.push('--recipe', request.recipe);
  args.push('--workers', String(request.workers));
  args.push('--max-repairs', String(request.maxRepairs));
  if (request.baseRef) args.push('--base', request.baseRef);
  if (request.stash) args.push('--stash');
  if (request.mode === 'goal') {
    if (request.maxRounds !== undefined) args.push('--max-rounds', String(request.maxRounds));
    if (request.stallRounds !== undefined) args.push('--stall-rounds', String(request.stallRounds));
    if (request.maxHours !== undefined) args.push('--max-hours', String(request.maxHours));
    if (request.auditEvery !== undefined) args.push('--audit-every', String(request.auditEvery));
  }
  return args;
}

/**
 * Creates a run and starts it in the background, in one step.
 *
 * The run directory has to exist before the child starts, because the child is
 * told to `--adopt` the id rather than allocate its own. Both the CLI's
 * `--detach` and the TUI's start button go through here, so they cannot drift
 * apart on what a started run looks like.
 */
export function startUltraRunInBackground(
  input: UltraStartInput,
  options: UltraLaunchOptions,
): UltraLaunchResult {
  const now = options.now?.() ?? new Date();
  const store = ultra.RunStore.create(path.join(options.cwd, ultra.ULTRA_STATE_DIR), {
    runId: ultra.newUltraRunId(now),
    goal: input.task,
    budgetUsd: input.budgetUsd,
    now,
  });
  store.transition('planning');
  // Recorded on the run, so a resumed pass and the board agree on the cap.
  store.setWorkers(input.workers);
  return launchUltraRun({ ...input, runId: store.state.runId }, options);
}

/**
 * Starts a run detached and returns as soon as the child exists.
 *
 * Throws when the child cannot be spawned, so a caller can say so instead of
 * claiming a run started. A spawn that succeeds but dies immediately is reported
 * by the runner record and the log, not here: there is no reliable way to tell
 * "died at once" from "still starting" without waiting.
 */
export function launchUltraRun(
  request: UltraLaunchRequest,
  options: UltraLaunchOptions,
): UltraLaunchResult {
  // `runPathsFor` is relative to the Ultra state directory, not the workspace:
  // passing the workspace here would put the run at `<cwd>/<runId>`.
  const paths = ultra.runPathsFor(path.join(options.cwd, ultra.ULTRA_STATE_DIR), request.runId);
  const logPath = paths.runnerLog;
  // The launcher is callable before the run directory exists (the TUI's start
  // button names the run itself), so it creates the directory it writes into
  // rather than assuming a `RunStore.create` happened first.
  mkdirSync(paths.root, { recursive: true });
  const [command, ...prefix] = options.alranCommand ?? alranCommandFor();
  const args = [...prefix, 'ultra', ...ultraChildArgs(request)];

  // Append, so a resumed run keeps the log of the attempt before it.
  const fd = openSync(logPath, 'a');
  let child;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
  } finally {
    // The child holds its own descriptor; the parent does not need it.
    closeSync(fd);
  }

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`could not start the Ultra runner for ${request.runId}`);
  }
  // Without unref the parent would wait for the child, which is exactly what a
  // detached run must not do.
  child.unref();

  ultra.writeRunner(
    paths,
    {
      runId: request.runId,
      mode: request.mode,
      pid,
      startedAt: new Date().toISOString(),
      logPath: path.relative(paths.root, logPath) || 'runner.log',
      task: request.task,
      budgetUsd: request.budgetUsd,
      recipe: request.recipe,
      workers: request.workers,
    },
  );

  return { runId: request.runId, pid, logPath };
}