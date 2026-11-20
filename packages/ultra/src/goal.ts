/**
 * The goal document (spec §13.1).
 *
 * Green tests only prove the tests the workers wrote still pass. For a large
 * goal that is not enough: a run can end with every gate green and half the
 * feature missing. The goal document is what the run is actually judged against —
 * a frozen list of criteria, each with a priority, a verification method, a
 * status and the evidence that supports it.
 *
 * The rules that make it honest:
 *
 *   - `met` requires evidence (ULT-15). A claim with no reference behind it is
 *     not a result.
 *   - A criterion that was `met` and is observed `unmet` again is `regressed`,
 *     not silently `unmet` — a regression is the most important thing a long run
 *     can find, and it gets priority in the next round (ULT-17).
 *   - A criterion no model can check (visual feel, taste) is `needs_human`, and a
 *     run with an open `needs_human` `must` ends `partial`, never `succeeded`
 *     (ULT-20).
 *
 * The document is frozen after planning: it changes only through an explicit
 * amendment, which is recorded in the ledger.
 */

export type CriterionPriority = 'must' | 'should' | 'could';
export type CriterionVerification = 'test' | 'command' | 'scenario' | 'manual';
export type CriterionStatus = 'unmet' | 'partial' | 'met' | 'needs_human' | 'regressed';

export interface Criterion {
  readonly id: string;
  readonly priority: CriterionPriority;
  readonly verification: CriterionVerification;
  /** Plain language, written for the human reading the report. */
  readonly description: string;
  status: CriterionStatus;
  /** Command output, file references or screenshot paths that justify the status. */
  readonly evidence: string[];
  /** Set when a previously `met` criterion was observed unmet again. */
  regressedFrom?: CriterionStatus;
}

export interface GoalDocument {
  readonly goal: string;
  readonly criteria: Criterion[];
  /** Amendments after the document was frozen, in order. */
  readonly amendments: readonly { readonly at: string; readonly reason: string }[];
}

export interface GoalCounts {
  readonly total: number;
  readonly met: number;
  readonly must: number;
  readonly needsHuman: number;
  readonly regressed: number;
}

/** One criterion's observed result from the acceptance agent. */
export interface AcceptanceFinding {
  readonly id: string;
  readonly status: CriterionStatus;
  readonly evidence: readonly string[];
  readonly note?: string;
}

/** The acceptance agent's whole report. */
export interface AcceptanceReport {
  readonly findings: readonly AcceptanceFinding[];
  readonly costUsd?: number;
  readonly tokensUsed?: number;
  readonly model?: string;
  readonly rateLimited?: boolean;
}

export class GoalDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalDocumentError';
  }
}

/** A `met` criterion with no evidence is a claim, not a result (ULT-15). */
export function assertEvidence(status: CriterionStatus, evidence: readonly string[], id: string): void {
  if (status === 'met' && evidence.length === 0) {
    throw new GoalDocumentError(`criterion ${id} cannot be met without an evidence reference`);
  }
}

function isStatus(value: unknown): value is CriterionStatus {
  return (
    value === 'unmet' ||
    value === 'partial' ||
    value === 'met' ||
    value === 'needs_human' ||
    value === 'regressed'
  );
}

/** Parses and validates a goal document, refusing one whose criteria are malformed. */
export function parseGoalDocument(input: unknown): GoalDocument {
  const record = asRecord(input);
  const rawCriteria = Array.isArray(record.criteria) ? record.criteria : [];
  const criteria: Criterion[] = rawCriteria.map((entry, index) => {
    const item = asRecord(entry);
    const id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : `C${index + 1}`;
    const priority = item.priority;
    if (priority !== 'must' && priority !== 'should' && priority !== 'could') {
      throw new GoalDocumentError(`criterion ${id} has an unknown priority`);
    }
    const verification = item.verification;
    if (
      verification !== 'test' &&
      verification !== 'command' &&
      verification !== 'scenario' &&
      verification !== 'manual'
    ) {
      throw new GoalDocumentError(`criterion ${id} has an unknown verification method`);
    }
    const status = isStatus(item.status) ? item.status : 'unmet';
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.filter((entry): entry is string => typeof entry === 'string')
      : [];
    assertEvidence(status, evidence, id);
    return {
      id,
      priority,
      verification,
      description: typeof item.description === 'string' ? item.description : '',
      status,
      evidence,
    };
  });
  return { goal: typeof record.goal === 'string' ? record.goal : '', criteria, amendments: [] };
}

/**
 * Applies one acceptance report. Returns the findings that were accepted and the
 * ones rejected, so the caller can put the rejections in the ledger rather than
 * silently dropping a criterion the agent could not substantiate.
 */
export function applyAcceptance(
  document: GoalDocument,
  report: AcceptanceReport,
): { accepted: Criterion[]; rejected: AcceptanceFinding[] } {
  const byId = new Map(document.criteria.map((criterion) => [criterion.id, criterion]));
  const accepted: Criterion[] = [];
  const rejected: AcceptanceFinding[] = [];

  for (const finding of report.findings) {
    const criterion = byId.get(finding.id);
    if (!criterion) {
      rejected.push({ ...finding, note: `unknown criterion ${finding.id}` });
      continue;
    }
    if (finding.status === 'met' && finding.evidence.length === 0) {
      // ULT-15: no evidence, no `met`. Keep the criterion where it was and say so.
      rejected.push({ ...finding, note: `criterion ${finding.id} was reported met with no evidence` });
      continue;
    }
    const previous = criterion.status;
    if (previous === 'met' && finding.status === 'unmet') {
      // ULT-17: a criterion that regressed is flagged and prioritised.
      criterion.status = 'regressed';
      criterion.regressedFrom = 'met';
    } else {
      criterion.status = finding.status;
    }
    criterion.evidence.length = 0;
    criterion.evidence.push(...finding.evidence);
    accepted.push(criterion);
  }

  return { accepted, rejected };
}

/** True when every `must` criterion is `met` (or `needs_human` is impossible to clear). */
export function mustCriteriaSatisfied(document: GoalDocument): boolean {
  return document.criteria
    .filter((criterion) => criterion.priority === 'must')
    .every((criterion) => criterion.status === 'met');
}

/** A run with an open `needs_human` must criterion cannot be `succeeded` (ULT-20). */
export function hasOpenNeedsHumanMust(document: GoalDocument): boolean {
  return document.criteria.some(
    (criterion) => criterion.priority === 'must' && criterion.status === 'needs_human',
  );
}

export function goalCounts(document: GoalDocument): GoalCounts {
  return {
    total: document.criteria.length,
    met: document.criteria.filter((criterion) => criterion.status === 'met').length,
    must: document.criteria.filter((criterion) => criterion.priority === 'must').length,
    needsHuman: document.criteria.filter((criterion) => criterion.status === 'needs_human').length,
    regressed: document.criteria.filter((criterion) => criterion.status === 'regressed').length,
  };
}

/** The criteria the next round should work on, regressions first. */
export function openCriteria(document: GoalDocument): Criterion[] {
  const priority: Record<CriterionPriority, number> = { must: 0, should: 1, could: 2 };
  return document.criteria
    .filter((criterion) => criterion.status !== 'met')
    .sort((a, b) => {
      // A regression outranks everything: it is a loss of finished work.
      if (a.status === 'regressed' && b.status !== 'regressed') return -1;
      if (b.status === 'regressed' && a.status !== 'regressed') return 1;
      return priority[a.priority] - priority[b.priority] || a.id.localeCompare(b.id);
    });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}