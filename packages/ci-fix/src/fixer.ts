/**
 * CI Fix orchestration core.
 *
 * `runCiFix` is the whole workflow: fork and loop checks, rate limit, local
 * reproduction, one headless agent run with a restricted toolset, diff guard,
 * verification, commit, push or PR, and the summary comment. GitHub specifics
 * live behind the ports; this module decides. Nothing is committed unless the
 * previously failing command passes again, and a run that stops for any reason
 * leaves a comment explaining why — a silent no-op is the worst outcome.
 */

import { type CiFixConfig } from './config.js';
import { buildCiFixComment, type CiFixReport, type CiFixReportStatus } from './comment.js';
import { guardFixDiff } from './diff-guard.js';
import type { GitHubRepoRef } from './detect-repo.js';
import { maskCiLog } from './logs.js';
import { buildCiFixCommitMessage, countCiFixAttempts, evaluateLoopGuard } from './loop-guard.js';
import {
  CI_FIX_ALLOWED_TOOL_INTENT,
  buildCiFixSystemPrompt,
  buildCiFixUserPrompt,
  ciFixCommitSummary,
  resolveCiFixMode,
} from './prompt.js';
import type { CiFixPorts } from './ports.js';

export type CiFixBaseKind = 'pull_request' | 'main';

export interface CiFixRequest {
  readonly config: CiFixConfig;
  readonly repo: GitHubRepoRef;
  /** Repository that owns the failing head; forks are refused. */
  readonly headRepository: string;
  readonly branch: string;
  readonly headSha?: string;
  readonly pullRequestNumber?: number;
  readonly baseBranchKind: CiFixBaseKind;
  readonly failingCommand: string;
  readonly failedLogExcerpt: string;
  readonly workspaceDir: string;
  readonly apiKey: string;
  /** True when the push-token secret is available, i.e. a push restarts CI. */
  readonly pushTokenAvailable?: boolean;
  /** Dry runs reproduce, fix and verify but never commit, push or comment. */
  readonly dryRun?: boolean;
}

export type CiFixStatus = 'fixed' | 'blocked' | 'skipped' | 'failed' | 'no-change';

export interface CiFixOutcome {
  readonly status: CiFixStatus;
  readonly reasons: readonly string[];
  readonly committed: boolean;
  readonly pushed: boolean;
  readonly pullRequestCreated: boolean;
  readonly commented: boolean;
  readonly pullRequestNumber?: number;
  readonly attempts: number;
  readonly tokensUsed: number;
  readonly costUsd?: number;
  readonly diff: string;
  readonly violations: readonly string[];
  readonly comment?: string;
  readonly retrigger: { readonly action: string; readonly reason: string };
  readonly dryRun: boolean;
}

/** Counts the changed lines of a unified diff (added + removed). */
export function countDiffLines(diff: string): number {
  let count = 0;
  for (const line of diff.split('\n')) {
    if (
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      count += 1;
    }
  }
  return count;
}

/** File names touched by a unified diff. */
export function changedFilesFromDiff(diff: string): readonly string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    const match = /^diff --git a\/(.*) b\/(.*)$/u.exec(line);
    if (match?.[2]) files.push(match[2]);
  }
  return files;
}

export interface RetriggerInput {
  readonly committed: boolean;
  readonly pushTokenAvailable: boolean;
  readonly mode: string;
}

export interface RetriggerPlan {
  readonly action: 'push-with-token' | 'workflow-dispatch' | 'none';
  readonly reason: string;
}

/**
 * Plans how a verified fix re-triggers CI. The default GitHub token does not
 * start new workflow runs, so a push needs an explicit PAT/App token when one
 * is configured; without it the fallback is a manual `workflow_dispatch`, and
 * without either the run simply stays green without a fresh CI cycle.
 */
export function planRetrigger(input: RetriggerInput): RetriggerPlan {
  if (!input.committed) {
    return { action: 'none', reason: 'nothing was committed, so there is nothing to re-trigger' };
  }
  if (input.pushTokenAvailable) {
    return {
      action: 'push-with-token',
      reason: 'ALRAN_CI_PUSH_TOKEN is configured; the push restarts the monitored workflow',
    };
  }
  return {
    action: 'workflow-dispatch',
    reason:
      'no push token configured; the monitored workflow is re-triggered manually via workflow_dispatch, which does not exercise the real push event',
  };
}

