/**
 * The goal-driven outer loop (spec 13.3, 13.5).
 *
 * A single round proves the packets are green; it does not prove the goal is met.
 * The loop repeats execute → integrate → accept → gap analysis until the goal
 * document is satisfied or a stop condition fires, and it has to stop for the
 * right reason: `stalled` when nothing improves (ULT-16), `partial` when a
 * `needs_human` must criterion is still open (ULT-20), and `succeeded` only when
 * every must criterion is met with evidence.
 *
 * The loop is pure orchestration over ports, so the round decisions are testable
 * without a model or a git repository.
 */

import type { Ledger } from './ledger.js';
import { applyAcceptance, goalCounts, hasOpenNeedsHumanMust, mustCriteriaSatisfied } from './goal.js';
import type { AcceptanceFinding, GoalDocument } from './goal.js';
import { auditRound, isAuditRound, type AuditPorts, type AuditResult } from './audit.js';
import { finalizeRun, type IntegrateResult } from './integrate.js';
import { RunStore } from './run-state.js';
import type { PlanPacket, RunStatus, UltraPlan } from './types.js';

export interface LoopRoundResult {
  readonly round: number;
  readonly plan: UltraPlan;
  readonly integrate: IntegrateResult;
  readonly accepted: number;
  readonly rejected: number;
  readonly improved: boolean;
}

export interface LoopPorts {
  /** Executes one round's packets; the CLI wires this to runExecute. */
  readonly execute: (input: {
    readonly round: number;
    readonly plan: UltraPlan;
    readonly packets: readonly PlanPacket[];
  }) => Promise<{ readonly donePacketIds: readonly string[] }>;
  readonly integrate: (input: { readonly round: number; readonly plan: UltraPlan }) => Promise<IntegrateResult>;
  /**
   * Exercises the real result against the goal document and returns findings.
   * It gets the goal and run instructions, never the workers' reasoning.
   */
  readonly accept: (input: {
    readonly round: number;
    readonly goal: GoalDocument;
  }) => Promise<{ readonly findings: import('./goal.js').AcceptanceFinding[]; readonly costUsd?: number }>;
  /**
   * Gap analysis: turns the open criteria into the next round's packets. A round
   * with nothing to do ends the run instead of spinning.
   */
  readonly planNextRound: (input: {
    readonly round: number;
    readonly goal: GoalDocument;
  }) => Promise<{ readonly packets: readonly PlanPacket[]; readonly goal?: string }>;
}

export interface LoopConfig {
  readonly maxRounds: number;
  /** No criterion improved for this many rounds ⇒ `stalled` (ULT-16). */
  readonly stallRounds: number;
  /** Interim audit every N rounds (spec 13.4); 0 or omitted disables auditing. */
  readonly auditEvery?: number;
  /** Optional wall-clock cap in hours; 0 means off. */
  readonly maxHours?: number;
}

export interface LoopResult {
  readonly runStatus: RunStatus;
  readonly rounds: readonly LoopRoundResult[];
  readonly reason: string;
  readonly costUsd: number;
  /** Every audit finding, so the report can show the drift the auditor caught. */
  readonly audits?: readonly AuditResult[];
}

function metCount(goal: GoalDocument): number {
  return goalCounts(goal).met;
}

/**
 * Runs rounds until the goal is satisfied or a stop condition fires.
 *
 * Stop order matters: the goal being met wins over everything, then the budget
 * (which pauses, never fails), then stagnation, then the round cap.
 */
