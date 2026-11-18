import { searxngUrlFromEnv } from './searxng-web-search.js';

/** Every variable a customer can set, in the order they are tried. */
export const WEB_SEARCH_PROVIDER_ENV_VARS = [
  'BRAVE_API_KEY',
  'SERPER_API_KEY',
  'TAVILY_API_KEY',
  'EXA_API_KEY',
  'SEARXNG_URL',
] as const;

/**
 * Advanced opt-out for hosts where Exa's keyless endpoint cannot work (IPv6-only or proxied
 * networks get a 403 from Exa). With it set, the managed Matrix route is used when available.
 */
export const KEYLESS_EXA_DISABLE_ENV = 'ALRAN_DISABLE_KEYLESS_EXA';

/**
 * Shown once at start when web search is enabled but nothing can answer it. Exa is the keyless
 * default, so this only happens when that opt-out is set and no other route is available.
 */
export const SEARXNG_SETUP_HINT =
  'web search is unavailable: keyless Exa is disabled and no alternative is configured - ' +
  'unset ALRAN_DISABLE_KEYLESS_EXA, set BRAVE_API_KEY (free tier available), SERPER_API_KEY, ' +
  'TAVILY_API_KEY, EXA_API_KEY, or SEARXNG_URL - or sign in for the managed search route.';

export type WebSearchProvider =
  | { kind: 'brave'; apiKey: string }
  | { kind: 'serper'; apiKey: string }
  | { kind: 'tavily'; apiKey: string }
  | { kind: 'exa'; apiKey: string | undefined }
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
 * An explicitly configured provider always wins: a customer key or self-hosted SearXNG is a
 * deliberate choice and must not be shadowed by the keyless default. With no explicit setting the
 * user gets Exa's hosted MCP endpoint, which needs nothing but a direct IPv4 connection; Exa sees
 * the user's own IP, so no Ottili key or server is involved. Matrix is the last resort for hosts
 * that opt out of keyless Exa and actually hold a login token.
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

  const exaKey = keyFrom(env, 'EXA_API_KEY');
  if (exaKey !== undefined) return { kind: 'exa', apiKey: exaKey };

  const baseUrl = searxngUrlFromEnv(env);
  if (baseUrl !== undefined) return { kind: 'searxng', baseUrl };

  if (keyFrom(env, KEYLESS_EXA_DISABLE_ENV) === undefined) {
    return { kind: 'exa', apiKey: undefined };
  }

  return hasMatrixSession ? { kind: 'matrix' } : { kind: 'none' };
}
