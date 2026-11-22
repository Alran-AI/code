/**
 * Reviewing a run, for the CLI and the TUI.
 *
 * The review fleet itself lives in `@alran/ultra`; this module is the part
 * that knows about *this* repository: which branch holds the run's work, what
 * the diff is, and where the report is written.
 *
 * Both surfaces call it, so "review a run" means the same thing in the shell
 * and in the board: the same fleet, the same lenses, the same verification,
 * the same report.
 */

import { writeFileSync } from 'node:fs';
import * as ultra from '@alran/ultra';
import { ultraRefExists, ultraRunDiffContent } from './ultra-diff.js';
import { createUltraReviewAdapters } from './ultra-review-adapters.js';

export interface UltraReviewRunOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly store: ultra.RunStore;
  /**
   * The command that starts Alran Code. Defaults to the running entry point.
   *
   * The reviewers are model calls like any other, so they have to reach the
   * same CLI as the rest of Ultra — a review that ran against some other
   * build on the PATH would answer with a different product.
   */
  readonly alranCommand?: readonly string[];
  /** The fleet's ports; built from the runtime when absent. */
  readonly ports?: ultra.ReviewPorts;
  /** How many lenses to run, 1..8. */
  readonly reviewers: number;
  /** Hard cost cap in USD; `null` means no cap. */
  readonly budgetUsd: number | null;
  readonly model: string;
  /** Called before each slow model call. */
  readonly onProgress?: (message: string) => void;
}

export interface UltraReviewRunResult {
  readonly result: ultra.ReviewResult;
  readonly target: ultra.ReviewTarget;
  /** Where the markdown report was written. */
  readonly reportPath: string;
}

/**
 * Reviews what a run produced.
 *
 * Throws when there is nothing to review: a run with no finished packet, or
 * a run whose change is empty. Reviewing nothing and reporting "no findings"
 * would look like a clean bill of health, which is the one thing a review of
 * nothing must never look like.
 */
export async function reviewUltraRun(options: UltraReviewRunOptions): Promise<UltraReviewRunResult> {
  const { store } = options;
  const state = store.state;
  const done = state.packets.filter((packet) => packet.status === 'done');
  if (done.length === 0) {
    throw new Error(
      `Run ${state.runId} has no finished packet, so there is nothing to review yet. Review it after its packets have landed.`,
    );
  }

  const runBranch = ultra.runBranchFor(state.runId);
  const branchExists = ultraRefExists(options.cwd, runBranch);
  const content = ultraRunDiffContent({
    cwd: options.cwd,
    runId: state.runId,
    packets: state.packets,
    runBranchExists: branchExists,
  });
  if (content.files.length === 0 && content.diff.length === 0) {
    throw new Error(
      `Run ${state.runId} produced no diff to review (no branch ${runBranch} and no changed files).`,
    );
  }

  const target: ultra.ReviewTarget = {
    runId: state.runId,
    description: state.goal,
    ...(content.ref ? { branch: content.ref, baseRef: 'HEAD' } : {}),
    changedFiles: content.files,
    diff: content.diff,
    truncated: content.truncated,
    runStatus: state.status,
  };

  const reviewers = Math.min(
    ultra.MAX_REVIEWERS,
    Math.max(1, Math.floor(options.reviewers)),
  );
  const ports =
    options.ports ??
    createUltraReviewAdapters({
      cwd: options.cwd,
      env: options.env,
      ...(options.alranCommand ? { alranCommand: options.alranCommand } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });

  const result = await ultra.runReview({
    target,
    ports,
    config: {
      lenses: ultra.REVIEW_LENSES.slice(0, reviewers),
      reviewerModel: options.model,
      verifierModel: options.model,
      budgetUsd: options.budgetUsd,
    },
  });

  writeFileSync(store.paths.review, ultra.buildReviewReport(result, target));
  writeFileSync(store.paths.reviewJson, `${JSON.stringify(result, null, 2)}\n`);
  return { result, target, reportPath: store.paths.review };
}
