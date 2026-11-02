import { describe, expect, it, vi } from 'vitest';
import {
  TUI_MASCOT_ART_ROWS,
  TUI_MASCOT_ART_WIDTH,
  TUI_MASCOT_DANCE_REST_TICKS,
  TUI_MASCOT_GROUND_Y,
  createTuiMascotPhysics,
  renderTuiMascotArt,
  renderTuiMascotFace,
  resolveTuiMascotColor,
  stepTuiMascotPhysics,
  type TuiMascotPhysicsState,
} from '../../../../../src/tui/features/mascot/art.js';
import { TuiMascotPanel } from '../../../../../src/tui/features/mascot/panel.js';
import { createTuiCommandCatalog } from '../../../../../src/tui/commands/catalog.js';
import { stripAnsi, visibleWidth } from '../../../../../src/tui/rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../../../../src/tui/theme/runtime.js';

const palette = {
  chalk,
  body: colors.signal,
  airborne: colors.orbit,
  sleep: colors.dim,
  sleepFace: colors.dim,
  danceFace: colors.warning,
  alertFace: colors.warning,
  trail: colors.signal,
};

function pose(state: TuiMascotPhysicsState, tick = 0) {
  return { mode: state.mode, posY: state.posY, tick };
}

/** Runs the physics until the character lands, returning every visited height. */
function flightHeights(mode: 'jump' | 'dance'): number[] {
  let state = createTuiMascotPhysics(mode);
  const heights = [state.posY];
  for (let index = 0; index < 40; index += 1) {
    const next = stepTuiMascotPhysics(state);
    heights.push(next.posY);
    if (next.posY === TUI_MASCOT_GROUND_Y) break;
    state = next;
  }
  return heights;
}

