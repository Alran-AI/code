/**
 * Runtime adapters for the Ultra review fleet.
 *
 * The fleet itself lives in `@alran/ultra` as pure orchestration over ports.
 * This file is the other half: it builds the prompts, calls a headless
 * `alran exec` for each reviewer and each verifier, and parses the replies
 * back into findings and verdicts.
 *
 * Two properties matter here:
 *
 *   - **Read-only, and actually read-only.** A reviewer explores the
 *     repository. It must not change it, so the tree is fingerprinted before
 *     the call and restored afterwards — the same guard the planning roles use.
 *     A reviewer that "helpfully" fixes the bug it found has destroyed the
 *     evidence of the bug.
 *   - **Independent verification.** The verifier is given the finding and the
 *     code, never the reviewer's reasoning. A verifier that reads the
 *     reviewer's argument tends to agree with it.
 */

import * as ultra from '@alran/ultra';
import { runHeadless } from './ultra-headless.js';
import { restoreTree, snapshotTree } from './read-only-guard.js';

export interface UltraReviewAdapterContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Command that starts Alran Code; defaults to the running CLI entry. */
  readonly alranCommand?: readonly string[];
  readonly reviewerTimeoutMs?: number;
  readonly verifierTimeoutMs?: number;
  /** Called before each slow call, so a caller can say what is happening. */
  readonly onProgress?: (message: string) => void;
  /** Called when a read-only role changed the tree anyway. */
  readonly onUnexpectedWrite?: (paths: readonly string[]) => void;
}

const REVIEWER_SYSTEM_PROMPT = [
  'You are a code reviewer. You are read-only: do not edit, create or delete any file.',
  'You did not write this code and you must not assume it is correct.',
  '',
  'You are one lens of a review fleet. Each lens looks for a different kind of',
  'problem, so stay inside your lens and do not report what another lens owns.',
  '',
  'Report only problems you can point at in the code. A suspicion is not a finding:',
  'name the file and the line, and say what breaks. If you find nothing, say so.',
  '',
  'Reply with JSON only, in this shape:',
  '',
  '{"findings": [{"severity": "critical|major|minor", "title": "one line",',
  ' "detail": "why it is wrong and what it breaks", "file": "path/to/file.ts",',
  ' "line": 42, "evidence": "the code or the quote that shows it"}]}',
  '',
  'Rules:',
  '- "title" and "detail" are required; a finding without them is not a finding.',
  '- "file" and "line" are required whenever you can name them.',
  '- Report at most ten findings, most serious first.',
  '- An empty list is a valid answer. Do not invent a finding to look useful.',
].join('\n');

const VERIFIER_SYSTEM_PROMPT = [
  'You are an independent verifier. Another agent claims there is a problem in a',
  'code change. Your job is to check that claim against the code, not to agree',
  'with it.',
  '',
  'You are read-only: do not edit, create or delete any file.',
  '',
  'Open the files named in the claim and read the surrounding code. A claim is',
  'confirmed only when the code really does what the claim says. If the code',
  'handles the case, the claim is wrong — say so.',
  '',
  'Reply with JSON only, in this shape:',
  '',
  '{"confirmed": true|false, "reason": "one line: what in the code decides it"}',
  '',
  'Rules:',
  '- `confirmed` must be true or false. Nothing else counts as a confirmation.',
  '- The reason must point at the code, not at the reviewer.',
  '- A claim about a file or line that does not exist is not confirmed.',
].join('\n');

/** The part of the target every reviewer and verifier is shown. */
function targetBlock(target: ultra.ReviewTarget): string {
  const lines: string[] = [];
  lines.push(`Change under review: ${target.description}`);
  if (target.branch) {
    lines.push(`Branch: ${target.branch}${target.baseRef ? ` (compared against ${target.baseRef})` : ''}`);
  }
  lines.push('');
  lines.push('Files the change touches:');
  if (target.changedFiles.length === 0) {
    lines.push('(none listed)');
  } else {
    for (const file of target.changedFiles.slice(0, 200)) lines.push(`- ${file}`);
  }
  lines.push('');
  lines.push('The diff:');
  lines.push('```');
  lines.push(target.diff.length > 0 ? target.diff : '(no diff was captured)');
  lines.push('```');
  return lines.join('\n');
}

