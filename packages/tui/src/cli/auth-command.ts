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
  AuthStateStore,
  type AuthBuildEnv,
  type AuthRegion,
  type AuthState,
  type CredentialKey,
  type StoredCredential,
  CREDENTIAL_SCHEMA_VERSION,
} from '@mavis/oauth-core';

export interface RunTuiAuthCommandOptions
  extends Omit<OttiliApiKeyLoginOptions, 'openBrowser' | 'openExternalTarget'> {
  readonly region?: MavisRegion;
  readonly lane?: string;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly writeError?: (value: string) => void;
  /** Login provider: `api-key` (default) or `keycloak`. */
  readonly provider?: 'api-key' | 'keycloak';
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
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    tokenType: 'Bearer',
    clientId: ALRAN_KEYCLOAK_CLIENT_ID,
    scopes: result.scopes,
    audience: ALRAN_KEYCLOAK_AUDIENCE,
    expiresAtMs: now + result.expiresInSec * 1_000,
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
    scopes: result.scopes,
    audience: ALRAN_KEYCLOAK_AUDIENCE,
    buildEnv,
    region,
    expiresAtMs: now + result.expiresInSec * 1_000,
    generation,
  });
}

function formatRegion(region: MavisRegion): string {
  return region === 'cn' ? 'Alran China' : 'Alran Global';
}
