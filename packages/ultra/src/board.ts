/**
 * The Ultra board (spec §7).
 *
 * A long run has to be readable at a glance: what round it is in, what it has
 * cost, and which packets are finished, working, waiting or broken. The board is
 * the answer to "what is going on?" without reading the ledger.
 *
 * This module renders that board from data and nothing else: no clock, no
 * filesystem, no terminal. The CLI supplies the run's durable state and the
 * current time; a future TUI screen can supply live values and the same layout.
 *
 * Two consequences of being pure:
 *
 *   - **Deterministic.** Given the same input the board is byte-identical, so
 *     the layout is testable and a golden file cannot drift silently.
 *   - **No hidden state.** A field is shown because it was passed in, never
 *     because the renderer remembered it. The cost in the header is the caller's
 *     number, which is the ledger's arithmetic — not a second counter.
 */

import type { Criterion } from './goal.js';
import type { PlanPacket, RunState } from './types.js';

/**
 * Status glyphs. Every entry is exactly four characters wide so the packet rows
 * line up whatever the mix of statuses is, and plain ASCII so the board renders
 * the same in any terminal and in a log file. A TUI can pass its own set.
 */
export interface UltraBoardGlyphs {
  readonly done: string;
  readonly running: string;
  readonly repairing: string;
  readonly pending: string;
  readonly blocked: string;
  readonly skipped: string;
}

export const ULTRA_BOARD_GLYPHS: UltraBoardGlyphs = Object.freeze({
  done: '[ok]',
  running: '[..]',
  repairing: '[!!]',
  pending: '[  ]',
  blocked: '[xx]',
  skipped: '[--]',
});

export interface UltraBoardInput {
  readonly runId: string;
  /** The run's goal, as written at the start. */
  readonly goal: string;
  readonly state: RunState;
  /** Plan packets, for the dependency column and per-packet repair limits. */
  readonly packets?: readonly PlanPacket[];
  /** Goal-document criteria; a goal-driven run shows its progress. */
  readonly criteria?: readonly Criterion[];
  /** Spend so far, in USD. The caller owns this: the ledger is the source. */
  readonly costUsd: number;
  /** Cap in USD; `null` means no cap, shown as such rather than as $0. */
  readonly budgetUsd: number | null;
  /** Current round of a goal-driven run; omitted for a single-round run. */
  readonly round?: number;
  /** Phase inside the round (`Execute`, `Integrate`, `Accept`). */
  readonly phase?: string;
  /** Milliseconds since the run started; rendered as elapsed wall time. */
  readonly elapsedMs?: number;
  /** Parallel worker cap the next pass will use; shown so `+/-` has a visible effect. */
  readonly workers?: number;
  /**
   * Who is driving the run, when it was started in the background. A run that
   * outlives its shell is the normal case, and the board has to say so.
   */
  readonly runner?: string;
  /**
   * The last few log lines, so the board says what the run is doing without a
   * second command. Kept short on purpose: this is a glance, not a transcript.
   */
  readonly logTail?: readonly string[];
  /** Total width in columns; rows are truncated to fit. Defaults to 100. */
  readonly width?: number;
  readonly glyphs?: Partial<UltraBoardGlyphs>;
  /** Key hints in the footer; omitted when the caller has no keys to offer. */
  readonly keys?: readonly string[];
}

export const DEFAULT_BOARD_WIDTH = 100;

/** Fixed prefix in front of each log line, kept next to its width. */
const LOG_PREFIX = '  [log] ';

const DEFAULT_KEYS: readonly string[] = [
  '[p]ause',
  '[k]ill',
  '[+/-] workers',
  '[d]iff',
  '[l]og',
  '[g]oal',
  '[r]eport',
];

