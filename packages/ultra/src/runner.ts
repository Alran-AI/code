/**
 * Background runs: who is driving a run, and whether they still are.
 *
 * A long Ultra run must not depend on an open shell. The launcher records the
 * detached process that is driving the run next to the run's own state, and
 * every surface that shows a run (CLI `status`, TUI board) reads that record to
 * answer the only question a user has: is this still going, or did it stop?
 *
 * The module is deliberately process-free: it parses, writes and classifies, and
 * liveness is an injected probe. That keeps the interesting logic — deciding
 * that a dead process with a finished run is a *success* rather than a failure —
 * testable without spawning anything.
 *
 * Nothing here starts or stops a process. The run's own `state.json` stays the
 * source of truth for the outcome; this file only says who was driving.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { RunPaths } from './run-state.js';
import type { RunStatus } from './types.js';
import type { UltraRecipeChoice } from './types.js';

/** `run` is one execute-and-merge pass; `goal` loops rounds until the goal is met. */
export type UltraRunMode = 'run' | 'goal';

export interface UltraRunnerRecord {
  readonly runId: string;
  readonly mode: UltraRunMode;
  /** The detached process driving the run. */
  readonly pid: number;
  readonly startedAt: string;
  /** Where that process's output is going, relative to the run directory. */
  readonly logPath: string;
  /** The task, so `status` can show what a run is for without opening the log. */
  readonly task: string;
  readonly budgetUsd: number | null;
  readonly recipe: UltraRecipeChoice;
  readonly workers: number;
  /**
   * True when the process behind the run is the one the person started in the
   * foreground, rather than a detached child.
   *
   * Both are recorded, because both can be alive and both can die: a
   * foreground run that was killed with the terminal still has to say that
   * nobody is driving it any more.
   */
  readonly foreground?: boolean;
}

export type UltraRunnerStatus =
  /** The process exists and is working. */
  | 'running'
  /** The process is gone and the run finished. */
  | 'finished'
  /** The process is gone and the run failed. */
  | 'failed'
  /** The process is gone but the run did not finish: resumable. */
  | 'interrupted'
  /** No runner record; the run was started in the foreground. */
  | 'foreground';

export interface UltraRunnerClassification {
  readonly status: UltraRunnerStatus;
  /** One line for a human, always present. */
  readonly detail: string;
  readonly record?: UltraRunnerRecord;
}

/** Run statuses that mean no further pass will change the outcome. */
const TERMINAL_RUN_STATUS: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'partial',
  'failed',
  'killed',
  'stalled',
]);

/**
 * Whether this run has reached its final state.
 *
 * A run that is still going can change; anything that describes its change —
 * a review, a diff, a report — describes it as it is now.
 */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUS.has(status);
}

/** Reads a runner record, or `undefined` when the run was not started in the background. */
export function readRunner(paths: RunPaths): UltraRunnerRecord | undefined {
  if (!existsSync(paths.runner)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.runner, 'utf8'));
  } catch {
    return undefined;
  }
  return isRunnerRecord(parsed) ? parsed : undefined;
}

export function writeRunner(paths: RunPaths, record: UltraRunnerRecord): void {
  writeFileSync(paths.runner, `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Records the process that is driving the run, unless someone else is.
 *
 * A detached run is claimed by the process that spawned the child, so the
 * child must not claim it again — and it must not, because a child that
 * claimed the run would make `status` call a background run a foreground one.
 * The child still needs the run to be *its* run, so the same process that the
 * record already names may claim it again: it keeps the record as it is,
 * which is what keeps the "background" wording.
 *
 * A record whose process is *gone* is a different case: the run was orphaned,
 * and whoever picks it up (a `resume`) is the one driving it now. The record
 * is taken over, so `status` stops calling a run that is being worked on
 * "interrupted".
 *
 * The return value is the claim: `false` means somebody else is driving the
 * run, and a second execute pass would fight over the same worktrees.
 */
export function claimRunner(
  paths: RunPaths,
  record: UltraRunnerRecord,
  isAlive: (pid: number) => boolean = processAlive,
): boolean {
  const existing = readRunner(paths);
  if (existing) {
    if (existing.pid === record.pid) {
      // The same process claims the run it is already recorded as driving.
      // The record is left alone: it was written by the process that spawned
      // this one, and it says "background" for a reason.
      return true;
    }
    if (isAlive(existing.pid)) return false;
  }
  writeRunner(paths, record);
  return true;
}

/**
 * The default liveness probe.
 *
 * `process.kill(pid, 0)` sends no signal; it only checks that the process exists
 * and that we may signal it. `EPERM` means it exists but belongs to someone
 * else, which for our purposes is still alive.
 */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Decides what a run's runner record means, given whether the process is alive
 * and what the run itself says.
 *
 * The run's own status decides the outcome: a dead process whose run says
 * `succeeded` is a success that outlived its shell, not a failure. Only a dead
 * process whose run never reached a terminal state is `interrupted`.
 */
export function classifyRunner(input: {
  readonly record: UltraRunnerRecord | undefined;
  readonly runStatus: RunStatus;
  readonly isAlive?: (pid: number) => boolean;
}): UltraRunnerClassification {
  const { record, runStatus } = input;
  const alive = input.isAlive ?? processAlive;

  if (!record) {
    return {
      status: 'foreground',
      detail: `started in the foreground; run is ${runStatus}`,
    };
  }

  if (alive(record.pid)) {
    return {
      status: 'running',
      detail: record.foreground
        ? `running in the foreground (pid ${String(record.pid)})`
        : `running in the background (pid ${String(record.pid)})`,
      record,
    };
  }

  if (runStatus === 'succeeded' || runStatus === 'partial' || runStatus === 'stalled') {
    return { status: 'finished', detail: `the run finished as ${runStatus}`, record };
  }
  if (runStatus === 'failed' || runStatus === 'killed') {
    return { status: 'failed', detail: `the run ended as ${runStatus}`, record };
  }
  // The process is gone and the run never finished: a crash, a reboot, or a
  // closed laptop. The run is resumable, and saying so is the point.
  return {
    status: 'interrupted',
    detail:
      `interrupted: the process driving the run is gone and the run is ${runStatus}; ` +
      `resume it with \`alran ultra resume ${record.runId}\``,
    record,
  };
}

function isRunnerRecord(value: unknown): value is UltraRunnerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<UltraRunnerRecord>;
  return (
    typeof record.runId === 'string' &&
    (record.mode === 'run' || record.mode === 'goal') &&
    typeof record.pid === 'number'
  );
}