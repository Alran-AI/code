/**
 * The interactive Ultra board (spec §7).
 *
 * `/ultra` opens this panel on a run and keeps it live: it redraws on a timer
 * while it is open and on every key press, so a long run can be watched without
 * re-running the command. The layout itself is not decided here — `renderUltraBoard`
 * in @alran/ultra owns it, and this component only frames it and turns keys into
 * actions.
 *
 * The split matters: the renderer is pure and tested against width and glyph
 * rules, while this file is the only place that knows about the terminal. Keys
 * are offered only when the action behind them is real, so the footer never
 * advertises a control the host did not supply.
 */

import { getKeybindings, matchesKey } from '../../engine/public.js';
import type { Component } from '../../rendering/component.js';
import { truncateToWidth } from '../../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import {
  questionnaireFrameContentWidth,
  renderQuestionnaireFrame,
} from '../interaction/decision-frame.js';
import { boardPhase, renderUltraBoard, type UltraBoardInput } from '@alran/ultra';

/** Everything the board needs to draw one frame. */
export interface UltraBoardSnapshot {
  readonly runId: string;
  readonly goal: string;
  readonly state: UltraBoardInput['state'];
  readonly packets: UltraBoardInput['packets'];
  readonly criteria?: UltraBoardInput['criteria'];
  readonly costUsd: number;
  readonly round?: number;
  readonly elapsedMs?: number;
  /** Workers the next execute pass will use. */
  readonly workers: number;
  /** The newest log lines, so the board says what the run is doing right now. */
  readonly logTail?: readonly string[];
}

/**
 * The actions behind the keys. Each returns the line to show as a notice; a
 * host that cannot support an action leaves it out and the key is not offered.
 */
export interface UltraBoardActions {
  readonly pause?: () => string | Promise<string>;
  readonly kill?: () => string | Promise<string>;
  readonly resume?: () => string | Promise<string>;
  /** `delta` is +1 or -1; returns the new cap. */
  readonly workers?: (delta: number) => string | Promise<string>;
  readonly diff?: () => string;
  readonly log?: () => string;
  readonly goal?: () => string;
  readonly report?: () => string;
}

export interface UltraBoardOptions {
  /** Read the run's current state; called for every frame. */
  readonly snapshot: () => UltraBoardSnapshot | undefined;
  readonly actions: UltraBoardActions;
  /** Asks the host to repaint the panel. */
  readonly requestRender: () => void;
  /** Called when the user closes the board. */
  readonly onClose: () => void;
  /** Shows a key's result (a notice, a report, a diff). */
  readonly showNotice: (text: string, kind?: 'info' | 'warning' | 'error') => void;
}

const KEY_HINTS: readonly { readonly keys: readonly string[]; readonly label: string }[] = [
  { keys: ['p'], label: 'pause' },
  { keys: ['k'], label: 'kill' },
  { keys: ['+', '='], label: 'workers' },
  { keys: ['-', '_'], label: 'workers' },
  { keys: ['d'], label: 'diff' },
  { keys: ['l'], label: 'log' },
  { keys: ['g'], label: 'goal' },
  { keys: ['r'], label: 'report' },
  { keys: ['s'], label: 'resume' },
];

export class UltraBoard implements Component {
  private closed = false;

  constructor(private readonly options: UltraBoardOptions) {}

  /** Ids of the actions this host actually supplied, in footer order. */
  private available(): ReadonlySet<string> {
    const actions = this.options.actions;
    const available = new Set<string>();
    if (actions.pause) available.add('pause');
    if (actions.kill) available.add('kill');
    if (actions.workers) available.add('workers');
    if (actions.diff) available.add('diff');
    if (actions.log) available.add('log');
    if (actions.goal) available.add('goal');
    if (actions.report) available.add('report');
    if (actions.resume) available.add('resume');
    return available;
  }

