import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  ALRAN_CODE_DARK_THEME,
  ALRAN_CODE_LIGHT_THEME,
} from '../../../../src/tui/theme/palettes.js';
import {
  TUI_SYNTAX_TONE_NAMES,
  TUI_THEME_COLOR_NAMES,
} from '../../../../src/tui/theme/contracts.js';
import {
  ALRAN_CODE_THEME_CONTRAST_POLICY,
  contrastRatio,
} from '../../../helpers/theme-contrast.js';

/** Every palette in both appearances of every built-in theme. */
const ALL_PALETTES = BUILT_IN_THEMES.flatMap((theme) => [
  { theme, palette: theme.dark },
  { theme, palette: theme.light },
]);

describe('built-in TUI themes', () => {
  it('maps the default Alran palette onto the Ottili Foundation kit tokens', () => {
    // packages/foundation-ui kit-tokens.css (dark): accent #7c3aed/#8b5cf6, accent-text #b8a1fb,
    // text #ededf1, text-secondary #b9b9c3, text-faint #5f5f6b, bg-muted #1b1b21,
    // border-strong #363640, success #4ade80, warning #fbbf24, danger #f87171.
    expect(ALRAN_CODE_DARK_THEME.colors).toEqual({
      brand: '#8B5CF6',
      wordmarkHighlight: '#C4B5FD',
      wordmarkShadow: '#7C3AED',
      signal: '#8B5CF6',
      orbit: '#4ADE80',
      accent: '#B8A1FB',
      markdownHeading: '#B8A1FB',
      markdownCode: '#A6E3A1',
      markdownLink: '#B8A1FB',
      userMessageBg: '#1B1B21',
      diffAddedBg: '#213A2B',
      diffRemovedBg: '#4A221D',
      text: '#EDEDF1',
      muted: '#B9B9C3',
      dim: '#5F5F6B',
      border: '#363640',
      line: '#5F5F6B',
      success: '#4ADE80',
      warning: '#FBBF24',
      error: '#F87171',
    });
    // Light: accent #6d28d9, accent-text #6227c9, text #18181b, success #15803d, warning #b45309,
    // danger #c62828.
    expect(ALRAN_CODE_LIGHT_THEME.colors).toMatchObject({
      brand: '#6D28D9',
      accent: '#6227C9',
      text: '#18181B',
      success: '#15803D',
      warning: '#B45309',
      error: '#C62828',
    });
    expect(DEFAULT_THEME_ID).toBe('alran');
  });

  it('carries no colour of the upstream brand blue in any built-in theme', () => {
    const upstreamBlues = ['#68C0FF', '#0094FC', '#5AB9FF', '#0A6FCE', '#0B6FB8', '#93D2FF', '#3DAEFF'];
    for (const { palette } of ALL_PALETTES.filter(({ theme }) => theme.id !== 'aurora')) {
      for (const role of ['brand', 'signal', 'accent', 'markdownLink', 'wordmarkHighlight', 'wordmarkShadow'] as const) {
        expect(upstreamBlues, `${palette.id}.${palette.appearance}.${role}`).not.toContain(palette.colors[role]);
      }
    }
  });

  it.each(ALL_PALETTES)(
    'enforces readable semantic colors for $theme.id $palette.appearance',
    ({ palette }) => {
      const background = ALRAN_CODE_THEME_CONTRAST_POLICY.backgrounds[palette.appearance];

      for (const role of ALRAN_CODE_THEME_CONTRAST_POLICY.normalText.roles) {
        const exception = ALRAN_CODE_THEME_CONTRAST_POLICY.normalText.exceptions.find(
          (candidate) => candidate.appearance === palette.appearance && candidate.role === role,
        );
        expect(
          contrastRatio(palette.colors[role], background),
          `${palette.id}.${palette.appearance}.${role} must remain readable against ${background}`,
        ).toBeGreaterThanOrEqual(
          exception?.minimum ?? ALRAN_CODE_THEME_CONTRAST_POLICY.normalText.minimum,
        );
      }
      for (const role of ALRAN_CODE_THEME_CONTRAST_POLICY.nonText.roles) {
        expect(
          contrastRatio(palette.colors[role], background),
          `${palette.id}.${palette.appearance}.${role} must stay distinguishable against ${background}`,
        ).toBeGreaterThanOrEqual(ALRAN_CODE_THEME_CONTRAST_POLICY.nonText.minimum);
      }
    },
  );

  it.each(ALL_PALETTES)(
    'defines every color and syntax tone for $theme.id $palette.appearance',
    ({ palette }) => {
      for (const name of TUI_THEME_COLOR_NAMES) {
        expect(palette.colors[name], `${palette.id}.${name}`).toMatch(
          /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu,
        );
      }
      for (const tone of TUI_SYNTAX_TONE_NAMES) {
        expect(palette.syntax[tone], `${palette.id}.syntax.${tone}`).toMatch(
          /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu,
        );
      }
    },
  );

  it.each(ALL_PALETTES)(
    'keeps syntax text legible for $theme.id $palette.appearance',
    ({ palette }) => {
      const background = ALRAN_CODE_THEME_CONTRAST_POLICY.backgrounds[palette.appearance];
      // Comments are the lowest-emphasis token but still have to be readable.
      expect(contrastRatio(palette.syntax.overlay2, background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.syntax.text, background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('gives every built-in theme a matching id across both appearances', () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.dark.id).toBe(theme.id);
      expect(theme.light.id).toBe(theme.id);
      expect(theme.source).toBe('builtin');
      expect(theme.label.length).toBeGreaterThan(0);
    }
    const ids = BUILT_IN_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
