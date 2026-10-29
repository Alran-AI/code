export const ALRAN_OAUTH_CLIENT_ID = 'alran-public' as const;
export const ALRAN_OAUTH_SCOPES = ['agent.default'] as const;
export const ALRAN_OAUTH_AUDIENCE = 'agent-backend' as const;

/** Keycloak (Ottili Platform) OAuth 2.0 authorization code flow with PKCE. */
export const ALRAN_KEYCLOAK_CLIENT_ID = 'alran-public' as const;
export const ALRAN_KEYCLOAK_SCOPES = ['openid', 'profile', 'email', 'agent.default'] as const;
export const ALRAN_KEYCLOAK_AUDIENCE = 'agent-backend' as const;

/** Canonical interactive auth host (Ottili Platform). `login.ottili.one` is retired. */
export const ALRAN_KEYCLOAK_AUTH_HOST = 'auth.ottili.one' as const;

export type AuthBuildEnv = 'dev' | 'test' | 'staging' | 'prod';
export type AuthRegion = 'cn' | 'en';

export interface AuthNamespaceInput {
  dataDir: string;
  buildEnv: AuthBuildEnv;
  region: AuthRegion;
}

export interface AccessTokenLease {
  accessToken: string;
  /** Stable across refresh, replaced by every interactive login. Absent on legacy credentials. */
  loginEpoch?: string;
  expiresAtMs: number;
  generation: number;
  scopes: typeof ALRAN_OAUTH_SCOPES;
  audience: typeof ALRAN_OAUTH_AUDIENCE;
}

export interface UnauthorizedContext {
  generation: number;
  loginEpoch?: string;
}
