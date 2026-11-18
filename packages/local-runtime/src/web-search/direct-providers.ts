/**
 * Bring-your-own-key search providers — no Matrix backend, no Ottili server in the path.
 *
 * Each provider talks to one vendor's HTTP API with the *customer's own* key, read from that
 * customer's environment. Nothing is proxied through an Ottili host: the request leaves the
 * user's machine, so one user's traffic never spends another's quota and never shares an IP.
 *
 * All three answer with the same `{ query, results: [{ title, url, snippet }], total }` payload,
 * so the model sees one contract. Selection order lives in `provider-resolution.ts`.
 */

import type { LocalWebSearchAdapter, WebSearchInput } from '@alran/agent-tools/desktop';
import type { ToolResult } from '@alran/agent-core/tools';

const TOOL_NAME = 'web_search';
const REQUEST_TIMEOUT_MS = 20_000;
/** Caps a provider message in the failure label so no long body leaks into tool output. */
const MAX_REASON_LENGTH = 120;

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface DirectProviderOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** The tool schema spells freshness in words; each vendor spells its own window. */
type Freshness = 'day' | 'week' | 'month' | 'year';

function freshnessOf(input: WebSearchInput): Freshness | undefined {
  const value = input.freshness;
  return value === 'day' || value === 'week' || value === 'month' || value === 'year'
    ? value
    : undefined;
}

function limitOf(input: WebSearchInput): number | undefined {
  return typeof input.count === 'number' && input.count > 0 ? input.count : undefined;
}

function clip(value: string): string {
  return value.length > MAX_REASON_LENGTH ? `${value.slice(0, MAX_REASON_LENGTH)}…` : value;
}

function transportCode(error: unknown): string | undefined {
  if (error !== null && typeof error === 'object') {
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== null && typeof cause === 'object') {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === 'string' && code.length > 0) return code;
    }
    const name = (error as { name?: unknown }).name;
    if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  }
  return undefined;
}

function failure(provider: string, reason: string, error?: unknown): ToolResult {
  const suffix =
    error instanceof Error && error.message.trim().length > 0 ? ` ${clip(error.message)}` : '';
  const text = `WEB_SEARCH_FAILED: web search via ${provider} failed (reason: ${reason})${suffix}`;
  return {
    tool_name: TOOL_NAME,
    text,
    content: [{ type: 'text', text }],
    isError: true,
    details: { ok: false, provider, error_code: 'WEB_SEARCH_FAILED', reason },
  };
}

function success(provider: string, query: string, results: SearchHit[]): ToolResult {
  const text = JSON.stringify({ query, results, total: results.length });
  return {
    tool_name: TOOL_NAME,
    text,
    content: [{ type: 'text', text }],
    details: { ok: true, provider, total: results.length },
  };
}

async function readJson(response: Response): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: (await response.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

function combinedSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Collect `{title,url,snippet}` from a vendor list, honouring `count`. */
function collect(
  list: unknown,
  count: number | undefined,
  map: (entry: Record<string, unknown>) => SearchHit | undefined,
): SearchHit[] {
  if (!Array.isArray(list)) return [];
  const hits: SearchHit[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    const hit = map(entry as Record<string, unknown>);
    if (hit === undefined) continue;
    hits.push(hit);
    if (count !== undefined && hits.length >= count) break;
  }
  return hits;
}

// ── Brave ────────────────────────────────────────────────────────────────────
// GET https://api.search.brave.com/res/v1/web/search, header X-Subscription-Token.
// Hits: web.results[].{title,url,description}. Freshness: pd/pw/pm/py.
// Free tier: a few thousand queries per month.

const BRAVE_FRESHNESS: Record<Freshness, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

export class BraveWebSearchAdapter implements LocalWebSearchAdapter {
  private readonly apiKey: string;

  constructor(private readonly options: DirectProviderOptions) {
    this.apiKey = options.apiKey;
  }

  async search(_ctx: unknown, input: WebSearchInput, signal?: AbortSignal): Promise<ToolResult> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', input.query);
    const count = limitOf(input);
    if (count !== undefined) url.searchParams.set('count', String(count));
    const freshness = freshnessOf(input);
    if (freshness !== undefined) url.searchParams.set('freshness', BRAVE_FRESHNESS[freshness]);

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
        signal: combinedSignal(signal),
      });
    } catch (error) {
      return failure('brave', `code:${transportCode(error) ?? 'transport'}`, error);
    }
    if (!response.ok) return failure('brave', `http:${response.status}`);

    const parsed = await readJson(response);
    if (!parsed.ok) return failure('brave', 'error:invalid-json');
    const web = (parsed.body as { web?: { results?: unknown } }).web;
    const results = collect(web?.results, count, (entry) => {
      const link = str(entry.url);
      if (link === undefined) return undefined;
      return { title: str(entry.title) ?? link, url: link, snippet: str(entry.description) ?? '' };
    });
    return success('brave', input.query, results);
  }
}

