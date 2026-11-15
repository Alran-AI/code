import {
  clearStoredPlatformSession,
  getRuntimeRegion,
  platformEnvironmentOrder,
  resolveOttiliApiKeyConsoleUrlFor,
  resolvePlatformEnvironmentForBuild,
  resolveStoredPlatformSession,
} from '@alran/config';
import type { AlranBuildEnv, AlranRegion } from '@alran/config';
import type {
  AuthStatusSnapshot,
  DeviceAuthorizationPrompt,
  LoginOptions,
  LoginResult,
  LogoutResult,
} from '@alran/oauth-core';
import { resolvePlatformBaseUrl } from '@alran/oauth-core';
import { runTuiLogin } from '../cli/auth-command.js';

import type {
  AlranBusinessEventMap,
  AlranBusinessTelemetry,
  AlranLoginFailReason,
  AlranLoginSource,
} from '../analytics/business-telemetry.js';
import { resolveAlranAuthEnvironment } from './environment.js';
import { clearOttiliApiKey, loginWithOttiliApiKey } from './ottili-api-key.js';

export type AlranAuthProgress = {
  readonly state: 'device-authorization';
} & DeviceAuthorizationPrompt;

export interface AlranAuthResult {
  readonly state: 'already-authenticated' | 'authenticated' | 'already-signed-out' | 'signed-out';
  readonly message: string;
  readonly restartRequired?: boolean;
  readonly logoutUrl?: string;
}

export interface AlranAuthPort {
  /**
   * Sign in to the Ottili AI Platform.
   *
   * `platformEnv` defaults to the environment this build targets: `dev` (a
   * local Platform and gateway) everywhere except a production build, which
   * signs in against the real `ottili.one` endpoints.
   */
  login(
    onProgress?: (progress: AlranAuthProgress) => void,
    region?: AlranRegion,
    provider?: 'api-key' | 'keycloak' | 'platform',
    platformEnv?: 'dev' | 'prod',
  ): Promise<AlranAuthResult>;
  /** Sign in by storing an Ottili API key minted in the Platform console. */
  loginWithApiKey(apiKey: string): Promise<AlranAuthResult>;
  logout(): Promise<AlranAuthResult>;
}

export interface AlranSharedAuthCore {
  getStatus(): Promise<AuthStatusSnapshot>;
  login(options?: LoginOptions): Promise<LoginResult>;
  logout(options: { revoke: boolean }): Promise<LogoutResult>;
}

export interface AlranAuthApplicationOptions {
  readonly dataDir: string;
  readonly sharedAuthCore: AlranSharedAuthCore;
  readonly resolveSharedAuthCore?: (region: AlranRegion) => AlranSharedAuthCore;
  readonly region?: AlranRegion;
  readonly buildEnv?: AlranBuildEnv;
  readonly telemetry?: AlranBusinessTelemetry;
  readonly telemetrySource?: AlranLoginSource;
  readonly writeRegionPreference?: (
    dataDir: string,
    preference: { region: AlranRegion; buildEnv: AlranBuildEnv },
  ) => unknown;
}

export class AlranAuthApplication implements AlranAuthPort {
  private readonly scope: { region: AlranRegion; buildEnv: AlranBuildEnv };

  constructor(private readonly options: AlranAuthApplicationOptions) {
    const environment = resolveAlranAuthEnvironment({ runtimeRegion: getRuntimeRegion() });
    this.scope = {
      region: options.region ?? environment.region,
      buildEnv: options.buildEnv ?? environment.buildEnv,
    };
  }