const MASKED_SECRET_NAMES = ['ALRAN_API_KEY', 'GITHUB_TOKEN', 'ALRAN_CI_PUSH_TOKEN'];

function maskLogForModel(config: CiFixConfig, log: string): string {
  return maskCiLog(log, { names: [...MASKED_SECRET_NAMES, config.model.api_key_secret] });
}

/**
 * Runs one fix attempt. The caller supplies the failing context; every side
 * effect goes through ports. The result carries everything a CLI, a TUI or a
 * GitHub Action needs to report the run.
 */
export async function runCiFix(request: CiFixRequest, ports: CiFixPorts): Promise<CiFixOutcome> {
  const config = request.config;
  const dryRun = request.dryRun === true;
  const mode = resolveCiFixMode(config, request.baseBranchKind);

  const finish = async (
    status: CiFixReportStatus,
    reason: string,
    extra: {
      readonly attempts?: number;
      readonly tokensUsed?: number;
      readonly costUsd?: number;
      readonly diff?: string;
      readonly violations?: readonly string[];
      readonly committed?: boolean;
      readonly pushed?: boolean;
      readonly pullRequestCreated?: boolean;
      readonly pullRequestNumber?: number;
    } = {},
  ): Promise<CiFixOutcome> => {
    const committed = extra.committed ?? false;
    const pullRequestNumber = extra.pullRequestNumber ?? request.pullRequestNumber;
    const report: CiFixReport = {
      status,
      repo: request.repo.fullName,
      branch: request.branch,
      headSha: request.headSha,
      pullRequestNumber,
      failingCommand: request.failingCommand,
      summary: reason,
      changedFiles: extra.diff ? changedFilesFromDiff(extra.diff) : [],
      diffLines: extra.diff ? countDiffLines(extra.diff) : 0,
      attempts: extra.attempts ?? 0,
      maxAttempts: config.limits.max_attempts,
      tokensUsed: extra.tokensUsed ?? 0,
      costUsd: extra.costUsd,
      mode,
      dryRun,
      violations: extra.violations,
      commitSubject: undefined,
    };
    const comment = buildCiFixComment(report);
    let commented = false;
    if (!dryRun && pullRequestNumber !== undefined) {
      await ports.report.comment(pullRequestNumber, comment);
      commented = true;
    }
    return {
      status: status as CiFixStatus,
      reasons: [reason],
      committed,
      pushed: extra.pushed ?? false,
      pullRequestCreated: extra.pullRequestCreated ?? false,
      commented,
      pullRequestNumber,
      attempts: extra.attempts ?? 0,
      tokensUsed: extra.tokensUsed ?? 0,
      costUsd: extra.costUsd,
      diff: extra.diff ?? '',
      violations: extra.violations ?? [],
      comment,
      retrigger: planRetrigger({
        committed,
        pushTokenAvailable: request.pushTokenAvailable === true,
        mode,
      }),
      dryRun,
    };
  };

  if (!config.enabled) {
    return finish('skipped', 'CI Fix is disabled in .alran/ci.yml');
  }

  // Fork protection: never edit a pull request whose head lives elsewhere.
  if (request.headRepository.toLowerCase() !== request.repo.fullName.toLowerCase()) {
    return finish(
      'skipped',
      `fork pull requests are never fixed: head repository ${request.headRepository} is not ${request.repo.fullName}`,
    );
  }

  const headMessage = await ports.git.headMessage();
  const chain = await ports.git.commitChain(config.limits.max_attempts + 5);
  const loop = evaluateLoopGuard({
    headCommitMessage: headMessage,
    commitChain: chain,
    maxAttempts: config.limits.max_attempts,
  });
  if (!loop.run) {
    return finish('skipped', loop.reason ?? 'loop guard stopped this run');
  }

  const runsToday = await ports.rateLimit.runsToday();
  if (runsToday >= config.limits.max_runs_per_day) {
    return finish(
      'skipped',
      `daily limit reached: ${runsToday} of ${config.limits.max_runs_per_day} runs today`,
    );
  }

  const timeoutMs = config.limits.timeout_minutes * 60_000;

  // 1. Reproduce the failure locally.
  const reproduce = await ports.exec(request.failingCommand, request.workspaceDir, timeoutMs);
  if (reproduce.code === 0) {
    return finish('no-change', 'the failing command passes locally; nothing to fix');
  }
  if (reproduce.timedOut) {
    return finish('failed', `reproduction timed out after ${config.limits.timeout_minutes} minutes`);
  }

  // 2. One headless agent run with the restricted CI toolset.
  const attempt = countCiFixAttempts(chain) + 1;
  const agent = await ports.agent({
    systemPrompt: buildCiFixSystemPrompt({
      denyPaths: config.guards.deny_paths,
      failingCommand: request.failingCommand,
      model: config.model.name,
    }),
    userPrompt: buildCiFixUserPrompt({
      repo: request.repo.fullName,
      branch: request.branch,
      failingCommand: request.failingCommand,
      failedLogExcerpt: maskLogForModel(config, request.failedLogExcerpt),
      attempt,
      maxAttempts: config.limits.max_attempts,
      baseBranchKind: request.baseBranchKind,
    }),
    model: config.model.name,
    baseUrl: config.model.base_url,
    apiKey: request.apiKey,
    timeoutMs,
    maxTokens: config.limits.max_tokens,
    allowedToolIntent: [...CI_FIX_ALLOWED_TOOL_INTENT],
  });
  if (!agent.ok) {
    return finish('failed', `fix agent failed: ${agent.error ?? 'unknown error'}`, {
      tokensUsed: agent.tokensUsed,
      costUsd: agent.costUsd,
      attempts: attempt,
    });
  }

  const diff = agent.diff || (await ports.git.diff());
  if (agent.tokensUsed > config.limits.max_tokens) {
    return finish(
      'blocked',
      `token budget exceeded: ${agent.tokensUsed} tokens used of the ${config.limits.max_tokens} limit`,
      {
        tokensUsed: agent.tokensUsed,
        costUsd: agent.costUsd,
        attempts: attempt,
        diff,
      },
    );
  }
  const diffLines = countDiffLines(diff);
  if (diffLines > config.limits.max_diff_lines) {
    return finish(
      'blocked',
      `diff too large: ${diffLines} changed lines exceeds the limit of ${config.limits.max_diff_lines}`,
      {
        diff,
        tokensUsed: agent.tokensUsed,
        costUsd: agent.costUsd,
        attempts: attempt,
      },
    );
  }

  // 3. Hard security gate: protected paths and test weakening.
  const guard = guardFixDiff({
    diff,
    denyPaths: config.guards.deny_paths,
    forbidTestWeakening: config.guards.forbid_test_weakening,
  });
  if (!guard.ok) {
    const violations = guard.violations.map(
      (violation) =>
        `${violation.file}${violation.line ? `:${violation.line}` : ''}: ${violation.detail}`,
    );
    return finish(
      'blocked',
      'the diff guard rejected this fix; no commit was created',
      {
        diff,
        violations,
        tokensUsed: agent.tokensUsed,
        costUsd: agent.costUsd,
        attempts: attempt,
      },
    );
  }

  // 4. Verify: commit only when the same command is green.
  const verify = await ports.exec(request.failingCommand, request.workspaceDir, timeoutMs);
  if (verify.code !== 0) {
    return finish('failed', 'verification failed: the command is still red after the fix', {
      diff,
      tokensUsed: agent.tokensUsed,
      costUsd: agent.costUsd,
      attempts: attempt,
    });
  }

  const summary = ciFixCommitSummary(request.failingCommand);
  const { subject, body } = buildCiFixCommitMessage(summary);

  let committed = false;
  let pushed = false;
  let pullRequestCreated = false;
  let prNumber = request.pullRequestNumber;
  let delivery = 'comment-only mode: verified green, nothing committed';
  if (!dryRun && mode !== 'comment-only') {
    await ports.git.commit(subject, body);
    committed = true;
    if (mode === 'push-to-branch') {
      await ports.git.push();
      pushed = true;
      delivery = `pushed the fix commit to ${request.branch}`;
    } else {
      const head = `alran-ci-fix/${request.branch.replace(/\//gu, '-')}`;
      await ports.git.createBranch(head);
      await ports.git.push();
      prNumber = await ports.git.createPullRequest(subject, body, request.branch, head);
      pushed = true;
      pullRequestCreated = true;
      delivery = `fix pull request #${prNumber} against ${request.branch}`;
    }
  }

  return finish('fixed', delivery, {
    attempts: attempt,
    tokensUsed: agent.tokensUsed,
    costUsd: agent.costUsd,
    diff,
    committed,
    pushed,
    pullRequestCreated,
    pullRequestNumber: prNumber,
  });
}
