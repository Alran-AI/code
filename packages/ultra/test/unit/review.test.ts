import { describe, expect, it } from 'vitest';
import {
  buildReviewReport,
  findingKey,
  formatReviewSummary,
  mergeFindings,
  parseReviewerReply,
  parseVerifierReply,
  REVIEW_LENSES,
  runReview,
  type ReviewFinding,
  type ReviewPorts,
  type ReviewTarget,
  type ReviewerOutcome,
  type ReviewVerdict,
} from '../../src/review.js';

const target: ReviewTarget = {
  runId: 'run-1',
  description: 'the change under review',
  branch: 'ultra/run-1',
  baseRef: 'HEAD',
  changedFiles: ['src/a.ts'],
  diff: '--- a/src/a.ts\n+++ b/src/a.ts',
  truncated: false,
};

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'major',
    title: 'Something is wrong',
    detail: 'Here is why it is wrong.',
    ...over,
  };
}

/** A fleet where every lens reports the given findings and every verdict passes. */
function fleet(input: {
  readonly perLens?: (lensId: string) => readonly ReviewFinding[];
  readonly verdict?: (finding: ReviewFinding) => ReviewVerdict;
  readonly error?: string;
  readonly costUsd?: number;
}): ReviewPorts {
  return {
    reviewer: {
      review: async ({ lens }): Promise<ReviewerOutcome> => {
        if (input.error) return { findings: [], error: input.error };
        return {
          findings: input.perLens?.(lens.id) ?? [],
          costUsd: input.costUsd ?? 0.01,
          model: 'model-a',
        };
      },
    },
    verifier: {
      verify: async ({ finding: subject }): Promise<ReviewVerdict> =>
        input.verdict?.(subject) ?? { confirmed: true, reason: 'it holds up', costUsd: 0.01 },
    },
  };
}

const config = {
  reviewerModel: 'model-a',
  verifierModel: 'model-b',
  budgetUsd: 10,
};

describe('mergeFindings', () => {
  it('merges two reviewers who point at the same line', () => {
    const merged = mergeFindings([
      { lens: 'correctness', finding: finding({ file: 'src/a.ts', line: 10, title: 'Null deref' }) },
      { lens: 'safety', finding: finding({ file: 'src/a.ts', line: 10, title: 'Possible null deref' }) },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.reviewers).toEqual(['correctness', 'safety']);
  });

  it('keeps the most serious severity when two lenses disagree', () => {
    const merged = mergeFindings([
      { lens: 'correctness', finding: finding({ file: 'src/a.ts', line: 10, severity: 'minor' }) },
      { lens: 'safety', finding: finding({ file: 'src/a.ts', line: 10, severity: 'critical' }) },
    ]);
    expect(merged[0]!.finding.severity).toBe('critical');
  });

  it('keeps findings at different lines apart', () => {
    const merged = mergeFindings([
      { lens: 'correctness', finding: finding({ file: 'src/a.ts', line: 10 }) },
      { lens: 'correctness', finding: finding({ file: 'src/a.ts', line: 11 }) },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('merges by title when the finding names no file', () => {
    const merged = mergeFindings([
      { lens: 'correctness', finding: finding({ title: 'The lock is never released' }) },
      { lens: 'concurrency', finding: finding({ title: 'the lock is never released!' }) },
    ]);
    expect(merged).toHaveLength(1);
  });
});

describe('findingKey', () => {
  it('uses the location when there is one', () => {
    expect(findingKey(finding({ file: 'src/a.ts', line: 3 }))).toBe('at:src/a.ts:3');
  });

  it('uses the normalised title otherwise', () => {
    expect(findingKey(finding({ title: 'A Bad Thing!' }))).toBe('title:a bad thing');
  });
});

describe('runReview', () => {
  it('runs one lens per reviewer and reports what was confirmed', async () => {
    const result = await runReview({
      target,
      ports: fleet({
        perLens: (lens) =>
          lens === 'correctness' ? [finding({ title: 'Off by one', file: 'src/a.ts', line: 4 })] : [],
      }),
      config,
    });

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0]!.title).toBe('Off by one');
    expect(result.confirmed[0]!.reviewers).toEqual(['correctness']);
    expect(result.confirmed[0]!.verification).toBe('it holds up');
    expect(result.stoppedBy).toBe('completed');
  });

  it('drops a finding the verifier does not confirm, and says why', async () => {
    const result = await runReview({
      target,
      ports: fleet({
        perLens: () => [finding({ title: 'Not real' })],
        verdict: () => ({ confirmed: false, reason: 'the line does not exist' }),
      }),
      config,
    });

    expect(result.confirmed).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toBe('the line does not exist');
  });

  it('keeps the fleet going when one lens fails', async () => {
    const result = await runReview({
      target,
      ports: fleet({ error: 'the model call timed out' }),
      config,
    });

    expect(result.lenses).toHaveLength(REVIEW_LENSES.length);
    expect(result.lenses.every((lens) => lens.error === 'the model call timed out')).toBe(true);
    expect(result.confirmed).toHaveLength(0);
  });

  it('stops at the budget and says how much was left unchecked', async () => {
    const result = await runReview({
      target,
      ports: {
        reviewer: {
          review: async (): Promise<ReviewerOutcome> => ({
            findings: [finding({ title: 'First' }), finding({ title: 'Second' })],
            costUsd: 1,
          }),
        },
        verifier: {
          verify: async (): Promise<ReviewVerdict> => ({ confirmed: true, reason: 'yes', costUsd: 1 }),
        },
      },
      // One reviewer call (1.00) and one verification (1.00) exhaust the cap,
      // so the second finding is never checked.
      config: { ...config, budgetUsd: 2, lenses: [REVIEW_LENSES[0]!] },
    });

    expect(result.stoppedBy).toBe('budget');
    expect(result.unverified).toBe(1);
    // The finding that was checked before the cap is still reported.
    expect(result.confirmed).toHaveLength(1);
  });

  it('sorts the confirmed findings by severity', async () => {
    const result = await runReview({
      target,
      ports: fleet({
        perLens: () => [
          finding({ title: 'Minor thing', severity: 'minor', file: 'src/a.ts', line: 9 }),
          finding({ title: 'Critical thing', severity: 'critical', file: 'src/a.ts', line: 1 }),
          finding({ title: 'Major thing', severity: 'major', file: 'src/a.ts', line: 5 }),
        ],
      }),
      config,
    });

    expect(result.confirmed.map((entry) => entry.severity)).toEqual(['critical', 'major', 'minor']);
  });

  it('runs no more reviewers than there are lenses', async () => {
    const result = await runReview({
      target,
      ports: fleet({ perLens: () => [] }),
      config,
    });
    expect(result.lenses.length).toBeLessThanOrEqual(REVIEW_LENSES.length);
  });
});

describe('parseReviewerReply', () => {
  it('reads the findings of a well-formed reply', () => {
    const parsed = parseReviewerReply(
      JSON.stringify({
        findings: [
          {
            severity: 'critical',
            title: 'Null deref',
            detail: 'The pointer is used before the check.',
            file: 'src/a.ts',
            line: 12,
            evidence: 'src/a.ts:12 dereferences p',
          },
        ],
      }),
    );
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]!.severity).toBe('critical');
    expect(parsed.findings[0]!.line).toBe(12);
  });

  it('reads a reply wrapped in a code fence', () => {
    const parsed = parseReviewerReply(
      '```json\n{"findings": [{"severity": "minor", "title": "T", "detail": "D"}]}\n```',
    );
    expect(parsed.findings).toHaveLength(1);
  });

  it('drops a finding without a title instead of guessing one', () => {
    const parsed = parseReviewerReply(JSON.stringify({ findings: [{ severity: 'minor', detail: 'D' }] }));
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.dropped).toHaveLength(1);
  });

  it('reports a reply it cannot read rather than inventing findings', () => {
    const parsed = parseReviewerReply('the model rambled');
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.dropped[0]!.reason).toMatch(/could not read/iu);
  });

  it('defaults an unknown severity to minor rather than inventing one', () => {
    const parsed = parseReviewerReply(
      JSON.stringify({ findings: [{ severity: 'apocalyptic', title: 'T', detail: 'D' }] }),
    );
    expect(parsed.findings[0]!.severity).toBe('minor');
  });
});

