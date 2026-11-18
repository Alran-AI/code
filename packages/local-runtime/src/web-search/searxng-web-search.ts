/**
 * Direct SearXNG web search — no Matrix backend, no Ottili login.
 *
 * Point `SEARXNG_URL` at a self-hosted instance and `web_search` talks to it directly. The
 * adapter reads the SearXNG JSON API (`/search?q=…&format=json`) and maps every hit to the same
 * `title` / `url` / `snippet` shape the Matrix path returns, so the model sees one contract no
 * matter which provider answers.
 *
 * IPv6 literals stay in brackets (`http://[fd7a::1]:8080`); `URL` handles that, so the base URL is
 * validated through it instead of string concatenation.
 */

import type { LocalWebSearchAdapter } from '@alran/agent-tools/desktop';
import type { WebSearchInput } from '@alran/agent-tools/desktop';
import type { ToolResult } from '@alran/agent-core/tools';

const TOOL_NAME = 'web_search';
const REQUEST_TIMEOUT_MS = 20_000;
/** Caps a provider message in the failure label so no long body leaks into tool output. */
const MAX_REASON_LENGTH = 120;

export interface SearxngWebSearchOptions {
  /** Instance base URL, e.g. `http://127.0.0.1:8080` or `http://[::1]:8080`. */
  baseUrl: string;
  /**
   * Credential for an instance behind a key-checking gateway. Sent as `X-Api-Key`; omitted for a
   * bare instance that needs no auth.
   */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

interface SearxngResult {
  url?: unknown;
  title?: unknown;
  content?: unknown;
}

interface SearxngResponse {
  results?: unknown;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Read `SEARXNG_URL` as the direct provider. Blank or missing means "no direct provider", so the
 * caller keeps its existing Matrix path.
 */
export function searxngUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.SEARXNG_URL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * Credential for a key-checking SearXNG gateway. Only needed when `SEARXNG_URL` points at a
 * gateway rather than a bare instance; a private instance on loopback needs none.
 */
export function searxngApiKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.SEARXNG_API_KEY?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export class SearxngWebSearchAdapter implements LocalWebSearchAdapter {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string | undefined;

  constructor(options: SearxngWebSearchOptions) {
    // Normalise once so a trailing slash never produces `//search`.
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/u, '');
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(
    _ctx: unknown,
    input: WebSearchInput,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combinedSignal =
      signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.fetchImpl(this.buildSearchUrl(input), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(this.apiKey === undefined ? {} : { 'x-api-key': this.apiKey }),
        },
        signal: combinedSignal,
      });
    } catch (error) {
      return failure(`code:${transportCode(error) ?? 'transport'}`, error);
    }

    if (!response.ok) {
      return failure(`http:${response.status}`);
    }

    let payload: SearxngResponse;
    try {
      payload = (await response.json()) as SearxngResponse;
    } catch (error) {
      return failure('error:invalid-json', error);
    }

    const results = mapResults(payload, input.count);
    const text = JSON.stringify({ query: input.query, results, total: results.length });
    return {
      tool_name: TOOL_NAME,
      text,
      content: [{ type: 'text', text }],
      details: { ok: true, provider: 'searxng', total: results.length },
    };
  }

  private buildSearchUrl(input: WebSearchInput): string {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', input.query);
    url.searchParams.set('format', 'json');
    if (typeof input.count === 'number' && input.count > 0) {
      url.searchParams.set('count', String(input.count));
    }
    if (typeof input.freshness === 'string' && input.freshness !== 'noLimit') {
      url.searchParams.set('time_range', input.freshness);
    }
    return url.toString();
  }
}

function mapResults(payload: SearxngResponse, count: number | undefined): SearchHit[] {
  const raw = Array.isArray(payload.results) ? (payload.results as SearxngResult[]) : [];
  const hits: SearchHit[] = [];
  for (const entry of raw) {
    if (typeof entry?.url !== 'string' || entry.url.length === 0) continue;
    hits.push({
      title: typeof entry.title === 'string' ? entry.title : entry.url,
      url: entry.url,
      snippet: typeof entry.content === 'string' ? entry.content : '',
    });
    if (typeof count === 'number' && count > 0 && hits.length >= count) break;
  }
  return hits;
}

function transportCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== null && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  const name = (error as { name?: unknown }).name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  return undefined;
}

function failure(reason: string, error?: unknown): ToolResult {
  const detail =
    error instanceof Error && error.message.trim().length > 0
      ? `${reason} ${clip(error.message)}`
      : reason;
  const text = `SEARXNG_SEARCH_FAILED: web search via SearXNG failed (reason: ${clip(detail)})`;
  return {
    tool_name: TOOL_NAME,
    text,
    content: [{ type: 'text', text }],
    isError: true,
    details: { ok: false, provider: 'searxng', error_code: 'SEARXNG_SEARCH_FAILED', reason },
  };
}

function clip(value: string): string {
  return value.length > MAX_REASON_LENGTH ? `${value.slice(0, MAX_REASON_LENGTH)}…` : value;
}
