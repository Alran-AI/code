/**
 * Budget-aware planning (spec 13.6, build step 8).
 *
 * The planner normally writes the plan it thinks the task needs; this module
 * sizes that plan to the budget before any worker starts. The sizing unit is
 * `est_tokens`, and the budget is converted to tokens through a single declared
 * constant so the estimate is auditable rather than a hidden exchange rate.
 *
 * The rule that matters (ULT-18): a `must` criterion is never dropped silently.
 * If the budget cannot cover it, the result says so and marks the plan as not
 * fitting, so the caller can report the shortfall instead of shipping a plan
 * that quietly under-delivers.
 */

import type { Criterion, GoalDocument } from './goal.js';
import type { PlanPacket } from './types.js';

/**
 * Tokens per USD used to turn a dollar budget into a token budget.
 *
 * This is a planning heuristic, not a price feed: `alran exec` reports tokens,
 * not dollars, so Ultra has no live price to divide by. The constant is declared
 * here, once, so a future calibrated value replaces one number instead of
 * spreading through the planner.
 */
export const PLAN_TOKENS_PER_USD = 100_000;

/** The token budget a dollar budget implies. */
export function planTokenBudget(budgetUsd: number | null): number {
  if (budgetUsd === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(budgetUsd * PLAN_TOKENS_PER_USD));
}

/** Alias kept for callers that read better as a noun. */
export const PLAN_TOKEN_BUDGET = PLAN_TOKENS_PER_USD;

/**
 * Fraction of the budget held back for repair loops and acceptance.
 *
 * Repairs are the expensive part of a real run: a packet that fails its gate
 * twice costs roughly what it cost the first time. Without a reserve, a plan
 * that exactly fits the budget has nothing left to repair with, so the first
 * failure ends the run.
 */
export const REPAIR_RESERVE = 0.25;

/** Tokens held back for repairs, for a given dollar budget. */
export function repairReserve(budgetUsd: number | null): number {
  if (budgetUsd === null) return 0;
  return planTokenBudget(budgetUsd) * REPAIR_RESERVE;
}

/** Fraction of the budget held back for repairs; exposed for callers and tests. */
export function repairReserveRatio(): number {
  return REPAIR_RESERVE;
}

export interface SizePlanInput {
  readonly goal: GoalDocument;
  readonly packets: readonly PlanPacket[];
  readonly budgetUsd: number | null;
  /** Overrides the reserve fraction; defaults to `REPAIR_RESERVE`. */
  readonly reserveRatio?: number;
}

export interface DroppedCriterion {
  readonly criterionId: string;
  readonly priority: Criterion['priority'];
  readonly packetId: string;
  /** True when the dropped criterion is a `must`, which must be reported. */
  readonly isMust: boolean;
}

export interface SizePlanResult {
  /** Packets that fit, in their original order. */
  readonly packets: PlanPacket[];
  /** Criteria left out, in the order they were dropped (could → should → must). */
  readonly dropped: readonly DroppedCriterion[];
  /** `must` criteria that did not fit. Reported, never silently dropped. */
  readonly unfittedMust: readonly DroppedCriterion[];
  /** False when something had to be dropped, so the caller can report it. */
  readonly fits: boolean;
  readonly tokenBudget: number;
  readonly plannedTokens: number;
}

function packetTokens(packet: PlanPacket): number {
  return packet.est_tokens ?? 0;
}

/** Priority order for dropping: could first, must last. */
const DROP_ORDER: Record<Criterion['priority'], number> = { could: 0, should: 1, must: 2 };

/**
 * Sizes a packet list to a budget.
 *
 * Packets are kept whole — a half-funded packet is not useful — and dropping is
 * driven by the criteria each packet serves, lowest priority first. Packets with
 * no criteria are dropped before any criteria-bearing packet, because they are
 * the least defensible work in the plan.
 */
export function sizePlan(input: SizePlanInput): SizePlanResult {
  const ratio = input.reserveRatio ?? REPAIR_RESERVE;
  const tokenBudget = planTokenBudget(input.budgetUsd);
  const reserve = input.budgetUsd === null ? 0 : tokenBudget * ratio;
  const spendable = tokenBudget === Number.POSITIVE_INFINITY ? tokenBudget : Math.max(0, tokenBudget - reserve);

  const criteriaById = new Map(input.goal.criteria.map((criterion) => [criterion.id, criterion]));

  /** Lowest-priority criterion a packet serves, or `could` when it serves none. */
  const packetPriority = (packet: PlanPacket): Criterion['priority'] => {
    const served = (packet.criteria ?? [])
      .map((id) => criteriaById.get(id))
      .filter((criterion): criterion is Criterion => criterion !== undefined);
    if (served.length === 0) return 'could';
    // A packet serving a must is a must packet, however many shoulds it also serves.
    return served.reduce<Criterion['priority']>(
      (lowest, criterion) =>
        DROP_ORDER[criterion.priority] > DROP_ORDER[lowest] ? criterion.priority : lowest,
      'could',
    );
  };

  const kept: PlanPacket[] = [];
  const dropped: DroppedCriterion[] = [];
  let plannedTokens = 0;

  // Consider packets in a stable, defensible order: must packets first, then
  // should, then could, and within a tier the original plan order.
  const ordered = input.packets
    .map((packet, index) => ({ packet, index, priority: packetPriority(packet) }))
    .sort(
      (a, b) =>
        DROP_ORDER[b.priority] - DROP_ORDER[a.priority] ||
        a.index - b.index,
    );

  for (const entry of ordered) {
    const cost = packetTokens(entry.packet);
    if (plannedTokens + cost <= spendable) {
      kept.push(entry.packet);
      plannedTokens += cost;
      continue;
    }
    // Does not fit: record every criterion this packet was carrying.
    for (const id of entry.packet.criteria ?? []) {
      const criterion = criteriaById.get(id);
      if (!criterion) continue;
      dropped.push({ criterionId: id, priority: criterion.priority, packetId: entry.packet.id, isMust: criterion.priority === 'must' });
    }
    if ((entry.packet.criteria ?? []).length === 0) {
      // A packet with no criteria carries no criterion to report; it is simply
      // the least valuable work in the plan.
      dropped.push({ criterionId: '', priority: entry.priority, packetId: entry.packet.id, isMust: false });
    }
  }

  // Restore the plan's original order for the kept packets, so the scheduler
  // sees the order the planner intended rather than the tier order.
  const keptIds = new Set(kept.map((packet) => packet.id));
  const packets = input.packets.filter((packet) => keptIds.has(packet.id));

  const unfittedMust = dropped.filter((entry) => entry.isMust);

  return {
    packets,
    dropped,
    unfittedMust,
    fits: dropped.length === 0,
    tokenBudget,
    plannedTokens,
  };
}