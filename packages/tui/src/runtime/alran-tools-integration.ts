import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AlranBuildEnv, AlranRegion } from '@alran/config';
import {
  startAlranToolsAuthLeaseBroker,
  validateAlranToolsResource,
  type AlranToolsAuthLeaseBroker,
  type AlranToolsBuildEnv,
  type AlranToolsHostAuthSession,
  type AlranToolsHostLogger,
  type ValidatedAlranToolsResource,
} from '@alran/alran-tools-host';

import {
  activateTuiAlranToolsHostEnvironment,
  type TuiAlranToolsHostEnvironmentActivation,
} from '../cli/alran-tools-environment.js';

export type AlranToolsReadinessCategory =
  | 'disabled'
  | 'ready'
  | 'resource_unavailable'
  | 'broker_unavailable'
  | 'host_unavailable';

export interface AlranToolsReadiness {
  readonly requested: boolean;
  readonly ready: boolean;
  readonly category: AlranToolsReadinessCategory;
  readonly buildEnv: AlranToolsBuildEnv;
  readonly version?: string;
  ensureCommandPath(): void;
  dispose(): Promise<void>;
}

export interface PrepareTuiAlranToolsIntegrationOptions {
  requested: boolean;
  dataDir: string;
  buildEnv: AlranBuildEnv;
  region: AlranRegion;
  session: AlranToolsHostAuthSession;
  entryUrl: string;
  bedrockLane?: string;
  environment?: Record<string, string | undefined>;
  logger?: AlranToolsHostLogger;
}

export interface PrepareTuiAlranToolsIntegrationDependencies {
  validateResource?: typeof validateAlranToolsResource;
  startBroker?: typeof startAlranToolsAuthLeaseBroker;
  createRuntimeDir?: typeof createTuiAlranToolsRuntimeDir;
  removeRuntimeDir?: typeof removeTuiAlranToolsRuntimeDir;
  activateEnvironment?: typeof activateTuiAlranToolsHostEnvironment;
}

const NOOP_DISPOSE = async (): Promise<void> => undefined;
const NOOP = (): void => undefined;

export function resolveBundledAlranToolsResourceDir(
  entryUrl: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  if (environment.ALRAN_DEV_ALRAN_TOOLS_MODE === 'published') {
    const override = environment.ALRAN_DEV_ALRAN_TOOLS_RESOURCE_DIR?.trim();
    if (!override || !path.isAbsolute(override)) {
      throw new Error('ALRAN_DEV_ALRAN_TOOLS_RESOURCE_DIR must be an absolute path');
    }
    return path.normalize(override);
  }
  return path.join(path.dirname(fileURLToPath(entryUrl)), 'embedded', 'alran-tools');
}

export function resolveBundledAlranToolsCommandBinDir(entryUrl: string): string {
  return path.join(path.dirname(fileURLToPath(entryUrl)), 'internal-bin');
}

