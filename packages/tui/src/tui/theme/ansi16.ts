import type { ChalkInstance } from 'chalk';
import type { TuiResolvedAppearance, TuiThemeColors } from './contracts.js';

export type TuiAnsi16ForegroundStyle =
  | 'default'
  | 'defaultDim'
  | 'black'
  | 'blue'
  | 'blueBright'
  | 'cyan'
  | 'cyanBright'
  | 'gray'
  | 'green'
  | 'greenBright'
  | 'magenta'
  | 'magentaBright'
  | 'red'
  | 'redBright'
  | 'white'
  | 'whiteBright'
  | 'yellow'
  | 'yellowBright';

const ANSI16_FOREGROUND_STYLES: Readonly<
  Record<TuiResolvedAppearance, Partial<Record<keyof TuiThemeColors, TuiAnsi16ForegroundStyle>>>
> = Object.freeze({
  // The Ottili violet has no ANSI16 colour of its own; magenta is the nearest one. Roles that share
  // a hex value in a palette must share a style here, because the lookup goes by value.
  dark: Object.freeze({
    brand: 'magentaBright',
    wordmarkHighlight: 'whiteBright',
    wordmarkShadow: 'magenta',
    signal: 'magentaBright',
    orbit: 'greenBright',
    accent: 'magentaBright',
    markdownHeading: 'magentaBright',
    markdownCode: 'greenBright',
    markdownLink: 'magentaBright',
    text: 'default',
    muted: 'defaultDim',
    dim: 'gray',
    border: 'gray',
    line: 'gray',
    success: 'greenBright',
    warning: 'yellowBright',
    error: 'redBright',
  }),
  light: Object.freeze({
    brand: 'magenta',
    wordmarkHighlight: 'magentaBright',
    wordmarkShadow: 'magenta',
    signal: 'magenta',
    orbit: 'green',
    accent: 'magenta',
    markdownHeading: 'magenta',
    markdownCode: 'green',
    markdownLink: 'magenta',
    text: 'black',
    muted: 'black',
    dim: 'gray',
    border: 'gray',
    line: 'gray',
    success: 'green',
    warning: 'yellow',
    error: 'red',
  }),
});

export function resolveTuiAnsi16Foreground(
  chalk: ChalkInstance,
  colors: TuiThemeColors,
  appearance: TuiResolvedAppearance,
  color: string,
): ChalkInstance | undefined {
  const normalized = color.toLocaleLowerCase();
  const roles = Object.keys(colors) as (keyof TuiThemeColors)[];
  const role = roles.find((candidate) => colors[candidate].toLocaleLowerCase() === normalized);
  if (!role) return undefined;
  const style = ANSI16_FOREGROUND_STYLES[appearance][role];
  if (style === 'default') return chalk;
  if (style === 'defaultDim') return chalk.dim;
  return style ? chalk[style] : undefined;
}

export function shouldSuppressTuiAnsi16Background(colors: TuiThemeColors, color: string): boolean {
  const normalized = color.toLocaleLowerCase();
  return [colors.userMessageBg, colors.diffAddedBg, colors.diffRemovedBg].some(
    (background) => background.toLocaleLowerCase() === normalized,
  );
}