export async function runGoalLoop(input: {
  readonly store: RunStore;
  readonly ledger: Ledger;
  readonly goal: GoalDocument;
  readonly plan: UltraPlan;
  readonly ports: LoopPorts;
  readonly config: LoopConfig;
  /** Audits are optional: without ports, no audit runs and none is claimed. */
  readonly auditPorts?: AuditPorts;
  readonly now?: () => number;
}): Promise<LoopResult> {
  const { store, ledger, goal, ports, config } = input;
  const now = input.now ?? Date.now;
  const startedAt = now();
  const maxRounds = config.maxRounds > 0 ? config.maxRounds : Number.POSITIVE_INFINITY;
  const stallLimit = Math.max(1, config.stallRounds);
  const maxHours = config.maxHours ?? 0;

  const rounds: LoopRoundResult[] = [];
  const audits: AuditResult[] = [];
  let plan = input.plan;
  let stale = 0;
  let previousMet = metCount(goal);

  for (let round = 1; round <= maxRounds; round += 1) {
    if (maxHours > 0 && (now() - startedAt) / 3_600_000 >= maxHours) {
      return { runStatus: 'partial', rounds, reason: `wall-clock cap of ${maxHours}h reached`, costUsd: total(ledger) };
    }

    store.transition('running');
    await ports.execute({ round, plan, packets: plan.packets });

    store.transition('integrating');
    const integrate = await ports.integrate({ round, plan });

    // A failed integrate is a failed round, not a crashed run: the loop stops
    // honestly instead of planning another round on a broken tree.
    if (integrate.runStatus === 'failed') {
      return {
        runStatus: 'failed',
        rounds: [...rounds, { round, plan, integrate, accepted: 0, rejected: 0, improved: false }],
        reason: 'integrate failed',
        costUsd: total(ledger),
      };
    }

    store.transition('accepting');
    const report = await ports.accept({ round, goal });
    const { accepted, rejected } = applyAcceptance(goal, report);

    const currentMet = metCount(goal);
    const improved = currentMet > previousMet;
    stale = improved ? 0 : stale + 1;
    previousMet = currentMet;

    rounds.push({ round, plan, integrate, accepted: accepted.length, rejected: rejected.length, improved });

    // Interim audit (spec 13.4): every `auditEvery` rounds, review the whole run
    // for drift. A high-severity finding becomes real work in the next round;
    // the audit itself is allowed to fail without ending the run.
    let rework: PlanPacket[] = [];
    if (input.auditPorts && isAuditRound(round, config.auditEvery)) {
      const audit = await auditRound({
        store,
        ledger,
        goal,
        round,
        ports: input.auditPorts,
      });
      audits.push(audit);
      rework = [...audit.rework];
    }

    // Stop conditions, in priority order.
    if (mustCriteriaSatisfied(goal) && !hasOpenNeedsHumanMust(goal)) {
      // The write goes through integrate.ts, the only module allowed to set
      // `succeeded` (ULT-10). The loop decides *whether*; integrate owns *how*.
      finalizeRun(store, 'succeeded');
      return {
        runStatus: 'succeeded',
        rounds,
        reason: 'every must criterion is met',
        costUsd: total(ledger),
        ...(audits.length > 0 ? { audits } : {}),
      };
    }

    if (stale >= stallLimit) {
      // Stagnation is its own outcome: the run is not `failed`, it stopped making
      // progress, and the report says which criteria are still open.
      store.transition('stalled');
      return {
        runStatus: 'stalled',
        rounds,
        reason: `no criterion improved for ${stale} round(s)`,
        costUsd: total(ledger),
        ...(audits.length > 0 ? { audits } : {}),
      };
    }

    // Gap analysis for the next round.
    const next = await ports.planNextRound({ round: round + 1, goal });
    // Audit rework is appended to the planned packets, not substituted for them:
    // the auditor adds work, it does not get to cancel the planner's.
    const nextPackets = [...next.packets, ...rework];
    if (nextPackets.length === 0) {
      // Nothing left to do that the planner could turn into work. If a must is
      // still open this is `partial` (a human has to decide), never `succeeded`.
      store.transition('partial');
      return {
        runStatus: 'partial',
        rounds,
        reason: hasOpenNeedsHumanMust(goal)
          ? 'an open needs_human must criterion needs a human'
          : 'no further packets could be planned for the open criteria',
        costUsd: total(ledger),
        ...(audits.length > 0 ? { audits } : {}),
      };
    }
    plan = { ...plan, packets: nextPackets, goal: next.goal ?? plan.goal };
  }

  // The round cap ended the run with work outstanding.
  store.transition('partial');
  return {
    runStatus: 'partial',
    rounds,
    reason: `round cap of ${config.maxRounds} reached`,
    costUsd: total(ledger),
    ...(audits.length > 0 ? { audits } : {}),
  };
}

function total(ledger: Ledger): number {
  return ledger.entries().reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
}