import { searxngUrlFromEnv } from './searxng-web-search.js';

/** Every variable a customer can set, in the order they are tried. */
export const WEB_SEARCH_PROVIDER_ENV_VARS = [
  'BRAVE_API_KEY',
  'SERPER_API_KEY',
  'TAVILY_API_KEY',
  'SEARXNG_URL',
] as const;

/**
 * Shown once at start when web search is enabled but nothing can answer it. It names the cheapest
 * way to turn the tool on, so the user does not have to read the docs to find out.
 */
export const SEARXNG_SETUP_HINT =
  'web search is unavailable: set one search provider key in your environment - ' +
  'BRAVE_API_KEY (free tier available), SERPER_API_KEY, TAVILY_API_KEY, ' +
  'or SEARXNG_URL for a self-hosted instance - or sign in for the managed search route.';

export type WebSearchProvider =
  | { kind: 'brave'; apiKey: string }
  | { kind: 'serper'; apiKey: string }
  | { kind: 'tavily'; apiKey: string }
  | { kind: 'searxng'; baseUrl: string }
  | { kind: 'matrix' }
  | { kind: 'none' };

function keyFrom(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Decide which web search backend a Turn should use.
 *
 * Bring-your-own-key first: a customer's own provider key is tried in cost order (Brave has a free
 * tier), so the request leaves their machine and spends their quota. A self-hosted `SEARXNG_URL`
 * comes next, then the managed Matrix route — but Matrix only when the host actually holds a login
 * token, because a Matrix client without one can only fail. With none of these the tool is not
 * registered at all and the host shows `SEARXNG_SETUP_HINT`.
 */
export function resolveWebSearchProvider(
  env: NodeJS.ProcessEnv,
  hasMatrixSession: boolean,
): WebSearchProvider {
  const brave = keyFrom(env, 'BRAVE_API_KEY');
  if (brave !== undefined) return { kind: 'brave', apiKey: brave };

  const serper = keyFrom(env, 'SERPER_API_KEY');
  if (serper !== undefined) return { kind: 'serper', apiKey: serper };

  const tavily = keyFrom(env, 'TAVILY_API_KEY');
  if (tavily !== undefined) return { kind: 'tavily', apiKey: tavily };

  const baseUrl = searxngUrlFromEnv(env);
  if (baseUrl !== undefined) return { kind: 'searxng', baseUrl };

  return hasMatrixSession ? { kind: 'matrix' } : { kind: 'none' };
}
