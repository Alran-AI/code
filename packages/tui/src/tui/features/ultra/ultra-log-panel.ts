/**
 * The Ultra log panel: what a run is doing right now, in its own words.
 *
 * `/ultra attach` and the board's `l` key open this. It shows the tail of the
 * detached runner's log with the run's status, and it repaints on the board's
 * timer, so a run that is writing can be watched without re-running the command.
 *
 * It is a view, not a follower: the panel never blocks and never owns the file.
 * The flow reads the tail on each frame, which keeps this component free of I/O
 * and therefore testable.
 */

import type { Component } from '../../rendering/component.js';
import { truncateToWidth, visibleWidth } from '../../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import { questionnaireFrameContentWidth, renderQuestionnaireFrame } from '../interaction/decision-frame.js';
import { matchesKey } from '../../engine/public.js';

export interface UltraLogView {
  readonly runId: string;
  readonly status: string;
  /** The runner classification line: running, finished, interrupted. */
  readonly detail: string;
  readonly lines: readonly string[];
  /** True while a process is still driving the run. */
  readonly live: boolean;
}

export interface UltraLogPanelOptions {
  readonly view: () => UltraLogView | undefined;
  readonly requestRender: () => void;
  readonly onClose: () => void;
}

const MAX_LOG_LINES = 24;

export class UltraLogPanel implements Component {
  constructor(private readonly options: UltraLogPanelOptions) {}

  invalidate(): void {}

  handleInput(data: string): void {
    // Any key that is not a close redraws, so a reader who presses something
    // gets the newest log rather than a frozen screen.
    if (matchesKey(data, 'escape') || matchesKey(data, 'enter') || matchesKey(data, 'q')) {
      this.options.onClose();
      return;
    }
    this.options.requestRender();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    const contentWidth = questionnaireFrameContentWidth(safeWidth);
    const view = this.options.view();

    if (!view) {
      return renderQuestionnaireFrame(
        {
          title: 'Ultra · log',
          body: [chalk.hex(colors.muted)('This run has no log yet.')],
          footer: 'esc close',
        },
        safeWidth,
        'signal',
      );
    }

    const body: string[] = [
      chalk.hex(colors.muted)(`${view.runId} — ${view.status}`),
      chalk.hex(view.live ? colors.accent : colors.muted)(view.detail),
      '',
    ];
    if (view.lines.length === 0) {
      body.push(chalk.hex(colors.muted)('(no output yet)'));
    } else {
      for (const line of view.lines.slice(-MAX_LOG_LINES)) {
        body.push(truncateToWidth(line, contentWidth, ''));
      }
    }

    return renderQuestionnaireFrame(
      {
        title: safeWidth < 44 ? 'Ultra · log' : 'Ultra · runner log',
        meta: view.live ? 'live' : 'ended',
        body,
        footer: view.live ? 'following · esc close' : 'esc close',
      },
      safeWidth,
      'signal',
    );
  }
}

/** Renders a log line for a terminal of `width` columns. */
export function fitLogLine(line: string, width: number): string {
  return truncateToWidth(line.replace(/\s+/gu, ' ').trim(), Math.max(1, width), '');
}

/** Visible width of a log line, for callers that need to lay lines out. */
export function logLineWidth(line: string): number {
  return visibleWidth(line);
}