/** The prompt one lens of the fleet receives. */
export function buildReviewerPrompt(input: {
  readonly lens: ultra.ReviewLens;
  readonly target: ultra.ReviewTarget;
}): string {
  const lines: string[] = [];
  lines.push(`Your lens: ${input.lens.title}`);
  lines.push(`Look only for: ${input.lens.focus}`);
  lines.push('');
  lines.push(targetBlock(input.target));
  lines.push('');
  lines.push('Read the files before you answer. Report JSON only.');
  return lines.join('\n');
}

/** The prompt the verifier receives for one finding. */
export function buildVerifierPrompt(input: {
  readonly finding: ultra.ReviewFinding;
  readonly target: ultra.ReviewTarget;
}): string {
  const lines: string[] = [];
  lines.push('A reviewer claims there is a problem. Check it against the code.');
  lines.push('');
  lines.push(`Claim: ${input.finding.title}`);
  lines.push(`Why the reviewer says so: ${input.finding.detail}`);
  if (input.finding.file) {
    lines.push(`Claimed location: ${input.finding.file}${input.finding.line ? `:${String(input.finding.line)}` : ''}`);
  }
  if (input.finding.evidence) lines.push(`Claimed evidence: ${input.finding.evidence}`);
  lines.push('');
  lines.push(targetBlock(input.target));
  lines.push('');
  lines.push('Open the files and decide. Reply with JSON only.');
  return lines.join('\n');
}

/**
 * Builds the fleet's ports.
 *
 * A failed reviewer is a lens that did not report, not a failed review: the
 * fleet continues with the other lenses and the report names the lens that
 * failed. A reviewer that crashes must not throw away the findings of the
 * reviewers that worked.
 */
export function createUltraReviewAdapters(context: UltraReviewAdapterContext): ultra.ReviewPorts {
  const reviewerTimeoutMs = context.reviewerTimeoutMs ?? 10 * 60_000;
  const verifierTimeoutMs = context.verifierTimeoutMs ?? 6 * 60_000;

  /** One read-only model call, with the tree restored afterwards. */
  const call = (input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly timeoutMs: number;
    readonly model: string;
  }): { readonly ok: boolean; readonly text: string; readonly costUsd?: number; readonly tokensUsed: number; readonly error?: string } => {
    const before = snapshotTree(context.cwd, context.env);
    try {
      const result = runHeadless(context, {
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
        workspaceDir: context.cwd,
        model: input.model,
        timeoutMs: input.timeoutMs,
        permission: 'off',
      });
      return {
        ok: result.ok,
        text: result.text,
        tokensUsed: result.tokensUsed,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    } finally {
      if (before) {
        const { reverted } = restoreTree(context.cwd, before, context.env);
        if (reverted.length > 0) context.onUnexpectedWrite?.(reverted);
      }
    }
  };

  return {
    reviewer: {
      async review(input): Promise<ultra.ReviewerOutcome> {
        context.onProgress?.(`reviewing: ${input.lens.title}`);
        const result = call({
          systemPrompt: REVIEWER_SYSTEM_PROMPT,
          prompt: buildReviewerPrompt({ lens: input.lens, target: input.target }),
          timeoutMs: reviewerTimeoutMs,
          model: input.model,
        });
        if (!result.ok) {
          return { findings: [], costUsd: result.costUsd ?? 0, error: result.error ?? 'the reviewer failed' };
        }
        const parsed = ultra.parseReviewerReply(result.text);
        return {
          findings: parsed.findings,
          costUsd: result.costUsd ?? 0,
          tokensUsed: result.tokensUsed,
          model: input.model,
          ...(parsed.dropped.length > 0
            ? { error: `${String(parsed.dropped.length)} finding(s) could not be read` }
            : {}),
        };
      },
    },
    verifier: {
      async verify(input): Promise<ultra.ReviewVerdict> {
        const result = call({
          systemPrompt: VERIFIER_SYSTEM_PROMPT,
          prompt: buildVerifierPrompt({ finding: input.finding, target: input.target }),
          timeoutMs: verifierTimeoutMs,
          model: input.model,
        });
        if (!result.ok) {
          return {
            confirmed: false,
            reason: `the verifier failed: ${result.error ?? 'unknown error'}`,
            costUsd: result.costUsd ?? 0,
            tokensUsed: result.tokensUsed,
          };
        }
        const verdict = ultra.parseVerifierReply(result.text);
        return {
          ...verdict,
          costUsd: result.costUsd ?? 0,
          tokensUsed: result.tokensUsed,
          model: input.model,
        };
      },
    },
  };
}