// ── Serper ───────────────────────────────────────────────────────────────────
// POST https://google.serper.dev/search, header X-API-KEY, body {q,num,tbs}.
// Hits: organic[].{title,link,snippet}. Freshness: tbs=qdr:d|w|m|y.

const SERPER_FRESHNESS: Record<Freshness, string> = {
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
};

export class SerperWebSearchAdapter implements LocalWebSearchAdapter {
  private readonly apiKey: string;

  constructor(private readonly options: DirectProviderOptions) {
    this.apiKey = options.apiKey;
  }

  async search(_ctx: unknown, input: WebSearchInput, signal?: AbortSignal): Promise<ToolResult> {
    const count = limitOf(input);
    const freshness = freshnessOf(input);
    const body: Record<string, unknown> = { q: input.query };
    if (count !== undefined) body.num = count;
    if (freshness !== undefined) body.tbs = SERPER_FRESHNESS[freshness];

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: combinedSignal(signal),
      });
    } catch (error) {
      return failure('serper', `code:${transportCode(error) ?? 'transport'}`, error);
    }
    if (!response.ok) return failure('serper', `http:${response.status}`);

    const parsed = await readJson(response);
    if (!parsed.ok) return failure('serper', 'error:invalid-json');
    const results = collect((parsed.body as { organic?: unknown }).organic, count, (entry) => {
      const link = str(entry.link);
      if (link === undefined) return undefined;
      return { title: str(entry.title) ?? link, url: link, snippet: str(entry.snippet) ?? '' };
    });
    return success('serper', input.query, results);
  }
}

// ── Tavily ───────────────────────────────────────────────────────────────────
// POST https://api.tavily.com/search, header Authorization: Bearer <key>.
// Body {query,max_results,time_range}. Hits: results[].{title,url,content}.

export class TavilyWebSearchAdapter implements LocalWebSearchAdapter {
  private readonly apiKey: string;

  constructor(private readonly options: DirectProviderOptions) {
    this.apiKey = options.apiKey;
  }

  async search(_ctx: unknown, input: WebSearchInput, signal?: AbortSignal): Promise<ToolResult> {
    const count = limitOf(input);
    const freshness = freshnessOf(input);
    const body: Record<string, unknown> = { query: input.query };
    if (count !== undefined) body.max_results = count;
    if (freshness !== undefined) body.time_range = freshness;

    let response: Response;
    try {
      response = await (this.options.fetchImpl ?? fetch)('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal(signal),
      });
    } catch (error) {
      return failure('tavily', `code:${transportCode(error) ?? 'transport'}`, error);
    }
    if (!response.ok) return failure('tavily', `http:${response.status}`);

    const parsed = await readJson(response);
    if (!parsed.ok) return failure('tavily', 'error:invalid-json');
    const results = collect((parsed.body as { results?: unknown }).results, count, (entry) => {
      const link = str(entry.url);
      if (link === undefined) return undefined;
      return { title: str(entry.title) ?? link, url: link, snippet: str(entry.content) ?? '' };
    });
    return success('tavily', input.query, results);
  }
}