  async login(
    onProgress?: (progress: AlranAuthProgress) => void,
    region: AlranRegion = this.scope.region,
    provider: 'api-key' | 'keycloak' | 'platform' = 'platform',
    platformEnv?: 'dev' | 'prod',
  ): Promise<AlranAuthResult> {
    if (provider === 'platform') {
      return this.loginPlatform(platformEnv ?? resolvePlatformEnvForBuild(this.scope.buildEnv));
    }
    this.track('login_click', {});
    try {
      const requestedScope = { ...this.scope, region };
      const switchesRegion = !isSameScope(requestedScope, this.scope);
      let sharedAuthCore = this.options.sharedAuthCore;
      if (switchesRegion) {
        if (!this.options.resolveSharedAuthCore) {
          throw new Error(formatEnvironmentConflict(this.scope, requestedScope));
        }
        sharedAuthCore = this.options.resolveSharedAuthCore(region);
      }
      const wasAuthenticated = (await sharedAuthCore.getStatus()).status === 'authenticated';
      let deviceFlowStarted = false;
      await sharedAuthCore.login({
        onDeviceAuthorization: (authorization: DeviceAuthorizationPrompt) => {
          deviceFlowStarted = true;
          onProgress?.({ state: 'device-authorization', ...authorization });
        },
      });
      this.persistRegionPreference(requestedScope);
      const alreadyAuthenticated = wasAuthenticated && !deviceFlowStarted;
      const result = {
        state: alreadyAuthenticated
          ? ('already-authenticated' as const)
          : ('authenticated' as const),
        message: alreadyAuthenticated
          ? switchesRegion
            ? `Already signed in with ${formatRegion(requestedScope.region)}.`
            : 'Already signed in with Alran.'
          : switchesRegion
            ? `Signed in with ${formatRegion(requestedScope.region)}.`
            : 'Signed in with Alran.',
        ...(switchesRegion ? { restartRequired: true as const } : {}),
      };
      this.trackLoginResult('1', '');
      return result;
    } catch (error) {
      this.trackLoginResult('2', classifyLoginFailure(error));
      throw error;
    }
  }

  /** Sign in through the Ottili Platform (Keycloak OIDC). */
  async loginPlatform(
    platformEnv: 'dev' | 'prod' = resolvePlatformEnvForBuild(this.scope.buildEnv),
  ): Promise<AlranAuthResult> {
    this.track('login_click', {});
    try {
      const message = await runTuiLogin({
        provider: 'platform',
        platformEnv,
        openBrowser: true,
        writeError: (value: string) => process.stderr.write(value),
      });
      return { state: 'authenticated', message };
    } catch (error) {
      this.trackLoginResult('2', classifyLoginFailure(error));
      throw error;
    }
  }

  /**
   * Sign in with an Ottili API key minted in the Platform console.
   *
   * Unlike the Platform OIDC flow this opens no browser. The key is checked against the AI Platform
   * (`GET /v1/models`) before "Signed in" is said: a key the platform refuses is not saved, and a platform
   * that cannot answer is reported as unconfirmed rather than as success.
   */
  async loginWithApiKey(apiKey: string): Promise<AlranAuthResult> {
    this.track('login_click', {});
    try {
      const result = await loginWithOttiliApiKey({
        readApiKey: async () => apiKey,
        openBrowser: false,
        consoleUrl: resolveOttiliApiKeyConsoleUrlFor(
          resolvePlatformBaseUrl(resolvePlatformEnvForBuild(this.scope.buildEnv)),
        ),
        writeError: () => undefined,
      });
      this.trackLoginResult('1', '');
      return { state: 'authenticated', message: result.message };
    } catch (error) {
      this.trackLoginResult('2', classifyLoginFailure(error));
      throw error;
    }
  }

