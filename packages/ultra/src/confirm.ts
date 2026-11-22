/**
 * The confirmation step (spec §2, §3.2, open decision O-7).
 *
 * A run plans first and only then spends money, so there is a moment where the
 * human can still say no. This module renders that moment: what the plan will do,
 * what the goal document holds it to, what it may cost, and where the work will
 * land. `--yes` skips the question; nothing here decides — it only describes.
 *
 * The cost figure is deliberately absent. A preview is only as good as the
 * plan's `est_tokens` (O-7), and a confident wrong number is worse than none.
 * The live counter during the run is the number to trust.
 */

import { runBranchFor } from './branches.js';
import type { GoalDocument } from './goal.js';
import type { UltraPlan } from './types.js';
import type { UltraRecipeChoice } from './types.js';

export interface UltraConfirmationInput {
  readonly runId: string;
  readonly goal: string;
  readonly plan: UltraPlan;
  /** The goal document, when the run is judged against criteria (§13.1). */
  readonly goalDoc?: GoalDocument;
  readonly budgetUsd: number | null;
  readonly workers: number;
  readonly recipe: UltraRecipeChoice;
  /** Columns available; lines are truncated to fit. */
  readonly width?: number;
}

const DEFAULT_WIDTH = 100;

/**
 * Collapses whitespace in free text (a goal may span lines), keeping the result
 * a single line.
 */
function flatten(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Cuts a line to `width` columns.
 *
 * Deliberately does *not* collapse whitespace: the packet rows are aligned with
 * real spaces, and a helper that squeezed them would pull every column to the
 * left and make the list unreadable.
 */
function clip(text: string, width: number): string {
  // Only line breaks and tabs are foreign to a single line; runs of spaces are
  // the column layout and must survive.
  // trimEnd, not trim: the leading indent is what holds the columns apart.
  const flat = text.replace(/[\r\n\t]+/gu, ' ').trimEnd();
  if (flat.length <= width) return flat;
  return width <= 1 ? flat.slice(0, width) : `${flat.slice(0, width - 1)}…`;
}

/** `$2.00`, or `none` when the run is uncapped. */
export function formatBudget(budgetUsd: number | null): string {
  return budgetUsd === null ? 'none' : `$${budgetUsd.toFixed(2)}`;
}

/**
 * The whole confirmation text, ending with the question.
 *
 * The packet list is the point: it is what the plan will actually do, and it is
 * the last moment at which the reader can notice that it is wrong.
 */
export function renderUltraConfirmation(input: UltraConfirmationInput): string {
  const width = input.width ?? DEFAULT_WIDTH;
  const lines: string[] = [];

  lines.push(clip(`Plan for: ${input.goal}`, width));
  lines.push(
    clip(
      `Run ${input.runId} · ${String(input.plan.packets.length)} packet(s) · recipe ${input.recipe} · ` +
        `budget ${formatBudget(input.budgetUsd)} · workers ${String(input.workers)}`,
      width,
    ),
  );

  if (input.plan.packets.length === 0) {
    lines.push('', '  (the plan has no packets)');
  } else {
    const idWidth = Math.max(2, ...input.plan.packets.map((packet) => packet.id.length));
    const lefts = input.plan.packets.map(
      (packet) => `  ${packet.id.padEnd(idWidth)}  ${packet.title}`,
    );
    // One detail column for every row: a table whose second column starts at a
    // different place on each line is harder to scan than no table at all.
    const detailColumn = Math.max(...lefts.map((left) => left.length)) + 2;
    input.plan.packets.forEach((packet, index) => {
      const after =
        packet.depends_on.length > 0 ? `after ${packet.depends_on.join(', ')}` : 'starts immediately';
      const left = (lefts[index] ?? '').padEnd(detailColumn, ' ');
      lines.push(clip(`${left}${after}`, width));
    });
  }

  const criteria = input.goalDoc?.criteria ?? [];
  if (criteria.length > 0) {
    const counts = criteria.reduce(
      (acc, criterion) => {
        acc[criterion.priority] += 1;
        return acc;
      },
      { must: 0, should: 0, could: 0 },
    );
    lines.push('');
    lines.push(
      clip(
        `Goal document: ${String(criteria.length)} criteria ` +
          `(${String(counts.must)} must, ${String(counts.should)} should, ${String(counts.could)} could)`,
        width,
      ),
    );
    for (const criterion of criteria) {
      lines.push(clip(`  [${criterion.priority}] ${criterion.id}  ${criterion.description}`, width));
    }
  }

  // The project-wide gates, shown because they are the commands the run will
  // execute against the merged tree (spec 3.2). Detection is a guess about a
  // repository it has never seen; a reader who recognises a wrong guess needs
  // to see it here, before the money is spent, and not in the failure at the
  // end of the run.
  const gates = input.plan.gates;
  if (gates) {
    const groups: readonly (readonly [string, readonly string[]])[] = [
      ['test', gates.test],
      ['lint', gates.lint],
      ['build', gates.build],
    ];
    const commands = groups.flatMap(([, list]) => list);
    lines.push('');
    if (commands.length === 0) {
      lines.push(clip('Project-wide gates: none detected — the run will not claim a green build.', width));
    } else {
      lines.push(clip('Project-wide gates (run on the merged tree):', width));
      for (const [group, list] of groups) {
        for (const command of list) {
          lines.push(clip(`  ${group}: ${command}`, width));
        }
      }
    }
  }

  lines.push('');
  lines.push(clip(`Nothing is merged into main. Work lands on branch ${runBranchFor(input.runId)}.`, width));
  lines.push('');
  lines.push(confirmationQuestion());
  return lines.join('\n');
}

/** The question itself, kept separate so a host can style or localise it. */
export function confirmationQuestion(): string {
  return 'Continue with this plan? [y/N]';
}

/**
 * Reads an answer. Only an explicit yes proceeds: an empty line, a typo, or a
 * closed stdin is a no, because starting a run spends money.
 */
export function isConfirmationAccepted(answer: string): boolean {
  return /^y(?:es)?$/iu.test(answer.trim());
}