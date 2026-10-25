import type { AuthNamespaceInput } from './contracts.js';
import { AlranOAuthCore } from './auth-core.js';
import { createCredentialStore } from './credential-store/factory.js';
import { createAuthNamespace } from './namespace.js';
import { migrateLegacyAuthNamespace } from './namespace-migration.js';
import { HttpOAuthClient, type HttpOAuthClientOptions } from './oauth-client.js';
import {
  createAuthManager,
  createTokenProvider,
  type AlranAuthManager,
  type AlranTokenProvider,
} from './token-provider.js';

export interface CreateAlranLocalAuthOptions extends AuthNamespaceInput {
  fetchImpl?: typeof fetch;
  endpoints: Pick<
    HttpOAuthClientOptions,
    | 'deviceAuthorizationEndpoint'
    | 'deviceAuthorizationHeaders'
    | 'tokenEndpoint'
    | 'revocationEndpoint'
  >;
}

export function createAlranTokenProvider(options: CreateAlranLocalAuthOptions): AlranTokenProvider {
  return createTokenProvider(createCore(options));
}

export function createAlranAuthManager(options: CreateAlranLocalAuthOptions): AlranAuthManager {
  return createAuthManager(createCore(options));
}

function createCore(options: CreateAlranLocalAuthOptions): AlranOAuthCore {
  const namespace = createAuthNamespace(options);
  return new AlranOAuthCore({
    namespace,
    credentialStore: createCredentialStore({ authHome: namespace.namespaceHome }),
    oauthClient: new HttpOAuthClient({ ...options.endpoints, fetchImpl: options.fetchImpl }),
    initialize: () => migrateLegacyAuthNamespace(namespace),
  });
}