function glyphFor(status: string, glyphs: UltraBoardGlyphs): string {
  switch (status) {
    case 'done':
      return glyphs.done;
    case 'running':
    case 'gating':
    case 'verifying':
      return glyphs.running;
    case 'repairing':
      return glyphs.repairing;
    case 'blocked':
      return glyphs.blocked;
    case 'skipped':
    case 'cancelled':
      return glyphs.skipped;
    default:
      return glyphs.pending;
  }
}

/** `MM:SS`, or `H:MM:SS` once the run passes an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatUsd(value: number): string {
  // A non-finite cost would print as `$NaN`, which reads as a number and is not.
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : '$0.00';
}

/**
 * Collapses whitespace in a text field. A reason read back from the ledger can
 * span lines, and a board row may not. Applied to the text only: the row itself
 * is laid out with real spaces, which is what keeps the columns aligned.
 */
function flatten(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/** Truncates to `width` columns, marking the cut with an ellipsis. */
function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width === 1) return '…';
  return `${text.slice(0, width - 1)}…`;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** One packet's status line. */
function packetDetail(
  status: string,
  input: {
    readonly repairs?: number;
    readonly reason?: string;
    readonly maxRepairs: number;
    readonly waitingFor: readonly string[];
  },
): string {
  switch (status) {
    case 'done':
      // A packet is `done` only after gate and verifier (ULT-10), so saying so
      // is a statement about evidence, not about the worker's claim.
      return 'gate ok, verified';
    case 'repairing':
      // The denominator is the packet's own limit; without it, saying
      // `repair 1/0` would read as a packet that already exceeded its budget.
      return input.maxRepairs > 0
        ? `repair ${String(input.repairs ?? 0)}/${String(input.maxRepairs)}`
        : `repair ${String(input.repairs ?? 0)}`;
    case 'blocked':
      return input.reason ? `blocked: ${truncate(input.reason, 120)}` : 'blocked';
    case 'skipped':
      return input.reason ? `skipped: ${truncate(input.reason, 120)}` : 'skipped';
    default:
      return input.waitingFor.length > 0 ? `waits for ${input.waitingFor.join(', ')}` : '';
  }
}

/** The goal criteria summary, or an empty string when the run has no goal document. */
function criteriaLine(criteria: readonly Criterion[] | undefined): string {
  if (!criteria || criteria.length === 0) return '';
  const met = criteria.filter((criterion) => criterion.status === 'met').length;
  const mustOpen = criteria.filter(
    (criterion) => criterion.priority === 'must' && criterion.status !== 'met',
  ).length;
  const shouldOpen = criteria.filter(
    (criterion) => criterion.priority === 'should' && criterion.status !== 'met',
  ).length;
  const needsHuman = criteria.filter((criterion) => criterion.status === 'needs_human').length;
  const regressed = criteria.filter((criterion) => criterion.status === 'regressed').length;
  const parts = [`${String(met)}/${String(criteria.length)} met`];
  parts.push(`${String(mustOpen)} must open`);
  if (shouldOpen > 0) parts.push(`${String(shouldOpen)} should open`);
  if (regressed > 0) parts.push(`${String(regressed)} regressed`);
  if (needsHuman > 0) parts.push(`${String(needsHuman)} needs_human`);
  return `Criteria: ${parts.join('  ')}`;
}

/**
 * Renders the board. Every line is at most `width` columns, so the board can be
 * printed into a fixed-width terminal or a log without wrapping.
 */
