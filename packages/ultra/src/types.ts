/**
 * Shared types for Ultra mode.
 *
 * Ultra runs a task too large for a single agent loop as a DAG of bounded work
 * packets, each gated by real commands on its own branch. These types describe
 * the durable plan and run state; nothing here touches git, the model, or the
 * filesystem, so the whole planning layer is testable in isolation.
 */

export type UltraRecipe = 'migrate' | 'bughunt' | 'refactor' | 'testgen' | 'audit';

/** Build a plan with no plan file yet; `auto` means "let the planner decide". */
export type UltraRecipeChoice = UltraRecipe | 'auto';

export type PacketStatus =
  | 'pending'
  | 'running'
  | 'gating'
  | 'verifying'
  | 'done'
  | 'repairing'
  | 'blocked'
  | 'skipped'
  | 'cancelled';

/**
 * Run status. Only INTEGRATE may move a run to `succeeded`; `partial` and
 * `failed` are honest terminal outcomes when some packets did not land.
 * `accepting` and `stalled` belong to the goal-driven loop (spec 13).
 */
export type RunStatus =
  | 'planning'
  | 'awaiting_confirm'
  | 'running'
  | 'paused'
  | 'integrating'
  | 'accepting'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'killed'
  | 'stalled';

/** A single acceptance command and the condition that makes it pass. */
export interface AcceptanceCommand {
  readonly cmd: string;
  /** Only `exit0` is supported in v1; kept explicit so the plan reads unambiguously. */
  readonly must?: 'exit0';
}

/** One packet as written by the planner. */
export interface PlanPacket {
  readonly id: string;
  /** Round this packet belongs to; 1 for a single-round run. */
  readonly round?: number;
  readonly title: string;
  readonly goal: string;
  /** Goal-document criteria this packet works towards (spec 13). */
  readonly criteria?: readonly string[];
  /** Writable globs; a change outside these rejects the packet. */
  readonly scope: readonly string[];
  /** Paths the worker may read but must not change. */
  readonly readonly?: readonly string[];
  readonly depends_on: readonly string[];
  readonly accept?: readonly AcceptanceCommand[];
  readonly max_repairs?: number;
  readonly est_tokens?: number;
}

/** The whole plan, saved as `.alran/ultra/<run-id>/plan.json`. */
export interface UltraPlan {
  readonly goal: string;
  readonly recipe: UltraRecipeChoice;
  readonly packets: readonly PlanPacket[];
  /** Gate commands auto-detected from the repository, shown for review. */
  readonly gates?: UltraGates;
}

/** Repository-wide gate commands detected from well-known project files. */
export interface UltraGates {
  readonly test: readonly string[];
  readonly lint: readonly string[];
  readonly build: readonly string[];
}

export interface PlanValidation {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** Parallel waves in dependency order; `[][]` when the plan is invalid. */
  readonly waves: readonly (readonly string[])[];
}

/** The persisted shape of a packet inside `state.json`. */
export interface PacketState {
  readonly id: string;
  readonly title: string;
  status: PacketStatus;
  repairs?: number;
  /** Why a packet is blocked, kept for the report rather than reconstructed. */
  reason?: string;
}

/** The persisted run state in `state.json`. */
export interface RunState {
  readonly runId: string;
  readonly goal: string;
  /** `null` means no cap. Raised by `resume --budget N` (spec 6). */
  budgetUsd: number | null;
  readonly createdAt: string;
  status: RunStatus;
  packets: PacketState[];
  /**
   * Parallel worker cap for the next execute pass, 1-8. Persisted so the board's
   * `+`/`-` keys change something real: a pass reads this when the caller did
   * not pass `--workers` explicitly.
   */
  workers?: number;
}

/** Ledger record kinds; the ledger is the durable, replayable step log. */
export type LedgerEntryKind = 'step' | 'packet' | 'gate' | 'run';

export interface LedgerEntry {
  readonly kind: LedgerEntryKind;
  readonly at?: string;
  readonly role?: string;
  readonly packetId?: string;
  readonly status?: string;
  readonly note?: string;
  readonly costUsd?: number;
  /** Tokens spent by a step, when the upstream reports them. */
  readonly tokensUsed?: number;
  /** Provider/model identity, so a report can say who did the work. */
  readonly model?: string;
}

/** One acceptance command's result. The exit code decides, never the output. */
export interface GateCommandResult {
  readonly cmd: string;
  /** Null means the process did not exit normally (timeout, signal, spawn error). */
  readonly exitCode: number | null;
  readonly output: string;
  readonly timedOut?: boolean;
}

export interface GateResult {
  readonly ok: boolean;
  readonly commands: readonly GateCommandResult[];
}

/** The reason a repair loop restarts a packet; it becomes the worker's note. */
export interface RepairFailure {
  readonly kind: 'gate' | 'verifier' | 'scope';
  readonly output: string;
}

/** What a worker run produced. `ok` here means "the agent finished", not "the work is good". */
export interface WorkerOutcome {
  readonly ok: boolean;
  readonly summary: string;
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
  /** Upstream HTTP 429 / rate limit; the scheduler backs off and lowers parallelism. */
  readonly rateLimited?: boolean;
  /**
   * The worker was cut short by an interrupt (SIGINT/SIGTERM), not by its own
   * work failing.
   *
   * An interrupted attempt is not a repair: the person asked the run to stop,
   * and spending a repair on it would punish the worker for their decision.
   */
  readonly interrupted?: boolean;
}

/** One verifier verdict over a packet's diff. */
export interface VerifierVerdictResult {
  readonly pass: boolean;
  readonly reasons: readonly string[];
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
  /** Upstream 429 during verification: retryable, never a repair (see ULT-06). */
  readonly rateLimited?: boolean;
}

/**
 * The final review pass over the combined diff (spec 3.6). The same checklist as
 * the packet verifier, plus cross-packet consistency.
 */
export interface ReviewVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
}

/** How a packet ended, for the report and the resume logic. */
export interface PacketExecutionOutcome {
  readonly id: string;
  readonly title: string;
  readonly status: PacketStatus;
  readonly reason?: string;
  readonly repairs: number;
  /** Worktree directory, kept on disk so nothing is silently thrown away. */
  readonly worktreeDir?: string;
  readonly branch?: string;
}

export interface ExecuteRunResult {
  readonly runStatus: RunStatus;
  readonly packets: readonly PacketExecutionOutcome[];
  /** 429 events observed; the report names this instead of hiding it. */
  readonly rateLimitEvents: number;
  /** Concurrency after any 429 backoff, so a report can explain the slowdown. */
  readonly effectiveWorkers: number;
  /** Total cost of this execute pass, summed from the ledger entries it wrote. */
  readonly costUsd: number;
}

