/**
 * Exa web search over the hosted MCP server — the zero-setup default.
 *
 * Keyless mode needs no account, key or Ottili server: the request goes from the user's own
 * machine straight to Exa, so Exa sees (and rate-limits) the user's IP, not ours. Exa documents
 * that keyless access requires a direct IPv4 connection; a 403 here means IPv6 or a proxy is in
 * the way, and the failure text says so. An optional `EXA_API_KEY` moves the call onto the user's
 * own Exa plan and also works from proxied networks.
 *
 * The MCP protocol is a small streamable-HTTP handshake: initialize, optional initialized
 * notification, then one tools/call. Results are normalised to the same `{ title, url, snippet }`
 * shape every other web-search provider returns, so the model sees one contract.
 */

import type { LocalWebSearchAdapter, WebSearchInput } from '@alran/agent-tools/desktop';
import type { ToolResult } from '@alran/agent-core/tools';

const TOOL_NAME = 'web_search';
/** Restrict the exposed tools: we only need search, not fetch or the agent. */
const MCP_URL = 'https://mcp.exa.ai/mcp?tools=web_search_exa';
const EXA_TOOL = 'web_search_exa';
const PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SNIPPET_LENGTH = 600;
/** Caps a provider message in the failure label so no long body leaks into tool output. */
const MAX_REASON_LENGTH = 120;

export interface ExaWebSearchOptions {
  /** Optional. Keyless uses Exa's free per-IP rate limit; a key uses the customer's own plan. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface JsonRpcResponse {
  result?: {
    content?: Array<{ type?: unknown; text?: unknown }>;
    isError?: unknown;
  };
  error?: {
    message?: unknown;
    code?: unknown;
  };
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

/** MCP answers as SSE (`data: {...}`); plain JSON is accepted too for tolerant test doubles. */
function parseMcpBody(raw: string): JsonRpcResponse | undefined {
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data.length === 0) continue;
    try {
      return JSON.parse(data) as JsonRpcResponse;
    } catch {
      return undefined;
    }
  }
  try {
    return JSON.parse(raw) as JsonRpcResponse;
  } catch {
    return undefined;
  }
}

function failure(provider: string, reason: string, hint?: string, error?: unknown): ToolResult {
  const suffix =
    error instanceof Error && error.message.trim().length > 0 ? ` ${clip(error.message)}` : '';
  const text =
    `WEB_SEARCH_FAILED: web search via ${provider} failed (reason: ${reason})` +
    `${hint === undefined ? '' : ` ${hint}`}${suffix}`;
  return {
    tool_name: TOOL_NAME,
    text,
    content: [{ type: 'text', text }],
    isError: true,
    details: { ok: false, provider, error_code: 'WEB_SEARCH_FAILED', reason },
  };
}

function success(query: string, results: SearchHit[]): ToolResult {
  const text = JSON.stringify({ query, results, total: results.length });
  return {
    tool_name: TOOL_NAME,
    text,
    content: [{ type: 'text', text }],
    details: { ok: true, provider: 'exa', total: results.length },
  };
}

/** `web_search_exa` asks for an objective in addition to the query; freshness is expressed there. */
function objectiveOf(input: WebSearchInput): string {
  const freshness = input.freshness;
  const window =
    freshness === 'day'
      ? 'the last day'
      : freshness === 'week'
        ? 'the last week'
        : freshness === 'month'
          ? 'the last month'
          : freshness === 'year'
            ? 'the last year'
            : undefined;
  return [
    'Find authoritative pages that answer the query and include their title and URL.',
    window === undefined ? undefined : `Prefer pages published within ${window}.`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

/** Exa renders each hit as `Title:` / `URL:` / `Highlights:` blocks separated by `---`. */
export function mapExaResults(text: string, count?: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const block of text.split(/\n---\s*\n/u)) {
    const title = /^Title:\s*(.+)$/mu.exec(block)?.[1]?.trim();
    const url = /^URL:\s*(\S+)/mu.exec(block)?.[1]?.trim();
    if (title === undefined || title.length === 0 || url === undefined || url.length === 0) {
      continue;
    }
    const marker = block.indexOf('Highlights:');
    const snippet = (marker === -1 ? '' : block.slice(marker + 'Highlights:'.length))
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_SNIPPET_LENGTH);
    hits.push({ title, url, snippet });
    if (count !== undefined && hits.length >= count) break;
  }
  return hits;
}

export class ExaWebSearchAdapter implements LocalWebSearchAdapter {
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ExaWebSearchOptions = {}) {
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
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      ...(this.apiKey === undefined ? {} : { 'x-api-key': this.apiKey }),
    };

    const post = async (body: unknown, sessionId?: string): Promise<Response> =>
      this.fetchImpl(MCP_URL, {
        method: 'POST',
        headers: sessionId === undefined ? headers : { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

    let initResponse: Response;
    try {
      initResponse = await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'alran-code', version: '1' },
        },
      });
    } catch (error) {
      return failure('exa', `code:${transportCode(error) ?? 'transport'}`, undefined, error);
    }
    if (!initResponse.ok) return this.httpFailure(initResponse.status);

    const initBody = await initResponse.text();
    const initPayload = parseMcpBody(initBody);
    if (initPayload?.error !== undefined) {
      return failure('exa', `mcp:${clip(String(initPayload.error.message ?? 'initialize failed'))}`);
    }
    const sessionId = initResponse.headers.get('mcp-session-id') ?? undefined;

    // The notification is optional in practice, but a well-behaved client sends it.
    try {
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
    } catch {
      // Ignore: Exa accepts tools/call without it.
    }

    let callResponse: Response;
    try {
      callResponse = await post(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: EXA_TOOL,
            arguments: {
              query: input.query,
              objective: objectiveOf(input),
              ...(input.count === undefined ? {} : { numResults: input.count }),
            },
          },
        },
        sessionId,
      );
    } catch (error) {
      return failure('exa', `code:${transportCode(error) ?? 'transport'}`, undefined, error);
    }
    if (!callResponse.ok) return this.httpFailure(callResponse.status);

    const payload = parseMcpBody(await callResponse.text());
    if (payload?.error !== undefined) {
      return failure('exa', `mcp:${clip(String(payload.error.message ?? 'call failed'))}`);
    }
    if (payload?.result?.isError === true) {
      return failure('exa', 'tool:error');
    }
    const text = (payload?.result?.content ?? [])
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n');
    return success(input.query, mapExaResults(text, input.count));
  }

  /** Keyless users are the ones who hit 403 (IPv6/proxy) or 429 (free quota). Say what to do. */
  private httpFailure(status: number): ToolResult {
    if (status === 403) {
      return failure(
        'exa',
        'http:403',
        'Keyless Exa needs a direct IPv4 connection; set EXA_API_KEY or another search provider.',
      );
    }
    if (status === 429) {
      return failure(
        'exa',
        'http:429',
        'Exa free rate limit reached; set EXA_API_KEY or another search provider.',
      );
    }
    return failure('exa', `http:${status}`);
  }
}
