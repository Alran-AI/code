/**
 * Live progress for a running Ultra pass.
 *
 * A Ultra run is long by design: the whole point is to do work that does not fit
 * in one agent loop. The planning phase already narrates itself ("exploring
 * structure…", "planning the packets…"), but the execute phase used to be silent
 * between "Executing 6 packet(s)…" and the final summary — minutes or hours of
 * a frozen terminal, with no way to tell a slow worker from a stuck one.
 *
 * This module is the *shape* of that narration: the events the scheduler emits
 * and the one-line rendering of each. Both are pure, so the layout is tested
 * once and the CLI, the TUI and the detached runner's log all read the same
 * words.
 *
 * The events are deliberately coarse. They say what the harness *observed* — a
 * gate ran, a verifier rejected, a packet was blocked — and never what a worker
 * claims about its own work. A progress line that repeats the worker's summary
 * would be the worker talking, and the worker is not the evidence.
 */

/** What the scheduler observed. One kind per decision point in a packet's life. */
export type UltraProgressKind =
  /** A worker attempt started (the first one, or a repair). */
  | 'attempt'
  /** The worker process finished; its own claim about the work is not repeated. */
  | 'worker_done'
  /** Every acceptance command exited 0. */
  | 'gate_ok'
  /** At least one acceptance command failed. */
  | 'gate_fail'
  /** The verifier accepted the diff. */
  | 'verifier_pass'
  /** The verifier rejected the diff. */
  | 'verifier_fail'
  /** The packet is going around again after a failure. */
  | 'repair'
  /** The packet reached `done`: gate green and verifier passed. */
  | 'packet_done'
  /** The packet reached `blocked` and will not be retried. */
  | 'packet_blocked'
  /** The packet was skipped because a dependency did not complete. */
  | 'packet_skipped'
  /** The upstream was rate limited; parallelism was lowered. */
  | 'rate_limited'
  /** The budget stopped the run at 100 %. */
  | 'budget_paused';

export interface UltraProgressEvent {
  readonly kind: UltraProgressKind;
  /** The packet this event is about. */
  readonly packetId: string;
  /** The packet's title, shown on the attempt line so the reader knows what started. */
  readonly title?: string;
  /** Why, in one line: the failing command, the verifier's first reason. */
  readonly detail?: string;
  /** 1-based attempt number within the packet. */
  readonly attempt?: number;
  /** How many repairs the packet has used. */
  readonly repairs?: number;
}

/** Longest detail rendered on one line; the full text stays in the evidence files. */
const MAX_DETAIL = 160;

/**
 * The first non-empty line of a text, trimmed and shortened.
 *
 * Gate output and verifier reasons are multi-line; a progress line has to stay
 * one line so the log and the terminal stay readable. The full text is never
 * lost: it is in the packet's evidence files and in the report.
 */
export function firstLineOf(text: string, max = MAX_DETAIL): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0)?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Renders one progress event as a single line.
 *
 * The packet id is padded so the events of different packets line up, which is
 * what makes a log of a parallel run readable: three packets are working at
 * once and their lines have to be told apart at a glance.
 */
export function renderProgressEvent(event: UltraProgressEvent): string {
  const head = `  ${event.packetId.padEnd(6)}`;
  const detail = event.detail ? firstLineOf(event.detail) : '';
  const suffix = detail ? `: ${detail}` : '';
  switch (event.kind) {
    case 'attempt': {
      const attempt = event.attempt ?? 1;
      const title = event.title ? ` · ${event.title}` : '';
      return `${head} attempt ${String(attempt)}${title}`;
    }
    case 'worker_done':
      return `${head} worker finished`;
    case 'gate_ok':
      return `${head} gate ok`;
    case 'gate_fail':
      return `${head} gate failed${suffix}`;
    case 'verifier_pass':
      return `${head} verifier passed`;
    case 'verifier_fail':
      return `${head} verifier rejected${suffix}`;
    case 'repair': {
      const attempt = (event.attempt ?? 1) + 1;
      return `${head} repairing${suffix} (attempt ${String(attempt)})`;
    }
    case 'packet_done':
      return `${head} done`;
    case 'packet_blocked':
      return `${head} blocked${suffix}`;
    case 'packet_skipped':
      return `${head} skipped${suffix}`;
    case 'rate_limited':
      return `${head} rate limited${suffix}`;
    case 'budget_paused':
      return `  --    budget paused${suffix}`;
    default:
      return `${head} ${event.kind}`;
  }
}
