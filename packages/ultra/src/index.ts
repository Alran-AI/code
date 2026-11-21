/**
 * Public API of @alran/ultra.
 *
 * The portable core of Ultra mode: run state, ledger, budget, start guard, gate
 * detection, plan validation, and planning. Runtime-specific pieces (git
 * worktrees, model calls, the TUI board) live in the CLI adapters, mirroring
 * the layering of @alran/ci-fix.
 */

export type {
  AcceptanceCommand,
  ExecuteRunResult,
  GateCommandResult,
  GateResult,
  LedgerEntry,
  LedgerEntryKind,
  PacketExecutionOutcome,
  PacketState,
  PacketStatus,
  PlanPacket,
  PlanValidation,
  RunState,
  RunStatus,
  RepairFailure,
  UltraGates,
  UltraPlan,
  UltraRecipe,
  UltraRecipeChoice,
  VerifierVerdictResult,
  WorkerOutcome,
} from './types.js';

export {
  BudgetTracker,
  parseBudgetUsd,
  usdForTokens,
  type BudgetLevel,
  type BudgetRecordInput,
} from './budget.js';

export {
  GOAL_AUTHOR_SCHEMA,
  buildGoalAuthorPrompt,
  parseGoalAuthorReply,
  type GoalAuthorInput,
} from './goal-authoring.js';

export {
  checkpointTagFor,
  packetBranchFor,
  runBranchFor,
  specTestBranchFor,
} from './branches.js';

export {
  loadRecipeOverrides,
  parseRecipeFile,
  recipeFor,
} from './recipe-files.js';

export { Ledger } from './ledger.js';

export {
  createFileEvidenceWriter,
  type FileEvidenceWriter,
} from './evidence.js';

export {
  RunStore,
  ULTRA_STATE_DIR,
  newUltraRunId,
  runPathsFor,
  type CreateRunInput,
  type RunPaths,
} from './run-state.js';

export {
  MAX_CHUNK_BYTES,
  MAX_TAIL_BYTES,
  readRunnerLogChunk,
  runnerLogTail,
  tailRunnerLog,
  type RunnerLogChunk,
} from './runner-log.js';

export {
  classifyRunner,
  processAlive,
  readRunner,
  writeRunner,
  type UltraRunnerClassification,
  type UltraRunnerRecord,
  type UltraRunnerStatus,
  type UltraRunMode,
} from './runner.js';

export {
  evaluateStartGuard,
  probeWorkingTree,
  type StartGuardDecision,
  type StartGuardInput,
  type WorkingTreeProbe,
} from './start-guard.js';

export {
  detectUltraGates,
  type UltraGateSources,
} from './gates.js';

export {
  isTerminalPacketStatus,
  scopesOverlap,
  validatePlan,
} from './plan-schema.js';

export {
  checkScope,
  describeScopeViolations,
  ULTRA_DENY_PATHS,
  type CheckScopeInput,
  type ScopeDecision,
  type ScopeViolation,
  type ScopeViolationReason,
} from './scope-guard.js';

export { buildWorkerPrompt, buildWorkerSystemPrompt, type WorkerPromptInput } from './worker-prompt.js';

export {
  runExecute,
  type ExecuteConfig,
  type ExecuteInput,
  type ExecutePorts,
} from './execute.js';

export {
  runPlanPhase,
  ULTRA_PLAN_SCHEMA,
  type CriticVerdict,
  type ExplorerBrief,
  type ExplorerFinding,
  type PlanRunInput,
  type PlanRunResult,
  type PlannerDraft,
  type PlannerRoleConfig,
  type UltraPlanPorts,
} from './plan-phase.js';

export {
  finalizeRun,
  runIntegrate,
  type IntegrateConfig,
  type IntegrateInput,
  type IntegratePorts,
  type IntegrateResult,
  type PacketMergeOutcome,
} from './integrate.js';

export { buildReport, type ReportInput } from './report.js';

export {
  confirmationQuestion,
  formatBudget,
  isConfirmationAccepted,
  renderUltraConfirmation,
  type UltraConfirmationInput,
} from './confirm.js';

export {
  boardPhase,
  DEFAULT_BOARD_WIDTH,
  formatElapsed,
  renderUltraBoard,
  ULTRA_BOARD_GLYPHS,
  type UltraBoardGlyphs,
  type UltraBoardInput,
} from './board.js';

export {
  applyAcceptance,
  assertEvidence,
  goalCounts,
  hasOpenNeedsHumanMust,
  mustCriteriaSatisfied,
  openCriteria,
  parseGoalDocument,
  GoalDocumentError,
  type AcceptanceFinding,
  type AcceptanceReport,
  type Criterion,
  type CriterionPriority,
  type CriterionStatus,
  type CriterionVerification,
  type GoalCounts,
  type GoalDocument,
} from './goal.js';

export {
  runGoalLoop,
  type LoopConfig,
  type LoopPorts,
  type LoopResult,
  type LoopRoundResult,
} from './loop.js';

export {
  auditRound,
  isAuditRound,
  type AuditFinding,
  type AuditFindingKind,
  type AuditPorts,
  type AuditResult,
  type AuditSeverity,
} from './audit.js';

export {
  PLAN_TOKEN_BUDGET,
  PLAN_TOKENS_PER_USD,
  REPAIR_RESERVE,
  planTokenBudget,
  repairReserve,
  repairReserveRatio,
  sizePlan,
  type DroppedCriterion,
  type SizePlanInput,
  type SizePlanResult,
} from './plan-budget.js';

export {
  SPEC_TEST_DIR,
  assertSpecTestsProtected,
  describeSpecTestViolation,
  isSpecTestPath,
  specTestDenyPaths,
} from './spec-tests.js';

export {
  buildNotes,
  buildPacketContext,
  type InterfaceSummary,
  type NotesInput,
  type RunNote,
} from './notes.js';

export {
  buildRecipePromptBlock,
  type RecipeOverrides,
  isUltraRecipe,
  parseRecipeChoice,
  recipeCriteriaSeeds,
  recipeReadonlyPaths,
  recipeVerifierChecks,
  selectRecipe,
  suggestRecipe,
  ULTRA_RECIPE_IDS,
  ULTRA_RECIPES,
  type RecipePrompt,
  type UltraRecipeDefinition,
} from './recipes.js';

export {
  ACCEPTOR_SYSTEM_PROMPT,
  buildAcceptancePrompt,
  parseAcceptanceReport,
  type ParsedAcceptance,
} from './acceptance.js';

export {
  SPEC_TEST_FILENAME,
  buildSpecTestPrompt,
  createFileSpecTestWriter,
  parseSpecTestReply,
  renderSpecTest,
  specTestFileFor,
  type SpecTestFile,
  type SpecTestWriter,
} from './spec-authoring.js';
