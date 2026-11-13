import {
  ALRAN_CODE_SUPPORTED_NODE_VERSIONS,
  ALRAN_CODE_VERSION,
  supportsTuiNodeVersion,
} from '../build-info.js';
import type { RawTuiExecOptions } from '../headless/invocation.js';
import type { AlranRegion } from '@alran/config';
import { createTuiProgram, type TuiInteractiveLaunchRequest } from './program.js';
import type { AlranProviderCliRequest } from './provider-command.js';
import type { AlranPluginCliRequest, AlranSkillCliRequest } from '../plugin/contract.js';
import { tuiErrorDiagnostic } from '../user-facing-failure.js';
import { configureTuiNetworkProxy } from './network-proxy.js';
import { consumeLoginRestartHandoff } from '../tui/login-restart-handoff.js';
import type { SystemPromptOverrides } from './system-prompt-options.js';
import type { AlranTelemetryCliAction } from './telemetry-command.js';

const OUTPUT_DRAIN_TIMEOUT_MS = 250;
const ALRAN_CODE_PROCESS_TITLE = 'alran-code';

export interface TuiOutputStream {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  write(value: string, callback?: (error?: Error | null) => void): unknown;
  once?(event: 'error', listener: (error: Error) => void): unknown;
  off?(event: 'error', listener: (error: Error) => void): unknown;
}

export interface TuiCliProcess {
  title: string;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly versions: { readonly node: string };
  readonly stdout: TuiOutputStream;
  readonly stderr: TuiOutputStream;
  exitCode?: number | string;
  exit(code: number): unknown;
}

interface LaunchTuiInput extends TuiInteractiveLaunchRequest {
  readonly version: string;
}