  private footer(available: ReadonlySet<string>): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const hint of KEY_HINTS) {
      const label = hint.label;
      if (seen.has(label)) continue;
      // `+`/`-` are one control, so offer it once and accept both spellings.
      if (label === 'workers' && !available.has('workers')) continue;
      if (label !== 'workers' && !available.has(label)) continue;
      seen.add(label);
      const keys = hint.keys[0] === '+' ? '+/-' : hint.keys[0];
      parts.push(`[${keys}] ${label}`);
    }
    parts.push('[esc] close');
    return parts.join(' · ');
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, 'escape') || getKeybindings().matches(data, 'tui.select.cancel')) {
      this.closed = true;
      this.options.onClose();
      return;
    }
    if (matchesKey(data, 'up') || matchesKey(data, 'down') || matchesKey(data, 'enter')) {
      // The board has no cursor; a redraw is the useful response, and it keeps
      // the panel from swallowing keys that would otherwise do nothing.
      this.options.requestRender();
      return;
    }
    const actions = this.options.actions;
    // The keys that start an async action; each resolves to a thunk so the
    // workers key can pass its direction.
    const asyncActions: Record<string, (() => string | Promise<string>) | undefined> = {
      p: actions.pause,
      k: actions.kill,
      s: actions.resume,
      '+': actions.workers ? () => actions.workers!(1) : undefined,
      '=': actions.workers ? () => actions.workers!(1) : undefined,
      '-': actions.workers ? () => actions.workers!(-1) : undefined,
      '_': actions.workers ? () => actions.workers!(-1) : undefined,
    };
    const started = asyncActions[data];
    if (started) {
      void this.run(started);
      return;
    }
    // The keys that only show text the host can produce synchronously.
    const notices: Record<string, (() => string) | undefined> = {
      d: actions.diff,
      l: actions.log,
      g: actions.goal,
      r: actions.report,
    };
    const show = notices[data];
    if (show) this.options.showNotice(show());
  }

  /** Runs an async action and reports what it said; a failure is shown, not thrown. */
  private async run(action: (() => string | Promise<string>) | undefined): Promise<void> {
    if (!action) return;
    try {
      this.options.showNotice(await action());
    } catch (error) {
      this.options.showNotice(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.options.requestRender();
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    const contentWidth = questionnaireFrameContentWidth(safeWidth);
    const available = this.available();
    const snapshot = this.options.snapshot();

    if (!snapshot) {
      // The flow only opens a board for a run it found on disk, so "no
      // snapshot" means the run has no packets yet — not that there is no run.
      return renderQuestionnaireFrame(
        {
          title: 'Ultra',
          body: [
            chalk.hex(colors.muted)('This run has no packets yet.'),
            '',
            'It is still planning; the board fills in once the plan is written.',
            'A run started outside the TUI begins with `alran ultra "<task>"`.',
          ],
          footer: 'esc close',
        },
        safeWidth,
        'signal',
      );
    }

    // The core renderer owns the layout; the panel only supplies the width.
    const board = renderUltraBoard({
      runId: snapshot.runId,
      goal: snapshot.goal,
      state: snapshot.state,
      ...(snapshot.packets ? { packets: snapshot.packets } : {}),
      ...(snapshot.criteria ? { criteria: snapshot.criteria } : {}),
      costUsd: snapshot.costUsd,
      budgetUsd: snapshot.state.budgetUsd,
      ...(snapshot.round === undefined ? {} : { round: snapshot.round }),
      // Derived from the run status so the board can never claim a phase the
      // state file does not record.
      phase: boardPhase(snapshot.state.status),
      ...(snapshot.elapsedMs === undefined ? {} : { elapsedMs: snapshot.elapsedMs }),
      workers: snapshot.workers,
      ...(snapshot.logTail && snapshot.logTail.length > 0 ? { logTail: snapshot.logTail } : {}),
      width: contentWidth,
      // The footer carries the keys; the board must not print a second set.
      keys: [],
    });

    const body = board
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => truncateToWidth(line, contentWidth, ''));

    return renderQuestionnaireFrame(
      {
        title: safeWidth < 40 ? 'Ultra' : 'Ultra · run board',
        body,
        footer: this.footer(available),
      },
      safeWidth,
      'signal',
    );
  }
}