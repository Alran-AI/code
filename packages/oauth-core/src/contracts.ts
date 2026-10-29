export const ALRAN_OAUTH_CLIENT_ID = 'alran-public' as const;
export const ALRAN_OAUTH_SCOPES = ['agent.default'] as const;
export const ALRAN_OAUTH_AUDIENCE = 'agent-backend' as const;

/** Keycloak (Ottili Platform) OAuth 2.0 authorization code flow with PKCE. */
export const ALRAN_KEYCLOAK_CLIENT_ID = 'alran-public' as const;
export const ALRAN_KEYCLOAK_SCOPES = ['openid', 'profile', 'email', 'agent.default'] as const;
export const ALRAN_KEYCLOAK_AUDIENCE = 'agent-backend' as const;

/** Canonical interactive auth host (Ottili Platform). `login.ottili.one` is retired. */
export const ALRAN_KEYCLOAK_AUTH_HOST = 'auth.ottili.one' as const;

/** Platform base URLs. Dev talks to loopback; prod uses the real API. */
export interface PlatformBaseUrls {
  readonly dev: string;
  readonly prod: string;
}

/** The Platform instance Alran Code signs in to. */
export const ALRAN_PLATFORM_BASE_URLS: PlatformBaseUrls = {
  dev: 'http://127.0.0.1:18150',
  prod: 'https://api.alran.ai',
} as const;

/** Resolve the Platform base URL from env or a fixed environment. */
export function resolvePlatformBaseUrl(environment: 'dev' | 'prod'): string {
  const envValue = process.env.ALRAN_PLATFORM_BASE_URL;
  if (envValue?.trim()) return envValue.trim();
  return ALRAN_PLATFORM_BASE_URLS[environment];
}

/** The OIDC login path on the Platform. */
export const ALRAN_PLATFORM_OIDC_LOGIN_PATH = '/v2/auth/oidc/login' as const;
/** The OIDC handoff redemption path on the Platform. */
export const ALRAN_PLATFORM_OIDC_REDEEM_PATH = '/__dev/oidc/redeem' as const;

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