export interface RunTuiCliDependencies {
  readonly processRef?: TuiCliProcess;
  readonly platform?: NodeJS.Platform;
  readonly createProgram?: typeof createTuiProgram;
  readonly supportsNodeVersion?: (version: string) => boolean;
  readonly launchTui?: (input: LaunchTuiInput) => Promise<void>;
  readonly runExec?: (
    prompt: string | undefined,
    options: RawTuiExecOptions,
    version: string,
  ) => Promise<void>;
  readonly runAcp?: (
    version: string,
    lane?: string,
    systemPromptOverrides?: SystemPromptOverrides,
  ) => Promise<void>;
  readonly runLogin?: (
    region?: AlranRegion,
    openBrowser?: boolean,
    lane?: string,
    provider?: 'api-key' | 'keycloak' | 'platform',
    platformEnv?: 'dev' | 'prod',
  ) => Promise<string>;
  readonly runLogout?: (region?: AlranRegion) => Promise<string>;
  readonly runUpdate?: (version: string) => Promise<void>;
  readonly runProvider?: (
    request: AlranProviderCliRequest,
    version: string,
    lane?: string,
  ) => Promise<string>;
  readonly runPlugin?: (
    request: AlranPluginCliRequest,
    version: string,
    lane?: string,
  ) => Promise<string>;
  readonly runSkills?: (request: AlranSkillCliRequest) => Promise<string>;
  readonly runTelemetry?: (
    action: AlranTelemetryCliAction,
    version: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<string> | string;
  readonly configureNetworkProxy?: typeof configureTuiNetworkProxy;
  readonly allowStartupEnvironmentSelection?: boolean;
  readonly outputDrainTimeoutMs?: number;
}

export async function runTuiCli(dependencies: RunTuiCliDependencies = {}): Promise<void> {
  const processRef = dependencies.processRef ?? process;
  processRef.title = ALRAN_CODE_PROCESS_TITLE;
  const resumeDraftAfterLogin = consumeLoginRestartHandoff(processRef.env);
  const supportsNodeVersion =
    dependencies.supportsNodeVersion ?? ((version: string) => supportsTuiNodeVersion(version));
  if (!supportsNodeVersion(processRef.versions.node)) {
    processRef.stderr.write(
      `Alran Code supports Node.js ${ALRAN_CODE_SUPPORTED_NODE_VERSIONS}; current version is ${processRef.versions.node}.\n`,
    );
    processRef.exitCode = 1;
    return;
  }

  let completedCommandExitMode: 'force' | 'natural' | undefined;
  try {
    (dependencies.configureNetworkProxy ?? configureTuiNetworkProxy)({
      environment: processRef.env,
      writeWarning: (message) => processRef.stderr.write(`${message}\n`),
    });
    const createProgram = dependencies.createProgram ?? createTuiProgram;
    await createProgram({
      version: ALRAN_CODE_VERSION,
      allowStartupEnvironmentSelection: dependencies.allowStartupEnvironmentSelection,
      launchTui: async ({
        initialPrompt,
        model,
        sessionId,
        showSessionPicker,
        continueLatestSession,
        workspaceDir,
        tuiMode,
        contextMode,
        ptc,
        lane,
        systemPromptOverrides,
      }) => {
        const launchTui = dependencies.launchTui ?? defaultLaunchTui;
        await launchTui({
          version: ALRAN_CODE_VERSION,
          ...(initialPrompt ? { initialPrompt } : {}),
          ...(model ? { model } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(showSessionPicker ? { showSessionPicker: true } : {}),
          ...(continueLatestSession ? { continueLatestSession: true } : {}),
          ...(workspaceDir ? { workspaceDir } : {}),
          ...(tuiMode ? { tuiMode } : {}),
          ...(contextMode ? { contextMode } : {}),
          ...(ptc ? { ptc: true } : {}),
          ...(lane ? { lane } : {}),
          ...(systemPromptOverrides ? { systemPromptOverrides } : {}),
          ...(resumeDraftAfterLogin ? { resumeDraftAfterLogin: true } : {}),
        });
        completedCommandExitMode = 'force';
      },
      runExec: async (prompt, commandOptions, lane) => {
        const runExec = dependencies.runExec ?? defaultRunExec;
        await runExec(
          prompt,
          lane ? { ...commandOptions, lane } : commandOptions,
          ALRAN_CODE_VERSION,
        );
        completedCommandExitMode = 'natural';
      },
      runAcp: async (lane, systemPromptOverrides) => {
        const runAcp = dependencies.runAcp ?? defaultRunAcp;
        await (systemPromptOverrides
          ? runAcp(ALRAN_CODE_VERSION, lane, systemPromptOverrides)
          : runAcp(ALRAN_CODE_VERSION, lane));
        completedCommandExitMode = 'natural';
      },
      runLogin: async (region, openBrowser, lane, provider, platformEnv) => {
        const runLogin = dependencies.runLogin ?? defaultRunLogin;
        processRef.stdout.write(`${await runLogin(region, openBrowser, lane, provider, platformEnv)}\n`);
        completedCommandExitMode = 'natural';
      },
      runLogout: async (region) => {
        const runLogout = dependencies.runLogout ?? defaultRunLogout;
        processRef.stdout.write(`${await runLogout(region)}\n`);
        completedCommandExitMode = 'natural';
      },
      runUpdate: async () => {
        completedCommandExitMode = 'natural';
        const runUpdate = dependencies.runUpdate ?? defaultRunUpdate;
        await runUpdate(ALRAN_CODE_VERSION);
      },
      runProvider: async (request, lane) => {
        const runProvider = dependencies.runProvider ?? defaultRunProvider;
        processRef.stdout.write(`${await runProvider(request, ALRAN_CODE_VERSION, lane)}\n`);
        completedCommandExitMode = 'natural';
      },
      runPlugin: async (request, lane) => {
        const runPlugin = dependencies.runPlugin ?? defaultRunPlugin;
        processRef.stdout.write(`${await runPlugin(request, ALRAN_CODE_VERSION, lane)}\n`);
        completedCommandExitMode = 'natural';
      },
      runSkills: async (request) => {
        const runSkills = dependencies.runSkills ?? defaultRunSkills;
        processRef.stdout.write(`${await runSkills(request)}\n`);
        completedCommandExitMode = 'natural';
      },
      runTelemetry: async (action) => {
        const runTelemetry = dependencies.runTelemetry ?? defaultRunTelemetry;
        processRef.stdout.write(await runTelemetry(action, ALRAN_CODE_VERSION, processRef.env));
        completedCommandExitMode = 'natural';
      },
    }).parseAsync(processRef.argv, { from: 'node' });

    if (completedCommandExitMode) {
      const exitCode = typeof processRef.exitCode === 'number' ? processRef.exitCode : 0;
      await Promise.all([
        drainTuiOutput(
          processRef.stdout,
          dependencies.outputDrainTimeoutMs ?? OUTPUT_DRAIN_TIMEOUT_MS,
        ),
        drainTuiOutput(
          processRef.stderr,
          dependencies.outputDrainTimeoutMs ?? OUTPUT_DRAIN_TIMEOUT_MS,
        ),
      ]);
      if (
        (dependencies.platform ?? process.platform) === 'win32' &&
        completedCommandExitMode === 'natural'
      ) {
        processRef.exitCode = exitCode;
      } else {
        processRef.exit(exitCode);
      }
    }
  } catch (error) {
    processRef.stderr.write(`${await formatTuiCliError(error)}\n`);
    processRef.exitCode = 1;
  }
}

async function formatTuiCliError(error: unknown): Promise<string> {
  const diagnostic = tuiErrorDiagnostic(error);
  if (
    !/better[-_]sqlite3/iu.test(diagnostic) ||
    !/Could not locate the bindings file|Cannot find (?:module|package)|NODE_MODULE_VERSION|Module did not self-register/iu.test(
      diagnostic,
    )
  ) {
    return diagnostic;
  }

  const { buildAlranPackageManagerCommand, resolveAlranNpmPrefixInstall } =
    await import('../update/install-source.js');
  if (resolveAlranNpmPrefixInstall()) {
    return [
      'Alran could not load its native SQLite dependency.',
      'The Node runtime recorded by this installation no longer loads it (for example after a Homebrew Node upgrade).',
      'Reinstall with the original installer to repair this installation.',
      '',
      `Original error: ${diagnostic}`,
    ].join('\n');
  }
  const command = buildAlranPackageManagerCommand('npm-global', ALRAN_CODE_VERSION);
  return [
    'Alran could not load its native SQLite dependency.',
    'If npm reported blocked install scripts, the installation needs explicit script approval.',
    'Reinstall with the original installer. For npm installations, run:',
    `  ${command.display} --foreground-scripts`,
    '',
    `Original error: ${diagnostic}`,
  ].join('\n');
}

export function drainTuiOutput(stream: TuiOutputStream, timeoutMs: number): Promise<void> {
  if (stream.destroyed || stream.writableEnded) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onError = () => finish(true);
    const finish = (awaitingErrorEvent = false) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (!awaitingErrorEvent) stream.off?.('error', onError);
      resolve();
    };
    timeout = setTimeout(finish, timeoutMs);
    timeout.unref?.();
    stream.once?.('error', onError);
    try {
      stream.write('', (error) => finish(Boolean(error)));
    } catch {
      finish();
    }
  });
}

