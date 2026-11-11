import type { AlranRegion } from '@alran/config';
// The data directory of the running CLI (ALRAN_DATA_DIR, else the profile's default): the same one
// the model resolver reads the session from, so a sign-in is found where it is used.
import { getTuiDataDirPath } from '../runtime/data-dir.js';
import {
  clearStoredPlatformSession,
  platformEnvironmentOrder,
  resolveOttiliGatewayBaseUrl,
  resolveOttiliApiKeyConsoleUrlFor,
  resolvePlatformEnvironmentForBuild,
} from '@alran/config';

import { randomBytes } from 'node:crypto';

import {
  loginWithOttiliApiKey,
  logoutOfOttiliApiKey,
  type OttiliApiKeyLoginOptions,
} from '../auth/ottili-api-key.js';
import { resolveAlranAuthEnvironment } from '../auth/environment.js';
import {
  runDeviceAuthorization,
  shouldUseDeviceFlow,
  type DeviceAuthorizationOptions,
} from './device-login.js';
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
  parsePlatformOidcCallbackUri,
  resolvePlatformBaseUrl,
  resolvePlatformOidcCallbackUri,
  AuthStateStore,
  type AuthBuildEnv,
  type AuthRegion,
  type AuthState,
  type CredentialKey,
  type StoredCredential,
  CREDENTIAL_SCHEMA_VERSION,
  PlatformApiClient,
  platformIdempotencyKey,
} from '@alran/oauth-core';

export interface RunTuiAuthCommandOptions
  extends Omit<OttiliApiKeyLoginOptions, 'openBrowser' | 'openExternalTarget'> {
  readonly region?: AlranRegion;
  readonly lane?: string;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
  /** Login provider: `api-key` (default), `keycloak` or `platform`. */
  readonly provider?: 'api-key' | 'keycloak' | 'platform';
  /**
   * Platform environment: `dev` (local Platform) or `prod` (ottili.one).
   * Defaults to the environment this build targets.
   */
  readonly platformEnv?: 'dev' | 'prod';
  /**
   * The `platform` provider signs in with the device authorization (a code confirmed in any browser)
   * instead of the loopback redirect. Unset: decided by the terminal (SSH, no display) or by
   * `ALRAN_LOGIN_FLOW`.
   */
  readonly device?: boolean;
  /** Replaces the device authorization's network and clock in tests. */
  readonly deviceAuthorization?: Partial<DeviceAuthorizationOptions>;
}

/**
 * The Platform the running build signs in to: the embedded build identity when
 * one is present, otherwise the runtime build environment.
 */
function defaultPlatformEnvironment(): 'dev' | 'prod' {
  return resolvePlatformEnvironmentForBuild(resolveAlranAuthEnvironment().buildEnv);
}

/**
 * Sign in to the Ottili AI Platform.
 *
 * With the `api-key` provider, Alran Code has no account of its own:
 * the Ottili platform mints API keys, so the browser opens on the key page and
 * the pasted `sk-ottili-...` key is stored in the local config.
 *
 * With the `keycloak` provider, an OAuth 2.0 authorization code flow with PKCE
 * is started against the Ottili Platform keycloak at `auth.ottili.one`. A local
 * callback server hosts `/login` and `/callback` to complete the flow.
 *
 * With the `platform` provider, an OpenID Connect flow through the Ottili
 * Platform (Keycloak) is started. A local callback server listens on the
 * registered callback URI (by default `http://127.0.0.1:18370/callback`,
 * overridable with `ALRAN_OIDC_CALLBACK_URI`); the callback redeems the
 * one-time handoff code against the Platform's `/v2/auth/sessions/handoff` for
 * a Platform session. The Platform session id and company id are stored locally
 * and every subsequent Platform API call carries `x-ottili-session` and
 * `x-ottili-company`.
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
    if (options.device ?? shouldUseDeviceFlow()) {
      return loginWithDevice({
        platformEnv: options.platformEnv ?? defaultPlatformEnvironment(),
        writeError,
        ...(options.deviceAuthorization ? { overrides: options.deviceAuthorization } : {}),
      });
    }
    return loginWithPlatformOidc({
      platformEnv: options.platformEnv ?? defaultPlatformEnvironment(),
      openBrowser: options.openBrowser !== false,
      openExternalTarget: options.openExternalTarget,
      writeError,
    });
  }
  const result = await loginWithOttiliApiKey({
    ...(options.readApiKey ? { readApiKey: options.readApiKey } : {}),
    ...(options.storeKey ? { storeKey: options.storeKey } : {}),
    consoleUrl:
      options.consoleUrl ??
      resolveOttiliApiKeyConsoleUrlFor(resolvePlatformBaseUrl(defaultPlatformEnvironment())),
    ...(options.openExternalTarget ? { openExternalTarget: options.openExternalTarget } : {}),
    openBrowser: options.openBrowser !== false,
    writeError,
  });
  return result.message;
}

/**
 * Sign out by removing the stored credentials.
 *
 * Both credential kinds are cleared: the Ottili API key and any stored Platform
 * session. Clearing both environments is deliberate — a sign-out must not leave
 * a session behind that the model calls would keep using.
 */
