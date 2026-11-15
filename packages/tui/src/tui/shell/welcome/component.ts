import type { Component } from '../../rendering/component.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import type { TuiShellState } from '../contracts.js';
import {
  fitLine,
  normalizeWidth,
} from '../frame.js';
import { resolveTuiLayoutPolicy } from '../layout-policy.js';
import { ALRAN_CODE_WELCOME_DESIGN } from './design.js';
import { renderTuiWelcomeHero } from './hero.js';

export class TuiWelcome implements Component {
  constructor(private state: TuiShellState) {}

  setState(state: TuiShellState): void {
    this.state = state;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return this.renderViewport(width, Number.POSITIVE_INFINITY);
  }

  renderViewport(width: number, height: number): string[] {
    return this.renderFrame(width, height, false);
  }

  /**
   * Static banner above a conversation. In regular mode it becomes native
   * scrollback, so it omits live account and runtime status; the conversation
   * footer shows those through renderPreludeNotice().
   */
  renderPrelude(width: number): string[] {
    return this.renderFrame(width, Number.POSITIVE_INFINITY, true);
  }

  /** Live account notice for the conversation footer; empty when nothing needs action. */
  renderPreludeNotice(width: number): string[] {
    const safeWidth = normalizeWidth(width);
    const message = resolveWelcomeAccountNotice(this.state);
    if (!message || safeWidth === 0) return [];
    return [
      fitLine(`  ${renderWelcomeAccountNotice(message)}`, safeWidth),
      ...renderWelcomeGettingStarted(this.state).map((line) => fitLine(`  ${line}`, safeWidth)),
    ];
  }

  private renderFrame(width: number, height: number, staticBanner: boolean): string[] {
    const safeWidth = normalizeWidth(width);
    if (safeWidth === 0) return [];
    if (safeWidth < 4) {
      return [fitLine(ALRAN_CODE_WELCOME_DESIGN.hero.fallbackTitle, safeWidth)];
    }

    const policy = resolveTuiLayoutPolicy(safeWidth);
    const options = { staticBanner };
    let frame =
      policy.welcome === 'compact'
        ? renderCompactWelcome(this.state, safeWidth, options)
        : policy.welcome === 'stacked'
          ? renderStackedWelcome(this.state, safeWidth, options)
          : renderWideWelcome(this.state, safeWidth, options);
    if (frame.length + 2 > height && policy.welcome !== 'compact') {
      frame = renderCompactWelcome(this.state, safeWidth, options);
    }
    return fitWelcomeHeight(['', ...frame, ''], height);
  }
}

interface WelcomeRenderOptions {
  readonly staticBanner: boolean;
}

function fitWelcomeHeight(lines: string[], height: number): string[] {
  if (!Number.isFinite(height)) return lines;
  const maxRows = Math.max(1, Math.floor(height));
  const fitted = [...lines];
  while (fitted.length > maxRows) {
    const blankIndex = fitted.findIndex((line) => line.length === 0);
    if (blankIndex < 0) break;
    fitted.splice(blankIndex, 1);
  }
  return fitted.slice(0, maxRows);
}

function renderWideWelcome(
  state: TuiShellState,
  width: number,
  { staticBanner }: WelcomeRenderOptions,
): string[] {
  return [
    ...renderTuiWelcomeHero(width),
    '',
    renderWelcomeHeader(state, width, staticBanner),
    ...(staticBanner ? [] : renderWelcomeAccountNoticeRows(state)),
  ];
}

function renderStackedWelcome(
  state: TuiShellState,
  width: number,
  { staticBanner }: WelcomeRenderOptions,
): string[] {
  return [
    ...renderTuiWelcomeHero(width),
    '',
    renderWelcomeHeader(state, width, staticBanner),
    ...(staticBanner ? [] : renderWelcomeAccountNoticeRows(state)),
  ];
}

function renderCompactWelcome(
  state: TuiShellState,
  width: number,
  { staticBanner }: WelcomeRenderOptions,
): string[] {
  return [
    ...renderTuiWelcomeHero(width),
    '',
    fitLine(renderWelcomeHeader(state, width, staticBanner), width),
    ...(staticBanner ? [] : renderWelcomeAccountNoticeRows(state)),
  ];
}

function renderWelcomeHeader(state: TuiShellState, width: number, staticBanner: boolean): string {
  const left = chalk.hex(colors.muted)(`v${state.version}`);
  const right = staticBanner ? '' : renderActivity(state);
  return right ? `${left}  ${right}` : left;
}

function resolveWelcomeAccountNotice(state: TuiShellState): string | undefined {
  return state.accountStatus === 'Sign in with /login'
    ? state.accountStatus
    : state.accountStatus === 'Connected with warnings'
      ? 'Check /provider or /status for details.'
      : state.accountStatus === 'Account unavailable'
        ? 'Check /status for details.'
        : undefined;
}

function renderWelcomeAccountNotice(message: string): string {
  return `${chalk.bold.hex(colors.warning)('○')} ${chalk.bold.hex(colors.warning)(message)}`;
}

function renderWelcomeAccountNoticeRows(state: TuiShellState): string[] {
  const message = resolveWelcomeAccountNotice(state);
  if (!message) return [];
  return [renderWelcomeAccountNotice(message), ...renderWelcomeGettingStarted(state)];
}

/**
 * The first start, without a tutorial: while nobody is signed in and no provider is connected, the notice that
 * says "Sign in with /login" also says what that gets you and where the other ways in are. It is four lines of
 * text under the notice — nothing to dismiss, nothing blocks the composer (/login can be typed at once) — and it
 * disappears as soon as an account or a provider is connected.
 */
function renderWelcomeGettingStarted(state: TuiShellState): string[] {
  if (state.accountStatus !== 'Sign in with /login') return [];
  const dim = chalk.hex(colors.muted);
  const key = (command: string): string => chalk.bold.hex(colors.signal)(command.padEnd(10));
  return [
    dim('Alran Code runs on the Ottili AI Platform, on your own provider, or on both.'),
    `${key('/login')}${dim('sign in with your Ottili account (browser or device code), or paste an API key')}`,
    `${key('/provider')}${dim('connect OpenRouter, another provider, or any OpenAI-compatible endpoint')}`,
    dim('Then describe your task. /help lists every command.'),
  ];
}

function renderActivity(state: TuiShellState): string {
  if (state.accountStatus === 'Sign in with /login') {
    return chalk.bold.hex(colors.warning)('○ Login required');
  }
  if (state.runtimeStatus === 'error') {
    return chalk.bold.hex(colors.error)('× Error');
  }
  if (state.accountStatus === 'Checking account') {
    return chalk.bold.hex(colors.signal)('◌ Checking account');
  }
  if (state.accountStatus === 'Connected with warnings') {
    return chalk.bold.hex(colors.warning)('○ Setup warning');
  }
  if (state.accountStatus === 'Account unavailable') {
    return chalk.bold.hex(colors.warning)('○ Account unavailable');
  }
  if (state.runtimeStatus === 'ready') {
    return chalk.bold.hex(colors.orbit)('● Ready');
  }
  if (state.runtimeStatus === 'starting') {
    return chalk.bold.hex(colors.signal)('◌ Starting');
  }
  if (state.runtimeStatus === 'offline') {
    return chalk.bold.hex(colors.warning)('○ Offline');
  }
  return chalk.bold.hex(colors.error)('× Error');
}
