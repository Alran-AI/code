/**
 * Public API of @alran/ci-fix.
 *
 * The package is the GitHub-agnostic core of the CI Fixer: configuration,
 * project detection, the workflow generator, the diff guard, loop protection,
 * log handling, prompts, and the fix orchestrator. GitHub-specific behavior
 * (gh CLI, workflow_run events, PR comments) lives in the adapters that
 * implement the ports in ports.ts.
 */

export {
  CI_FIX_CONFIG_PATH,
  CI_FIX_CONFIG_VERSION,
  CI_FIX_MAIN_MODES,
  CI_FIX_MARKER,
  CI_FIX_PULL_REQUEST_MODES,
  CI_FIX_PUSH_TOKEN_SECRET,
  CI_FIX_SECRET_NAME,
  CI_FIX_WORKFLOW_PATH,
  DEFAULT_CI_FIX_CONFIG,
  DEFAULT_CI_FIX_GUARDS,
  DEFAULT_CI_FIX_LIMITS,
  DEFAULT_CI_FIX_MODEL,
  DEFAULT_CI_FIX_MODE,
  isDeniedPath,
  matchesDenyPath,
  parseCiFixConfig,
  renderCiFixConfig,
  type CiFixConfig,
  type CiFixConfigParseResult,
  type CiFixConfigProblem,
  type CiFixGuardsConfig,
  type CiFixLimitsConfig,
  type CiFixMainMode,
  type CiFixModelConfig,
  type CiFixModeConfig,
  type CiFixPullRequestMode,
  type CiFixTriggerConfig,
} from './config.js';

export {
  detectProjectCommands,
  extractFailedCommand,
  type ProjectCommands,
  type ProjectCommandSources,
} from './detect-commands.js';

export { parseGitHubRemote, sameGitHubRepo, type GitHubRepoRef } from './detect-repo.js';

export {
  guardFixDiff,
  parseUnifiedDiff,
  type DiffGuardInput,
  type DiffGuardResult,
  type DiffGuardViolation,
  type DiffGuardViolationCode,
} from './diff-guard.js';

export {
  countCiFixAttempts,
  buildCiFixCommitMessage,
  evaluateLoopGuard,
  isCiFixCommitMessage,
  type LoopGuardDecision,
  type LoopGuardInput,
} from './loop-guard.js';

export {
  maskCiLog,
  maskSecrets,
  maskSecretAssignments,
  maskTokenPatterns,
  truncateLog,
  type TruncatedLog,
  type TruncateLogOptions,
} from './logs.js';

export {
  buildCiFixComment,
  type CiFixReport,
  type CiFixReportStatus,
} from './comment.js';

export {
  buildCiFixSystemPrompt,
  buildCiFixUserPrompt,
  ciFixCommitSummary,
  resolveCiFixMode,
  CI_FIX_ALLOWED_TOOL_INTENT,
} from './prompt.js';

export type {
  CiFixAgentRequest,
  CiFixAgentResult,
  CiFixAgentRunner,
  CiFixExecResult,
  CiFixExecRunner,
  CiFixGitPort,
  CiFixPorts,
  CiFixRateLimitPort,
  CiFixReportPort,
} from './ports.js';

export {
  changedFilesFromDiff,
  countDiffLines,
  planRetrigger,
  runCiFix,
  type CiFixBaseKind,
  type CiFixOutcome,
  type CiFixRequest,
  type CiFixStatus,
  type RetriggerInput,
  type RetriggerPlan,
} from './fixer.js';

export {
  buildSecretSetupInstructions,
  inspectCiFixConfig,
  planCiFixInit,
  type InitPlan,
  type InitPlanInput,
  type SecretSetupInput,
} from './init.js';

export { doctorIsHealthy, runDoctorChecks, type DoctorCheck, type DoctorFacts } from './doctor.js';

export { isSafeProjectCommand, MAX_PROJECT_COMMAND_LENGTH } from './safety.js';

export { renderCiFixWorkflow, type CiFixWorkflowInput } from './workflow-template.js';
