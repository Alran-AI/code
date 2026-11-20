/**
 * Budget tracking for Ultra.
 *
 * A run carries a hard USD cap. The tracker warns at 80 % and *pauses* at
 * 100 % — never kills — so `ultra resume` can continue once the human raises
 * the cap. Cost is always recomputed from ledger entries (see `fromLedger`),
 * so the number in the report is the same arithmetic the run enforced.
 */

export type BudgetLevel = 'ok' | 'warn' | 'paused';

import { PLAN_TOKENS_PER_USD } from './plan-budget.js';

/**
 * Tokens per USD, the single declared conversion for the whole feature.
 *
 * Defined in `plan-budget.ts` (where planning sizes against it) and re-exported
 * here so accounting and planning cannot drift apart: the number that decides
 * what fits in the budget is the same number that decides when the budget is
 * spent. See `usdForTokens` for why the runtime needs it at all.
 */
export { PLAN_TOKENS_PER_USD };

const WARN_RATIO = 0.8;

/** Rounds to cents-of-a-cent so floating drift never shows in totals. */
function round(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}

/**
 * Estimated USD for a token count.
 *
 * `alran exec` reports `usage.totalTokens` and no price, so a run that recorded
 * only tokens could never reach its cap: every comparison against `spentUsd`
 * would be against zero and `--budget` would be decorative. This converts the
 * tokens Ultra already records into the same unit the cap is written in, so the
 * budget is enforced on real runs instead of only in tests.
 *
 * The result is an *estimate*, not a provider charge. It is the best available
 * number, it is auditable (one constant, applied uniformly), and the report says
 * so rather than presenting it as a billed amount.
 */
export function usdForTokens(tokens: number): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return round(tokens / PLAN_TOKENS_PER_USD);
}

export interface BudgetRecordInput {
  readonly usd: number;
  readonly role?: string;
}

/**
 * Parses a `--budget` value.
 *
 * Returns `null` for "no cap" and throws for anything that is not a finite
 * non-negative number. The explicit rejection matters: `Number('none')` is
 * `NaN`, and a `NaN` cap fails *every* comparison — it would silently disable
 * the cap and print as `$NaN`. A typo must fail loudly instead.
 */
export function parseBudgetUsd(raw: string | undefined | null): number | null {
  const text = (raw ?? '').trim();
  if (text.length === 0) return null;
  if (/^none$/iu.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid budget "${text}": expected a non-negative number of USD, or "none"`);
  }
  return value;
}

export class BudgetTracker {
  private spent = 0;
  private readonly roles = new Map<string, number>();

  constructor(private readonly budgetUsd: number | null) {}

  /** Rebuilds the tracker from ledger rows so resume trusts durable cost, not a counter. */
  static fromLedger(
    entries: readonly { readonly role?: string; readonly costUsd?: number }[],
    budgetUsd: number | null,
  ): BudgetTracker {
    const tracker = new BudgetTracker(budgetUsd);
    for (const entry of entries) {
      if (typeof entry.costUsd === 'number' && entry.costUsd > 0) {
        tracker.record({ usd: entry.costUsd, role: entry.role });
      }
    }
    return tracker;
  }

  record(input: BudgetRecordInput): void {
    this.spent = round(this.spent + input.usd);
    if (input.role) {
      this.roles.set(input.role, round((this.roles.get(input.role) ?? 0) + input.usd));
    }
  }

  get spentUsd(): number {
    return this.spent;
  }

  get remainingUsd(): number {
    return this.budgetUsd === null ? Number.POSITIVE_INFINITY : round(this.budgetUsd - this.spent);
  }

  get exceeded(): boolean {
    return this.budgetUsd !== null && this.spent >= this.budgetUsd;
  }

  get level(): BudgetLevel {
    if (this.budgetUsd === null) return 'ok';
    if (this.exceeded) return 'paused';
    const ratio = this.budgetUsd === 0 ? 1 : this.spent / this.budgetUsd;
    return ratio >= WARN_RATIO ? 'warn' : 'ok';
  }

  get shouldPause(): boolean {
    return this.level === 'paused';
  }

  byRole(): Record<string, number> {
    return Object.fromEntries(this.roles);
  }
}
