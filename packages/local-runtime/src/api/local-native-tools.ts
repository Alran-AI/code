import type { PiEventWriter } from "@alran/agent-core/pi-turn-runner";
import type { RuntimeTool } from "@alran/agent-core/tools";
import {
  buildLocalToolRegistry,
  LocalTodoWriteToolDef,
  type LocalAskUserAdapter,
  type LocalBashAdapter,
  type LocalCodeReviewAdapter,
  type LocalRuntimeTool,
  type LocalRuntimeToolContext,
  type LocalSandboxBashOperationsFactory,
  type LocalAlranAgentAdapter,
  type LocalAlranCronAdapter,
  type LocalAlranMcpAdapter,
  type LocalAlranSessionAdapter,
  type LocalTaskAdapter,
  type LocalTaskAppendAdapter,
  type LocalTaskControlAdapter,
  type LocalWebFetchAdapter,
  type LocalWebSearchAdapter,
  WebSearchToolDef,
} from "@alran/agent-tools/desktop";
import { MatrixWebSearchToolDef } from "@alran/agent-tools";
import {
  commitTrailerFor,
  getConfig,
  resolveAgentCapabilities,
  webSearchEnvWithConfig,
  type AgentBuiltinMcpToolId,
  type AgentBuiltinSkillId,
  type ResolvedAgentCapabilities,
} from "@alran/config";
import { resolveFeatureAwareBuiltinSkillNames } from "../agent/feature-owned-skills.js";
import type { ModuleMetricsReporter } from "../common/metrics.js";
import { CU_DESKTOP_SKILL_NAME } from "../cu/gate.js";
import type { LocalMemoryFacade } from "../memory/local-memory-facade.js";
import { executeLocalMemoryTool } from "../memory/local-memory-tool.js";
import type { DesktopTurnCapabilityView } from "../runtime/desktop-turn-capabilities.js";
import type { LocalRuntimeAuthContext } from "../runtime/model-resolver.js";
import type { LocalRuntimeRoutingContext } from "../runtime/routing-headers.js";
import { logger } from "../common/logger.js";
import { buildLocalHostTrashRuntime } from "../permissions/host-trash-runtime.js";
import { resolveAgentBashEnvPolicy } from "../infra/ensure-rm-shim.js";
import { getSkillService } from "../skills/skill-service.js";
import { emitLocalTodoUpdatedEvent } from "../turns/todo-event.js";
import { LocalWebFetchClient } from "../web-fetch/index.js";
import { createLocalWebSearchAdapter } from "../web-search/index.js";
import {
  resolveWebSearchProvider,
  SEARXNG_SETUP_HINT,
  WEB_SEARCH_PROVIDER_ENV_VARS,
} from "../web-search/provider-resolution.js";
import { LocalWebsiteDeployClient } from "../website-deploy/index.js";
import { buildLocalAskUserAdapter } from "./local-ask-user-adapter.js";
import { mergeDesktopTurnTools } from "./local-desktop-tool-modes.js";
import { withLocalMemoryPolicyGuidance } from "./local-memory-policy-guidance.js";
import { withoutLocalAlranCronGuidance } from "./local-alran-cron-guidance.js";
import {
  filterLocalBuiltinCapabilityTools,
  isDesktopExtensionSkillSelected,
  normalizedSkillName,
} from "./local-native-tool-filter.js";
import type {
  LocalTurnToolSources,
  LocalTurnToolSourcesInput,
} from "./local-turn-tool-sources.types.js";

export type {
  LocalTurnToolSources,
  LocalTurnToolSourcesInput,
} from "./local-turn-tool-sources.types.js";

/**
 * Build the adapter only when a backend can actually answer. Returning `undefined` leaves
 * `web_search` out of the tool list entirely, which is better than offering a tool that can only
 * fail: without `SEARXNG_URL` and without a managed login, there is nothing to call.
 *
 * The host shows `SEARXNG_SETUP_HINT` once at start in that case, so the missing variable is named
 * instead of discovered through a failed call.
 */