export function renderUltraBoard(input: UltraBoardInput): string {
  const width = input.width ?? DEFAULT_BOARD_WIDTH;
  const glyphs = { ...ULTRA_BOARD_GLYPHS, ...input.glyphs };
  const state = input.state;

  // Header: identity on the left, round and money on the right.
  const identity = `ULTRA ${input.runId}`;
  // A single-round run has no round number, but it still has a phase, and the
  // phase is the only place the board says whether the run finished.
  const phase = input.phase ? ` / ${input.phase}` : '';
  const round =
    input.round === undefined
      ? input.phase
        ? `  ${input.phase}`
        : ''
      : `  Round ${String(input.round)}${phase}`;
  const cap = input.budgetUsd === null ? 'no cap' : formatUsd(input.budgetUsd);
  const right = [
    `${formatUsd(input.costUsd)} / ${cap}`,
    input.elapsedMs === undefined ? '' : formatElapsed(input.elapsedMs),
    input.workers === undefined ? '' : `workers=${String(input.workers)}`,
  ]
    .filter((part) => part.length > 0)
    .join('  ');
  const header = `${identity}${round}`;
  // The right side carries the numbers a monitor actually reads — cost against
  // the cap, elapsed time, the worker cap — so it is what survives on a narrow
  // board. Truncating the whole line from the right would cut the cost first and
  // leave a run id with no price next to it.
  let head: string;
  if (right.length >= width) {
    head = truncate(right, width);
  } else {
    const left = truncate(header, width - right.length - 1);
    const gap = ' '.repeat(Math.max(1, width - left.length - right.length));
    head = `${left}${gap}${right}`;
  }
  const lines: string[] = [truncate(head, width)];

  const goal = truncate(flatten(input.goal), width);
  if (goal.length > 0) lines.push(`Goal: ${goal}`);
  if (input.runner) lines.push(truncate(flatten(input.runner), width));
  const criteria = criteriaLine(input.criteria);
  if (criteria.length > 0) lines.push(truncate(criteria, width));

  // Packet rows.
  const packets = state.packets;
  if (packets.length === 0) {
    lines.push('(no packets yet)');
  } else {
    const statusOf = new Map(packets.map((packet) => [packet.id, packet.status]));
    const planOf = new Map((input.packets ?? []).map((packet) => [packet.id, packet]));
    const idWidth = Math.max(2, ...packets.map((packet) => packet.id.length));
    for (const packet of packets) {
      const planPacket = planOf.get(packet.id);
      const waitingFor = (planPacket?.depends_on ?? []).filter(
        (dependency) => statusOf.get(dependency) !== 'done',
      );
      const detail = packetDetail(packet.status, {
        repairs: packet.repairs,
        reason: packet.reason === undefined ? undefined : flatten(packet.reason),
        maxRepairs: planPacket?.max_repairs ?? 0,
        waitingFor,
      });
      const left = `${glyphFor(packet.status, glyphs)} ${padRight(packet.id, idWidth)}  ${flatten(packet.title)}`;
      const gutter = ' '.repeat(Math.max(1, width - left.length - detail.length - 2));
      lines.push(truncate(`${left}${gutter}  ${detail}`, width));
    }
  }

  // The log tail sits between the packets and the keys: it is the newest thing
  // that happened, and the keys are the least urgent thing on the screen.
  if (input.logTail && input.logTail.length > 0) {
    for (const line of input.logTail) {
      // `  [log] ` is eight columns, so the text gets the rest.
      const text = truncate(flatten(line), Math.max(4, width - LOG_PREFIX.length));
      lines.push(text.length > 0 ? `${LOG_PREFIX}${text}` : '  [log]');
    }
  }

  const keys = input.keys ?? DEFAULT_KEYS;
  if (keys.length > 0) lines.push(truncate(keys.join(' '), width));

  // A row with no detail would otherwise end in padding spaces, which shows up
  // as trailing whitespace in a pasted log and in a diff of the board.
  return lines.map((line) => line.trimEnd()).join('\n');
}

/**
 * The phase a run is in, for the board's header. Derived from the run status so
 * the board cannot disagree with `state.json`.
 */
export function boardPhase(status: RunState['status']): string {
  switch (status) {
    case 'planning':
      return 'Plan';
    case 'awaiting_confirm':
      return 'Confirm';
    case 'running':
      return 'Execute';
    case 'integrating':
      return 'Integrate';
    case 'accepting':
      return 'Accept';
    case 'paused':
      return 'Paused';
    default:
      return status;
  }
}