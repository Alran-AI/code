import type { MavisRegion } from '@mavis/config';
import { resolveDataDir } from '@mavis/config';

import { randomBytes } from 'node:crypto';

import {
  loginWithOttiliApiKey,
  logoutOfOttiliApiKey,
  type OttiliApiKeyLoginOptions,
} from '../auth/ottili-api-key.js';
import { createTuiExternalTargetOpener, type TuiExternalTargetOpener } from '../host/open-external.js';

import {
  AuthorizationCodeClient,
  CallbackServer,
  type CallbackLoginResult,
  createAuthNamespace,
  createCredentialStore,
  ALRAN_KEYCLOAK_AUTH_HOST,
  ALRAN_KEYCLOAK_AUDIENCE,
  ALRAN_KEYCLOAK_CLIENT_ID,
  ALRAN_KEYCLOAK_SCOPES,
  ALRAN_PLATFORM_BASE_URLS,
  resolvePlatformBaseUrl,
  AuthStateStore,
  type AuthBuildEnv,
  type AuthRegion,
  type AuthState,
  type CredentialKey,
  type StoredCredential,
  CREDENTIAL_SCHEMA_VERSION,
  PlatformApiClient,
  platformIdempotencyKey,
} from '@mavis/oauth-core';

export interface RunTuiAuthCommandOptions
  extends Omit<OttiliApiKeyLoginOptions, 'openBrowser' | 'openExternalTarget'> {
  readonly region?: MavisRegion;
  readonly lane?: string;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
  /** Login provider: `api-key` (default), `keycloak` or `platform`. */
  readonly provider?: 'api-key' | 'keycloak' | 'platform';
  /** Platform environment: `dev` (loopback) or `prod` (api.alran.ai). */
  readonly platformEnv?: 'dev' | 'prod';
}

/**
 * Sign in to the Ottili AI Platform.
 *
 * With the default `api-key` provider, Alran Code has no account of its own:
 * the Ottili platform mints API keys, so the browser opens on the key page and
 * the pasted `sk-ottili-...` key is stored in the local config.
 *
 * With the `keycloak` provider, an OAuth 2.0 authorization code flow with PKCE
 * is started against the Ottili Platform keycloak at `auth.ottili.one`. A local
 * callback server hosts `/login` and `/callback` to complete the flow.
 *
 * With the `platform` provider, an OpenID Connect flow through the Ottili
 * Platform (Keycloak) is started. A local callback server hosts `/login` and
 * `/callback`; the callback redeems the one-time handoff code against the
 * Platform's `/__dev/oidc/redeem` for a Platform session. The Platform session
 * id and company id are stored locally and every subsequent Platform API call
 * carries `x-ottili-session` and `x-ottili-company`.
 */
export async function runTuiLogin(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
  if (options.provider === 'keycloak') {
    return loginWithKeycloak({
      region: options.region,
      openBrowser: options.openBrowser !== false,
      openExternalTarget: options.openExternalTarget,
      writeError,
    });
  }
  if (options.provider === 'platform') {
    return loginWithPlatformOidc({
      platformEnv: options.platformEnv ?? 'dev',
      openBrowser: options.openBrowser !== false,
      openExternalTarget: options.openExternalTarget,
      writeError,
    });
  }
  const result = await loginWithOttiliApiKey({
    ...(options.readApiKey ? { readApiKey: options.readApiKey } : {}),
    ...(options.storeKey ? { storeKey: options.storeKey } : {}),
    ...(options.consoleUrl ? { consoleUrl: options.consoleUrl } : {}),
    ...(options.openExternalTarget ? { openExternalTarget: options.openExternalTarget } : {}),
    openBrowser: options.openBrowser !== false,
    writeError,
  });
  return result.message;
}

/** Sign out by removing the stored Ottili API key. */
export async function runTuiLogout(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  return logoutOfOttiliApiKey({
    ...(options.clearKey ? { clearKey: options.clearKey } : {}),
  });
}

interface LoginWithKeycloakOptions {
  readonly region?: MavisRegion;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
}

interface LoginWithPlatformOidcOptions {
  readonly platformEnv: 'dev' | 'prod';
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
}

