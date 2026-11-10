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
  dev: 'http://127.0.0.1:18360',
  prod: 'https://platform.ottili.one',
} as const;

/** Resolve the Platform base URL from env or a fixed environment.
 *
 * `dev` stays on localhost (`http://127.0.0.1:18360`) unless
 * `ALRAN_PLATFORM_BASE_URL_DEV` is set explicitly. `prod` defaults to
 * `https://api.ottili.one` and can be overridden with
 * `ALRAN_PLATFORM_BASE_URL_PROD` or `ALRAN_PLATFORM_BASE_URL`.
 */
export function resolvePlatformBaseUrl(environment: 'dev' | 'prod'): string {
  if (environment === 'dev') {
    const devValue = process.env.ALRAN_PLATFORM_BASE_URL_DEV;
    if (devValue?.trim()) return devValue.trim();
    return ALRAN_PLATFORM_BASE_URLS.dev;
  }
  const prodValue =
    process.env.ALRAN_PLATFORM_BASE_URL_PROD ?? process.env.ALRAN_PLATFORM_BASE_URL;
  if (prodValue?.trim()) return prodValue.trim();
  return ALRAN_PLATFORM_BASE_URLS.prod;
}

/** The OIDC login path on the Platform. */
export const ALRAN_PLATFORM_OIDC_LOGIN_PATH = '/v2/auth/oidc/login' as const;
/** The OIDC handoff redemption path on the Platform. */
export const ALRAN_PLATFORM_OIDC_REDEEM_PATH = '/v2/auth/sessions/handoff' as const;

/**
 * The loopback callback the Ottili Platform hands the browser back to.
 *
 * The Platform compares `origin + pathname` of `return_to` byte for byte
 * against its `OTTILI_OIDC_CALLBACK_URIS` allowlist, so a callback on an
 * ephemeral port can never be registered. This is the URI registered for
 * Alran Code; a deployment that registered a different one overrides it with
 * `ALRAN_OIDC_CALLBACK_URI` (or the environment-specific
 * `ALRAN_OIDC_CALLBACK_URI_DEV` / `ALRAN_OIDC_CALLBACK_URI_PROD`).
 */
export const ALRAN_PLATFORM_OIDC_CALLBACK_URI = 'http://127.0.0.1:18370/callback' as const;

/** A parsed absolute OIDC callback URI. */
export interface PlatformOidcCallbackEndpoint {
  /** The exact URI the Platform must have registered (`origin + pathname`). */
  readonly uri: string;
  /** The scheme, host and port, without the path. */
  readonly origin: string;
  /** The host to listen on (IPv6 brackets removed). */
  readonly host: string;
  /** The port to listen on. */
  readonly port: number;
  /** The path the callback server serves. */
  readonly path: string;
}

/**
 * Resolve the callback URI for a Platform environment.
 *
 * `ALRAN_OIDC_CALLBACK_URI` wins for both environments; the environment-specific
 * variables exist so a development Platform with its own allowlist does not
 * have to share the production URI.
 */
export function resolvePlatformOidcCallbackUri(environment: 'dev' | 'prod'): string {
  const shared = process.env.ALRAN_OIDC_CALLBACK_URI?.trim();
  if (shared) return shared;
  const specific =
    environment === 'dev'
      ? process.env.ALRAN_OIDC_CALLBACK_URI_DEV
      : process.env.ALRAN_OIDC_CALLBACK_URI_PROD;
  if (specific?.trim()) return specific.trim();
  return ALRAN_PLATFORM_OIDC_CALLBACK_URI;
}

/**
 * Parse and validate an absolute callback URI.
 *
 * A query or fragment would make the browser send something the Platform did
 * not register, and credentials in the URI are never a callback. Both are
 * refused here rather than discovered at login time.
 */
export function parsePlatformOidcCallbackUri(value: string): PlatformOidcCallbackEndpoint {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OIDC callback URI "${value}" is not an absolute URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`OIDC callback URI "${value}" must use http or https.`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`OIDC callback URI "${value}" must not carry credentials.`);
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error(`OIDC callback URI "${value}" must not carry a query or fragment.`);
  }
  if (url.pathname === '' || url.pathname === '/') {
    throw new Error(`OIDC callback URI "${value}" must name a callback path.`);
  }
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const rawHost = url.hostname;
  const host =
    rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
  return {
    uri: `${url.origin}${url.pathname}`,
    origin: url.origin,
    host,
    port,
    path: url.pathname,
  };
}

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