export async function prepareTuiAlranToolsIntegration(
  options: PrepareTuiAlranToolsIntegrationOptions,
  dependencies: PrepareTuiAlranToolsIntegrationDependencies = {},
): Promise<AlranToolsReadiness> {
  const buildEnv = normalizeAlranToolsHostBuildEnv(options.buildEnv);
  if (!options.requested) return inactiveReadiness(false, 'disabled', buildEnv);

  const logger = options.logger ?? { info: () => undefined, warn: () => undefined };
  const environment = options.environment ?? process.env;
  const removeRuntimeDir = dependencies.removeRuntimeDir ?? removeTuiAlranToolsRuntimeDir;
  let runtimeDir: string | undefined;
  let broker: AlranToolsAuthLeaseBroker | undefined;
  let activation: TuiAlranToolsHostEnvironmentActivation | undefined;
  try {
    const resource = (dependencies.validateResource ?? validateAlranToolsResource)({
      resourceDir: resolveBundledAlranToolsResourceDir(options.entryUrl, environment),
      expectedBuildEnv: buildEnv,
    });
    runtimeDir = await (dependencies.createRuntimeDir ?? createTuiAlranToolsRuntimeDir)();
    broker = await (dependencies.startBroker ?? startAlranToolsAuthLeaseBroker)({
      dataDir: runtimeDir,
      session: options.session,
      logger,
    });
    const configDir = path.join(options.dataDir, 'integrations', 'alran-tools', options.region);
    await ensurePrivateDirectory(configDir);
    activation = (dependencies.activateEnvironment ?? activateTuiAlranToolsHostEnvironment)(
      environment,
      {
        runtimeExecutable: process.execPath,
        brokerEndpoint: broker.endpoint,
        brokerCapabilityFile: broker.capabilityFile,
        configDir,
        region: options.region,
        commandBinDir: resolveBundledAlranToolsCommandBinDir(options.entryUrl),
        ...(options.bedrockLane ? { bedrockLane: options.bedrockLane } : {}),
      },
    );
    const readiness = activeReadiness({
      buildEnv,
      resource,
      broker,
      runtimeDir,
      removeRuntimeDir,
      activation,
    });
    logger.info(
      `alran-tools readiness category=${readiness.category} buildEnv=${buildEnv} region=${options.region} version=${resource.manifest.version}`,
    );
    return readiness;
  } catch (error) {
    activation?.restore();
    await broker?.dispose().catch(() => undefined);
    if (runtimeDir) await removeRuntimeDir(runtimeDir).catch(() => undefined);
    const category = classifyReadinessFailure(error);
    logger.warn(
      `alran-tools readiness category=${category} buildEnv=${buildEnv} region=${options.region}`,
    );
    return inactiveReadiness(true, category, buildEnv);
  }
}

export function normalizeAlranToolsHostBuildEnv(buildEnv: AlranBuildEnv): AlranToolsBuildEnv {
  return buildEnv === 'dev' ? 'test' : buildEnv;
}

export async function createTuiAlranToolsRuntimeDir(): Promise<string> {
  // macOS Unix-domain sockets have a short path limit. `/tmp` keeps the
  // process-private broker endpoint bounded even when the user's dataDir is long.
  const parent = process.platform === 'win32' ? tmpdir() : '/tmp';
  const runtimeDir = await mkdtemp(path.join(parent, `alran-tools-tui-${process.pid}-`));
  if (process.platform !== 'win32') await chmod(runtimeDir, 0o700);
  return runtimeDir;
}

export function removeTuiAlranToolsRuntimeDir(runtimeDir: string): Promise<void> {
  return rm(runtimeDir, { recursive: true, force: true });
}

function activeReadiness(options: {
  buildEnv: AlranToolsBuildEnv;
  resource: ValidatedAlranToolsResource;
  broker: AlranToolsAuthLeaseBroker;
  runtimeDir: string;
  removeRuntimeDir: (runtimeDir: string) => Promise<void>;
  activation: TuiAlranToolsHostEnvironmentActivation;
}): AlranToolsReadiness {
  let disposed = false;
  return {
    requested: true,
    ready: true,
    category: 'ready',
    buildEnv: options.buildEnv,
    version: options.resource.manifest.version,
    ensureCommandPath: options.activation.ensureCommandPath,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      options.activation.restore();
      const errors: unknown[] = [];
      try {
        await options.broker.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await options.removeRuntimeDir(options.runtimeDir);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'alran-tools TUI cleanup failed');
    },
  };
}

function inactiveReadiness(
  requested: boolean,
  category: Exclude<AlranToolsReadinessCategory, 'ready'>,
  buildEnv: AlranToolsBuildEnv,
): AlranToolsReadiness {
  return {
    requested,
    ready: false,
    category,
    buildEnv,
    ensureCommandPath: NOOP,
    dispose: NOOP_DISPOSE,
  };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
}

function classifyReadinessFailure(
  error: unknown,
): Exclude<AlranToolsReadinessCategory, 'disabled' | 'ready'> {
  if (isErrorCode(error, 'EADDRINUSE')) return 'broker_unavailable';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    [
      'manifest',
      'resource',
      'sha256',
      'build environment',
      'package mismatch',
      'embedded cli',
    ].some((needle) => message.includes(needle))
  ) {
    return 'resource_unavailable';
  }
  if (message.includes('broker') || message.includes('socket') || message.includes('named pipe')) {
    return 'broker_unavailable';
  }
  return 'host_unavailable';
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code,
  );
}