async function loginWithKeycloak(options: LoginWithKeycloakOptions): Promise<string> {
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));

  const region = (options.region ?? 'en') as AuthRegion;
  const buildEnv = 'prod' as AuthBuildEnv;

  const authorizationEndpoint = resolveKeycloakEndpoint(
    'ALRAN_KEYCLOAK_AUTHORIZATION_ENDPOINT',
    `https://${ALRAN_KEYCLOAK_AUTH_HOST}/realms/alran/protocol/openid-connect/auth`,
  );
  const tokenEndpoint = resolveKeycloakEndpoint(
    'ALRAN_KEYCLOAK_TOKEN_ENDPOINT',
    `https://${ALRAN_KEYCLOAK_AUTH_HOST}/realms/alran/protocol/openid-connect/token`,
  );
  const revocationEndpoint = resolveKeycloakEndpoint(
    'ALRAN_KEYCLOAK_REVOCATION_ENDPOINT',
    `https://${ALRAN_KEYCLOAK_AUTH_HOST}/realms/alran/protocol/openid-connect/revoke`,
  );

  const namespace = createAuthNamespace({
    dataDir: resolveDataDir(),
    buildEnv,
    region,
  });
  const credentialStore = createCredentialStore({ authHome: namespace.namespaceHome });
  const stateStore = new AuthStateStore(namespace.statePath);

  let server: CallbackServer | undefined;
  try {
    const state = randomBytes(16).toString('base64url');
    server = new CallbackServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1',
      expectedState: state,
      onLogin: async (result: CallbackLoginResult) => {
        await storeKeycloakCredential(
          namespace,
          credentialStore,
          stateStore,
          result,
          buildEnv,
          region,
        );
      },
    });

    // Start the server first so we know the port for the redirect URI.
    await server.start();
    const serverPort = server.port;
    if (serverPort === null) {
      throw new Error('Callback server failed to start.');
    }
    const redirectUri = `http://127.0.0.1:${serverPort}/callback`;

    const client = new AuthorizationCodeClient({
      authorizationEndpoint,
      tokenEndpoint,
      revocationEndpoint,
      redirectUri,
      clientId: ALRAN_KEYCLOAK_CLIENT_ID,
      scopes: ALRAN_KEYCLOAK_SCOPES,
      audience: ALRAN_KEYCLOAK_AUDIENCE,
    });
    server.setClient(client);

    const authorizeUrl = await server.beginLogin();

    writeError(`Open this page to sign in with keycloak:\n${authorizeUrl}\n`);
    if (options.openBrowser !== false) {
      const openExternalTarget =
        options.openExternalTarget ?? createTuiExternalTargetOpener(process.cwd());
      try {
        await openExternalTarget(authorizeUrl);
      } catch {
        writeError("Couldn't open the default browser. Open the URL above manually.\n");
      }
    }

    await server.waitForLogin();

    const credential = await credentialStore.get(namespace.credentialKey);
    if (!credential) {
      throw new Error('Keycloak login succeeded but no credential was stored.');
    }

    return `Signed in to the Ottili AI Platform with keycloak (${formatRegion(region)}).`;
  } finally {
    if (server) {
      try {
        await server.close();
      } catch {
        // Ignore close errors; the login result has already been delivered.
      }
    }
  }
}

async function loginWithPlatformOidc(options: LoginWithPlatformOidcOptions): Promise<string> {
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));

  const platformBaseUrl = resolvePlatformBaseUrl(options.platformEnv);

  // Store the Platform session under the Platform namespace.
  const dataDir = resolveDataDir();
  const platformAuthDir = `${dataDir}/auth/platform/${options.platformEnv}`;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(platformAuthDir, { recursive: true });

  let server: CallbackServer | undefined;
  try {
    const state = randomBytes(16).toString('base64url');
    server = new CallbackServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1',
      platformOidc: {
        platformBaseUrl,
      },
      onLogin: async (result: CallbackLoginResult) => {
        const session = result.platformSession;
        if (!session) {
          throw new Error('Platform OIDC login succeeded but no session was returned.');
        }
        await storePlatformSession(platformAuthDir, session);
      },
    });

    // Start the server first so we know the port for the redirect URI.
    await server.start();
    const serverPort = server.port;
    if (serverPort === null) {
      throw new Error('Callback server failed to start.');
    }

    const authorizeUrl = server.platformOidcAuthorizeUrl();

    writeError(`Open this page to sign in with the Ottili Platform:\n${authorizeUrl}\n`);
    if (options.openBrowser !== false) {
      const openExternalTarget =
        options.openExternalTarget ?? createTuiExternalTargetOpener(process.cwd());
      try {
        await openExternalTarget(authorizeUrl);
      } catch {
        writeError("Couldn't open the default browser. Open the URL above manually.\n");
      }
    }

    await server.waitForLogin();

    // Verify the stored session by calling /v2/version through the Platform client.
    const stored = await readPlatformSession(platformAuthDir);
    if (!stored) {
      throw new Error('Platform OIDC login succeeded but no session was stored.');
    }
    const client = new PlatformApiClient(stored);
    const version = await client.get('/v2/version');
    if (!version.ok) {
      throw new Error(
        `Platform session stored but /v2/version returned HTTP ${version.status}.`,
      );
    }

    return `Signed in to the Ottili AI Platform (${options.platformEnv === 'prod' ? 'production' : 'development'}).`;
  } finally {
    if (server) {
      try {
        await server.close();
      } catch {
        // Ignore close errors; the login result has already been delivered.
      }
    }
  }
}

