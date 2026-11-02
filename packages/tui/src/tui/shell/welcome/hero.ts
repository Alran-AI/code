import { visibleWidth } from '../../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import { centerToWidth } from '../frame.js';
import {
  ALRAN_CODE_TERMINAL_MEDIUM_WORDMARK,
  ALRAN_CODE_TERMINAL_MICRO_WORDMARK,
  ALRAN_CODE_TERMINAL_WORDMARK,
  ALRAN_CODE_WELCOME_DESIGN,
  ALRAN_CODE_WELCOME_TAGLINE,
  ALRAN_CODE_WORDMARK_GRADIENT,
} from './design.js';

export function renderTuiWelcomeHero(width: number): string[] {
  const { fullMinWidth, mediumMinWidth, microMinWidth, fallbackTitle } =
    ALRAN_CODE_WELCOME_DESIGN.hero;
  const showsFullWordmark = width >= fullMinWidth;
  const source = showsFullWordmark
    ? ALRAN_CODE_TERMINAL_WORDMARK
    : width >= mediumMinWidth
      ? ALRAN_CODE_TERMINAL_MEDIUM_WORDMARK
      : width >= microMinWidth
        ? ALRAN_CODE_TERMINAL_MICRO_WORDMARK
        : [fallbackTitle];
  const sourceWidth = Math.max(...source.map((line) => visibleWidth(line)));

  const lines = source.map((line, index) => {
    const canvasLine = line + ' '.repeat(Math.max(0, sourceWidth - visibleWidth(line)));
    const color = wordmarkGradientColor(index, source.length);
    return centerToWidth(chalk.bold.hex(color)(canvasLine), width);
  });
  if (!showsFullWordmark) return lines;
  return [...lines, renderWordmarkTagline(width)];
}

/**
 * The tagline is muted instead of gradient filled and is centered under the
 * full wordmark on the same axis as the art.
 */
function renderWordmarkTagline(width: number): string {
  return centerToWidth(chalk.hex(colors.muted)(ALRAN_CODE_WELCOME_TAGLINE), width);
}

/**
 * Brand purple ramp applied per line, from the top line to the bottom line.
 * A single-line wordmark has no ramp to walk, so it uses the mid brand purple.
 */
function wordmarkGradientColor(index: number, total: number): string {
  const ratio = total <= 1 ? 0.5 : index / (total - 1);
  return interpolateHexColor(
    ALRAN_CODE_WORDMARK_GRADIENT.start,
    ALRAN_CODE_WORDMARK_GRADIENT.end,
    ratio,
  );
}

function interpolateHexColor(from: string, to: string, ratio: number): string {
  const [fromRed, fromGreen, fromBlue] = parseHexChannels(from);
  const [toRed, toGreen, toBlue] = parseHexChannels(to);
  const mix = (start: number, end: number): number => Math.round(start + (end - start) * ratio);
  const channels = [mix(fromRed, toRed), mix(fromGreen, toGreen), mix(fromBlue, toBlue)];
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function parseHexChannels(hex: string): readonly [number, number, number] {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  const channel = (offset: number): number => Number.parseInt(value.slice(offset, offset + 2), 16);
  return [channel(0), channel(2), channel(4)];
}
