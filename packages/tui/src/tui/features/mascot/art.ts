import type { ChalkInstance } from 'chalk';
import { visibleWidth } from '../../rendering/text.js';

/**
 * The little man who lives in the Alran Code TUI.
 *
 * He is a five-line ASCII character with three moods — jumping, dancing and
 * sleeping — driven by a small vertical physics model. Everything here is pure
 * data and arithmetic so the art and the motion can be tested without a
 * terminal or a timer.
 */

export type TuiMascotMode = 'jump' | 'dance' | 'sleep';

export const TUI_MASCOT_MODES = ['jump', 'dance', 'sleep'] as const satisfies readonly TuiMascotMode[];

/** Rows the character block occupies. Stage padding is measured in these rows. */
export const TUI_MASCOT_ART_ROWS = 4;

/** Resting height. Positive `posY` means airborne, so 0 is standing on the floor. */
export const TUI_MASCOT_GROUND_Y = 0;

/**
 * Initial upward velocity in rows per tick.
 *
 * The original character used 6 and 5 inside a 15-row Ink box, where the apex
 * ran past the top edge and pegged there. The TUI renders this panel in a
 * tighter interaction band, so the arcs are tuned to fit inside it: velocity 3
 * peaks at 6 rows, velocity 2 at 3 rows.
 */
export const TUI_MASCOT_JUMP_VELOCITY = 3;
export const TUI_MASCOT_DANCE_VELOCITY = 2;

/** Rows removed from velocity each tick. */
export const TUI_MASCOT_GRAVITY = 1;

/** Ticks the dancer rests on the floor before bouncing again. */
export const TUI_MASCOT_DANCE_REST_TICKS = 4;

/** Ticks per disco-color step while dancing. */
export const TUI_MASCOT_COLOR_STEP_TICKS = 5;

/** Ticks per sleeping "z" step. */
export const TUI_MASCOT_ZZZ_STEP_TICKS = 2;

/** Number of rows the sleeping trail walks up. */
export const TUI_MASCOT_ZZZ_PHASES = 3;

/**
 * Disco colors stay hard-coded on purpose: the dancer should read as a party in
 * every theme, including light ones where the brand ramp is too subtle to look
 * like celebration.
 */
export const TUI_MASCOT_PARTY_COLORS = ['#FF00FF', '#00FFFF', '#FFFF00', '#00FF00'] as const;

/**
 * Every pose renders the same total width so switching moods cannot make the
 * character jitter horizontally when the block is centered.
 */
export const TUI_MASCOT_ART_WIDTH = 16;

const HEAD_PAD = '   ';
const HEAD = '╭───────╮';
const NECK = '╰───┬───╯';
const FACE_INNER_WIDTH = 5;
const TRAIL_COLUMN_PAD = ' ';
const TRAIL_WIDTH = 3;

export interface TuiMascotPose {
  readonly mode: TuiMascotMode;
  /** Airborne height in rows. */
  readonly posY: number;
  /** Animation tick; drives the disco beat and the sleeping trail. */
  readonly tick: number;
}

export interface TuiMascotPalette {
  readonly chalk: ChalkInstance;
  /** Standing body. */
  readonly body: string;
  /** Body while airborne. */
  readonly airborne: string;
  /** Body while asleep. */
  readonly sleep: string;
  readonly sleepFace: string;
  readonly danceFace: string;
  /** Eyes when the jump is near its peak. */
  readonly alertFace: string;
  /** Sleeping trail letters. */
  readonly trail: string;
}

export interface TuiMascotPhysicsState {
  readonly mode: TuiMascotMode;
  readonly posY: number;
  readonly velY: number;
  /** Remaining rest ticks on the floor; only the dancer bounces back up. */
  readonly restTicks: number;
}

export function createTuiMascotPhysics(mode: TuiMascotMode): TuiMascotPhysicsState {
  if (mode === 'jump') {
    return { mode, posY: 1, velY: TUI_MASCOT_JUMP_VELOCITY, restTicks: 0 };
  }
  if (mode === 'dance') {
    return { mode, posY: 1, velY: TUI_MASCOT_DANCE_VELOCITY, restTicks: 0 };
  }
  return { mode, posY: TUI_MASCOT_GROUND_Y, velY: 0, restTicks: 0 };
}

/**
 * Advances one animation tick.
 *
 * Sleeping settles on the floor instead of freezing wherever the character
 * happened to be when the user typed "sleep": a mid-air nap reads as a stuck
 * frame rather than a sleeping character.
 */
export function stepTuiMascotPhysics(
  state: TuiMascotPhysicsState,
  nextMode: TuiMascotMode = state.mode,
): TuiMascotPhysicsState {
  const mode = nextMode;
  if (mode === 'sleep') {
    return { mode, posY: TUI_MASCOT_GROUND_Y, velY: 0, restTicks: 0 };
  }
  if (mode !== state.mode) return createTuiMascotPhysics(mode);

  if (state.posY > 0 || state.velY > 0) {
    const posY = state.posY + state.velY;
    const velY = state.velY - TUI_MASCOT_GRAVITY;
    if (posY <= TUI_MASCOT_GROUND_Y) {
      return {
        mode,
        posY: TUI_MASCOT_GROUND_Y,
        velY: 0,
        restTicks: mode === 'dance' ? TUI_MASCOT_DANCE_REST_TICKS : 0,
      };
    }
    return { mode, posY, velY, restTicks: 0 };
  }

  if (mode !== 'dance') return { mode, posY: TUI_MASCOT_GROUND_Y, velY: 0, restTicks: 0 };
  if (state.restTicks > 0) {
    return { mode, posY: TUI_MASCOT_GROUND_Y, velY: 0, restTicks: state.restTicks - 1 };
  }
  return {
    mode,
    posY: 1,
    velY: TUI_MASCOT_DANCE_VELOCITY,
    restTicks: 0,
  };
}