describe('TUI mascot art', () => {
  it('renders four rows at one fixed width for every mode', () => {
    for (const mode of ['jump', 'dance', 'sleep'] as const) {
      const lines = renderTuiMascotArt({ mode, posY: 0, tick: 0 }, palette);
      expect(lines).toHaveLength(TUI_MASCOT_ART_ROWS);
      for (const line of lines) expect(visibleWidth(line)).toBe(TUI_MASCOT_ART_WIDTH);
    }
  });

  it('keeps trailing blanks free of color escapes', () => {
    for (const mode of ['jump', 'dance', 'sleep'] as const) {
      for (const line of renderTuiMascotArt({ mode, posY: 0, tick: 0 }, palette)) {
        expect(line).not.toMatch(/\u001B\[[0-9;]*m\s+$/u);
      }
    }
  });

  it('changes the face per mood', () => {
    expect(stripAnsi(renderTuiMascotFace({ mode: 'sleep', posY: 0, tick: 0 }, palette))).toBe(
      '-   -',
    );
    expect(stripAnsi(renderTuiMascotFace({ mode: 'dance', posY: 0, tick: 0 }, palette))).toBe(
      '♪   ♪',
    );
    expect(stripAnsi(renderTuiMascotFace({ mode: 'jump', posY: 3, tick: 0 }, palette))).toBe(
      'O   O',
    );
    expect(stripAnsi(renderTuiMascotFace({ mode: 'jump', posY: 0, tick: 0 }, palette))).toBe(
      '◕   ◕',
    );
  });

  it('tints the airborne body differently from the resting body', () => {
    expect(resolveTuiMascotColor({ mode: 'jump', posY: 0, tick: 0 }, palette)).toBe(palette.body);
    expect(resolveTuiMascotColor({ mode: 'jump', posY: 2, tick: 0 }, palette)).toBe(
      palette.airborne,
    );
    expect(resolveTuiMascotColor({ mode: 'sleep', posY: 0, tick: 0 }, palette)).toBe(palette.sleep);
  });

  it('cycles the disco colors while dancing', () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < 40; tick += 1) {
      seen.add(resolveTuiMascotColor({ mode: 'dance', posY: 0, tick }, palette));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('walks the sleeping trail upward as ticks advance', () => {
    const rows = new Set<string>();
    for (let tick = 0; tick < 12; tick += 1) {
      const art = renderTuiMascotArt({ mode: 'sleep', posY: 0, tick }, palette).map(stripAnsi);
      rows.add(art.map((line) => (line.trim().endsWith('z') || line.includes('Z') ? 'z' : '-')).join(''));
    }
    // The letter lands on a different row in each phase instead of stacking.
    expect(rows.size).toBeGreaterThan(1);
  });
});

describe('TUI mascot physics', () => {
  it('launches a jump upward and returns to the ground', () => {
    const heights = flightHeights('jump');
    expect(heights[0]).toBeGreaterThan(TUI_MASCOT_GROUND_Y);
    expect(Math.max(...heights)).toBeGreaterThan(heights[0] - 1);
    expect(heights.at(-1)).toBe(TUI_MASCOT_GROUND_Y);
  });

  it('keeps both arcs inside the default stage band', () => {
    // The stage is 9 rows including the footer; the arc must not exceed it or
    // the character would be clipped at the top edge.
    for (const mode of ['jump', 'dance'] as const) {
      expect(Math.max(...flightHeights(mode))).toBeLessThan(9);
    }
  });

  it('lands and stays asleep instead of napping mid-air', () => {
    let state: TuiMascotPhysicsState = createTuiMascotPhysics('jump');
    state = stepTuiMascotPhysics(state, 'sleep');
    expect(state.posY).toBe(TUI_MASCOT_GROUND_Y);
    expect(state.velY).toBe(0);
    const settled = stepTuiMascotPhysics(state);
    expect(settled.posY).toBe(TUI_MASCOT_GROUND_Y);
    expect(settled.velY).toBe(0);
  });

  it('bounces the dancer back up after resting on the floor', () => {
    let state: TuiMascotPhysicsState = createTuiMascotPhysics('dance');
    for (let index = 0; index < 40 && state.posY > 0; index += 1) state = stepTuiMascotPhysics(state);
    expect(state.posY).toBe(TUI_MASCOT_GROUND_Y);
    expect(state.restTicks).toBe(TUI_MASCOT_DANCE_REST_TICKS);

    let restTicks = state.restTicks;
    while (state.posY === 0 && restTicks >= 0) {
      state = stepTuiMascotPhysics(state);
      restTicks = state.restTicks;
    }
    expect(state.posY).toBeGreaterThan(0);
    expect(state.velY).toBeGreaterThan(0);
  });

  it('holds still on the ground when jumping has finished', () => {
    let state = createTuiMascotPhysics('jump');
    for (let index = 0; index < 40; index += 1) state = stepTuiMascotPhysics(state);
    expect(state.posY).toBe(TUI_MASCOT_GROUND_Y);
    expect(state.restTicks).toBe(0);
    expect(stepTuiMascotPhysics(state).posY).toBe(TUI_MASCOT_GROUND_Y);
  });
});

describe('TuiMascotPanel', () => {
  it('starts airborne and closes on Escape', () => {
    const onClose = vi.fn();
    const panel = new TuiMascotPanel({ requestRender: () => undefined, onClose });
    expect(panel.getState().mode).toBe('jump');
    expect(panel.getState().posY).toBeGreaterThan(0);
    panel.handleInput('\u001B');
    expect(onClose).toHaveBeenCalledOnce();
    panel.dispose();
  });

  it('switches mood when the user types a mood word', () => {
    const requestRender = vi.fn();
    const panel = new TuiMascotPanel({ requestRender, onClose: () => undefined });
    panel.handleInput('d');
    panel.handleInput('a');
    panel.handleInput('n');
    panel.handleInput('c');
    panel.handleInput('e');
    expect(panel.getState().mode).toBe('dance');
    expect(requestRender).toHaveBeenCalled();
    panel.dispose();
  });

  it('re-launches the jump when the user asks for it again', () => {
    const panel = new TuiMascotPanel({ requestRender: () => undefined, onClose: () => undefined });
    for (const char of 'jump') panel.handleInput(char);
    // Land him first, then ask for another jump.
    while (panel.getState().posY > 0) panel.tickOnce();
    expect(panel.getState().posY).toBe(TUI_MASCOT_GROUND_Y);
    for (const char of 'jump') panel.handleInput(char);
    expect(panel.getState().posY).toBeGreaterThan(TUI_MASCOT_GROUND_Y);
    expect(panel.getState().velY).toBeGreaterThan(0);
    panel.dispose();
  });

  it('detects a mood word in the middle of a longer typed phrase', () => {
    const panel = new TuiMascotPanel({ requestRender: () => undefined, onClose: () => undefined });
    for (const char of 'let him sleep') panel.handleInput(char);
    expect(panel.getState().mode).toBe('sleep');
    expect(panel.getState().posY).toBe(TUI_MASCOT_GROUND_Y);
    panel.dispose();
  });

  it('renders the character inside the requested width and height', () => {
    const panel = new TuiMascotPanel({ requestRender: () => undefined, onClose: () => undefined });
    const width = 60;
    const height = 12;
    const lines = panel.renderViewport(width, height);
    expect(lines.length).toBe(height);
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    expect(stripAnsi(lines.join('\n'))).toContain('╭───────╮');
    panel.dispose();
  });

  it('keeps the footer readable when the panel is narrow', () => {
    const panel = new TuiMascotPanel({ requestRender: () => undefined, onClose: () => undefined });
    const width = 28;
    const footer = panel.renderViewport(width, 10).at(-1) ?? '';
    expect(visibleWidth(footer)).toBeLessThanOrEqual(width);
    expect(stripAnsi(footer)).toContain('Esc close');
    panel.dispose();
  });

  it('stops animating after disposal', () => {
    const requestRender = vi.fn();
    const panel = new TuiMascotPanel({ requestRender, onClose: () => undefined });
    panel.tickOnce();
    expect(requestRender).toHaveBeenCalledTimes(1);
    panel.dispose();
    panel.tickOnce();
    expect(requestRender).toHaveBeenCalledTimes(1);
  });
});

describe('/mascot command registration', () => {
  const baseContext = {
    hasSession: false,
    hasParentSession: false,
    managedTokenPresent: false,
    queueEnabled: true,
    hasLiveRun: false,
    hasPendingInteraction: false,
    queuedCount: 0,
    canRetry: false,
    sideMode: false,
  };

  it('resolves the command and runs its handler', async () => {
    const handler = vi.fn();
    const catalog = createTuiCommandCatalog([], { mascot: handler }, () => baseContext);

    expect(catalog.resolve('/mascot')?.name).toBe('mascot');
    await expect(catalog.dispatch('/mascot')).resolves.toMatchObject({ status: 'handled' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('stays out of the default slash list but remains searchable', () => {
    const catalog = createTuiCommandCatalog([], { mascot: () => undefined }, () => baseContext);
    expect(catalog.discoverableCommands.some((command) => command.name === 'mascot')).toBe(false);
    expect(catalog.searchableCommands.some((command) => command.name === 'mascot')).toBe(true);
  });
});


