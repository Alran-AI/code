import {
  ALRAN_OAUTH_SCOPES,
  type AccessTokenLease,
  type UnauthorizedContext,
} from './contracts.js';
import type {
  AuthStatusSnapshot,
  DeviceAuthorizationPrompt,
  LoginOptions,
  LoginResult,
  LogoutResult,
  AlranOAuthCore,
} from './auth-core.js';

export interface AlranTokenProvider {
  getStatus(): Promise<AuthStatusSnapshot>;
  getAccessToken(options: { minValidityMs: number }): Promise<AccessTokenLease>;
  handleUnauthorized(context: UnauthorizedContext): Promise<'retry' | 'logout'>;
}

export interface AlranAuthManager extends AlranTokenProvider {
  login(options?: LoginOptions): Promise<LoginResult>;
  cancelLogin(): Promise<void>;
  logout(options: { revoke: boolean }): Promise<LogoutResult>;
  watch(listener: (status: AuthStatusSnapshot) => void): () => void;
}

export function createTokenProvider(core: AlranOAuthCore): AlranTokenProvider {
  return Object.freeze({
    getStatus: () => core.getStatus(),
    getAccessToken: (options: { minValidityMs: number }) =>
      core.getAccessToken({
        requiredScopes: [...ALRAN_OAUTH_SCOPES],
        minValidityMs: options.minValidityMs,
      }),
    handleUnauthorized: (context: UnauthorizedContext) => core.handleUnauthorized(context),
  });
}

export function createAuthManager(core: AlranOAuthCore): AlranAuthManager {
  const provider = createTokenProvider(core);
  return Object.freeze({
    ...provider,
    login: (options?: {
      onDeviceAuthorization?: (authorization: DeviceAuthorizationPrompt) => void;
    }) => core.login(options),
    cancelLogin: () => core.cancelLogin(),
    logout: (options: { revoke: boolean }) => core.logout(options),
    watch: (listener: (status: AuthStatusSnapshot) => void) => core.watch(listener),
  });
}
