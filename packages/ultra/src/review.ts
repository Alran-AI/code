/**
 * The review fleet (spec §10 step 10, §14).
 *
 * An Ultra run finishes with a branch and a report. The question that follows
 * is the one no gate can answer: *is this change actually good?* Gates say the
 * tests pass; they do not say the change is correct, safe, or complete.
 *
 * The fleet answers it the same way the rest of Ultra answers everything: with
 * independent agents and evidence.
 *
 *   - **A fleet, not one reviewer.** Each reviewer gets its own *lens* —
 *     correctness, safety, tests, compatibility, concurrency. N reviewers with
 *     the same prompt produce N copies of the same opinion; N reviewers with
 *     different lenses produce N different opinions.
 *   - **Independent verification.** A reviewer's finding is a claim, and a
 *     claim is not a result. Every finding is checked by a separate agent that
 *     sees the finding and the code, not the reviewer's reasoning. A finding
 *     that cannot be confirmed is dropped with the reason it was dropped.
 *   - **Fail closed.** A malformed reply, a reviewer that crashed, a verdict
 *     that cannot be parsed — none of these become a finding. A review that
 *     cannot confirm a problem does not report one.
 *
 * The module is pure orchestration over ports, like the rest of the core: the
 * model calls live in the CLI adapter.
 */

import { BudgetTracker } from './budget.js';
import type { RunStatus } from './types.js';

/** How bad a finding is. `critical` breaks the software; `minor` is a nit. */
export type ReviewSeverity = 'critical' | 'major' | 'minor';

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { critical: 0, major: 1, minor: 2 };

/** One thing a reviewer believes is wrong, with the proof they point at. */
export interface ReviewFinding {
  readonly severity: ReviewSeverity;
  /** One line: what is wrong. */
  readonly title: string;
  /** Why it is wrong, and what it breaks. */
  readonly detail: string;
  /** The file, when the reviewer could name it. */
  readonly file?: string;
  /** The line, when the reviewer could name it. */
  readonly line?: number;
  /** What the reviewer points at as proof. */
  readonly evidence?: string;
}

/**
 * What one reviewer is asked to look for.
 *
 * The lenses are deliberately different from each other. A fleet of identical
 * prompts is an echo, and an echo is not a second opinion.
 */
export interface ReviewLens {
  readonly id: string;
  readonly title: string;
  /** The instruction that shapes what this reviewer reports. */
  readonly focus: string;
}

export const REVIEW_LENSES: readonly ReviewLens[] = Object.freeze([
  {
    id: 'correctness',
    title: 'Correctness',
    focus:
      'logic that does not do what it says: wrong conditions, unhandled cases, off-by-one errors, wrong return values, error paths that swallow failures',
  },
  {
    id: 'safety',
    title: 'Safety and data',
    focus:
      'harm to data or users: unvalidated input, injection, secrets in code or logs, destructive operations, missing permission checks',
  },
  {
    id: 'tests',
    title: 'Tests',
    focus:
      'coverage that is not coverage: assertions that cannot fail, tests that do not exercise the new behaviour, deleted or weakened tests, mocks standing in for real logic',
  },
  {
    id: 'compatibility',
    title: 'Compatibility',
    focus:
      'breaks for someone else: changed signatures or return shapes, removed exports, changed defaults, behaviour other parts of the repository depend on',
  },
  {
    id: 'concurrency',
    title: 'Concurrency and resources',
    focus:
      'ordering and lifetime hazards: shared mutable state, races, missing awaits, unclosed handles, work that happens twice',
  },
]);

/** The maximum number of reviewers in a fleet. */
export const MAX_REVIEWERS = 8;

/** What is being reviewed. */
export interface ReviewTarget {
  readonly runId: string;
  /** One line describing the change under review. */
  readonly description: string;
  /** The branch that holds the change, when there is one. */
  readonly branch?: string;
  /** What the branch is compared against. */
  readonly baseRef?: string;
  /** The files the change touches. */
  readonly changedFiles: readonly string[];
  /** The diff, bounded: a review of a megabyte of patch is not a review. */
  readonly diff: string;
  /** Whether the diff was cut short. */
  readonly truncated: boolean;
  /**
   * The run's status when the review started.
   *
   * A review of a run that is still going covers the change as it is now, not
   * as it will be. Without this the report would read like a review of a
   * finished run's change, which is a claim the review cannot make.
   */
  readonly runStatus?: RunStatus;
}

/** What one reviewer came back with. */
export interface ReviewerOutcome {
  readonly findings: readonly ReviewFinding[];
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
  /** The reviewer failed; the fleet continues without it. */
  readonly error?: string;
}

/** The verifier's verdict on one finding. */
export interface ReviewVerdict {
  readonly confirmed: boolean;
  /** Why, in one line. Recorded for confirmed findings too. */
  readonly reason: string;
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
}

