import type { LocalWebSearchAdapter } from '@alran/agent-tools/desktop';
import type { LocalRuntimeAuthContext } from '../runtime/model-resolver.js';
import type { LocalRuntimeRoutingContext } from '../runtime/routing-headers.js';
import {
  createManagedLocalWebSearchClient,
  LocalWebSearchClient,
  type LocalWebSearchClientOptions,
} from './local-web-search-client.js';
import {
  BraveWebSearchAdapter,
  SerperWebSearchAdapter,
  TavilyWebSearchAdapter,
} from './direct-providers.js';
import {
  SearxngWebSearchAdapter,
  searxngApiKeyFromEnv,
  searxngUrlFromEnv,
} from './searxng-web-search.js';
import { resolveWebSearchProvider } from './provider-resolution.js';

export {
  createManagedLocalWebSearchClient,
  LocalWebSearchClient,
  type LocalWebSearchClientOptions,
} from './local-web-search-client.js';
export {
  SearxngWebSearchAdapter,
  searxngApiKeyFromEnv,
  searxngUrlFromEnv,
} from './searxng-web-search.js';
export type { SearchHit, SearxngWebSearchOptions } from './searxng-web-search.js';

export interface CreateLocalWebSearchAdapterOptions {
  authContext?: LocalRuntimeAuthContext;
  authContextGetter?: () => LocalRuntimeAuthContext | undefined;
  authContextInvalidator?: (
    rejectedAccessToken?: string,
    loginEpoch?: string,
  ) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  routingContextGetter?: () => LocalRuntimeRoutingContext | undefined;
}

/**
 * Pick the configured provider, or `undefined` when nothing can answer.
 *
 * Bring-your-own-key first: a customer key is used directly from their environment, so the request
 * leaves their machine. `SEARXNG_URL` is next, then the managed Matrix route. Returning
 * `undefined` lets the caller leave `web_search` out of the tool list entirely, which is better
 * than offering a tool that can only fail.
 */
export function createLocalWebSearchAdapter(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLocalWebSearchAdapterOptions = {},
  hasMatrixSession = false,
): LocalWebSearchAdapter | undefined {
  const provider = resolveWebSearchProvider(env, hasMatrixSession);
  const fetchImpl = options.fetchImpl;
  const fetchOption = fetchImpl === undefined ? {} : { fetchImpl };

  switch (provider.kind) {
    case 'brave':
      return new BraveWebSearchAdapter({ apiKey: provider.apiKey, ...fetchOption });
    case 'serper':
      return new SerperWebSearchAdapter({ apiKey: provider.apiKey, ...fetchOption });
    case 'tavily':
      return new TavilyWebSearchAdapter({ apiKey: provider.apiKey, ...fetchOption });
    case 'searxng': {
      const apiKey = searxngApiKeyFromEnv(env);
      return new SearxngWebSearchAdapter({
        baseUrl: provider.baseUrl,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...fetchOption,
      });
    }
    case 'matrix':
      return createManagedLocalWebSearchClient(options);
    case 'none':
      return undefined;
  }
}
