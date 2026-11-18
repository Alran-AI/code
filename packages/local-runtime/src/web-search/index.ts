import type { LocalWebSearchAdapter } from '@alran/agent-tools/desktop';
import type { LocalRuntimeAuthContext } from '../runtime/model-resolver.js';
import type { LocalRuntimeRoutingContext } from '../runtime/routing-headers.js';
import {
  createManagedLocalWebSearchClient,
  LocalWebSearchClient,
  type LocalWebSearchClientOptions,
} from './local-web-search-client.js';
import {
  SearxngWebSearchAdapter,
  searxngApiKeyFromEnv,
  searxngUrlFromEnv,
} from './searxng-web-search.js';

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
 * Pick the direct provider when one is configured, otherwise keep the managed Matrix client.
 *
 * `SEARXNG_URL` wins because a configured self-hosted instance is reachable without an Ottili
 * login, which is exactly the case the Matrix path cannot serve. Unset keeps today's behaviour,
 * so the managed route is untouched for everyone who never sets it.
 */
export function createLocalWebSearchAdapter(
  env: NodeJS.ProcessEnv = process.env,
  options: CreateLocalWebSearchAdapterOptions = {},
): LocalWebSearchAdapter {
  const searxngUrl = searxngUrlFromEnv(env);
  if (searxngUrl !== undefined) {
    const apiKey = searxngApiKeyFromEnv(env);
    return new SearxngWebSearchAdapter({
      baseUrl: searxngUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }
  return createManagedLocalWebSearchClient(options);
}
