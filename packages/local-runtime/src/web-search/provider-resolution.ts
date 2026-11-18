import { searxngUrlFromEnv } from './searxng-web-search.js';

/** Shown once at start when web search is enabled but nothing can answer it. */
export const SEARXNG_SETUP_HINT =
  'web search is unavailable: set SEARXNG_URL to your SearXNG endpoint ' +
  '(for example http://127.0.0.1:8080) or sign in for the managed search route.';

export type WebSearchProvider =
  | { kind: 'searxng'; baseUrl: string }
  | { kind: 'matrix' }
  | { kind: 'none' };

/**
 * Decide which web search backend a Turn should use.
 *
 * `SEARXNG_URL` wins: a configured instance answers without an Ottili login. Next is the managed
 * Matrix route, but only when the host actually holds a login token — a Matrix client without one
 * can only fail, so it is not a provider. With neither, the tool is not registered at all and the
 * host shows `SEARXNG_SETUP_HINT`, instead of offering a search that cannot work.
 */
export function resolveWebSearchProvider(
  env: NodeJS.ProcessEnv,
  hasMatrixSession: boolean,
): WebSearchProvider {
  const baseUrl = searxngUrlFromEnv(env);
  if (baseUrl !== undefined) return { kind: 'searxng', baseUrl };
  return hasMatrixSession ? { kind: 'matrix' } : { kind: 'none' };
}
