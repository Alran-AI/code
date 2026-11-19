/**
 * Pure health checks for `alran ci doctor`.
 *
 * The CLI gathers facts (gh login, secret presence, workflow permissions,
 * fork state, monitored workflow names) and this module turns them into a
 * stable check list. Staying pure keeps the checks testable without GitHub.
 */

export interface DoctorFacts {
  readonly ghAuthenticated: boolean;
  readonly secretPresent: boolean;
  readonly workflowInstalled: boolean;
  /** Permission keys the installed workflow declares, e.g. "contents: write". */
  readonly workflowPermissions: readonly string[];
  readonly isFork: boolean;
  /** Names of workflows that exist in .github/workflows of the repository. */
  readonly repositoryWorkflows: readonly string[];
  /** Names this installation monitors, from .alran/ci.yml. */
  readonly monitoredWorkflows: readonly string[];
  readonly pushTokenSecretPresent: boolean;
  readonly configEnabled: boolean;
  readonly configProblems: readonly string[];
  /** Workflow guards forks and supports the manual dispatch fallback. */
  readonly workflowHasForkGuard: boolean;
  readonly workflowHasDispatch: boolean;
}

export interface DoctorCheck {
  readonly id: string;
  readonly ok: boolean;
  /** Errors block a run; warnings only inform (e.g. missing push token). */
  readonly severity: 'error' | 'warning';
  readonly detail: string;
  readonly hint?: string;
}

const REQUIRED_PERMISSIONS = new Set(['contents: write', 'pull-requests: write', 'actions: read']);

export function runDoctorChecks(facts: DoctorFacts): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  checks.push({
    id: 'gh-login',
    ok: facts.ghAuthenticated,
    severity: 'error',
    detail: facts.ghAuthenticated ? 'gh is signed in' : 'gh is not signed in',
    hint: facts.ghAuthenticated ? undefined : 'run `gh auth login` first',
  });

  checks.push({
    id: 'api-key-secret',
    ok: facts.secretPresent,
    severity: 'error',
    detail: facts.secretPresent
      ? 'the model API key secret is present'
      : 'the model API key secret is missing',
    hint: facts.secretPresent
      ? undefined
      : 'run `alran ci init` again, or set the secret manually in repository Settings → Secrets → Actions',
  });

  if (facts.workflowInstalled) {
    const declared = new Set(facts.workflowPermissions);
    const missing = [...REQUIRED_PERMISSIONS].filter((permission) => !declared.has(permission));
    const extra = [...declared].filter((permission) => !REQUIRED_PERMISSIONS.has(permission));
    checks.push({
      id: 'workflow-permissions',
      ok: missing.length === 0 && extra.length === 0,
      severity: 'error',
      detail:
        missing.length === 0 && extra.length === 0
          ? 'workflow permissions are minimal (contents, pull-requests, actions)'
          : `workflow permissions are wrong (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
      hint:
        missing.length === 0 && extra.length === 0
          ? undefined
          : 're-run `alran ci init` to restore the minimal permission set',
    });
  } else {
    checks.push({
      id: 'workflow-permissions',
      ok: false,
      severity: 'error',
      detail: 'the Alran CI Fix workflow is not installed',
      hint: 'run `alran ci init` to install it',
    });
  }

  checks.push({
    id: 'fork',
    ok: !facts.isFork,
    severity: 'error',
    detail: facts.isFork ? 'this repository is a fork' : 'this repository is not a fork',
    hint: facts.isFork
      ? 'CI Fix never edits forks; install it in the upstream repository instead'
      : undefined,
  });

  if (facts.workflowInstalled) {
    const ok = facts.workflowHasForkGuard && facts.workflowHasDispatch;
    checks.push({
      id: 'workflow-triggers',
      ok,
      severity: 'error',
      detail: ok
        ? 'workflow guards forks and supports manual dispatch'
        : 'workflow is missing the fork guard or the workflow_dispatch trigger',
      hint: ok ? undefined : 're-run `alran ci init` to restore the workflow',
    });
  }

  const missingWorkflows = facts.monitoredWorkflows.filter(
    (name) => !facts.repositoryWorkflows.includes(name),
  );
  checks.push({
    id: 'monitored-workflows',
    ok: missingWorkflows.length === 0,
    severity: 'error',
    detail:
      missingWorkflows.length === 0
        ? `all monitored workflows exist (${facts.monitoredWorkflows.join(', ')})`
        : `monitored workflows missing: ${missingWorkflows.join(', ')}`,
    hint:
      missingWorkflows.length === 0
        ? undefined
        : 'fix the names in .alran/ci.yml under trigger.workflows',
  });

  checks.push({
    id: 'config',
    ok: facts.configProblems.length === 0,
    severity: 'error',
    detail:
      facts.configProblems.length === 0
        ? '.alran/ci.yml parses cleanly'
        : `.alran/ci.yml has ${facts.configProblems.length} problem(s)`,
    hint: facts.configProblems[0],
  });

  checks.push({
    id: 'enabled',
    ok: facts.configEnabled,
    severity: 'error',
    detail: facts.configEnabled ? 'CI Fix is enabled' : 'CI Fix is disabled in .alran/ci.yml',
    hint: facts.configEnabled ? undefined : 'set enabled: true in .alran/ci.yml to re-enable',
  });

  checks.push({
    id: 'retrigger-token',
    ok: facts.pushTokenSecretPresent,
    severity: 'warning',
    detail: facts.pushTokenSecretPresent
      ? 'a push token is configured, so a fix push restarts CI'
      : 'no push token is configured',
    hint: facts.pushTokenSecretPresent
      ? undefined
      : 'without ALRAN_CI_PUSH_TOKEN a fix push does not re-run CI; the fallback is a manual workflow_dispatch, which skips push-event paths. See docs/ci-fixer.md',
  });

  return checks;
}

/** True when no error-severity check failed; warnings do not block. */
export function doctorIsHealthy(checks: readonly DoctorCheck[]): boolean {
  return checks.every((check) => check.ok || check.severity === 'warning');
}