export interface ReviewPorts {
  readonly reviewer: {
    review(input: {
      readonly lens: ReviewLens;
      readonly target: ReviewTarget;
      readonly model: string;
    }): Promise<ReviewerOutcome>;
  };
  readonly verifier: {
    verify(input: {
      readonly finding: ReviewFinding;
      readonly target: ReviewTarget;
      readonly model: string;
    }): Promise<ReviewVerdict>;
  };
}

export interface ReviewConfig {
  /** The lenses to run; the first `reviewers` of them. */
  readonly lenses?: readonly ReviewLens[];
  readonly reviewerModel: string;
  readonly verifierModel: string;
  /** Hard cap in USD; `null` means no cap. */
  readonly budgetUsd: number | null;
  /** Upper bound on findings carried into verification. */
  readonly maxFindings?: number;
}

export interface ReviewInput {
  readonly target: ReviewTarget;
  readonly ports: ReviewPorts;
  readonly config: ReviewConfig;
}

/** A finding that survived independent verification. */
export interface ConfirmedFinding extends ReviewFinding {
  readonly id: string;
  /** The lenses that reported it. More than one means they agreed. */
  readonly reviewers: readonly string[];
  /** The verifier's note on why it holds. */
  readonly verification: string;
}

/** A finding that did not survive verification, with the reason it went. */
export interface RejectedFinding {
  readonly id: string;
  readonly finding: ReviewFinding;
  readonly reviewers: readonly string[];
  readonly reason: string;
}

/** What one lens of the fleet produced. */
export interface ReviewLensOutcome {
  readonly lens: string;
  readonly title: string;
  /** Findings this lens reported, before merging. */
  readonly reported: number;
  readonly costUsd: number;
  /** The lens failed; the fleet continued without it. */
  readonly error?: string;
}

export interface ReviewResult {
  readonly confirmed: readonly ConfirmedFinding[];
  readonly rejected: readonly RejectedFinding[];
  readonly lenses: readonly ReviewLensOutcome[];
  readonly costUsd: number;
  /** `budget` means the cap ran out before the fleet finished. */
  readonly stoppedBy: 'completed' | 'budget';
  /** Findings that were never checked, because the budget ran out. */
  readonly unverified: number;
}

/** Normalises a title so two reviewers can be recognised as saying one thing. */
function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}

/**
 * The key two findings are merged under.
 *
 * A file and line is a location: two reviewers who point at the same line are
 * talking about the same thing, whatever they call it. Without a location, the
 * title is all there is — and two findings with the same title are one finding.
 */
export function findingKey(finding: ReviewFinding): string {
  if (finding.file && finding.file.trim().length > 0) {
    return `at:${finding.file.trim()}:${String(finding.line ?? 0)}`;
  }
  return `title:${normaliseTitle(finding.title)}`;
}

/** The more serious of two severities. */
function mostSevere(left: ReviewSeverity, right: ReviewSeverity): ReviewSeverity {
  return SEVERITY_ORDER[left] <= SEVERITY_ORDER[right] ? left : right;
}

/**
 * Merges the findings of several reviewers into the unique ones.
 *
 * The most serious severity wins, the first title wins (the earliest reviewer
 * named it), and every lens that reported it is kept: agreement between
 * reviewers is worth showing.
 */
export function mergeFindings(
  entries: readonly { readonly lens: string; readonly finding: ReviewFinding }[],
): { readonly finding: ReviewFinding; readonly reviewers: readonly string[] }[] {
  const merged = new Map<string, { finding: ReviewFinding; reviewers: string[] }>();
  for (const { lens, finding } of entries) {
    const key = findingKey(finding);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { finding, reviewers: [lens] });
      continue;
    }
    existing.reviewers.push(lens);
    if (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[existing.finding.severity]) {
      existing.finding = {
        ...existing.finding,
        severity: finding.severity,
        detail: finding.detail,
        evidence: finding.evidence ?? existing.finding.evidence,
      };
    } else if (!existing.finding.evidence && finding.evidence) {
      existing.finding = { ...existing.finding, evidence: finding.evidence };
    }
  }
  return [...merged.values()];
}

/**
 * Runs the fleet: every lens reviews, then every finding is verified.
 *
 * The budget stops the fleet, it does not corrupt it: a run that runs out of
 * money reports what it confirmed and says plainly how much it could not check.
 */
