import type { AlranBuildEnv, AlranRegion } from '@alran/config';
import {
  createAuthNamespace,
  createCredentialStore,
  HttpOAuthClient,
  migrateLegacyAuthNamespace,
  AlranOAuthCore,
  type HttpOAuthClientOptions,
  type OAuthClient,
} from '@alran/oauth-core';

export interface CreateAlranSharedAuthSessionOptions {
  dataDir: string;
  region: AlranRegion;
  buildEnv: AlranBuildEnv;
  oauthClient?: OAuthClient;
  oauthEndpoints?: Pick<
    HttpOAuthClientOptions,
    'deviceAuthorizationEndpoint' | 'tokenEndpoint' | 'revocationEndpoint'
  >;
}

export function createAlranSharedAuthSession(
  options: CreateAlranSharedAuthSessionOptions,
): AlranOAuthCore {
  const namespace = createAuthNamespace({
    dataDir: options.dataDir,
    buildEnv: options.buildEnv,
    region: options.region,
  });
  const oauthClient = options.oauthClient ?? createHttpOAuthClient(options.oauthEndpoints);
  const credentialStore = createCredentialStore({ authHome: namespace.namespaceHome });
  return new AlranOAuthCore({
    namespace,
    oauthClient,
    credentialStore,
    initialize: () => migrateLegacyAuthNamespace(namespace),
  });
}

function createHttpOAuthClient(
  endpoints: CreateAlranSharedAuthSessionOptions['oauthEndpoints'],
): HttpOAuthClient {
  if (!endpoints) {
    throw new TypeError(
      'Shared Alran OAuth requires explicit device authorization, token, and revocation endpoints.',
    );
  }
  return new HttpOAuthClient(endpoints);
}
