/**
 * Executes the re-trigger plan after a committed fix.
 *
 * A push made with the default GITHUB_TOKEN does not start new workflow runs.
 * When no ALRAN_CI_PUSH_TOKEN is configured, the plan falls back to a manual
 * dispatch; this module turns that plan into `gh workflow run` calls. It is
 * deliberately tiny and injectable so tests never need a real gh.
 */

export interface RetriggerCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type RetriggerGhRunner = (args: readonly string[]) => RetriggerCommandResult;

export interface RetriggerOutcome {
  readonly executed: number;
  readonly failed: readonly string[];
}

/**
 * Dispatches every monitored workflow on the fix branch when — and only when —
 * the plan asks for the workflow-dispatch fallback. Push-token pushes restart
 * CI on their own and need no dispatch here.
 */
export function executeRetrigger(
  retrigger: { readonly action: string; readonly reason: string },
  monitoredWorkflows: readonly string[],
  branch: string,
  runGh: RetriggerGhRunner,
): RetriggerOutcome {
  if (retrigger.action !== 'workflow-dispatch') {
    return { executed: 0, failed: [] };
  }
  let executed = 0;
  const failed: string[] = [];
  for (const workflow of monitoredWorkflows) {
    const result = runGh(['workflow', 'run', workflow, '--ref', branch]);
    if (result.status === 0) {
      executed += 1;
    } else {
      failed.push(`${workflow}: ${result.stderr.trim() || `exit ${result.status}`}`);
    }
  }
  return { executed, failed };
}