async function defaultLaunchTui(input: LaunchTuiInput): Promise<void> {
  const { launchTui } = await import('../tui/launcher.js');
  await launchTui(input);
}

async function defaultRunExec(
  prompt: string | undefined,
  options: RawTuiExecOptions,
  version: string,
): Promise<void> {
  const { runTuiExecCommand } = await import('./run-exec-command.js');
  await runTuiExecCommand(prompt, options, version);
}

async function defaultRunAcp(
  version: string,
  lane?: string,
  systemPromptOverrides?: SystemPromptOverrides,
): Promise<void> {
  const { runTuiAcpCommand } = await import('./run-acp-command.js');
  await (systemPromptOverrides
    ? runTuiAcpCommand(version, {}, lane, systemPromptOverrides)
    : runTuiAcpCommand(version, {}, lane));
}

async function defaultRunLogin(
  region?: AlranRegion,
  openBrowser = true,
  lane?: string,
  provider: 'api-key' | 'keycloak' | 'platform' = 'platform',
  platformEnv?: 'dev' | 'prod',
): Promise<string> {
  const { runTuiLogin } = await import('./auth-command.js');
  return runTuiLogin({ region, openBrowser, lane, provider, platformEnv });
}

async function defaultRunLogout(_region?: AlranRegion): Promise<string> {
  // The same sign-out as `alran auth logout`: the session is revoked at the Platform first, then
  // every local credential is removed. The message is printed by the caller.
  const { defaultAccountCommandIo, runAuthLogout } = await import('./account-commands.js');
  const io = defaultAccountCommandIo();
  await runAuthLogout({ ...io, out: () => undefined });
  return 'Logged out.';
}

async function defaultRunUpdate(version: string): Promise<void> {
  const { runAlranUpdate } = await import('./update.js');
  await runAlranUpdate(version);
}

async function defaultRunProvider(
  request: AlranProviderCliRequest,
  version: string,
  lane?: string,
): Promise<string> {
  const { runAlranProviderCommand } = await import('./provider-command.js');
  return runAlranProviderCommand({ request, version, lane });
}

async function defaultRunPlugin(
  request: AlranPluginCliRequest,
  version: string,
  lane?: string,
): Promise<string> {
  const { runAlranPluginCommand } = await import('./plugin-command.js');
  return runAlranPluginCommand({ request, version, lane });
}

async function defaultRunSkills(request: AlranSkillCliRequest): Promise<string> {
  const { runAlranSkillCommand } = await import('./skills-command.js');
  return runAlranSkillCommand({ request });
}

async function defaultRunTelemetry(
  action: AlranTelemetryCliAction,
  version: string,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const { runAlranTelemetryCommand } = await import('./telemetry-command.js');
  return runAlranTelemetryCommand(action, version, { environment });
}
