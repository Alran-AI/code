/**
 * The `/ultra` start wizard.
 *
 * The wizard's contract is small but load-bearing: it never starts anything
 * itself, it produces exactly the request the flow needs, a run cannot be
 * started without a task, and every step can be abandoned. These tests drive it
 * the way the terminal would.
 */

import { describe, expect, it, vi } from 'vitest';
import { UltraWizard, type UltraStartRequest } from '../../../../../src/tui/features/ultra/ultra-wizard.js';
import { visibleWidth } from '../../../../../src/tui/rendering/text.js';

interface Harness {
  readonly wizard: UltraWizard;
  readonly started: UltraStartRequest[];
  readonly cancelled: vi.Mock;
  press(...keys: string[]): void;
  type(text: string): void;
  render(width?: number): string;
}

function harness(gates?: { test: string[]; lint: string[]; build: string[] }): Harness {
  const started: UltraStartRequest[] = [];
  const cancelled = vi.fn();
  const renders = vi.fn();
  const wizard = new UltraWizard({
    onStart: (request) => started.push(request),
    onCancel: cancelled,
    requestRender: renders,
    ...(gates ? { gates } : {}),
  });
  return {
    wizard,
    started,
    cancelled,
    press(...keys: string[]) {
      for (const key of keys) wizard.handleInput(key);
    },
    type(text: string) {
      for (const char of text) wizard.handleInput(char);
    },
    render(width = 100) {
      return wizard.render(width).join('\n');
    },
  };
}

describe('UltraWizard', () => {
  it('asks for the task first, with a text field', () => {
    const h = harness();
    const text = h.render();
    expect(text).toMatch(/What should Ultra do/iu);
    expect(text).toContain('1/6');
  });

  it('walks the steps and starts with the chosen options', () => {
    const h = harness();
    h.type('build a drawing app');
    h.press('\r'); // task -> mode
    expect(h.render()).toMatch(/How long should it run/iu);
    h.press('\r'); // mode: one pass
    h.press('\r'); // budget: $1
    h.press('3'); // workers: 4
    h.press('\r'); // recipe: auto
    expect(h.render()).toMatch(/Start this run/iu);
    h.press('\r'); // confirm

    expect(h.started).toHaveLength(1);
    expect(h.started[0]).toEqual({
      task: 'build a drawing app',
      mode: 'run',
      budgetUsd: 1,
      workers: 4,
      recipe: 'auto',
    });
  });

  it('can choose the goal-driven mode', () => {
    const h = harness();
    h.type('ship the feature');
    h.press('\r');
    h.press('2'); // until the goal is met
    h.press('\r'); // budget
    h.press('\r'); // workers
    h.press('\r'); // recipe
    h.press('\r');
    expect(h.started[0]?.mode).toBe('goal');
  });

  it('can choose no budget cap at all', () => {
    const h = harness();
    h.type('t');
    h.press('\r'); // task -> mode
    h.press('\r'); // mode
    h.press('5'); // no cap
    h.press('\r'); // workers
    h.press('\r'); // recipe
    h.press('\r'); // confirm
    expect(h.started[0]?.budgetUsd).toBeNull();
  });

  it('passes the recipe through', () => {
    const h = harness();
    h.type('move the old client to the new one');
    h.press('\r'); // task -> mode
    h.press('\r'); // mode
    h.press('\r'); // budget
    h.press('\r'); // workers
    h.press('2'); // migrate
    h.press('\r'); // confirm
    expect(h.started[0]?.recipe).toBe('migrate');
  });

  it('shows a summary before starting', () => {
    const h = harness();
    h.type('a task worth a summary');
    h.press('\r'); // task
    h.press('\r', '\r', '\r'); // mode, budget, workers -> recipe
    h.press('\r'); // recipe -> confirm
    const text = h.render();
    expect(text).toContain('a task worth a summary');
    expect(text).toMatch(/Budget:\s+\$1/iu);
    // The wizard must be honest that the run outlives the TUI.
    expect(text).toMatch(/close this TUI/iu);
  });

  it('shows the gates the run will be checked against', () => {
    const h = harness({ test: ['pnpm test'], lint: [], build: ['pnpm build'] });
    h.type('a task worth a summary');
    h.press('\r'); // task
    h.press('\r', '\r', '\r'); // mode, budget, workers -> recipe
    h.press('\r'); // recipe -> confirm
    const text = h.render();
    // Detection is a guess about a repository, and this is the last moment
    // before the money is spent.
    expect(text).toContain('pnpm test');
    expect(text).toContain('pnpm build');
  });

  it('says so when no gate was detected', () => {
    const h = harness({ test: [], lint: [], build: [] });
    h.type('a task worth a summary');
    h.press('\r'); // task
    h.press('\r', '\r', '\r'); // mode, budget, workers -> recipe
    h.press('\r'); // recipe -> confirm
    expect(h.render()).toMatch(/none detected/iu);
  });

  it('refuses to start without a task', () => {
    const h = harness();
    // Walk to the end with an empty task: Enter on the text step does nothing.
    h.press('\r');
    expect(h.started).toHaveLength(0);
    expect(h.render()).toMatch(/What should Ultra do/iu);
  });

  it('does not start anything while it is still collecting answers', () => {
    const h = harness();
    h.type('t');
    h.press('\r');
    expect(h.started).toHaveLength(0);
  });

  it('cancels on escape at any step', () => {
    const h = harness();
    h.press('\u001b');
    expect(h.cancelled).toHaveBeenCalledOnce();
    expect(h.started).toHaveLength(0);
  });

  it('fits a narrow terminal', () => {
    // Width is the *visible* width: colour and cursor codes take no columns.
    const h = harness();
    h.type('a task');
    for (const width of [46, 60, 100]) {
      for (const line of h.wizard.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});