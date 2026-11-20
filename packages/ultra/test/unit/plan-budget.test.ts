/**
 * Budget-aware planning (spec 13.6, build step 8, ULT-18).
 *
 * A plan is sized to the budget instead of being written first and paid for
 * later. Criteria are included by priority — must, then should, then could — and
 * a `must` that does not fit is reported rather than dropped silently. The sizing
 * unit is `est_tokens`, and a `repair_reserve` fraction is held back for repair
 * loops and acceptance.
 *
 * The property under test is the important one: no run may silently shrink its
 * goal. Either the plan fits, or the caller is told which `must` criteria were
 * left out.
 */

import { describe, expect, it } from 'vitest';
import {
  PLAN_TOKEN_BUDGET,
  repairReserve,
  sizePlan,
  type SizePlanInput,
} from '../../src/plan-budget.js';
import { parseGoalDocument } from '../../src/goal.js';

function goal(criteria: unknown[]) {
  return parseGoalDocument({ goal: 'g', criteria });
}

const packet = (id: string, tokens: number, criteria: string[]) => ({
  id,
  title: id,
  goal: id,
  scope: [`src/${id}/**`],
  depends_on: [] as string[],
  criteria,
  est_tokens: tokens,
});

describe('sizePlan', () => {
  it('keeps every packet when the plan fits the token budget', () => {
    const doc = goal([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a' },
      { id: 'C2', priority: 'should', verification: 'test', description: 'b' },
    ]);
    const result = sizePlan({
      goal: doc,
      packets: [packet('p1', 1000, ['C1']), packet('p2', 1000, ['C2'])],
      budgetUsd: 10,
    });
    expect(result.packets.map((entry) => entry.id)).toEqual(['p1', 'p2']);
    expect(result.dropped).toEqual([]);
    expect(result.fits).toBe(true);
  });

  it('drops could criteria first, then should, never must silently (ULT-18)', () => {
    const doc = goal([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a' },
      { id: 'C2', priority: 'should', verification: 'test', description: 'b' },
      { id: 'C3', priority: 'could', verification: 'test', description: 'c' },
    ]);
    // 0.02 USD = 2000 tokens, minus a 25 % reserve = 1500 spendable: exactly
    // one 1000-token packet fits, so the other two must be dropped.
    const result = sizePlan({
      goal: doc,
      packets: [packet('p1', 1000, ['C1']), packet('p2', 1000, ['C2']), packet('p3', 1000, ['C3'])],
      budgetUsd: 0.02,
    });

    const droppedIds = result.dropped.map((entry) => entry.criterionId);
    // could goes before should, and must is never dropped.
    expect(droppedIds).toContain('C3');
    expect(droppedIds).not.toContain('C1');
    expect(result.packets.some((entry) => entry.id === 'p1')).toBe(true);
  });

  it('reports a must criterion that does not fit instead of dropping it silently', () => {
    const doc = goal([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a' },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
    ]);
    // 0.02 USD = 2000 tokens, minus a 25 % reserve = 1500 spendable: only one
    // 1000-token must packet fits, so the second must is reported as unfitted.
    const result = sizePlan({
      goal: doc,
      packets: [packet('p1', 1000, ['C1']), packet('p2', 1000, ['C2'])],
      budgetUsd: 0.02,
    });

    // The must that does not fit is surfaced, not hidden.
    const unfitted = result.unfittedMust;
    expect(unfitted.length).toBeGreaterThan(0);
    expect(unfitted.map((entry) => entry.criterionId)).toContain('C2');
    // ...and it is not silently marked as planned work.
    expect(result.fits).toBe(false);
  });

  it('plans the full goal when the budget is none', () => {
    const doc = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const result = sizePlan({
      goal: doc,
      packets: [packet('p1', 1_000_000, ['C1'])],
      budgetUsd: null,
    });
    expect(result.fits).toBe(true);
    expect(result.packets).toHaveLength(1);
    expect(result.unfittedMust).toEqual([]);
  });

  it('reserves a fraction of the token budget for repairs and acceptance', () => {
    // The reserve is a fraction of the token budget, so it scales with the
    // budget and stays below it: a reserve that consumed the whole budget would
    // leave nothing to plan with.
    expect(repairReserve(1)).toBeGreaterThan(0);
    expect(repairReserve(1)).toBeLessThan(PLAN_TOKEN_BUDGET);
    expect(repairReserve(10)).toBeCloseTo(repairReserve(1) * 10, 10);
  });

  it('exposes the token budget used for sizing', () => {
    expect(PLAN_TOKEN_BUDGET).toBeGreaterThan(0);
  });

  it('drops packets with no criteria only after criteria-bearing ones', () => {
    const doc = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const result = sizePlan({
      goal: doc,
      packets: [packet('p1', 1000, ['C1']), packet('p2', 1000, [])],
      budgetUsd: 0.02,
    });
    // The criteria-bearing packet wins over the unscoped one.
    expect(result.packets.some((entry) => entry.id === 'p1')).toBe(true);
    expect(result.packets.some((entry) => entry.id === 'p2')).toBe(false);
  });
});