describe('parseVerifierReply', () => {
  it('confirms only an explicit true', () => {
    expect(parseVerifierReply(JSON.stringify({ confirmed: true, reason: 'it holds' })).confirmed).toBe(
      true,
    );
    expect(parseVerifierReply(JSON.stringify({ confirmed: false, reason: 'no' })).confirmed).toBe(false);
    expect(parseVerifierReply(JSON.stringify({ confirmed: 'yes' })).confirmed).toBe(false);
    expect(parseVerifierReply('nonsense').confirmed).toBe(false);
  });

  it('keeps the reason either way', () => {
    expect(parseVerifierReply(JSON.stringify({ confirmed: true, reason: 'it holds' })).reason).toBe(
      'it holds',
    );
    expect(parseVerifierReply(JSON.stringify({ confirmed: false, reason: 'the code is fine' })).reason).toBe(
      'the code is fine',
    );
  });
});

describe('buildReviewReport', () => {
  it('shows the confirmed findings, the rejected ones and the notes', async () => {
    const result = await runReview({
      target: { ...target, truncated: true },
      ports: fleet({
        perLens: (lens) =>
          lens === 'correctness'
            ? [finding({ title: 'Real bug', file: 'src/a.ts', line: 3, severity: 'critical' })]
            : lens === 'safety'
              ? [finding({ title: 'Imaginary bug', file: 'src/b.ts', line: 9 })]
              : [],
        verdict: (subject) =>
          subject.title === 'Real bug'
            ? { confirmed: true, reason: 'the pointer is null here' }
            : { confirmed: false, reason: 'the code handles it' },
      }),
      config,
    });

    const report = buildReviewReport(result, { ...target, truncated: true });
    expect(report).toContain('## Confirmed findings (1)');
    expect(report).toContain('Real bug');
    expect(report).toContain('the pointer is null here');
    // The rejected finding is named too: hiding it would hide the argument.
    expect(report).toContain('## Rejected findings (1)');
    expect(report).toContain('Imaginary bug');
    expect(report).toContain('the code handles it');
    // A truncated diff is a limit of the review and belongs in the report.
    expect(report).toContain('The diff was cut short');
  });

  it('records the state the run was in when the review started', async () => {
    const result = await runReview({
      target: { ...target, runStatus: 'running' },
      ports: fleet({ perLens: () => [], verdict: () => ({ confirmed: false, reason: 'x' }) }),
      config,
    });

    const report = buildReviewReport(result, { ...target, runStatus: 'running' });
    // A review of a run that is still going covers the change as it is now.
    // A report that did not say so would read like a verdict on a finished run.
    expect(report).toContain('Run status at review: running');
  });

  it('summarises the review for the terminal', async () => {
    const result = await runReview({
      target,
      ports: fleet({ perLens: (lens) => (lens === 'correctness' ? [finding({ file: 'src/a.ts' })] : []) }),
      config,
    });
    const summary = formatReviewSummary(result);
    expect(summary).toMatch(/1 confirmed, 0 rejected/u);
    expect(summary).toContain('src/a.ts');
  });
});
