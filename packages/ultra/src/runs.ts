/**
 * Listing the runs on disk.
 *
 * A repository accumulates Ultra runs: one per task, each with its own state,
 * ledger, plan and evidence. The first question a user asks after a while is
 * "which one was that?" — and the answer has to be a list, not a guess.
 *
 * The CLI's `status` takes an optional run id and refuses to pick one when
 * several exist, because a command that silently acts on the wrong run is
 * worse than one that asks. That refusal is only fair if the user can *see*
 * the runs, so this module is the other half of it: one listing, rendered the
 * same way by the CLI and by the TUI, so both surfaces teach one vocabulary.
 *
 * Everything here is derived from durable state. A run whose state file cannot
 * be read is listed as unreadable rather than hidden: a missing run looks
 * exactly like a run that never existed, and the user has to be able to tell
 * those apart.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ledger } from './ledger.js';
import { goalCounts, parseGoalDocument, type GoalCounts } from './goal.js';
import { runPathsFor } from './run-state.js';
import type { RunState, RunStatus } from './types.js';

/** One run, reduced to what a list has to show. */
export interface UltraRunSummary {
  readonly runId: string;
  readonly status: RunStatus;
  readonly goal: string;
  readonly createdAt: string;
  readonly packetsDone: number;
  readonly packetsTotal: number;
  readonly costUsd: number;
  /** The run's cap; `null` means unlimited. */
  readonly budgetUsd: number | null;
  /** Criteria progress, for goal-driven runs only. */
  readonly criteria?: GoalCounts;
}

/** A run directory whose state could not be read. */
export interface UltraUnreadableRun {
  readonly runId: string;
  readonly reason: string;
}

export interface UltraRunListing {
  readonly runs: readonly UltraRunSummary[];
  readonly unreadable: readonly UltraUnreadableRun[];
}

/** Run ids under the state directory, newest first. */
function runIdsIn(stateDir: string): string[] {
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

/** Reads one run's state, or the reason it cannot be read. */
function readState(stateDir: string, runId: string): { state?: RunState; reason?: string } {
  const paths = runPathsFor(stateDir, runId);
  if (!existsSync(paths.state)) {
    return { reason: `no state.json at ${paths.state}` };
  }
  try {
    return { state: JSON.parse(readFileSync(paths.state, 'utf8')) as RunState };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Lists every run under the state directory, newest first.
 *
 * A run is listed even when its state cannot be parsed: the entry says so
 * instead of the run vanishing. Hiding it would leave the user with a list
 * that does not match the directory.
 */
export function listUltraRuns(stateDir: string): UltraRunListing {
  const runs: UltraRunSummary[] = [];
  const unreadable: UltraUnreadableRun[] = [];
  for (const runId of runIdsIn(stateDir)) {
    const paths = runPathsFor(stateDir, runId);
    const { state, reason } = readState(stateDir, runId);
    if (!state) {
      unreadable.push({ runId, reason: reason ?? 'unreadable state' });
      continue;
    }
    const done = state.packets.filter((packet) => packet.status === 'done').length;
    const costUsd = Ledger.open(paths.ledger).totalCostUsd();
    let criteria: GoalCounts | undefined;
    if (existsSync(paths.goal)) {
      try {
        criteria = goalCounts(parseGoalDocument(JSON.parse(readFileSync(paths.goal, 'utf8'))));
      } catch {
        // A malformed goal file must not hide the run; the run is still a run.
        criteria = undefined;
      }
    }
    runs.push({
      runId: state.runId,
      status: state.status,
      goal: state.goal,
      createdAt: state.createdAt,
      packetsDone: done,
      packetsTotal: state.packets.length,
      costUsd,
      budgetUsd: state.budgetUsd,
      ...(criteria ? { criteria } : {}),
    });
  }
  // Newest first. Run ids start with a sortable timestamp, so the id order is
  // chronological; `createdAt` is the truthful field and the id breaks ties.
  runs.sort((left, right) =>
    right.createdAt === left.createdAt
      ? right.runId.localeCompare(left.runId)
      : right.createdAt.localeCompare(left.createdAt),
  );
  return { runs, unreadable };
}

/** Width of the run id column; ids are `run-<timestamp>-<random>`. */
const ID_WIDTH = 25;
const STATUS_WIDTH = 16;
const PACKET_WIDTH = 16;
const COST_WIDTH = 16;
const CRITERIA_WIDTH = 14;

function formatCost(costUsd: number, budgetUsd: number | null): string {
  const spent = `$${costUsd.toFixed(2)}`;
  return budgetUsd === null ? `${spent}/none` : `${spent}/$${budgetUsd.toFixed(2)}`;
}

/** Truncates to a column budget, marking the cut with an ellipsis. */
function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text.padEnd(width);
  if (width === 1) return '…';
  return `${text.slice(0, width - 1)}…`;
}

/**
 * Renders the run list.
 *
 * Each run takes two lines: the facts on the first, the goal on the second.
 * A single line would have to choose between showing the goal and showing the
 * status, and the goal is what the reader is actually looking for — "which run
 * was that?" — while the status is already the shortest word that says it.
 *
 * The columns are dropped from the right when the width is too small to hold
 * them, so a narrow terminal loses the cost before it loses the status, and
 * never loses the id: that is the handle the reader needs to act.
 */
export function renderRunList(listing: UltraRunListing, width = 100): string {
  if (listing.runs.length === 0 && listing.unreadable.length === 0) {
    return 'No Ultra runs yet.';
  }
  const lines: string[] = [];
  for (const run of listing.runs) {
    const cells: string[] = [
      fit(run.runId, ID_WIDTH),
      fit(run.status, STATUS_WIDTH),
      fit(`${String(run.packetsDone)}/${String(run.packetsTotal)} packets`, PACKET_WIDTH),
      fit(formatCost(run.costUsd, run.budgetUsd), COST_WIDTH),
    ];
    if (run.criteria) {
      cells.push(fit(`${String(run.criteria.met)}/${String(run.criteria.total)} met`, CRITERIA_WIDTH));
    }
    // Drop the least important column until the row fits: criteria, then the
    // cost, then the packet counts. The id and the status always stay.
    while (cells.length > 2 && cells.join(' ').length > width) {
      cells.pop();
    }
    let row = cells.join(' ');
    if (row.length > width) {
      // Only reachable on a very narrow terminal: the status is what gives way.
      row = `${cells[0]} ${fit(cells[1]!, Math.max(1, width - cells[0]!.length - 1))}`;
    }
    lines.push(row.trimEnd());
    lines.push(`  ${fit(run.goal, Math.max(8, width - 2)).trimEnd()}`);
  }
  for (const run of listing.unreadable) {
    lines.push(`${fit(run.runId, ID_WIDTH)} unreadable  ${run.reason}`);
  }
  return lines.join('\n');
}
