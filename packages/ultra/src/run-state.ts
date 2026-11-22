/**
 * Durable run state for Ultra.
 *
 * `state.json` holds the run status and one row per packet so a killed process
 * can be resumed from disk. The transition guards encode the two rules the
 * whole design depends on: a packet reaches `done` only after its gate (never
 * straight from `running`), and a run reaches `succeeded` only from INTEGRATE.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PacketState, PacketStatus, RunState, RunStatus } from './types.js';

/**
 * Ignore rules that keep Ultra's *own* output (state and packet worktrees) out
 * of `git status`. Scoped to Ultra's directories so a committed sibling like
 * `.alran/ci.yml` is left alone. The file lives at the top of `.alran/`.
 */
const STATE_IGNORE = ['ultra/', 'worktrees/', ''].join('\n');

/**
 * Where Ultra keeps its runs, relative to the working directory. One constant so
 * the CLI, the TUI and the detached launcher cannot disagree about where a run
 * lives.
 */
export const ULTRA_STATE_DIR = '.alran/ultra';

export interface RunPaths {
  readonly root: string;
  readonly state: string;
  readonly ledger: string;
  readonly plan: string;
  readonly goal: string;
  readonly packets: string;
  readonly notes: string;
  readonly rounds: string;
  readonly report: string;
  /** The review fleet's report for this run, when it has been reviewed. */
  readonly review: string;
  /** The review fleet's findings as JSON, for other tools to read. */
  readonly reviewJson: string;
  /** Who is driving this run, if it was started in the background. */
  readonly runner: string;
  /** Where a background runner's output goes. */
  readonly runnerLog: string;
}

export interface CreateRunInput {
  readonly runId: string;
  readonly goal: string;
  readonly budgetUsd: number | null;
  readonly now?: Date;
}

/** Packet statuses that mean the scheduler will not touch the packet again. */
const TERMINAL_PACKET_STATUS: ReadonlySet<PacketStatus> = new Set([
  'done',
  'blocked',
  'skipped',
  'cancelled',
]);

/** Spec 2: `--workers` is 4 by default and 8 at the ceiling. */
export const MAX_WORKERS = 8;

/**
 * A fresh, sortable run id: a timestamp plus eight random hex chars.
 *
 * The timestamp makes ids sort chronologically, which is how the TUI picks the
 * newest run. `RunStore.create` refuses to reuse an id, so a collision can never
 * overwrite another run's state.
 */
export function newUltraRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:T]/gu, '').slice(0, 12);
  const suffix = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, '0');
  return `run-${stamp}-${suffix}`;
}

/**
 * The paths of one run, without touching the disk.
 *
 * Exported because the detached launcher has to name the log file before the run
 * exists, and it must derive it the same way `RunStore` does.
 */
export function runPathsFor(baseDir: string, runId: string): RunPaths {
  return runPaths(baseDir, runId);
}

function runPaths(baseDir: string, runId: string): RunPaths {
  const root = path.join(baseDir, runId);
  return {
    root,
    state: path.join(root, 'state.json'),
    ledger: path.join(root, 'ledger.jsonl'),
    plan: path.join(root, 'plan.json'),
    goal: path.join(root, 'goal.json'),
    packets: path.join(root, 'packets'),
    notes: path.join(root, 'notes.md'),
    rounds: path.join(root, 'rounds'),
    report: path.join(root, 'report.md'),
    review: path.join(root, 'review.md'),
    reviewJson: path.join(root, 'review.json'),
    runner: path.join(root, 'runner.json'),
    runnerLog: path.join(root, 'runner.log'),
  };
}

/**
 * Writes `.alran/.gitignore` so the state directory never makes the working
 * tree dirty. Without this, the first run dirties the tree and the next run is
 * refused by the start guard — Ultra would block itself. A repository-wide
 * `.alran/` entry is preferable, but a self-contained ignore file means Ultra
 * works in any checkout without asking the user to edit their .gitignore.
 */
function ensureStateIgnored(baseDir: string): void {
  // `baseDir` is `.alran/ultra`; the ignore file belongs at `.alran/` so it also
  // covers `.alran/worktrees/`, where the packet worktrees are created.
  const alranDir = path.dirname(baseDir);
  if (path.basename(alranDir) !== '.alran') return;
  const ignoreFile = path.join(alranDir, '.gitignore');
  mkdirSync(alranDir, { recursive: true });
  if (existsSync(ignoreFile)) return;
  writeFileSync(ignoreFile, STATE_IGNORE);
}

export class RunStore {
  private constructor(
    readonly paths: RunPaths,
    private readonly data: RunState,
  ) {}

