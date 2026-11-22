/**
 * What to do next with a run.
 *
 * A status that says `succeeded` and stops is a status that leaves the reader
 * guessing: the run is over, the branch is ready, and the merge is the next
 * thing — but nothing says so. A run that stopped still has work, and the
 * command that continues it should be named rather than remembered.
 *
 * The rule lives in the core because the CLI and the TUI read the same state
 * directory: a next step that differs between them is a next step one of them
 * gets wrong.
 */

import { runBranchFor } from './branches.js';
import { resumeRefusal } from './resume.js';
import type { RunState } from './types.js';

export type UltraNextStep =
  /** The run still has work; it can be continued. */
  | { readonly kind: 'resume' }
  /** The run is finished and its branch is ready to be merged. */
  | { readonly kind: 'merge'; readonly branch: string }
  /** Nothing to do: the run is going, or it never got as far as a plan. */
  | { readonly kind: 'none' };

/**
 * The next step for this run.
 *
 * A successful run is the case that matters most: it is the one the reader
 * waited for, and the merge is the only thing left to do with it.
 */
export function nextStepFor(state: RunState): UltraNextStep {
  if (state.status === 'succeeded') {
    return { kind: 'merge', branch: runBranchFor(state.runId) };
  }
  // A run that may be continued is a run with work left, whether it paused at
  // its budget cap, was killed, or is waiting for a confirmation.
  if (resumeRefusal(state) === undefined) {
    return { kind: 'resume' };
  }
  return { kind: 'none' };
}
