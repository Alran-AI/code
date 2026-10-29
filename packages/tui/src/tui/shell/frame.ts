import { truncateToWidth, visibleWidth } from '../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../theme/runtime.js';

export function centerToWidth(content: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(content));
  const left = Math.floor(padding / 2);
  return `${' '.repeat(left)}${content}${' '.repeat(padding - left)}`;
}

export function renderSplitFrameRow(
  left: string,
  right: string,
  width: number,
  leftWidth: number,
): string {
  const border = chalk.hex(colors.line);
  const rightWidth = Math.max(0, width - leftWidth - 7);
  const fittedLeft = truncateToWidth(left, leftWidth, chalk.hex(colors.muted)('…'));
  const fittedRight = truncateToWidth(right, rightWidth, chalk.hex(colors.muted)('…'));
  return `${border('│')} ${fittedLeft}${' '.repeat(
    Math.max(0, leftWidth - visibleWidth(fittedLeft)),
  )} ${border('│')} ${fittedRight}${' '.repeat(
    Math.max(0, rightWidth - visibleWidth(fittedRight)),
  )} ${border('│')}`;
}

export function renderSplitFrameBottom(width: number, leftWidth: number): string {
  const border = chalk.hex(colors.line);
  const rightWidth = Math.max(0, width - leftWidth - 7);
  return `${border('╰')}${border('─'.repeat(leftWidth + 2))}${border('┴')}${border(
    '─'.repeat(rightWidth + 2),
  )}${border('╯')}`;
}

export function fitLine(line: string, width: number): string {
  return truncateToWidth(line, width, chalk.hex(colors.muted)('…'));
}

export function fitFirstStatusCandidate(candidates: readonly string[], width: number): string {
  return (
    candidates.find((candidate) => visibleWidth(candidate) <= width) ??
    fitLine(candidates.at(-1) ?? '', width)
  );
}

export function normalizeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}
