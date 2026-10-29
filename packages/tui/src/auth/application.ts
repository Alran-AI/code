import type { MavisBuildEnv, MavisRegion } from '@mavis/config';
import type {
  AuthStatusSnapshot,
  DeviceAuthorizationPrompt,
  LoginOptions,
  LoginResult,
  LogoutResult,
} from '@mavis/oauth-core';
import { runTuiLogin } from '../cli/auth-command.js';

import type {
  AlranBusinessEventMap,
  AlranBusinessTelemetry,
  AlranLoginFailReason,
  AlranLoginSource,
} from '../analytics/business-telemetry.js';
import { resolveAlranAuthEnvironment } from './environment.js';
import { buildAlranLogoutUrl } from './logout-url.js';

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
  login(
    onProgress?: (progress: AlranAuthProgress) => void,
    region?: MavisRegion,
    provider?: 'api-key' | 'keycloak' | 'platform',
    platformEnv?: 'dev' | 'prod',
  ): Promise<AlranAuthResult>;
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
  readonly resolveSharedAuthCore?: (region: MavisRegion) => AlranSharedAuthCore;
  readonly region?: MavisRegion;
  readonly buildEnv?: MavisBuildEnv;
  readonly telemetry?: AlranBusinessTelemetry;
  readonly telemetrySource?: AlranLoginSource;
  readonly writeRegionPreference?: (
    dataDir: string,
    preference: { region: MavisRegion; buildEnv: MavisBuildEnv },
  ) => unknown;
}

export class AlranAuthApplication implements AlranAuthPort {
  private readonly scope: { region: MavisRegion; buildEnv: MavisBuildEnv };

  constructor(private readonly options: AlranAuthApplicationOptions) {
    const environment = resolveAlranAuthEnvironment({
      runtimeRegion: process.env.MAVIS_REGION === 'en' ? 'en' : 'cn',
    });
    this.scope = {
      region: options.region ?? environment.region,
      buildEnv: options.buildEnv ?? environment.buildEnv,
    };
  }

  async login(
    onProgress?: (progress: AlranAuthProgress) => void,
    region: MavisRegion = this.scope.region,
    provider: 'api-key' | 'keycloak' | 'platform' = 'platform',
    platformEnv: 'dev' | 'prod' = 'prod',
  ): Promise<AlranAuthResult> {
    if (provider === 'platform') {
      return this.loginPlatform(platformEnv);
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
    platformEnv: 'dev' | 'prod' = 'prod',
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

  async logout(): Promise<AlranAuthResult> {
    this.track('logout_click', {});
    const status = await this.options.sharedAuthCore.getStatus();
    // Always run the shared logout: signing out while already signed out is a
    // safe no-op in the core, and never blocking /logout keeps a wedged local
    // state recoverable.
    const result = await this.options.sharedAuthCore.logout({ revoke: true });
    const logoutUrl = buildAlranLogoutUrl(this.scope);
    if (status.status === 'anonymous' && result.status === 'anonymous') {
      return { state: 'already-signed-out', message: 'Already signed out of Alran.', logoutUrl };
    }
    return {
      state: 'signed-out',
      logoutUrl,
      message:
        result.status === 'logout_pending'
          ? `Signed out locally from ${formatRegion(this.scope.region)} across Alran. Server revocation is pending until the network recovers.`
          : `Signed out of ${formatRegion(this.scope.region)} on Desktop, CLI/TUI, and embedded alran-tools.`,
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

  private persistRegionPreference(scope: { region: MavisRegion; buildEnv: MavisBuildEnv }): void {
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
  left: { region: MavisRegion; buildEnv: MavisBuildEnv },
  right: { region: MavisRegion; buildEnv: MavisBuildEnv },
): boolean {
  return left.region === right.region && left.buildEnv === right.buildEnv;
}

function formatEnvironmentConflict(
  active: { region: MavisRegion; buildEnv: MavisBuildEnv },
  requested: { region: MavisRegion; buildEnv: MavisBuildEnv },
): string {
  if (active.region !== requested.region) {
    return `Signed in to ${formatRegion(active.region)}. Run \`alran logout\` before signing in to ${formatRegion(requested.region)}.`;
  }
  return `Signed in to another Alran ${active.buildEnv} environment. Run \`alran logout\` before signing in to ${requested.buildEnv}.`;
}

function formatRegion(region: MavisRegion): string {
  return region === 'cn' ? 'Alran China' : 'Alran Global';
}
