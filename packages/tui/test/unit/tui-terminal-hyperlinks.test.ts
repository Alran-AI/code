import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCapabilities } from '../../src/tui/engine/terminal-image.js';

const IDENTITY_VARIABLES = [
  'TMUX',
  'TERM',
  'TERM_PROGRAM',
  'TERMINAL_EMULATOR',
  'COLORTERM',
  'VTE_VERSION',
  'KONSOLE_VERSION',
  'KITTY_WINDOW_ID',
  'GHOSTTY_RESOURCES_DIR',
  'WEZTERM_PANE',
  'WARP_SESSION_ID',
  'WARP_TERMINAL_SESSION_UUID',
  'ITERM_SESSION_ID',
  'WT_SESSION',
  'PI_HYPERLINKS',
] as const;

describe('hyperlink support of the terminal', () => {
  beforeEach(() => {
    for (const name of IDENTITY_VARIABLES) vi.stubEnv(name, undefined);
    vi.stubEnv('TERM', 'xterm-256color');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const hyperlinks = (tmuxForwards = false): boolean =>
    detectCapabilities(() => tmuxForwards).hyperlinks;

  it('is on in GNOME Terminal and the other VTE terminals new enough to handle OSC 8', () => {
    vi.stubEnv('VTE_VERSION', '7600');

    expect(hyperlinks()).toBe(true);
  });

  it('stays off in an old VTE terminal that does not know OSC 8', () => {
    vi.stubEnv('VTE_VERSION', '4800');

    expect(hyperlinks()).toBe(false);
  });

  it('is on in Konsole and foot', () => {
    vi.stubEnv('KONSOLE_VERSION', '240200');
    expect(hyperlinks()).toBe(true);

    vi.stubEnv('KONSOLE_VERSION', undefined);
    vi.stubEnv('TERM', 'foot');
    expect(hyperlinks()).toBe(true);
  });

  it('stays off for a terminal nothing identifies', () => {
    expect(hyperlinks()).toBe(false);
  });

  describe('inside tmux', () => {
    beforeEach(() => {
      vi.stubEnv('TMUX', '/tmp/tmux-1000/default,1,0');
      vi.stubEnv('TERM', 'tmux-256color');
    });

    it('trusts tmux when it says it forwards hyperlinks', () => {
      expect(hyperlinks(true)).toBe(true);
    });

    it('also emits them when tmux has no feature flag but the outer terminal is known to handle them', () => {
      vi.stubEnv('VTE_VERSION', '7600');

      expect(hyperlinks(false)).toBe(true);
    });

    it('stays off when tmux does not forward them and nothing says the outer terminal can', () => {
      expect(hyperlinks(false)).toBe(false);
    });
  });

  it('lets the user force the setting either way', () => {
    vi.stubEnv('VTE_VERSION', '7600');
    vi.stubEnv('PI_HYPERLINKS', '0');
    expect(hyperlinks()).toBe(false);

    vi.stubEnv('VTE_VERSION', undefined);
    vi.stubEnv('PI_HYPERLINKS', '1');
    expect(hyperlinks()).toBe(true);
  });
});
