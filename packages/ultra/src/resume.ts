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
 *   - A **running** run must not be continued while something is driving it: a
 *     second execute pass would race the first one over the same worktrees. A
 *     running run whose driver is *gone* is a different case: the process died
 *     and left the run behind, and it is exactly the run that needs to be
 *     resumed. `status` already tells such a run to `resume` it, so refusing
 *     the resume would contradict the run's own advice.
 *   - A **succeeded** run must not be continued: it has a verdict, and moving
 *     it to `running` would throw that verdict away.
 *
 * The succeeded case was not enforced anywhere. `RunStore` guards the
 * transition *into* `succeeded`, not the ones out of it, so resuming a
 * succeeded run relabelled it as `running` and left it there — a successful
 * run that looked like it had just started and never would.
 */

import type { UltraControlDriver } from './control.js';
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
 *
 * `driver` says whether something is still behind the run. It is what turns
 * "a running run must not be resumed" into "a running run nobody is driving
 * may be resumed": without it, a run whose process died would be refused by
 * the very command its own status told the reader to run.
 */
export function resumeRefusal(state: RunState, driver?: UltraControlDriver): string | undefined {
  const status = state.status;
  if (CONTINUABLE.has(status)) return undefined;
  if (status === 'succeeded') {
    return `Run ${state.runId} already finished as succeeded; there is nothing left to resume.`;
  }
  if (status === 'running') {
    if (driver === 'dead') {
      // The process that was driving the run is gone. Nothing can race it now.
      return undefined;
    }
    return `Run ${state.runId} is already running; pause it first.`;
  }
  return `Run ${state.runId} is still planning; it has no plan to execute yet.`;
}
