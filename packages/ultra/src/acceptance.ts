/**
 * Acceptance reporting (spec 13.2).
 *
 * The acceptor is an independent agent: it gets the goal document and the run
 * instructions, never the workers' reasoning, and it exercises the real result
 * rather than reading the diff. Its reply is free text from a model, so this
 * module is the boundary that turns that text into findings the goal layer can
 * apply — and it fails closed. A reply that does not clearly say `met` with
 * evidence is rejected, because a model's vague "looks good" must never be able
 * to mark a criterion done.
 */

import type { AcceptanceFinding, AcceptanceReport, CriterionStatus, GoalDocument } from './goal.js';

export const ACCEPTOR_SYSTEM_PROMPT = [
  'You are an independent acceptance tester. You did not write this software and',
  'you must not trust the reports of the agents that did.',
  '',
  'You are given a goal document and instructions for running the result. Your job',
  'is to exercise the real result — start the application, call the CLI, drive the',
  'workflow — and decide, for every criterion, whether the evidence supports it.',
  '',
  'Do not read the workers\' reasoning or transcripts. Judge only what you observe.',
  '',
  'Reply with one block per criterion, exactly in this form:',
  '',
  'C1: met | partial | unmet | needs_human',
  'evidence: <command output, file path, or screenshot path>',
  'evidence: <another reference, if useful>',
  '',
  'Rules:',
  '- `met` requires at least one evidence line. Without evidence, say `partial` or',
  '  `unmet` instead.',
  '- Use `needs_human` only when the criterion cannot be judged without a human',
  '  (visual quality, taste, feel).',
  '- Do not invent criteria that are not in the goal document.',
].join('\n');

export interface ParsedAcceptance {
  readonly findings: AcceptanceFinding[];
  /** Findings that could not be used, with the reason. */
  readonly rejected: { readonly id: string; readonly reason: string }[];
}

const VERDICTS: ReadonlySet<CriterionStatus> = new Set([
  'met',
  'partial',
  'unmet',
  'needs_human',
]);

/**
 * Builds the user prompt for the acceptor.
 *
 * Deliberately excludes anything the workers wrote: the acceptor's independence
 * is the whole point, and a prompt that quoted the worker's summary would anchor
 * it to a claim it is supposed to be testing.
 */
export function buildAcceptancePrompt(input: {
  readonly goal: GoalDocument;
  readonly round: number;
  /** How to run the result, supplied by the run configuration. */
  readonly runInstructions?: string;
  /**
   * Where the frozen spec tests live, when the run froze any. They are the
   * executable form of the criteria, so the acceptor runs them before it forms
   * an opinion: a failing check is `unmet` however convincing the diff looks.
   */
  readonly specTestDir?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Round ${String(input.round)} acceptance review.`);
  lines.push('');
  lines.push('Goal:');
  lines.push(input.goal.goal);
  lines.push('');
  lines.push('Criteria:');
  for (const criterion of input.goal.criteria) {
    lines.push(
      `- ${criterion.id} (${criterion.priority}, verify by ${criterion.verification}): ${criterion.description}`,
    );
  }
  lines.push('');
  lines.push('Allowed verdicts: met, partial, unmet, needs_human.');
  lines.push('`met` requires at least one evidence line; without evidence use partial or unmet.');
  lines.push('');
  if (input.specTestDir && input.specTestDir.trim().length > 0) {
    lines.push(
      `Frozen acceptance checks live in \`${input.specTestDir.trim()}/\`. Run them first:`,
    );
    lines.push('a check that fails makes its criterion unmet, whatever the diff looks like.');
    lines.push('');
  }
  if (input.runInstructions && input.runInstructions.trim().length > 0) {
    lines.push('How to run the result:');
    lines.push(input.runInstructions.trim());
    lines.push('');
  }
  lines.push('Reply with one block per criterion, in the form described in your instructions.');
  return lines.join('\n');
}

/**
 * Parses the acceptor's free-text reply into findings.
 *
 * Fails closed: a criterion that is not reported as `met` with evidence is left
 * out of `findings` and named in `rejected`, so the goal layer cannot apply a
 * claim the text does not support.
 */
export function parseAcceptanceReport(
  text: string,
  goal?: GoalDocument,
): AcceptanceReport & ParsedAcceptance {
  const known = new Set(goal?.criteria.map((criterion) => criterion.id) ?? []);
  const findings: AcceptanceFinding[] = [];
  const rejected: { id: string; reason: string }[] = [];

  const lines = text.split('\n');
  let current: { id: string; status: CriterionStatus; evidence: string[] } | undefined;

  const flush = (): void => {
    if (!current) return;
    const { id, status, evidence } = current;
    current = undefined;
    if (known.size > 0 && !known.has(id)) {
      rejected.push({ id, reason: `criterion ${id} is not in the goal document` });
      return;
    }
    if (status === 'met' && evidence.length === 0) {
      // No evidence, no `met`: the claim is rejected rather than trusted.
      rejected.push({ id, reason: `criterion ${id} was reported met with no evidence` });
      return;
    }
    findings.push({ id, status, evidence });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const verdict = /^(C\d+)\s*:\s*(met|partial|unmet|needs_human)\b/iu.exec(line);
    if (verdict) {
      flush();
      const id = verdict[1]!;
      const status = verdict[2]!.toLowerCase() as CriterionStatus;
      if (!VERDICTS.has(status)) {
        rejected.push({ id, reason: `unknown verdict for ${id}` });
        continue;
      }
      current = { id, status, evidence: [] };
      // Evidence may sit on the same line: `C1: met (see shot.png)`.
      const rest = line.slice(verdict[0].length).trim();
      if (rest.length > 0) current.evidence.push(stripParens(rest));
      continue;
    }

    const evidence = /^evidence\s*:\s*(.+)$/iu.exec(line);
    if (evidence && current) {
      current.evidence.push(evidence[1]!.trim());
      continue;
    }

    // A criterion-shaped line that is not a recognised verdict is malformed.
    const looksLikeCriterion = /^C\d+\s*:/u.test(line);
    if (looksLikeCriterion) {
      const id = /^C\d+/u.exec(line)?.[0] ?? '?';
      rejected.push({ id, reason: `could not read the verdict for ${id}` });
    }
  }
  flush();

  return { findings, rejected };
}

function stripParens(text: string): string {
  const trimmed = text.trim().replace(/^\(+|[),;.]+$/gu, '').trim();
  return trimmed;
}