export async function runReview(input: ReviewInput): Promise<ReviewResult> {
  const { target, ports, config } = input;
  const lenses = (config.lenses ?? REVIEW_LENSES).slice(0, MAX_REVIEWERS);
  const budget = new BudgetTracker(config.budgetUsd);
  const maxFindings = config.maxFindings ?? 40;

  const lensOutcomes: ReviewLensOutcome[] = [];
  const reported: { lens: string; finding: ReviewFinding }[] = [];
  let stoppedBy: 'completed' | 'budget' = 'completed';

  for (const lens of lenses) {
    if (budget.shouldPause) {
      stoppedBy = 'budget';
      break;
    }
    let outcome: ReviewerOutcome;
    try {
      outcome = await ports.reviewer.review({ lens, target, model: config.reviewerModel });
    } catch (error) {
      outcome = {
        findings: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (typeof outcome.costUsd === 'number' && outcome.costUsd > 0) {
      budget.record({ usd: outcome.costUsd, role: `review:${lens.id}` });
    }
    lensOutcomes.push({
      lens: lens.id,
      title: lens.title,
      reported: outcome.findings.length,
      costUsd: outcome.costUsd ?? 0,
      ...(outcome.error ? { error: outcome.error } : {}),
    });
    for (const finding of outcome.findings) {
      reported.push({ lens: lens.id, finding });
    }
  }

  const unique = mergeFindings(reported).slice(0, maxFindings);
  const confirmed: ConfirmedFinding[] = [];
  const rejected: RejectedFinding[] = [];
  let unverified = 0;

  for (const [index, { finding, reviewers }] of unique.entries()) {
    if (budget.shouldPause) {
      stoppedBy = 'budget';
      unverified = unique.length - index;
      break;
    }
    const id = `F${String(index + 1)}`;
    let verdict: ReviewVerdict;
    try {
      verdict = await ports.verifier.verify({
        finding,
        target,
        model: config.verifierModel,
      });
    } catch (error) {
      verdict = {
        confirmed: false,
        reason: `the verifier failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (typeof verdict.costUsd === 'number' && verdict.costUsd > 0) {
      budget.record({ usd: verdict.costUsd, role: 'review:verifier' });
    }
    if (verdict.confirmed) {
      confirmed.push({
        ...finding,
        id,
        reviewers,
        verification: verdict.reason,
      });
    } else {
      rejected.push({ id, finding, reviewers, reason: verdict.reason });
    }
  }

  confirmed.sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const leftFile = left.file ?? '';
    const rightFile = right.file ?? '';
    if (leftFile !== rightFile) return leftFile.localeCompare(rightFile);
    return (left.line ?? 0) - (right.line ?? 0);
  });

  return {
    confirmed,
    rejected,
    lenses: lensOutcomes,
    costUsd: budget.spentUsd,
    stoppedBy,
    unverified,
  };
}

/**
 * Parses a reviewer's reply into findings.
 *
 * Fails closed: a reply that is not the expected JSON, or a finding without a
 * title, contributes nothing. A review that cannot read a reply must not
 * invent findings, and it must not report half a finding either.
 */
export function parseReviewerReply(text: string): {
  readonly findings: readonly ReviewFinding[];
  readonly dropped: readonly { readonly reason: string }[];
} {
  const findings: ReviewFinding[] = [];
  const dropped: { reason: string }[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonReply(text);
  } catch (error) {
    return { findings, dropped: [{ reason: `could not read the reply as JSON: ${String(error)}` }] };
  }
  if (!parsed || typeof parsed !== 'object' || !('findings' in parsed)) {
    return { findings, dropped: [{ reason: 'the reply has no findings array' }] };
  }
  const entries = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(entries)) {
    return { findings, dropped: [{ reason: 'the reply has no findings array' }] };
  }
  entries.forEach((entry, index) => {
    const finding = parseFinding(entry);
    if (!finding) {
      dropped.push({ reason: `finding ${String(index + 1)} could not be read` });
      return;
    }
    findings.push(finding);
  });
  return { findings, dropped };
}

/** Reads one finding, or `undefined` when it is not usable. */
function parseFinding(entry: unknown): ReviewFinding | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const record = entry as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
  if (title.length === 0 || detail.length === 0) return undefined;
  const severity = record.severity;
  const file = typeof record.file === 'string' && record.file.trim().length > 0 ? record.file.trim() : undefined;
  const line = typeof record.line === 'number' && Number.isFinite(record.line) ? record.line : undefined;
  const evidence =
    typeof record.evidence === 'string' && record.evidence.trim().length > 0
      ? record.evidence.trim()
      : undefined;
  return {
    severity: severity === 'critical' || severity === 'major' || severity === 'minor' ? severity : 'minor',
    title,
    detail,
    ...(file ? { file } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Parses a verifier's verdict.
 *
 * Fail closed: only an explicit `confirmed: true` counts as confirmed. A
 * verdict that cannot be read is a rejection, because reporting an unverified
 * problem is worse than missing a problem.
 */
export function parseVerifierReply(text: string): { confirmed: boolean; reason: string } {
  let parsed: unknown;
  try {
    parsed = parseJsonReply(text);
  } catch (error) {
    return { confirmed: false, reason: `could not read the verdict: ${String(error)}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { confirmed: false, reason: 'the verdict is not an object' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.confirmed !== true) {
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
    return {
      confirmed: false,
      reason: reason.length > 0 ? reason : 'the verifier did not confirm the finding',
    };
  }
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  return { confirmed: true, reason: reason.length > 0 ? reason : 'confirmed' };
}

/** Strips a ```json fence if the model added one, then parses. */
function parseJsonReply(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const body = fenced ? fenced[1]! : trimmed;
  return JSON.parse(body);
}

/**
 * Renders the review as markdown.
 *
 * The rejected findings are in the report too, with the reason they were
 * dropped. A report that only shows what survived hides how much the fleet
 * argued with itself, and a reader who sees "one finding" cannot tell whether
 * one was found or nine were proposed and eight did not hold up.
 */
export function buildReviewReport(result: ReviewResult, target: ReviewTarget): string {
  const lines: string[] = [];
  lines.push(`# Ultra review — ${target.runId}`);
  lines.push('');
  lines.push(`Reviewed: ${target.description}`);
  if (target.branch) {
    lines.push(`Branch: \`${target.branch}\`${target.baseRef ? ` (against \`${target.baseRef}\`)` : ''}`);
  }
  lines.push(`Files changed: ${String(target.changedFiles.length)}`);
  // The state the run was in when the review started. A review of a run that
  // is still going covers the change as it is now — saying so is the
  // difference between a review and a guess.
  if (target.runStatus) {
    lines.push(`Run status at review: ${target.runStatus}`);
  }
  lines.push(`Cost: $${result.costUsd.toFixed(2)} (estimated from tokens)`);
  lines.push('');

  lines.push(`## Confirmed findings (${String(result.confirmed.length)})`);
  lines.push('');
  if (result.confirmed.length === 0) {
    lines.push('None. Every proposed finding was checked and did not hold up.');
  }
  for (const finding of result.confirmed) {
    lines.push(`### ${finding.id} — ${finding.severity} — ${finding.title}`);
    lines.push('');
    if (finding.file) {
      lines.push(`- File: \`${finding.file}\`${finding.line ? `:${String(finding.line)}` : ''}`);
    }
    lines.push(`- ${finding.detail}`);
    if (finding.evidence) lines.push(`- Evidence: ${finding.evidence}`);
    lines.push(`- Reported by: ${finding.reviewers.join(', ')}`);
    lines.push(`- Verification: ${finding.verification}`);
    lines.push('');
  }

  lines.push(`## Rejected findings (${String(result.rejected.length)})`);
  lines.push('');
  if (result.rejected.length === 0) {
    lines.push('None.');
  }
  for (const rejected of result.rejected) {
    lines.push(
      `- ${rejected.id} — ${rejected.finding.severity} — ${rejected.finding.title}` +
        `${rejected.finding.file ? ` (\`${rejected.finding.file}\`)` : ''} — not confirmed: ${rejected.reason}`,
    );
  }
  lines.push('');

  lines.push('## Lenses');
  lines.push('');
  lines.push('| Lens | Reported | Cost |');
  lines.push('| --- | --- | --- |');
  for (const lens of result.lenses) {
    lines.push(
      `| ${lens.title} | ${String(lens.reported)}${lens.error ? ' (failed)' : ''} | $${lens.costUsd.toFixed(2)} |`,
    );
  }
  lines.push('');

  const notes: string[] = [];
  if (target.truncated) {
    notes.push('The diff was cut short, so a reviewer saw part of the change.');
  }
  if (result.stoppedBy === 'budget') {
    notes.push(
      `The budget ran out before the fleet finished; ${String(result.unverified)} finding(s) were never checked.`,
    );
  }
  for (const lens of result.lenses) {
    if (lens.error) notes.push(`The ${lens.title} lens failed: ${lens.error}`);
  }
  if (notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of notes) lines.push(`- ${note}`);
    lines.push('');
  }

  return lines.join('\n');
}

/** The short summary the CLI prints after a review. */
export function formatReviewSummary(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push(
    `Review: ${String(result.confirmed.length)} confirmed, ${String(result.rejected.length)} rejected` +
      `  cost=$${result.costUsd.toFixed(2)}`,
  );
  for (const finding of result.confirmed) {
    const where = finding.file ? ` (${finding.file}${finding.line ? `:${String(finding.line)}` : ''})` : '';
    lines.push(`  ${finding.id}  ${finding.severity.padEnd(8)} ${finding.title}${where}`);
  }
  if (result.stoppedBy === 'budget') {
    lines.push(`  The budget ran out; ${String(result.unverified)} finding(s) were not checked.`);
  }
  return lines.join('\n');
}
