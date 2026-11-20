/**
 * The confirmation step (spec §2, O-7).
 *
 * The question exists so a human can refuse before money is spent, so the tests
 * are about what the reader can see and what counts as a yes.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmationQuestion,
  formatBudget,
  isConfirmationAccepted,
  renderUltraConfirmation,
} from '../../src/confirm.js';
import { parseGoalDocument } from '../../src/goal.js';
import type { UltraPlan } from '../../src/plan-schema.js';

function plan(): UltraPlan {
  return {
    goal: 'build the widget',
    recipe: 'auto',
    packets: [
      { id: 'p1', title: 'Extract types', goal: 'g', scope: ['src/types/**'], depends_on: [] },
      { id: 'p2', title: 'Client wrapper', goal: 'g', scope: ['src/client/**'], depends_on: ['p1'] },
      { id: 'p3', title: 'Scheduler lock', goal: 'g', scope: ['src/sched/**'], depends_on: ['p2'] },
    ],
  };
}

const goalDoc = parseGoalDocument({
  goal: 'build the widget',
  criteria: [
    { id: 'C1', priority: 'must', verification: 'scenario', description: 'A user can create layers.' },
    { id: 'C2', priority: 'should', verification: 'command', description: 'It exports a PNG.' },
    { id: 'C3', priority: 'could', verification: 'scenario', description: 'It has themes.' },
  ],
});

describe('renderUltraConfirmation', () => {
  it('shows the packets, their order and what the run will cost', () => {
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'build the widget',
      plan: plan(),
      goalDoc,
      budgetUsd: 2,
      workers: 4,
      recipe: 'auto',
    });
    expect(text).toContain('3 packet(s)');
    expect(text).toContain('recipe auto');
    expect(text).toContain('budget $2.00');
    expect(text).toContain('workers 4');
    // The order is what a reader checks before paying for it.
    expect(text).toContain('Extract types');
    expect(text).toContain('after p1');
    expect(text).toContain('starts immediately');
  });

  it('keeps the packet columns aligned', () => {
    // The rows are a table: if the detail column drifts, the list is unreadable.
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'g',
      plan: plan(),
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
    });
    const columns = text
      .split('\n')
      .filter((line) => /^\s+p\d/.test(line))
      .map((line) => line.indexOf('  ') + 2);
    expect(new Set(columns).size).toBe(1);
  });

  it('counts the goal criteria by priority', () => {
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'g',
      plan: plan(),
      goalDoc,
      budgetUsd: null,
      workers: 1,
      recipe: 'audit',
    });
    expect(text).toContain('3 criteria (1 must, 1 should, 1 could)');
    expect(text).toContain('[must]');
    // An uncapped run says so instead of printing $0.00.
    expect(text).toContain('budget none');
  });

  it('says where the work lands and that main is untouched', () => {
    const text = renderUltraConfirmation({
      runId: 'run-9',
      goal: 'g',
      plan: plan(),
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
    });
    expect(text).toContain('ultra/run-9');
    expect(text).toMatch(/nothing is merged into main/iu);
  });

  it('ends with the question', () => {
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'g',
      plan: plan(),
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
    });
    expect(text.trimEnd().endsWith(confirmationQuestion())).toBe(true);
  });

  it('offers no cost preview, because a wrong number is worse than none', () => {
    // O-7: the preview is undecided, so the confirmation must not invent one.
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'g',
      plan: plan(),
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
    });
    expect(text).not.toMatch(/estimated cost|will cost about/iu);
  });

  it('fits the width it is given', () => {
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'a very long goal statement that would not fit on one line at all',
      plan: plan(),
      goalDoc,
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
      width: 60,
    });
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(60);
  });

  it('handles a plan with no packets', () => {
    const text = renderUltraConfirmation({
      runId: 'run-1',
      goal: 'g',
      plan: { goal: 'g', recipe: 'auto', packets: [] },
      budgetUsd: 2,
      workers: 2,
      recipe: 'auto',
    });
    expect(text).toContain('no packets');
  });
});

describe('formatBudget', () => {
  it('shows a cap in dollars and no cap as none', () => {
    expect(formatBudget(2)).toBe('$2.00');
    expect(formatBudget(0)).toBe('$0.00');
    expect(formatBudget(null)).toBe('none');
  });
});

describe('isConfirmationAccepted', () => {
  it('accepts an explicit yes in any casing', () => {
    for (const answer of ['y', 'Y', 'yes', 'YES', '  yes  ']) {
      expect(isConfirmationAccepted(answer)).toBe(true);
    }
  });

  it('treats everything else as a no', () => {
    // Starting a run spends money: an empty line, a typo and a closed stdin all
    // mean the reader did not say yes.
    for (const answer of ['', '   ', 'n', 'no', 'yess', 'ja', '1', 'true']) {
      expect(isConfirmationAccepted(answer)).toBe(false);
    }
  });
});