/** Face row. The eyes keep a fixed column so the head never shifts between poses. */
export function renderTuiMascotFace(pose: TuiMascotPose, palette: TuiMascotPalette): string {
  const { chalk } = palette;
  if (pose.mode === 'sleep') return chalk.hex(palette.sleepFace)('-   -');
  if (pose.mode === 'dance') return chalk.hex(palette.danceFace)('♪   ♪');
  if (pose.posY > 2) return chalk.hex(palette.alertFace)('O   O');
  return '◕   ◕';
}

/** Body color for the current pose. */
export function resolveTuiMascotColor(pose: TuiMascotPose, palette: TuiMascotPalette): string {
  if (pose.mode === 'sleep') return palette.sleep;
  if (pose.mode === 'dance') {
    const index =
      Math.floor(pose.tick / TUI_MASCOT_COLOR_STEP_TICKS) % TUI_MASCOT_PARTY_COLORS.length;
    return TUI_MASCOT_PARTY_COLORS[index] ?? TUI_MASCOT_PARTY_COLORS[0];
  }
  if (pose.posY > 0) return palette.airborne;
  return palette.body;
}

/**
 * Sleeping trail: one letter per row, walking upward as the phase advances, so
 * the "z"s drift up the right side of the head instead of stacking in a column.
 */
export function renderTuiMascotSleepTrail(
  tick: number,
  palette: TuiMascotPalette,
): readonly [string, string, string] {
  const phase = Math.floor(tick / TUI_MASCOT_ZZZ_STEP_TICKS) % TUI_MASCOT_ZZZ_PHASES;
  const letter = palette.chalk.hex(palette.trail)(phase === 1 ? 'Z' : 'z');
  const row = (index: number): string =>
    padVisible(index === phase ? letter : ' ', TRAIL_WIDTH, ' ');
  return [row(2), row(1), row(0)];
}

/**
 * The full character block. Every line is padded to
 * {@link TUI_MASCOT_ART_WIDTH} so callers can indent or center without
 * re-measuring, and trailing blanks never contain color escapes.
 */
export function renderTuiMascotArt(pose: TuiMascotPose, palette: TuiMascotPalette): string[] {
  const color = palette.chalk.hex(resolveTuiMascotColor(pose, palette));
  const face = renderTuiMascotFace(pose, palette);
  const faceRow = `${HEAD_PAD}${color('│ ')}${face}${color(' │')}`;
  const trail = renderTuiMascotSleepTrail(pose.tick, palette);
  const trailRow = (index: number): string => `${TRAIL_COLUMN_PAD}${trail[index] ?? ''}`;

  if (pose.mode === 'sleep') {
    return [
      padVisible(`${HEAD_PAD}${color(HEAD)}${trailRow(2)}`, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(`${faceRow}${trailRow(1)}`, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(`${HEAD_PAD}${color(NECK)}${trailRow(0)}`, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(`${HEAD_PAD}   ${color('╱ ╲')}`, TUI_MASCOT_ART_WIDTH, ' '),
    ];
  }

  if (pose.mode === 'dance') {
    const beat = Math.floor(pose.tick / TUI_MASCOT_COLOR_STEP_TICKS) % 2 === 0;
    const armLeft = beat ? '\\' : '/';
    const armRight = beat ? '/' : '\\';
    const legLeft = beat ? '╱' : '╲';
    const legRight = beat ? '╲' : '╱';
    return [
      padVisible(`  ${color(armLeft)}${color(HEAD)}${color(armRight)}`, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(faceRow, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(`${HEAD_PAD}${color(NECK)}`, TUI_MASCOT_ART_WIDTH, ' '),
      padVisible(`      ${color(`${legLeft} ${legRight}`)}`, TUI_MASCOT_ART_WIDTH, ' '),
    ];
  }

  return [
    padVisible(`${HEAD_PAD}${color(HEAD)}`, TUI_MASCOT_ART_WIDTH, ' '),
    padVisible(faceRow, TUI_MASCOT_ART_WIDTH, ' '),
    padVisible(`${HEAD_PAD}${color(NECK)}`, TUI_MASCOT_ART_WIDTH, ' '),
    padVisible(`      ${color('╱ ╲')}`, TUI_MASCOT_ART_WIDTH, ' '),
  ];
}

/** Pads visible content to `width`, leaving escapes in place. */
export function padVisible(value: string, width: number, fill: string): string {
  const visible = visibleWidth(value);
  if (visible >= width) return value;
  return `${value}${fill.repeat(width - visible)}`;
}