  async logout(): Promise<AlranAuthResult> {
    this.track('logout_click', {});

    let status: AuthStatusSnapshot | undefined;
    try {
      status = await this.options.sharedAuthCore.getStatus();
    } catch {
      // Continue with local sign-out even when the auth store is unavailable.
    }

    const platformEnv = resolvePlatformEnvironmentForBuild(this.scope.buildEnv);
    const hadPlatformSession =
      resolveStoredPlatformSession(this.options.dataDir, platformEnv) !== null;

    // Always clear local credentials so sign-out works offline and cannot leave
    // a usable Platform session or Ottili API key behind.
    for (const env of platformEnvironmentOrder(platformEnv)) {
      clearStoredPlatformSession(this.options.dataDir, env);
    }
    try {
      await clearOttiliApiKey();
    } catch {
      // Local sign-out must stay recoverable even if the config cannot be updated.
    }

    let sharedResult: LogoutResult | undefined;
    try {
      // Best-effort server revocation for managed OAuth credentials; local
      // sign-out above must not depend on network access.
      sharedResult = await this.options.sharedAuthCore.logout({ revoke: true });
    } catch {
      sharedResult = undefined;
    }

    const wasSignedIn =
      hadPlatformSession ||
      status?.status === 'authenticated' ||
      sharedResult?.status === 'logout_pending';

    if (
      !wasSignedIn &&
      status?.status === 'anonymous' &&
      sharedResult?.status === 'anonymous'
    ) {
      return {
        state: 'already-signed-out',
        message: 'Already signed out of Alran.',
      };
    }

    return {
      state: 'signed-out',
      message:
        sharedResult?.status === 'logout_pending'
          ? `Signed out locally from ${formatRegion(this.scope.region)}. Server revocation is pending until the network recovers.`
          : `Signed out of ${formatRegion(this.scope.region)} on this device.`,
    };
  }

  private trackLoginResult(resultType: '1' | '2', failReason: AlranLoginFailReason): void {
    this.track('login_result', {
      source: this.options.telemetrySource ?? 'alran_cli',
      result_type: resultType,
      fail_reason: failReason,
      login_type: 'alran_oauth',
    });
  }

  private persistRegionPreference(scope: { region: AlranRegion; buildEnv: AlranBuildEnv }): void {
    try {
      this.options.writeRegionPreference?.(this.options.dataDir, scope);
    } catch {
      // Region persistence must not invalidate an already completed OAuth login.
    }
  }

  private track<Event extends 'login_click' | 'logout_click' | 'login_result'>(
    event: Event,
    properties: AlranBusinessEventMap[Event],
  ): void {
    try {
      this.options.telemetry?.track(event, properties);
    } catch {
      // Business telemetry must not affect authentication.
    }
  }
}

function classifyLoginFailure(error: unknown): AlranLoginFailReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/iu.test(message)) return '3';
  if (/network|offline|fetch|ECONN|ENOTFOUND|ETIMEDOUT/iu.test(message)) return '2';
  if (/oauth|authorization|login failed|invalid login state/iu.test(message)) return '5';
  if (/server|HTTP 5\d\d/iu.test(message)) return '1';
  return '4';
}

function isSameScope(
  left: { region: AlranRegion; buildEnv: AlranBuildEnv },
  right: { region: AlranRegion; buildEnv: AlranBuildEnv },
): boolean {
  return left.region === right.region && left.buildEnv === right.buildEnv;
}

function formatEnvironmentConflict(
  active: { region: AlranRegion; buildEnv: AlranBuildEnv },
  requested: { region: AlranRegion; buildEnv: AlranBuildEnv },
): string {
  if (active.region !== requested.region) {
    return `Signed in to ${formatRegion(active.region)}. Run \`alran logout\` before signing in to ${formatRegion(requested.region)}.`;
  }
  return `Signed in to another Alran ${active.buildEnv} environment. Run \`alran logout\` before signing in to ${requested.buildEnv}.`;
}

function formatRegion(region: AlranRegion): string {
  return region === 'cn' ? 'Alran China' : 'Alran Global';
}

/**
 * Which Platform the sign-in talks to. Only a production build signs in
 * against the real `ottili.one` endpoints; every development, test, and
 * staging build stays on the local Platform.
 */
export function resolvePlatformEnvForBuild(buildEnv: AlranBuildEnv): 'dev' | 'prod' {
  return resolvePlatformEnvironmentForBuild(buildEnv);
}