  /** Creates a fresh run directory in `planning`; never reuses an existing id. */
  static create(baseDir: string, input: CreateRunInput): RunStore {
    const paths = runPaths(baseDir, input.runId);
    if (existsSync(paths.state)) {
      // Two runs sharing an id would silently overwrite each other's state.
      throw new Error(`Ultra run ${input.runId} already exists at ${paths.root}`);
    }
    ensureStateIgnored(baseDir);
    mkdirSync(paths.packets, { recursive: true });
    const data: RunState = {
      runId: input.runId,
      goal: input.goal,
      budgetUsd: input.budgetUsd,
      createdAt: (input.now ?? new Date()).toISOString(),
      status: 'planning',
      packets: [],
    };
    const store = new RunStore(paths, data);
    store.persist();
    return store;
  }

  /** Reopens an existing run; throws a clear error on a corrupted state file. */
  static open(baseDir: string, runId: string): RunStore {
    const paths = runPaths(baseDir, runId);
    if (!existsSync(paths.state)) {
      throw new Error(`Ultra run ${runId} not found: no state.json at ${paths.state}`);
    }
    let data: RunState;
    try {
      data = JSON.parse(readFileSync(paths.state, 'utf8')) as RunState;
    } catch (error) {
      throw new Error(`Ultra run ${runId} has an unreadable state.json: ${String(error)}`);
    }
    return new RunStore(paths, data);
  }

  get state(): RunState {
    return this.data;
  }

  transition(status: RunStatus): void {
    RunStore.assertRunTransition(this.data.status, status);
    this.data.status = status;
    this.persist();
  }

  /**
   * Raises (or clears) the budget cap for a resumed pass.
   *
   * A budget pause is a pause, not a failure: the human raises the cap and
   * `resume` continues. Lowering it below what is already spent is refused, since
   * that would instantly re-pause a run the human just asked to continue.
   */
  setBudgetUsd(budgetUsd: number | null): void {
    if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) {
      throw new Error(`invalid budget cap: ${String(budgetUsd)}`);
    }
    this.data.budgetUsd = budgetUsd;
    this.persist();
  }

  /**
   * Sets the parallel worker cap for the next execute pass, clamped to 1-8 so a
   * typo or a held-down `+` key cannot make the scheduler spin up unbounded
   * concurrency. Persisted, because the board's `+`/`-` keys have to change
   * something a later pass actually reads.
   */
  setWorkers(workers: number): number {
    const finite = Number.isFinite(workers) ? Math.floor(workers) : 4;
    const clamped = Math.min(MAX_WORKERS, Math.max(1, finite));
    this.data.workers = clamped;
    this.persist();
    return clamped;
  }

  setPackets(packets: readonly { id: string; title: string; status?: PacketStatus }[]): void {
    this.data.packets = packets.map((packet) => ({
      id: packet.id,
      title: packet.title,
      status: packet.status ?? 'pending',
    }));
    this.persist();
  }

  setPacketStatus(id: string, status: PacketStatus, reason?: string, repairs?: number): void {
    const packet = this.data.packets.find((entry) => entry.id === id);
    if (!packet) throw new Error(`Ultra run has no packet ${id}`);
    // Enforce the invariant here, not only in prose: `done` is reachable only
    // from `verifying`, so no caller can skip the gate and verifier stages.
    RunStore.assertTransition(packet.status, status);
    packet.status = status;
    // A `done` packet has no failure to explain. Without this, a packet that
    // was repaired and then passed keeps its "repairing after …" reason and the
    // report claims a finished packet is still broken.
    if (status === 'done') delete packet.reason;
    else if (reason !== undefined) packet.reason = reason;
    if (repairs !== undefined) packet.repairs = repairs;
    this.persist();
  }

  /**
   * Packet ids a resume must (re)run: anything not in a terminal state. A kill
   * can leave a packet in `running`, so resume redoes it rather than assuming
   * a half-finished worktree is valid.
   */
  resumablePacketIds(): string[] {
    return this.data.packets
      .filter((packet) => !TERMINAL_PACKET_STATUS.has(packet.status))
      .map((packet) => packet.id);
  }

  /** A packet may reach `done` only from `verifying`; the gate must run first. */
  static assertTransition(from: PacketStatus, to: PacketStatus): void {
    if (to === 'done' && from !== 'verifying') {
      throw new Error(
        `packet cannot go ${from} → done: a packet is done only after its gate and verifier run`,
      );
    }
  }

  /**
   * A run may reach `succeeded` only from INTEGRATE (or from ACCEPT in a
   * goal-driven run, which is the same verdict one step later). Nothing else may
   * claim success, so a run cannot be `succeeded` straight from `running`.
   */
  static assertRunTransition(from: RunStatus, to: RunStatus): void {
    if (to === 'succeeded' && from !== 'integrating' && from !== 'accepting') {
      throw new Error(
        `a run can be succeeded only by INTEGRATE/ACCEPT (integrating → succeeded), not from ${from}`,
      );
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.paths.state), { recursive: true });
    writeFileSync(this.paths.state, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}

export type { PacketState, RunState };
