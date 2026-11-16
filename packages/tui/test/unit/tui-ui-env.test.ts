import { afterEach, describe, expect, it } from 'vitest';

import { readUiEnv, UI_ENV_NAMES } from '../../src/tui/engine/public.js';

describe('the environment switches of the terminal UI', () => {
  const saved = new Map<string, string | undefined>();

  const set = (name: string, value: string | undefined): void => {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  it('reads a switch under its Alran name', () => {
    set('ALRAN_DEBUG_REDRAW', '1');
    expect(readUiEnv('ALRAN_DEBUG_REDRAW')).toBe('1');
  });

  it('still honours the inherited name when the Alran name is unset', () => {
    set('PI_DEBUG_REDRAW', '1');
    expect(readUiEnv('ALRAN_DEBUG_REDRAW')).toBe('1');
  });

  it('lets the Alran name win over the inherited name', () => {
    set('PI_DEBUG_REDRAW', '1');
    set('ALRAN_DEBUG_REDRAW', '0');
    expect(readUiEnv('ALRAN_DEBUG_REDRAW')).toBe('0');
  });

  it('reports an unset switch as undefined', () => {
    set('ALRAN_TUI_DEBUG', undefined);
    set('PI_TUI_DEBUG', undefined);
    expect(readUiEnv('ALRAN_TUI_DEBUG')).toBeUndefined();
  });

  it('names every switch with the inherited name it falls back to', () => {
    expect(Object.keys(UI_ENV_NAMES).every((name) => name.startsWith('ALRAN_'))).toBe(true);
    expect(Object.values(UI_ENV_NAMES).every((name) => name.startsWith('PI_'))).toBe(true);
  });
});