function buildWebSearchAdapterFor(
  env: NodeJS.ProcessEnv,
  input: {
    authContext?: LocalRuntimeAuthContext;
    authContextGetter?: () => LocalRuntimeAuthContext | undefined;
    authContextInvalidator?: (
      rejectedAccessToken?: string,
      loginEpoch?: string,
    ) => void | Promise<void>;
    fetchImpl?: typeof fetch;
    routingContextGetter?: () => LocalRuntimeRoutingContext | undefined;
  },
): LocalWebSearchAdapter | undefined {
  const session = input.authContextGetter?.() ?? input.authContext;
  const hasMatrixSession = (session?.accessToken?.trim().length ?? 0) > 0;
  const provider = resolveWebSearchProvider(env, hasMatrixSession);
  if (provider.kind === 'none') {
    // Name the missing variable once, instead of surfacing it later as a failed tool call.
    logger.warn({ providers: WEB_SEARCH_PROVIDER_ENV_VARS }, SEARXNG_SETUP_HINT);
    return undefined;
  }
  return createLocalWebSearchAdapter(env, {
    ...(input.authContext ? { authContext: input.authContext } : {}),
    ...(input.authContextGetter ? { authContextGetter: input.authContextGetter } : {}),
    ...(input.authContextInvalidator
      ? { authContextInvalidator: input.authContextInvalidator }
      : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.routingContextGetter ? { routingContextGetter: input.routingContextGetter } : {}),
  }, hasMatrixSession);
}

