/**
 * The Ultra report (spec §3.7).
 *
 * `report.md` is the artifact the human actually reads, so it is written from
 * durable state and the ledger rather than from whatever the last pass happened
 * to return. Two properties matter:
 *
 *   - The cost in the report is the arithmetic sum of the ledger entries, never
 *     a separately accumulated counter (ULT-12). A counter can drift from the
 *     ledger; the ledger is the record, so the report reads it.
 *   - Every blocked, skipped, unmerged or stalled item is named with its reason.
 *     A report that only prints the happy path is the "commit volume ≠ quality"
 *     failure the whole design exists to avoid.
 *
 * The writer is pure string building over injected data, so the arithmetic and
 * the wording are testable without touching a file.
 */

import { PLAN_TOKENS_PER_USD } from './plan-budget.js';
import type { Ledger } from './ledger.js';
import { goalCounts, type GoalDocument } from './goal.js';
import type { IntegrateResult } from './integrate.js';
import type { RunState, RunStatus } from './types.js';

export interface ReportInput {
  readonly state: RunState;
  readonly ledger: Ledger;
  readonly plan?: {
    readonly goal: string;
    readonly recipe: string;
    readonly packets: readonly { readonly id: string; readonly title: string; readonly est_tokens?: number }[];
  };
  /** Present once integrate has run. */
  readonly integrate?: IntegrateResult;
  /** Present for a goal-driven run (spec 13). */
  readonly goal?: GoalDocument;
  /** Per-round cost, when the run went through several rounds. */
  readonly rounds?: readonly { readonly round: number; readonly costUsd: number; readonly result: string }[];
  /** True when the run was killed by the user rather than ending on its own. */
  readonly killed?: boolean;
}

/** Cost of one role across the whole ledger. */
function costByRole(ledger: Ledger): Record<string, number> {
  return ledger.costByRole();
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Tokens per role, for the cost section. */
function tokensByRole(ledger: Ledger): Record<string, number> {
  const byRole: Record<string, number> = {};
  for (const entry of ledger.entries()) {
    if (!entry.role) continue;
    byRole[entry.role] = (byRole[entry.role] ?? 0) + (entry.tokensUsed ?? 0);
  }
  return byRole;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) return [];
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0)).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map((row) => line(row)),
  ];
}

function resultLine(status: RunStatus, killed: boolean): string {
  if (killed) return 'killed';
  return status;
}

/**
 * Builds the report markdown. Pure: no clock, no filesystem, so the same input
 * always produces the same text and the cost arithmetic is directly testable.
 */
