/**
 * Stopping a run that is still running.
 *
 * `alran ultra pause` and `alran ultra kill` are one process; the run is
 * another. The run's `state.json` belongs to the process that drives the run,
 * so a second process cannot stop it by writing that file: the driver would
 * overwrite the change with its next save. That is why pausing a live run used
 * to do nothing at all — the command wrote `paused`, the driver wrote `running`
 * a second later, and the run carried on as if it had never been asked.
 *
 * The request therefore travels through a file of its own. The command writes
 * the request; the driver reads it at its next safe point, stops there and
 * records the outcome in the run's own state. When nothing is driving the run,
 * the command applies the change itself, so `pause` on a run whose process is
 * gone still means what it says.
 *
 * The decision is a pure function so both surfaces — the CLI and the TUI
 * board — stop a run the same way, and so the rule can be tested without a
 * process table.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { RunPaths } from './run-state.js';
import type { RunStatus } from './types.js';

/** What a person asked a running run to do. */
export type UltraControlRequest = 'pause' | 'kill';

export interface UltraControlRecord {
  readonly request: UltraControlRequest;
  /** When the request was made. */
  readonly at: string;
  /** The process that made it. */
  readonly by: number;
}

/**
 * Who is driving the run.
 *
 * - `live`: a process is behind the run and will read the request.
 * - `dead`: a process drove the run and is gone; nobody will read the request.
 * - `unknown`: no runner record, so the run was started in the foreground and
 *   the driver may or may not still be there.
 */
export type UltraControlDriver = 'live' | 'dead' | 'unknown';

/** What the caller should do about a stop request. */
export interface UltraControlDecision {
  /** Write the request file: the driver will honour it at its next safe point. */
  readonly request: boolean;
  /** Apply the status change here and now. */
  readonly apply: boolean;
  /** Why the request was refused, when it was. */
  readonly refusal?: string;
}

/** Run statuses that mean no further pass will change the outcome. */
const VERDICT_RUN_STATUS: ReadonlySet<RunStatus> = new Set([
  'succeeded',
  'partial',
  'failed',
  'stalled',
]);

/**
 * Reads the pending request, or `undefined` when there is none.
 *
 * A file that cannot be read is treated as no request: a corrupt request must
 * not stop a run, and the driver is the only one who can say what a run's
 * state is.
 */
export function readControl(paths: RunPaths): UltraControlRecord | undefined {
  if (!existsSync(paths.control)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.control, 'utf8'));
  } catch {
    return undefined;
  }
  return isControlRecord(parsed) ? parsed : undefined;
}

/**
 * Writes the pending request.
 *
 * The newest request wins: a kill after a pause is a kill, and a pause after a
 * kill is a pause. A file that cannot be written means the request cannot be
 * delivered, so the caller is told rather than left waiting for a stop that
 * will never come.
 */
export function writeControl(
  paths: RunPaths,
  request: UltraControlRequest,
  options: { readonly now?: Date; readonly by?: number } = {},
): UltraControlRecord {
  const record: UltraControlRecord = {
    request,
    at: (options.now ?? new Date()).toISOString(),
    by: options.by ?? process.pid,
  };
  writeFileSync(paths.control, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/**
 * Removes the pending request.
 *
 * A run that has read the request must not see it again: a resume that starts
 * with a stale request would pause itself before it began.
 */
export function clearControl(paths: RunPaths): void {
  rmSync(paths.control, { force: true });
}

/**
 * Reads the pending request and clears it.
 *
 * The request is consumed by the driver that read it. A leftover request would
 * stop the *next* pass before it began, which is how a run that was paused
 * once could never be continued.
 */
export function takeControl(paths: RunPaths): UltraControlRequest | undefined {
  const request = readControl(paths)?.request;
  if (request) clearControl(paths);
  return request;
}

/**
 * Decides what a stop request means for this run.
 *
 * The rule is the same on every surface:
 *
 * - A run that already has a verdict is refused. Stopping a finished run would
 *   rewrite its result, and a report that says `killed` about work that
 *   succeeded is a lie.
 * - A run with a live driver gets the request written; the driver stops at its
 *   next safe point and records the outcome itself, so the two processes never
 *   write the same state.
 * - A run whose driver is gone gets the change applied here and now.
 * - A foreground run (no runner record) gets both: the driver may still be
 *   there, and it converges on the same status if it is.
 */
export function decideControl(input: {
  readonly request: UltraControlRequest;
  readonly runStatus: RunStatus;
  readonly driver: UltraControlDriver;
}): UltraControlDecision {
  if (input.runStatus === 'killed') {
    // The run was already stopped on purpose. Relabelling it `paused` would
    // make the state disagree with the report that was written from it, and
    // would make a stopped run look like it was waiting to be continued.
    return {
      request: false,
      apply: false,
      refusal:
        input.request === 'kill' ? 'run is already killed' : 'run was already stopped',
    };
  }
  if (VERDICT_RUN_STATUS.has(input.runStatus)) {
    return {
      request: false,
      apply: false,
      refusal:
        input.request === 'pause'
          ? `run already finished as ${input.runStatus}; there is nothing to pause`
          : `run already finished as ${input.runStatus}; there is nothing to kill`,
    };
  }

  // A run that is already in the requested state has nothing left to change.
  if (input.request === 'pause' && input.runStatus === 'paused') {
    return { request: false, apply: false, refusal: 'run is already paused' };
  }
  // A run that was killed is handled above: it stays killed, whatever is asked
  // of it.

  if (input.driver === 'live') {
    // The driver owns the state file. Two writers would fight over it.
    return { request: true, apply: false };
  }
  if (input.driver === 'dead') {
    // Nobody will read the request, and a leftover request would pause the
    // next resume before it started.
    return { request: false, apply: true };
  }
  // Foreground: the driver may be alive. The request reaches it if it is, and
  // the change stands if it is not.
  return { request: true, apply: true };
}

/**
 * Maps a runner classification to the driver a control request has to reach.
 *
 * `foreground` means there is no runner record, so the liveness of the driver
 * is unknown — it may be a run in another terminal, or a run nobody started
 * any more.
 */
export function driverFromRunnerStatus(status: 'running' | 'finished' | 'failed' | 'interrupted' | 'foreground'): UltraControlDriver {
  switch (status) {
    case 'running':
      return 'live';
    case 'foreground':
      return 'unknown';
    default:
      return 'dead';
  }
}

function isControlRecord(value: unknown): value is UltraControlRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<UltraControlRecord>;
  return (
    (record.request === 'pause' || record.request === 'kill') &&
    typeof record.at === 'string' &&
    typeof record.by === 'number'
  );
}
