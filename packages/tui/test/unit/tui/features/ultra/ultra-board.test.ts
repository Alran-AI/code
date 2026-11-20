/**
 * The interactive Ultra board (spec §7).
 *
 * The layout is tested in @alran/ultra's board suite; what is tested here is the
 * terminal half: the panel frames the board, every advertised key does what it
 * says, a key with no action behind it is not advertised, and a failing action
 * becomes a notice instead of an exception that would take the TUI down.
 */

import { describe, expect, it, vi } from 'vitest';
import { UltraBoard, type UltraBoardActions, type UltraBoardSnapshot } from '../../../../../src/tui/features/ultra/ultra-board.js';
import type { RunState } from '@alran/ultra';

function snapshot(over: Partial<UltraBoardSnapshot> = {}): UltraBoardSnapshot {
  const state: RunState = {
    runId: 'run-8f2a1c9d',
    goal: 'Build the widget',
    budgetUsd: 2,
    createdAt: '2026-11-20T09:00:00.000Z',
    status: 'running',
    workers: 4,
    packets: [
      { id: 'p1', title: 'Extract types', status: 'done' },
      { id: 'p2', title: 'Client wrapper', status: 'pending' },
    ],
  };
  return {
    runId: state.runId,
    goal: state.goal,
    state,
    packets: [
      { id: 'p1', title: 'Extract types', goal: 'g', scope: [], depends_on: [] },
      { id: 'p2', title: 'Client wrapper', goal: 'g', scope: [], depends_on: ['p1'] },
    ],
    costUsd: 0.5,
    round: 1,
    elapsedMs: 65_000,
    workers: 4,
    ...over,
  };
}

interface Harness {
  readonly board: UltraBoard;
  readonly notices: string[];
  readonly noticeKinds: (string | undefined)[];
  readonly closed: vi.Mock;
  readonly renders: vi.Mock;
  press(...keys: string[]): void;
  render(width?: number): string;
}

function harness(
  actions: Partial<UltraBoardActions> = {},
  options: { readonly snapshot?: UltraBoardSnapshot } = {},
): Harness {
  const notices: string[] = [];
  const noticeKinds: (string | undefined)[] = [];
  const closed = vi.fn();
  const renders = vi.fn();
  const board = new UltraBoard({
    snapshot: () => options.snapshot,
    actions,
    requestRender: renders,
    onClose: closed,
    showNotice: (text, kind) => {
      notices.push(text);
      noticeKinds.push(kind);
    },
  });
  return {
    board,
    notices,
    noticeKinds,
    closed,
    renders,
    press(...keys: string[]) {
      for (const key of keys) board.handleInput(key);
    },
    render(width = 100) {
      return board.render(width).join('\n');
    },
  };
}

describe('UltraBoard rendering', () => {
  it('frames the board: run, goal, packets and cost', () => {
    const h = harness({}, { snapshot: snapshot() });
    const text = h.render();
    expect(text).toContain('Ultra');
    expect(text).toContain('run-8f2a1c9d');
    expect(text).toContain('Build the widget');
    expect(text).toContain('Extract types');
    expect(text).toContain('$0.50 / $2.00');
  });

  it('says a run has no packets yet rather than that no run exists', () => {
    // The flow only opens a board for a run it found, so an empty board means
    // the run is still planning — claiming "no run" would be a lie.
    const h = harness();
    const text = h.render();
    expect(text).toContain('no packets yet');
    // Starting a run is the CLI's job and the board must keep saying so.
    expect(text).toContain('alran ultra');
  });

  it('never draws a line wider than the panel', () => {
    const h = harness({}, { snapshot: snapshot() });
    for (const line of h.board.render(52)) expect(line.length).toBeLessThanOrEqual(52);
  });

  it('shows the criteria progress when the run has a goal document', () => {
    const h = harness({}, {
      snapshot: snapshot({
        criteria: [
          { id: 'C1', priority: 'must', verification: 'scenario', description: 'works', status: 'met', evidence: [] },
          { id: 'C2', priority: 'must', verification: 'scenario', description: 'exports', status: 'unmet', evidence: [] },
        ],
      }),
    });
    expect(h.render()).toContain('Criteria: 1/2 met');
  });
});

describe('UltraBoard keys', () => {
  it('offers only the actions the host supplied', () => {
    const h = harness({ pause: () => 'paused' }, { snapshot: snapshot() });
    const text = h.render();
    expect(text).toContain('[p] pause');
    // No kill action, so no [k] in the footer.
    expect(text).not.toContain('[k] kill');
    expect(text).toContain('close');
  });

  it('runs pause and kill and reports what they said', async () => {
    const pause = vi.fn(() => 'paused the run');
    const kill = vi.fn(() => 'killed the run');
    const h = harness({ pause, kill }, { snapshot: snapshot() });
    h.press('p');
    h.press('k');
    await Promise.resolve();
    await Promise.resolve();
    expect(pause).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledOnce();
    expect(h.notices).toEqual(['paused the run', 'killed the run']);
  });

  it('changes the worker cap with + and -', async () => {
    const workers = vi.fn((delta: number) => `workers ${delta > 0 ? 'up' : 'down'}`);
    const h = harness({ workers }, { snapshot: snapshot() });
    h.press('+', '-');
    await Promise.resolve();
    await Promise.resolve();
    expect(workers).toHaveBeenNthCalledWith(1, 1);
    expect(workers).toHaveBeenNthCalledWith(2, -1);
    expect(h.notices).toEqual(['workers up', 'workers down']);
  });

  it('shows diff, log, goal and report as notices', () => {
    const h = harness(
      {
        diff: () => 'DIFF',
        log: () => 'LOG',
        goal: () => 'GOAL',
        report: () => 'REPORT',
      },
      { snapshot: snapshot() },
    );
    h.press('d', 'l', 'g', 'r');
    expect(h.notices).toEqual(['DIFF', 'LOG', 'GOAL', 'REPORT']);
  });

  it('closes on escape', () => {
    const h = harness({}, { snapshot: snapshot() });
    h.press('\u001b');
    expect(h.closed).toHaveBeenCalledOnce();
  });

  it('shows a failed action instead of throwing', async () => {
    const h = harness(
      { pause: () => Promise.reject(new Error('run is not running')) },
      { snapshot: snapshot() },
    );
    h.press('p');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.notices).toEqual(['run is not running']);
    expect(h.noticeKinds).toEqual(['error']);
  });

  it('refuses a paused run rather than claiming it paused', async () => {
    const h = harness(
      { pause: () => 'Run is paused, not running; nothing to pause.' },
      { snapshot: snapshot() },
    );
    h.press('p');
    await Promise.resolve();
    await Promise.resolve();
    expect(h.notices[0]).toMatch(/not running/iu);
  });
});