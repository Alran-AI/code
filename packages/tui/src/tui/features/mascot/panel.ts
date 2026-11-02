import { Key, decodePrintableKey, matchesKey } from '../../engine/public.js';
import type { Component } from '../../rendering/component.js';
import { truncateToWidth, visibleWidth } from '../../rendering/text.js';
import { centerToWidth } from '../../shell/frame.js';
import { renderTuiActionHint, tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import {
  TUI_MASCOT_ART_ROWS,
  createTuiMascotPhysics,
  renderTuiMascotArt,
  stepTuiMascotPhysics,
  type TuiMascotMode,
  type TuiMascotPalette,
  type TuiMascotPhysicsState,
} from './art.js';

/**
 * Animation cadence. The original character ran at 50 ms; 80 ms matches the
 * rest of the TUI's animated surfaces and is fast enough that the jump arc
 * still reads as motion.
 */
const MASCOT_TICK_INTERVAL_MS = 80;

/** Keystrokes buffered for word detection, matching the original character. */
const MASCOT_KEY_BUFFER_LIMIT = 20;

/**
 * Stage height in rows when the host renders without a viewport hint. The
 * default interaction band is 12 rows, and the footer costs one, so this leaves
 * room for the character plus his jump arc.
 */
const MASCOT_STAGE_ROWS = 9;

const MASCOT_WORDS: readonly { readonly word: string; readonly mode: TuiMascotMode }[] = [
  { word: 'jump', mode: 'jump' },
  { word: 'dance', mode: 'dance' },
  { word: 'sleep', mode: 'sleep' },
];

/** Longest first, so a narrow panel keeps the most useful instruction. */
const MASCOT_MOOD_HINTS = [
  'type jump, dance or sleep · Esc close',
  'type a mood · Esc close',
  'Esc close',
] as const;

const MASCOT_WAKE_HINTS = [
  'type jump or dance to wake him · Esc close',
  'type jump to wake him · Esc close',
  'Esc close',
] as const;

export interface TuiMascotPanelOptions {
  readonly requestRender: () => void;
  readonly onClose: () => void;
}

/**
 * An animated little man who responds to typed words.
 *
 * Typing `jump`, `dance`, or `sleep` while the panel is focused switches his
 * mood. There is no input field, so the panel renders a stage and a hint rather
 * than a text cursor.
 */
export class TuiMascotPanel implements Component {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private physics: TuiMascotPhysicsState = createTuiMascotPhysics('jump');
  private keyBuffer = '';
  private tick = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private readonly requestRender: () => void;
  private readonly onClose: () => void;

  constructor(options: TuiMascotPanelOptions) {
    this.requestRender = options.requestRender;
    this.onClose = options.onClose;
    this.startAnimation();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onClose();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.keyBuffer = '';
      return;
    }
    const printable = decodePrintableKey(data);
    const text = printable ?? (isPlainText(data) ? data : undefined);
    if (!text) return;
    this.keyBuffer = `${this.keyBuffer}${text.toLowerCase()}`.slice(-MASCOT_KEY_BUFFER_LIMIT);
    const matched = MASCOT_WORDS.find((entry) => this.keyBuffer.includes(entry.word));
    if (!matched) return;
    this.keyBuffer = '';
    this.setMode(matched.mode);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    return this.renderStage(safeWidth, MASCOT_STAGE_ROWS);
  }

  renderViewport(width: number, height: number): readonly string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    return this.renderStage(safeWidth, Math.max(TUI_MASCOT_ART_ROWS + 1, Math.floor(height)));
  }

  dispose(): void {
    this.disposed = true;
    this.stopAnimation();
  }

  /** Exposed for tests and for hosts that want to drive the animation manually. */
  tickOnce(): void {
    if (this.disposed) return;
    this.tick += 1;
    this.physics = stepTuiMascotPhysics(this.physics);
    this.requestRender();
  }

  getState(): Readonly<TuiMascotPhysicsState> {
    return this.physics;
  }

  setMode(mode: TuiMascotMode): void {
    // Recreating the physics on every request means typing "jump" while already
    // jumping launches him again instead of doing nothing.
    this.physics = createTuiMascotPhysics(mode);
    this.requestRender();
  }

  private renderStage(width: number, height: number): string[] {
    const art = renderTuiMascotArt(
      { mode: this.physics.mode, posY: this.physics.posY, tick: this.tick },
      this.palette(),
    );
    const footer = this.renderFooter(width);
    // The footer is part of the requested height, so a host that renders into a
    // fixed viewport never gets an extra row it did not budget for.
    const rows = Math.max(TUI_MASCOT_ART_ROWS + 1, height);
    const stageRows = rows - 1;
    const above = Math.max(0, stageRows - TUI_MASCOT_ART_ROWS - this.physics.posY);
    const below = Math.max(0, stageRows - above - TUI_MASCOT_ART_ROWS);
    return [
      ...Array.from({ length: above }, () => ''),
      ...art.map((line) => truncateToWidth(centerToWidth(line, width), width)),
      ...Array.from({ length: below }, () => ''),
      footer,
    ];
  }

  private renderFooter(width: number): string {
    const mode = this.physics.mode;
    const status = chalk.bold.hex(modeColor(mode))(modeLabel(mode));
    // Measure the plain text so a narrow panel shortens the hint to a whole
    // phrase instead of clipping a word in half.
    const room = Math.max(0, width - visibleWidth(status) - 1);
    const hint =
      mode === 'sleep'
        ? firstFitting(MASCOT_WAKE_HINTS, room)
        : firstFitting(MASCOT_MOOD_HINTS, room);
    if (!hint) return truncateToWidth(status, Math.max(0, width), '');
    return truncateToWidth(`${status} ${renderTuiActionHint(hint)}`, Math.max(0, width), '');
  }

  private palette(): TuiMascotPalette {
    return {
      chalk,
      body: colors.signal,
      airborne: colors.orbit,
      sleep: colors.dim,
      sleepFace: colors.dim,
      danceFace: colors.warning,
      alertFace: colors.warning,
      trail: colors.signal,
    };
  }

  private startAnimation(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tickOnce(), MASCOT_TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  private stopAnimation(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function firstFitting(hints: readonly string[], room: number): string | undefined {
  return hints.find((hint) => visibleWidth(hint) <= room);
}

function modeLabel(mode: TuiMascotMode): string {
  if (mode === 'dance') return '♪ dancing';
  if (mode === 'sleep') return 'z sleeping';
  return '● jumping';
}

function modeColor(mode: TuiMascotMode): string {
  if (mode === 'dance') return colors.warning;
  if (mode === 'sleep') return colors.dim;
  return colors.signal;
}

/** Single printable character without control sequences. */
function isPlainText(data: string): boolean {
  if (data.length !== 1) return false;
  const code = data.codePointAt(0);
  if (code === undefined) return false;
  return code >= 32 && code !== 127;
}
