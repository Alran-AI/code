import {
  installAlranToolsLauncher,
  removeAlranToolsLaunchers,
  validateAlranToolsResource,
  type AlranToolsBuildEnv,
  type AlranToolsRegion,
} from './resource.js';
import { startAlranToolsAuthLeaseBroker, type AlranToolsAuthLeaseBroker } from './lease-broker.js';
import type { AlranToolsHostAuthSession, AlranToolsHostLogger } from './contracts.js';

export interface StartAlranToolsHostIntegrationOptions {
  dataDir: string;
  resourceDir: string;
  expectedBuildEnv: AlranToolsBuildEnv;
  executable: string;
  platform: NodeJS.Platform;
  region: AlranToolsRegion;
  bedrockLane?: string;
  session: AlranToolsHostAuthSession;
  logger?: AlranToolsHostLogger;
}

export interface ActiveAlranToolsHostIntegration {
  readonly launcherPath: string;
  readonly brokerEndpoint: string;
  readonly packageName: string;
  readonly version: string;
  dispose(): Promise<void>;
}

export interface AlranToolsHostIntegrationDependencies {
  validateResource: typeof validateAlranToolsResource;
  startBroker: typeof startAlranToolsAuthLeaseBroker;
  installLauncher: typeof installAlranToolsLauncher;
  removeLaunchers: typeof removeAlranToolsLaunchers;
}

const DEFAULT_DEPENDENCIES: AlranToolsHostIntegrationDependencies = {
  validateResource: validateAlranToolsResource,
  startBroker: startAlranToolsAuthLeaseBroker,
  installLauncher: installAlranToolsLauncher,
  removeLaunchers: removeAlranToolsLaunchers,
};

export async function startAlranToolsHostIntegration(
  options: StartAlranToolsHostIntegrationOptions,
  dependencies: AlranToolsHostIntegrationDependencies = DEFAULT_DEPENDENCIES,
): Promise<ActiveAlranToolsHostIntegration> {
  const resource = dependencies.validateResource({
    resourceDir: options.resourceDir,
    expectedBuildEnv: options.expectedBuildEnv,
  });
  const broker = await dependencies.startBroker({
    dataDir: options.dataDir,
    session: options.session,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  try {
    const installed = await dependencies.installLauncher({
      resourceDir: options.resourceDir,
      expectedBuildEnv: options.expectedBuildEnv,
      dataDir: options.dataDir,
      executable: options.executable,
      platform: options.platform,
      region: options.region,
      ...(options.bedrockLane ? { bedrockLane: options.bedrockLane } : {}),
      brokerEndpoint: broker.endpoint,
      brokerCapabilityFile: broker.capabilityFile,
    });
    return activeIntegration(options, dependencies, broker, installed.launcherPath, resource);
  } catch (error) {
    let cleanupError: unknown;
    try {
      dependencies.removeLaunchers(options.dataDir, options.region);
    } catch (cause) {
      cleanupError = cause;
    }
    try {
      await broker.dispose();
    } catch (cause) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, cause], 'alran-tools startup cleanup failed')
        : cause;
    }
    if (cleanupError) {
      throw new AggregateError([error, cleanupError], 'alran-tools host integration failed');
    }
    throw error;
  }
}

function activeIntegration(
  options: StartAlranToolsHostIntegrationOptions,
  dependencies: AlranToolsHostIntegrationDependencies,
  broker: AlranToolsAuthLeaseBroker,
  launcherPath: string,
  resource: ReturnType<typeof validateAlranToolsResource>,
): ActiveAlranToolsHostIntegration {
  let disposed = false;
  return {
    launcherPath,
    brokerEndpoint: broker.endpoint,
    packageName: resource.manifest.packageName,
    version: resource.manifest.version,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      let launcherError: unknown;
      try {
        dependencies.removeLaunchers(options.dataDir, options.region);
      } catch (error) {
        launcherError = error;
      }
      try {
        await broker.dispose();
      } catch (error) {
        if (launcherError) {
          throw new AggregateError([launcherError, error], 'alran-tools cleanup failed');
        }
        throw error;
      }
      if (launcherError) throw launcherError;
    },
  };
}