function resolveKeycloakEndpoint(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  if (value?.trim()) return value.trim();
  return fallback;
}

async function storeKeycloakCredential(
  namespace: { credentialKey: CredentialKey; buildEnv: AuthBuildEnv; region: AuthRegion },
  credentialStore: { put: (key: CredentialKey, credential: StoredCredential) => Promise<void> },
  stateStore: { write: (state: AuthState) => Promise<void> },
  result: CallbackLoginResult,
  buildEnv: AuthBuildEnv,
  region: AuthRegion,
): Promise<void> {
  const now = Date.now();
  const generation = 1;
  const credential: StoredCredential = {
    schemaVersion: CREDENTIAL_SCHEMA_VERSION,
    accessToken: result.accessToken ?? '',
    refreshToken: result.refreshToken ?? '',
    tokenType: 'Bearer',
    clientId: ALRAN_KEYCLOAK_CLIENT_ID,
    scopes: result.scopes ?? [],
    audience: ALRAN_KEYCLOAK_AUDIENCE,
    expiresAtMs: now + (result.expiresInSec ?? 3600) * 1_000,
    generation,
    ...(result.subject ? { subject: result.subject } : {}),
    ...(result.accountId ? { accountId: result.accountId } : {}),
  };
  await credentialStore.put(namespace.credentialKey, credential);
  await stateStore.write({
    schemaVersion: 2,
    status: 'authenticated',
    storeKind: 'file',
    clientId: ALRAN_KEYCLOAK_CLIENT_ID,
    scopes: result.scopes ?? [],
    audience: ALRAN_KEYCLOAK_AUDIENCE,
    buildEnv,
    region,
    expiresAtMs: now + (result.expiresInSec ?? 3600) * 1_000,
    generation,
  });
}

interface StoredPlatformSession {
  readonly sessionId: string;
  readonly companyId: string;
  readonly subjectId: string;
  readonly baseUrl: string;
  readonly via: 'oidc';
  readonly storedAtMs: number;
}

async function storePlatformSession(
  authDir: string,
  session: { sessionId: string; companyId: string; subjectId: string; baseUrl: string },
): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const stored: StoredPlatformSession = {
    ...session,
    via: 'oidc',
    storedAtMs: Date.now(),
  };
  await writeFile(`${authDir}/platform-session.json`, JSON.stringify(stored, null, 2));
}

async function readPlatformSession(authDir: string): Promise<StoredPlatformSession | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(`${authDir}/platform-session.json`, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : '',
      companyId: typeof parsed.companyId === 'string' ? parsed.companyId : '',
      subjectId: typeof parsed.subjectId === 'string' ? parsed.subjectId : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      via: 'oidc',
      storedAtMs: typeof parsed.storedAtMs === 'number' ? parsed.storedAtMs : 0,
    };
  } catch {
    return null;
  }
}

function formatRegion(region: MavisRegion): string {
  return region === 'cn' ? 'Alran China' : 'Alran Global';
}

/**
 * Read the stored Platform session and return a Platform API client for it.
 * Returns null when no session is stored.
 */
export async function platformSessionClient(
  platformEnv: 'dev' | 'prod' = 'dev',
): Promise<PlatformApiClient | null> {
  const dataDir = resolveDataDir();
  const authDir = `${dataDir}/auth/platform/${platformEnv}`;
  const stored = await readPlatformSession(authDir);
  if (!stored) return null;
  return new PlatformApiClient({
    sessionId: stored.sessionId,
    companyId: stored.companyId,
    baseUrl: stored.baseUrl,
  });
}

/** Idempotency key for Platform usage reporting. */
export { platformIdempotencyKey };