export function buildReport(input: ReportInput): string {
  const { state, ledger } = input;
  const lines: string[] = [];
  const total = ledger.totalCostUsd();

  lines.push(`# Ultra report: ${state.runId}`);
  lines.push('');
  lines.push(`- Goal: ${input.plan?.goal ?? state.goal}`);
  if (input.plan) lines.push(`- Recipe: ${input.plan.recipe}`);
  lines.push(`- Result: **${resultLine(state.status, input.killed ?? false)}**`);
  lines.push(`- Budget: ${state.budgetUsd === null ? 'none' : usd(state.budgetUsd)}`);
  lines.push(`- Spent: ${usd(total)}`);
  if (state.budgetUsd !== null && state.budgetUsd > 0) {
    lines.push(`- Remaining: ${usd(Math.max(0, state.budgetUsd - total))}`);
  }
  lines.push(`- Started: ${state.createdAt}`);
  lines.push('');

  // Criteria table (goal-driven runs only).
  if (input.goal && input.goal.criteria.length > 0) {
    lines.push('## Criteria');
    lines.push('');
    const counts = goalCounts(input.goal);
    lines.push(
      `${counts.met}/${counts.total} met · ${counts.must} must · ${counts.needsHuman} need a human`,
    );
    lines.push('');
    lines.push(
      ...table(
        ['id', 'priority', 'status', 'verification', 'description'],
        input.goal.criteria.map((criterion) => [
          criterion.id,
          criterion.priority,
          criterion.status,
          criterion.verification,
          criterion.description,
        ]),
      ),
    );
    lines.push('');
  }

  // Packet table.
  lines.push('## Packets');
  lines.push('');
  const packets = input.integrate?.packets ?? state.packets.map((packet) => ({
    id: packet.id,
    title: packet.title,
    status: packet.status,
    reason: packet.reason,
  }));
  if (packets.length === 0) {
    lines.push('_No packets._');
  } else {
    lines.push(
      ...table(
        ['packet', 'status', 'title', 'detail'],
        packets.map((packet) => [
          packet.id,
          packet.status,
          packet.title,
          'reason' in packet && packet.reason ? packet.reason : '',
        ]),
      ),
    );
  }
  lines.push('');

  // Gate evidence.
  const gate = input.integrate?.gate;
  if (gate) {
    lines.push('## Full-suite gate');
    lines.push('');
    if (gate.commands.length === 0) {
      lines.push('_No gate commands were configured or run._');
    } else {
      lines.push(...table(['command', 'exit', 'output'], gate.commands.map((command) => [
        command.cmd,
        command.exitCode === null ? 'none' : String(command.exitCode),
        firstLine(command.output),
      ])));
    }
    lines.push('');
  }

  // Final review.
  const review = input.integrate?.review;
  if (review) {
    lines.push('## Final review');
    lines.push('');
    lines.push(review.ok ? 'Passed.' : 'Rejected:');
    if (!review.ok) {
      for (const problem of review.problems) lines.push(`- ${problem}`);
    }
    lines.push('');
  }

  // Per-round cost, when the run looped.
  if (input.rounds && input.rounds.length > 0) {
    lines.push('## Cost by round');
    lines.push('');
    lines.push(...table(['round', 'cost', 'result'], input.rounds.map((round) => [
      String(round.round),
      usd(round.costUsd),
      round.result,
    ])));
    lines.push('');
  }

  // Cost by role — the same arithmetic the budget enforced.
  lines.push('## Cost by role');
  lines.push('');
  const roles = costByRole(ledger);
  const tokens = tokensByRole(ledger);
  const roleNames = Object.keys(roles).sort();
  if (roleNames.length === 0) {
    lines.push('_No cost was recorded._');
  } else {
    lines.push(
      ...table(
        ['role', 'cost', 'tokens'],
        roleNames.map((role) => [role, usd(roles[role] ?? 0), String(tokens[role] ?? 0)]),
      ),
    );
    lines.push('');
    lines.push(`Total: ${usd(total)}`);
    lines.push('');
    // Honest about the unit: `alran exec` reports tokens, not dollars, so these
    // figures come from the declared conversion unless a price was reported for
    // the call. Presenting them as billed amounts would claim a precision the
    // run does not have; the budget cap uses the same number, so the report and
    // the cap always agree.
    lines.push(
      `Costs are estimated from token counts at ${String(PLAN_TOKENS_PER_USD)} tokens per USD, ` +
        'unless the runtime reported a price for the call.',
    );
  }
  lines.push('');

  // Blocked and skipped work, named.
  const problems = packets.filter(
    (packet) => packet.status === 'blocked' || packet.status === 'skipped' || packet.status === 'unmerged',
  );
  if (problems.length > 0) {
    lines.push('## Not finished');
    lines.push('');
    for (const packet of problems) {
      const reason = 'reason' in packet && packet.reason ? packet.reason : 'no reason recorded';
      lines.push(`- **${packet.id}** (${packet.status}): ${reason}`);
    }
    lines.push('');
  }

  // The exact command for the human.
  lines.push('## Merge');
  lines.push('');
  lines.push('Nothing was pushed and `main` was not touched. To review and merge:');
  lines.push('');
  lines.push('```sh');
  lines.push(`git merge ultra/${state.runId}`);
  lines.push('```');
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function firstLine(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0);
  return (line ?? '').trim().slice(0, 120);
}