export async function runTuiLogout(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  const dataDir = getTuiDataDirPath();
  for (const platformEnv of platformEnvironmentOrder(
    resolvePlatformEnvironmentForBuild(),
  )) {
    clearStoredPlatformSession(dataDir, platformEnv);
  }
  return logoutOfOttiliApiKey({
    ...(options.clearKey ? { clearKey: options.clearKey } : {}),
  });
}

interface LoginWithKeycloakOptions {
  readonly region?: AlranRegion;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
}

interface LoginWithDeviceOptions {
  readonly platformEnv: 'dev' | 'prod';
  readonly writeError: (value: string) => void;
  readonly overrides?: Partial<DeviceAuthorizationOptions>;
}

/** Sign in with a code that is confirmed in a browser anywhere (RFC 8628); see ./device-login.ts. */
async function loginWithDevice(options: LoginWithDeviceOptions): Promise<string> {
  const abort = new AbortController();
  const onInterrupt = () => abort.abort(new Error('interrupted'));
  process.once('SIGINT', onInterrupt);
  let session;
  try {
    session = await runDeviceAuthorization({
      gatewayBaseUrl: resolveOttiliGatewayBaseUrl(options.platformEnv),
      write: options.writeError,
      signal: abort.signal,
      ...options.overrides,
    });
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }
  const platformAuthDir = `${getTuiDataDirPath()}/auth/platform/${options.platformEnv}`;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(platformAuthDir, { recursive: true });
  await storePlatformSession(platformAuthDir, session);
  return `Signed in to the Ottili AI Platform (${options.platformEnv === 'prod' ? 'production' : 'development'}) with a device code.`;
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
    dataDir: getTuiDataDirPath(),
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
  const dataDir = getTuiDataDirPath();
  const platformAuthDir = `${dataDir}/auth/platform/${options.platformEnv}`;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(platformAuthDir, { recursive: true });

  // The Platform only accepts a `return_to` whose origin and path are
  // registered in `OTTILI_OIDC_CALLBACK_URIS`, and an ephemeral port cannot be
  // registered. Bind the stable loopback URI instead; a deployment that
  // registered a different one sets ALRAN_OIDC_CALLBACK_URI.
  const callbackUri = resolvePlatformOidcCallbackUri(options.platformEnv);
  const callback = parsePlatformOidcCallbackUri(callbackUri);

  let server: CallbackServer | undefined;
  try {
    const state = randomBytes(16).toString('base64url');
    server = new CallbackServer({
      baseUrl: callback.origin,
      callbackUri: callback.uri,
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

    // Start the server first so a port conflict fails before the browser opens.
    try {
      await server.start();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new Error(
          `Cannot listen on ${callback.uri}: the port is already in use. ` +
            'Close the other login, or set ALRAN_OIDC_CALLBACK_URI to a URI registered on the Platform.',
        );
      }
      throw error;
    }
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
  // The session id is a bearer credential: owner-only file (0600) in an owner-only directory.
  const { writePrivateConfigFileSync } = await import('@alran/config');
  const { chmod } = await import('node:fs/promises');
  if (process.platform !== 'win32') await chmod(authDir, 0o700).catch(() => undefined);
  const stored: StoredPlatformSession = {
    ...session,
    via: 'oidc',
    storedAtMs: Date.now(),
  };
  writePrivateConfigFileSync(`${authDir}/platform-session.json`, JSON.stringify(stored, null, 2));
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

function formatRegion(region: AlranRegion): string {
  return region === 'cn' ? 'Alran China' : 'Alran Global';
}

/**
 * Read the stored Platform session and return a Platform API client for it.
 * Returns null when no session is stored.
 */
export async function platformSessionClient(
  platformEnv: 'dev' | 'prod' = resolvePlatformEnvironmentForBuild(),
): Promise<PlatformApiClient | null> {
  const dataDir = getTuiDataDirPath();
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
