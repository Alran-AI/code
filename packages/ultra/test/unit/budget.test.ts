import { describe, expect, it } from 'vitest';
import { BudgetTracker, parseBudgetUsd, usdForTokens } from '../../src/budget.js';
import { PLAN_TOKENS_PER_USD } from '../../src/plan-budget.js';

// ULT-04 / ULT-12: the budget pauses (never kills) at 100 % and every cost
// figure is the arithmetic sum of the ledger.
describe('budget tracker', () => {
  it('starts with the full budget remaining', () => {
    const budget = new BudgetTracker(2);
    expect(budget.spentUsd).toBe(0);
    expect(budget.remainingUsd).toBe(2);
    expect(budget.level).toBe('ok');
    expect(budget.shouldPause).toBe(false);
  });

  it('warns at 80 % but keeps the run going', () => {
    const budget = new BudgetTracker(2);
    budget.record({ usd: 1.6 });
    expect(budget.level).toBe('warn');
    expect(budget.shouldPause).toBe(false);
  });

  it('pauses at 100 % instead of killing the run', () => {
    const budget = new BudgetTracker(2);
    budget.record({ usd: 2 });
    expect(budget.level).toBe('paused');
    expect(budget.shouldPause).toBe(true);
    expect(budget.exceeded).toBe(true);
  });

  it('accounts cost per role so the report can split it', () => {
    const budget = new BudgetTracker(10);
    budget.record({ usd: 0.5, role: 'planner' });
    budget.record({ usd: 0.25, role: 'worker' });
    budget.record({ usd: 0.25, role: 'worker' });
    expect(budget.byRole()).toEqual({ planner: 0.5, worker: 0.5 });
    expect(budget.spentUsd).toBe(1);
  });

  it('treats an unlimited budget as never pausing', () => {
    const budget = new BudgetTracker(null);
    budget.record({ usd: 1_000 });
    expect(budget.level).toBe('ok');
    expect(budget.shouldPause).toBe(false);
  });

  it('discounts a resumed run from ledger entries rather than trusting a counter', () => {
    // ULT-12: recomputing from entries is what makes report totals auditable.
    const budget = BudgetTracker.fromLedger([
      { role: 'planner', costUsd: 0.4 },
      { role: 'worker', costUsd: 0.6 },
    ], 2);
    expect(budget.spentUsd).toBeCloseTo(1, 10);
    expect(budget.remainingUsd).toBeCloseTo(1, 10);
  });

  it('rounds away floating-point drift in the split totals', () => {
    const budget = new BudgetTracker(5);
    for (let i = 0; i < 3; i += 1) budget.record({ usd: 0.1, role: 'worker' });
    expect(budget.spentUsd).toBeCloseTo(0.3, 10);
  });
});

describe('usdForTokens', () => {
  // The runtime budget: `alran exec` reports tokens, not dollars, so without a
  // conversion the cap could never trigger and `--budget` would be decorative.
  it('converts through the one declared tokens-per-USD constant', () => {
    expect(usdForTokens(PLAN_TOKENS_PER_USD)).toBe(1);
    expect(usdForTokens(PLAN_TOKENS_PER_USD * 2.5)).toBe(2.5);
  });

  it('is zero for no tokens, and never negative or NaN', () => {
    expect(usdForTokens(0)).toBe(0);
    expect(usdForTokens(-5)).toBe(0);
    expect(usdForTokens(Number.NaN)).toBe(0);
    expect(usdForTokens(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('stays exact enough that a cap is not missed by rounding', () => {
    // 1 token of a 1 USD budget must not round up to a whole dollar.
    expect(usdForTokens(1)).toBeLessThan(0.001);
    expect(usdForTokens(PLAN_TOKENS_PER_USD - 1)).toBeLessThan(1);
  });

  it('lets a run reach its cap from token-only accounting (ULT-04)', () => {
    // A $1 cap is 100 000 tokens, so 80 % is 80 000 and the cap is 100 000.
    const budget = new BudgetTracker(1);
    budget.record({ usd: usdForTokens(80_000), role: 'worker' });
    expect(budget.level).toBe('warn');
    budget.record({ usd: usdForTokens(20_000), role: 'worker' });
    expect(budget.shouldPause).toBe(true);
  });
});

describe('parseBudgetUsd', () => {
  it('reads a plain number', () => {
    expect(parseBudgetUsd('2')).toBe(2);
    expect(parseBudgetUsd('3.5')).toBe(3.5);
    expect(parseBudgetUsd('0.25')).toBe(0.25);
  });

  it('treats "none" as unlimited, never as NaN', () => {
    // `Number('none')` is NaN, which is falsy for every comparison: it would
    // silently disable the cap AND print as $NaN.
    expect(parseBudgetUsd('none')).toBeNull();
    expect(parseBudgetUsd('NONE')).toBeNull();
    expect(parseBudgetUsd('  none  ')).toBeNull();
  });

  it('returns null for an empty value, meaning "no cap set"', () => {
    expect(parseBudgetUsd('')).toBeNull();
    expect(parseBudgetUsd('   ')).toBeNull();
  });

  it('rejects a value that is not a finite non-negative number', () => {
    // A typo must fail loudly rather than becoming an unlimited run.
    expect(() => parseBudgetUsd('two')).toThrow(/budget/iu);
    expect(() => parseBudgetUsd('12abc')).toThrow(/budget/iu);
    expect(() => parseBudgetUsd('-1')).toThrow(/budget/iu);
    expect(() => parseBudgetUsd('Infinity')).toThrow(/budget/iu);
    expect(() => parseBudgetUsd('NaN')).toThrow(/budget/iu);
  });
});
