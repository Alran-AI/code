import type { AlranBuildEnv, AlranRegion } from '@alran/config';
import {
  resolveAlranOAuthEndpointConfig,
  type AlranOAuthEndpointEnvironment,
} from '@alran/oauth-core';

import { createAlranSharedAuthSession } from '../runtime/auth-session.js';
import { AlranAuthApplication, type AlranAuthApplicationOptions } from './application.js';
import { resolveAlranAuthEnvironment } from './environment.js';
import { writeTuiRegionPreference } from './region-preference.js';

export interface CreateDefaultAlranAuthApplicationOptions {
  dataDir: string;
  region?: AlranRegion;
  buildEnv?: AlranBuildEnv;
  oauthEndpointEnvironment?: AlranOAuthEndpointEnvironment;
  createSharedSession?: typeof createAlranSharedAuthSession;
  telemetry?: AlranAuthApplicationOptions['telemetry'];
  telemetrySource?: AlranAuthApplicationOptions['telemetrySource'];
  writeRegionPreference?: AlranAuthApplicationOptions['writeRegionPreference'];
  sharedAuthCore?: AlranAuthApplicationOptions['sharedAuthCore'];
}

export function createDefaultAlranAuthApplication(
  options: CreateDefaultAlranAuthApplicationOptions,
): AlranAuthApplication {
  const environment = resolveAlranAuthEnvironment({
    runtimeRegion: options.region,
    runtimeBuildEnv: options.buildEnv,
  });
  const region = options.region ?? environment.region;
  const buildEnv = options.buildEnv ?? environment.buildEnv;
  const applicationOptions = {
    dataDir: options.dataDir,
    region,
    buildEnv,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.telemetrySource ? { telemetrySource: options.telemetrySource } : {}),
    writeRegionPreference: options.writeRegionPreference ?? writeTuiRegionPreference,
  } satisfies Omit<AlranAuthApplicationOptions, 'sharedAuthCore'>;
  const createSharedAuthCore = (requestedRegion: AlranRegion) =>
    (options.createSharedSession ?? createAlranSharedAuthSession)({
      dataDir: options.dataDir,
      region: requestedRegion,
      buildEnv,
      oauthEndpoints: resolveAlranOAuthEndpointConfig(
        options.oauthEndpointEnvironment ?? process.env,
        { buildEnv, region: requestedRegion },
      ),
    });
  const sharedAuthCore = options.sharedAuthCore ?? createSharedAuthCore(region);
  return new AlranAuthApplication({
    ...applicationOptions,
    sharedAuthCore,
    resolveSharedAuthCore: createSharedAuthCore,
  });
}
