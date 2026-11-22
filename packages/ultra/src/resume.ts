/**
 * When may a run be continued?
 *
 * Continuing a run is not the same as starting one: it reuses a plan, a branch
 * and the packets that are already done. Two things have to be true before a
 * resume is safe, and the CLI and the TUI have to agree on both of them —
 * they read the same state directory, so a rule that differs between them is
 * a rule one of them gets wrong.
 *
 * The rules:
 *
 *   - A **planned** run (waiting for a confirmation) can be executed. That is
 *     the whole point of `alran ultra plan`: look at the plan, then run it.
 *   - A **paused** or **killed** run can be continued. That is what `resume`
 *     is for.
 *   - A **partial**, **failed** or **stalled** run can be continued too. These
 *     are not verdicts: a run that paused at its budget cap ends up `partial`
 *     with work still to do, and a run whose packets were blocked can be
 *     continued once the blocker is gone.
 *   - A **running** run must not be continued: a second execute pass would
 *     race the first one over the same worktrees.
 *   - A **succeeded** run must not be continued: it has a verdict, and moving
 *     it to `running` would throw that verdict away.
 *
 * The succeeded case was not enforced anywhere. `RunStore` guards the
 * transition *into* `succeeded`, not the ones out of it, so resuming a
 * succeeded run relabelled it as `running` and left it there — a successful
 * run that looked like it had just started and never would.
 */

import type { RunState, RunStatus } from './types.js';

/**
 * Statuses a run can be continued from.
 *
 * `partial` and `failed` are here on purpose: they say the run did not finish
 * *cleanly*, not that it is over. Treating them as final would make a
 * budget-paused run impossible to continue, which is exactly what `resume`
 * exists for.
 */
const CONTINUABLE: ReadonlySet<RunStatus> = new Set([
  'paused',
  'killed',
  'awaiting_confirm',
  'partial',
  'failed',
  'stalled',
]);

/**
 * Why this run must not be continued, or `undefined` when it can be.
 *
 * The message names the way out, because a refusal that only says "no" leaves
 * the reader guessing what to do instead.
 */
export function resumeRefusal(state: RunState): string | undefined {
  const status = state.status;
  if (CONTINUABLE.has(status)) return undefined;
  if (status === 'succeeded') {
    return `Run ${state.runId} already finished as succeeded; there is nothing left to resume.`;
  }
  if (status === 'running') {
    return `Run ${state.runId} is already running; pause it first.`;
  }
  return `Run ${state.runId} is still planning; it has no plan to execute yet.`;
}