export function buildLocalNativeRuntimeTools(input: {
  dataDir?: string;
  configGetter?: LocalTurnToolSourcesInput['configGetter'];
  workspaceRoot: string;
  agentName: string;
  excludeAgentResources?: boolean;
  expectedAgentInstanceId?: string;
  skipAgentResolution?: boolean;
  eventWriter?: PiEventWriter;
  askUserAdapter?: LocalAskUserAdapter;
  bashAdapter?: LocalBashAdapter;
  sandboxOperationsFactory?: LocalSandboxBashOperationsFactory;
  authContext?: LocalRuntimeAuthContext;
  /** Live host auth read per request; preferred over the `authContext` snapshot. */
  authContextGetter?: () => LocalRuntimeAuthContext | undefined;
  /** Host recovery for a rejected managed access token; enables one retry after a 401. */
  authContextInvalidator?: (
    rejectedAccessToken?: string,
    loginEpoch?: string,
  ) => void | Promise<void>;
  routingContextGetter?: () => LocalRuntimeRoutingContext | undefined;
  fetchImpl?: typeof fetch;
  webFetchAdapter?: LocalWebFetchAdapter;
  /** Local product gate for native web_search. */
  webSearchEnabled?: boolean;
  webSearchAdapter?: LocalWebSearchAdapter;
  taskAdapter?: LocalTaskAdapter;
  taskAppendAdapter?: LocalTaskAppendAdapter;
  taskControlAdapter?: LocalTaskControlAdapter;
  memoryFacade?: LocalMemoryFacade;
  alranAgentAdapter?: LocalAlranAgentAdapter;
  alranCronAdapter?: LocalAlranCronAdapter;
  alranMcpAdapter?: LocalAlranMcpAdapter;
  alranSessionAdapter?: LocalAlranSessionAdapter;
  emitBusEvent?: (type: string, payload: Record<string, unknown>) => void;
  /** Optional metrics reporter injected by the host. Absent → noop. */
  metrics?: ModuleMetricsReporter;
  /** Frozen CU active snapshot, resolved once by hosted turn assembly. */
  cuModeActive?: boolean;
  /** Host-owned Mini App Tool is present for this exact execution surface. */
  miniappAvailable?: boolean;
  codeReviewAdapter?: LocalCodeReviewAdapter;
  desktopCapabilities?: DesktopTurnCapabilityView;
  builtinCapabilities?: ResolvedAgentCapabilities;
  memoryEnabled?: boolean;
  memoryReadEnabled?: boolean;
  memoryWriteEnabled?: boolean;
  /** Per-Turn Agent profile gate; user/global Memory remains available. */
  memoryAgentScopeEnabled?: boolean;
  /** Canonical-first Runtime Memory aliases from the rendered Agent profile. */
  memoryReadAgentNames?: readonly string[];
  /** Frozen canonical standalone Skill selector for this Turn. */
  allowedSkillNames?: readonly string[];
  /** Frozen extension Skill selector for this Turn. */
  allowedExtensionSkillNames?: readonly string[];
  disabledBuiltinSkillNames?: readonly AgentBuiltinSkillId[];
  resumeCodexAvailable?: boolean;
}): LocalRuntimeTool[] {
  const capabilities = input.builtinCapabilities ?? resolveAgentCapabilities();
  const webFetchAdapter =
    input.webFetchAdapter ??
    new LocalWebFetchClient({ fetchImpl: input.fetchImpl });
  // `webSearch:` in config.yaml is a fallback for the environment, never an override: a key in the
  // shell wins even when the file holds a different one. Read config only when we actually build.
  const webSearchAdapter =
    input.webSearchEnabled === true
      ? (input.webSearchAdapter ??
        buildWebSearchAdapterFor(
          webSearchEnvWithConfig((input.configGetter ?? getConfig)().webSearch, process.env),
          input,
        ))
      : undefined;
  const builtinSkillNames = resolveFeatureAwareBuiltinSkillNames(capabilities, {
    cuModeActive: input.cuModeActive === true,
    ...(input.miniappAvailable === true ? { miniappAvailable: true } : {}),
    disabledSkillNames: input.disabledBuiltinSkillNames,
    resumeCodexAvailable: input.resumeCodexAvailable === true,
  });
  const nativeTools = [
    ...buildLocalToolRegistry({
      workspaceRoot: input.workspaceRoot,
      skillReader: {
        readSkill: async (name, agentName) => {
          if (name === CU_DESKTOP_SKILL_NAME && input.cuModeActive !== true) {
            return undefined;
          }
          const resolvedAgentName = agentName ?? input.agentName;
          const skill = await getSkillService().readSkillByName(name, {
            agentName: resolvedAgentName,
            ...(input.excludeAgentResources
              ? { excludeAgentResources: true }
              : {}),
            ...(input.expectedAgentInstanceId
              ? { expectedAgentInstanceId: input.expectedAgentInstanceId }
              : {}),
            ...(input.skipAgentResolution ? { skipAgentResolution: true } : {}),
            workspaceDir: input.workspaceRoot,
            ...(builtinSkillNames !== undefined ? { builtinSkillNames } : {}),
            ...(input.allowedSkillNames === undefined
              ? {}
              : { allowedSkillNames: input.allowedSkillNames }),
            ...(input.allowedExtensionSkillNames === undefined
              ? {}
              : {
                  allowedExtensionSkillNames: input.allowedExtensionSkillNames,
                }),
          });
          if (skill) {
            return {
              content: skill.content,
              location: skill.locationUri,
              sourceKind: skill.sourceKind,
            };
          }
          const desktopSkill = input.desktopCapabilities?.skills.find(
            (candidate) =>
              normalizedSkillName(candidate.name) ===
                normalizedSkillName(name) &&
              isDesktopExtensionSkillSelected(
                input.allowedSkillNames,
                input.allowedExtensionSkillNames,
                candidate.pluginName,
                candidate.name,
              ),
          );
          return desktopSkill
            ? {
                content: desktopSkill.content,
                location: desktopSkill.location,
                sourceKind: desktopSkill.sourceKind,
              }
            : undefined;
        },
      },
      todoEventSink: {
        emitTodoUpdated: (ctx, todos, signal) =>
          emitLocalTodoUpdatedEvent({
            ctx,
            todos,
            signal,
            emitBusEvent: input.emitBusEvent,
          }),
      },
      askUserAdapter: input.askUserAdapter,
      bashAdapter: input.bashAdapter,
      sandboxOperationsFactory: input.sandboxOperationsFactory,
      hostTrashRuntime: buildLocalHostTrashRuntime(input),
      bashEnvPolicy: (plan) =>
        resolveAgentBashEnvPolicy(
          input.dataDir,
          process.platform,
          plan?.nativeDelete ??
            (input.configGetter ?? getConfig)().permission?.nativeDelete === true,
          plan?.commitTrailer,
        ),
      // The Co-Authored-By line of a `git commit` this turn runs: the turn's model, unless the
      // user switched commit attribution off. Asked for every Bash call, with the call's turn.
      commitTrailerFor: (ctx) =>
        commitTrailerFor(ctx.parentAgentConfig?.model, (input.configGetter ?? getConfig)().attribution),
      webFetchAdapter,
      webSearchAdapter,
      taskAdapter: input.taskAdapter,
      taskAppendAdapter: input.taskAppendAdapter,
      taskControlAdapter: input.taskControlAdapter,
      memoryAdapter:
        input.memoryFacade &&
        input.memoryEnabled !== false &&
        !input.excludeAgentResources &&
        input.memoryAgentScopeEnabled === true &&
        (input.memoryReadEnabled !== false ||
          input.memoryWriteEnabled !== false)
          ? {
              execute: (ctx, toolInput) =>
                executeLocalMemoryTool(
                  input.memoryFacade!,
                  ctx,
                  toolInput,
                  input.emitBusEvent,
                  input.metrics,
                  input.memoryReadAgentNames,
                  {
                    readEnabled: input.memoryReadEnabled !== false,
                    writeEnabled: input.memoryWriteEnabled !== false,
                    agentScopeEnabled: input.memoryAgentScopeEnabled,
                  },
                ),
            }
          : undefined,
      alranAgentAdapter: input.alranAgentAdapter,
      alranCronAdapter: input.alranCronAdapter,
      alranMcpAdapter: input.alranMcpAdapter,
      alranSessionAdapter: input.alranSessionAdapter,
      websiteDeployAdapter: new LocalWebsiteDeployClient({
        ...(input.authContext ? { authContext: input.authContext } : {}),
        ...(input.dataDir ? { dataDir: input.dataDir } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        routingContextGetter: input.routingContextGetter,
      }),
      codeReviewAdapter: input.codeReviewAdapter,
    }).values(),
  ];
  const modelVisibleNativeTools = input.alranCronAdapter
    ? nativeTools
    : nativeTools.map(withoutLocalAlranCronGuidance);
  return filterLocalBuiltinCapabilityTools(
    modelVisibleNativeTools.map((tool) =>
      withLocalMemoryPolicyGuidance(tool, {
        readEnabled: input.memoryReadEnabled !== false,
        writeEnabled: input.memoryWriteEnabled !== false,
      }),
    ),
    capabilities,
  );
}

/**
 * Returns still-unmigrated product-domain tool sources before the v2
 * AgentRuntime applies model gates, MCP disclosure and final catalog ordering.
 */
export async function buildLocalTurnToolSources(
  input: LocalTurnToolSourcesInput,
): Promise<LocalTurnToolSources> {
  if (input.toolsDisabled) {
    return {
      nativeTools: [],
      mcpEntries: [],
      threadGoalTools: [],
      cuRuntimeAvailable: false,
    };
  }
  const cuRuntimeAvailable = input.cuModeActive === true;
  const builtinCapabilities =
    input.builtinCapabilities ?? resolveAgentCapabilities();
  const enableTaskControlTools =
    input.enableTaskControlTools ?? !!input.taskControlAdapter;
  // `task` and `task_append` are the same delegation entry point: a surface
  // that may not start a task may not continue one either.
  const delegationEntryPointsEnabled =
    input.enableTaskTool !== false && builtinCapabilities.features.delegation;
  const nativeTools = buildLocalNativeRuntimeTools({
    dataDir: input.dataDir,
    configGetter: input.configGetter,
    workspaceRoot: input.workspaceRoot,
    agentName: input.agentName,
    ...(input.excludeAgentResources ? { excludeAgentResources: true } : {}),
    ...(input.expectedAgentInstanceId
      ? { expectedAgentInstanceId: input.expectedAgentInstanceId }
      : {}),
    ...(input.skipAgentResolution ? { skipAgentResolution: true } : {}),
    eventWriter: input.eventWriter,
    askUserAdapter: buildLocalAskUserAdapter(input.questionnaireContext),
    bashAdapter: input.bashAdapter,
    sandboxOperationsFactory: input.sandboxOperationsFactory,
    authContext: input.authContext,
    routingContextGetter: input.routingContextGetter,
    fetchImpl: input.fetchImpl,
    webSearchEnabled: input.nativeWebSearchEnabled === true,
    taskAdapter: delegationEntryPointsEnabled ? input.taskAdapter : undefined,
    taskAppendAdapter: delegationEntryPointsEnabled
      ? input.taskAppendAdapter
      : undefined,
    taskControlAdapter: enableTaskControlTools
      ? input.taskControlAdapter
      : undefined,
    memoryFacade: input.memoryFacade,
    alranAgentAdapter: input.alranAgentAdapter,
    alranCronAdapter: input.alranCronAdapter,
    alranMcpAdapter: input.mcpService.createAlranAdapter(input.emitBusEvent),
    alranSessionAdapter: input.alranSessionAdapter,
    codeReviewAdapter: input.codeReviewAdapter,
    emitBusEvent: input.emitBusEvent,
    metrics: input.metrics,
    cuModeActive: cuRuntimeAvailable,
    ...(input.miniappAvailable === true ? { miniappAvailable: true } : {}),
    desktopCapabilities: input.desktopCapabilities,
    builtinCapabilities,
    memoryEnabled: input.memoryEnabled,
    memoryReadEnabled: input.memoryReadEnabled,
    memoryWriteEnabled: input.memoryWriteEnabled,
    memoryAgentScopeEnabled: input.memoryAgentScopeEnabled,
    memoryReadAgentNames: input.memoryReadAgentNames,
    ...(input.allowedSkillNames === undefined
      ? {}
      : { allowedSkillNames: input.allowedSkillNames }),
    ...(input.allowedExtensionSkillNames === undefined
      ? {}
      : { allowedExtensionSkillNames: input.allowedExtensionSkillNames }),
    disabledBuiltinSkillNames: input.disabledBuiltinSkillNames,
    resumeCodexAvailable: input.resumeCodexAvailable,
  });
  const gatedNativeTools =
    input.enableTodoWriteTool === false
      ? nativeTools.filter(
          (tool) => tool.def.name !== LocalTodoWriteToolDef.name,
        )
      : nativeTools;
  const allEntries = await input.mcpService.listToolEntriesForTurn({
    sessionId: input.sessionId,
    workspaceRoot: input.workspaceRoot,
    ...(input.authContext ? { authContext: input.authContext } : {}),
    routingContextGetter: input.routingContextGetter,
    emitBusEvent: input.emitBusEvent,
  });
  const selectedBuiltinMcpEntries =
    builtinCapabilities.builtinTools === undefined
      ? allEntries
      : allEntries.filter(
          (entry) =>
            entry.source !== "builtin-matrix" ||
            entry.tool.def.name === MatrixWebSearchToolDef.name ||
            builtinCapabilities.builtinTools!.includes(
              entry.tool.def.name as AgentBuiltinMcpToolId,
            ),
        );
  const selectedMcpEntries = builtinCapabilities.features.webSearch
    ? selectedBuiltinMcpEntries
    : selectedBuiltinMcpEntries.filter(
        (entry) =>
          !(
            entry.source === "builtin-matrix" &&
            entry.tool.def.name === MatrixWebSearchToolDef.name
          ),
      );
  const mcpEntries = selectedMcpEntries;
  const threadGoalTools = (await input.threadGoal.runtimeToolsFor(
    false,
    input.sessionId,
  )) as RuntimeTool[];
  return {
    nativeTools: gatedNativeTools as RuntimeTool[],
    mcpEntries,
    threadGoalTools,
    cuRuntimeAvailable,
  };
}
