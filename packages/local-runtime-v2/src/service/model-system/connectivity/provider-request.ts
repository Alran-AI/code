import { withOpenCodeGoHeaders, withOpenRouterAttributionHeaders } from '@alran/shared';

import type { ModelProviderApi } from '../identity.js';

/** Strips trailing `char` repeats in linear time (no backtracking regex). */
function trimTrailingChar(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}


export type { ModelProviderApi } from '../identity.js';

const MESSAGES_VERSION_HEADER = 'anthropic-messages'.replace('-messages', '-version');

export function buildProviderHeaders(input: {
  api: ModelProviderApi;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}): Headers {
  const defaults: Record<string, string> =
    input.api === 'anthropic-messages'
      ? {
          'content-type': 'application/json',
          'x-api-key': input.apiKey,
          [MESSAGES_VERSION_HEADER]: '2023-06-01',
        }
      : {
          'content-type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        };
  const headers = new Headers(defaults);
  const attributedHeaders = withOpenCodeGoHeaders(
    input.baseUrl,
    withOpenRouterAttributionHeaders(input.baseUrl, input.headers),
  );
  for (const [name, value] of Object.entries(attributedHeaders ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

export function buildModelDiscoveryHeaders(input: {
  api: ModelProviderApi;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}): Headers {
  const headers = buildProviderHeaders(input);
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${input.apiKey}`);
  if (!headers.has('x-api-key')) headers.set('x-api-key', input.apiKey);
  return headers;
}

export function providerCompletionUrl(api: ModelProviderApi, baseUrl: string): string {
  const { path, query } = splitBaseUrl(normalizeProviderBaseUrl(api, baseUrl));
  if (api === 'anthropic-messages') return `${path}/v1/messages${query}`;
  if (api === 'openai-responses') return `${path}/responses${query}`;
  return `${path}/chat/completions${query}`;
}

/**
 * Model-list candidate URLs in attempt order, with the protocol's native endpoint first. Anthropic
 * Messages-compatible gateways often implement only `/v1/messages`: DeepSeek serves Messages
 * compatibility under a subpath of `https://api.deepseek.com`, while its model list is at root
 * `/models`. If the native endpoint is missing, also provide same-base and prefix-stripped
 * OpenAI-style candidates.
 */
export function providerModelsUrls(api: ModelProviderApi, baseUrl: string): [string, ...string[]] {
  const { path, query } = splitBaseUrl(normalizeProviderBaseUrl(api, baseUrl));
  if (api !== 'anthropic-messages') return [`${path}/models${query}`];
  const primary = `${path}/v1/models${query}`;
  const fallbacks = [`${path}/models${query}`, originModelsUrl(path, query)].filter(
    (url): url is string => Boolean(url),
  );
  return [primary, ...new Set(fallbacks)];
}

function originModelsUrl(path: string, query: string): string | undefined {
  try {
    return `${new URL(path).origin}/models${query}`;
  } catch {
    return undefined;
  }
}

/**
 * A base URL split where its query or fragment starts. Endpoints belong on the path, so they are
 * appended to `path`; `query` goes after them. A fragment is never part of a request, so it is
 * left out of `query`.
 */
function splitBaseUrl(url: string): { path: string; query: string } {
  const { head, tail } = splitQueryAndFragment(url);
  const fragmentStart = tail.indexOf('#');
  return { path: head, query: fragmentStart === -1 ? tail : tail.slice(0, fragmentStart) };
}

function splitQueryAndFragment(url: string): { head: string; tail: string } {
  const start = url.search(/[?#]/u);
  return start === -1 ? { head: url, tail: '' } : { head: url.slice(0, start), tail: url.slice(start) };
}

export function normalizeProviderBaseUrl(api: ModelProviderApi, baseUrl: string): string {
  // The endpoint suffix sits at the end of the path, before any query or fragment.
  const { head, tail } = splitQueryAndFragment(baseUrl);
  let base = trimTrailingChar(head, '/');
  if (api === 'anthropic-messages') {
    if (base.endsWith('/v1/messages')) base = base.slice(0, -'/v1/messages'.length);
    else if (base.endsWith('/messages')) base = base.slice(0, -'/messages'.length);
    if (base.endsWith('/v1')) base = base.slice(0, -'/v1'.length);
    return `${base}${tail}`;
  }
  if (base.endsWith('/chat/completions')) base = base.slice(0, -'/chat/completions'.length);
  else if (base.endsWith('/responses')) base = base.slice(0, -'/responses'.length);
  return `${base}${tail}`;
}

export function mergeProviderHeaders(
  ...records: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged = new Map<string, { name: string; value: string }>();
  for (const record of records) {
    for (const [name, value] of Object.entries(record ?? {})) {
      merged.set(name.toLowerCase(), { name, value });
    }
  }
  return merged.size > 0
    ? Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]))
    : undefined;
}
