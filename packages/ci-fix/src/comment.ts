/**
 * PR comment builder.
 *
 * Every CI Fix run that stops or succeeds leaves one deterministic comment on
 * the pull request: what was red, what changed, how many attempts were spent,
 * and what the model cost. Nothing here talks to GitHub; the adapter posts the
 * returned string.
 */

export type CiFixReportStatus =
  | 'fixed'
  | 'blocked'
  | 'skipped'
  | 'failed'
  | 'no-change';

export interface CiFixReport {
  readonly status: CiFixReportStatus;
  readonly repo: string;
  readonly branch?: string;
  readonly headSha?: string;
  readonly pullRequestNumber?: number;
  readonly failingCommand: string;
  readonly summary: string;
  readonly changedFiles: readonly string[];
  readonly diffLines: number;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly tokensUsed: number;
  readonly costUsd?: number;
  readonly mode: string;
  readonly dryRun: boolean;
  readonly violations?: readonly string[];
  readonly commitSubject?: string;
  readonly reason?: string;
}

const STATUS_EMOJI: Record<CiFixReportStatus, string> = {
  fixed: '✅',
  blocked: '🚫',
  skipped: '⏭️',
  failed: '❌',
  'no-change': '⚪',
};

/** Renders the comment body for one CI Fix run. */
export function buildCiFixComment(report: CiFixReport): string {
  const lines: string[] = [];
  lines.push(`### ${STATUS_EMOJI[report.status]} Alran CI Fix — ${report.status}`);
  lines.push('');
  lines.push(`**Repository:** ${report.repo}`);
  if (report.branch) lines.push(`**Branch:** \`${report.branch}\``);
  if (report.headSha) lines.push(`**Head:** \`${report.headSha.slice(0, 12)}\``);
  lines.push(`**Mode:** ${report.mode}`);
  lines.push('');
  lines.push('**What was red**');
  lines.push('');
  lines.push(`- Failing command: \`${report.failingCommand}\``);
  lines.push(`- ${report.summary}`);
  lines.push('');
  lines.push('**What changed**');
  lines.push('');
  if (report.changedFiles.length === 0) {
    lines.push('No files were changed.');
  } else {
    for (const file of report.changedFiles) lines.push(`- \`${file}\``);
    lines.push('');
    lines.push(`Diff size: ${report.diffLines} changed lines.`);
  }
  lines.push('');
  lines.push('**Effort**');
  lines.push('');
  lines.push(`- Fix attempts: ${report.attempts} of ${report.maxAttempts}`);
  lines.push(`- Tokens used: ${report.tokensUsed.toLocaleString('en-US')}`);
  if (report.costUsd !== undefined) {
    lines.push(`- Estimated cost: $${report.costUsd.toFixed(4)}`);
  }
  if (report.commitSubject) {
    lines.push(`- Commit: \`${report.commitSubject}\``);
  }
  if (report.violations && report.violations.length > 0) {
    lines.push('');
    lines.push('**Why this was not committed**');
    lines.push('');
    for (const violation of report.violations) lines.push(`- ${violation}`);
  }
  if (report.reason) {
    lines.push('');
    lines.push(`**Reason:** ${report.reason}`);
  }
  lines.push('');
  lines.push(
    report.dryRun
      ? '_Dry run: nothing was committed, pushed or posted by this report._'
      : '_Automated by Alran Code CI Fixer. Reply on this pull request if the fix needs adjustments._',
  );
  return `${lines.join('\n')}\n`;
}
