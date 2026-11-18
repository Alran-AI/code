import { describe, expect, it, vi } from 'vitest';

import { ExaWebSearchAdapter, mapExaResults } from './exa-web-search.js';

const SEARCH_TEXT = [
  'Title: First result',
  'URL: https://example.test/first',
  'Published: 2026-11-01T00:00:00.000Z',
  'Highlights:',
  'Short   summary with   whitespace.',
  '',
  '---',
  '',
  'Title: Second result',
  'URL: https://example.test/second',
  'Highlights:',
  'Another summary.',
].join('\n');

function sse(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

function mockMcpFetch(options: { initStatus?: number; callStatus?: number } = {}) {
  const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body,
    });
    const method = body.method;
    if (method === 'initialize') {
      return new Response(
        sse({ result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: {} } }),
        {
          status: options.initStatus ?? 200,
          headers: { 'mcp-session-id': 'session-1' },
        },
      );
    }
    if (method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }
    if (options.callStatus !== undefined && options.callStatus !== 200) {
      return new Response('', { status: options.callStatus });
    }
    return new Response(
      sse({
        result: {
          content: [{ type: 'text', text: SEARCH_TEXT }],
        },
      }),
      { status: 200 },
    );
  });
  return { fetchImpl, calls };
}

describe('ExaWebSearchAdapter', () => {
  it('runs the MCP handshake keylessly and returns the shared result shape', async () => {
    const { fetchImpl, calls } = mockMcpFetch();
    const adapter = new ExaWebSearchAdapter({ fetchImpl });

    const result = await adapter.search({}, { query: 'Bun release', count: 2, freshness: 'week' });

    expect(result.isError).toBeFalsy();
    expect(result.details).toMatchObject({ ok: true, provider: 'exa', total: 2 });
    expect(JSON.parse(result.text)).toEqual({
      query: 'Bun release',
      results: [
        {
          title: 'First result',
          url: 'https://example.test/first',
          snippet: 'Short summary with whitespace.',
        },
        {
          title: 'Second result',
          url: 'https://example.test/second',
          snippet: 'Another summary.',
        },
      ],
      total: 2,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toContain('mcp.exa.ai/mcp');
    expect(calls[0]!.headers.get('x-api-key')).toBeNull();
    expect(calls[0]!.body.method).toBe('initialize');
    expect(calls[2]!.body.method).toBe('tools/call');
    expect(calls[2]!.headers.get('mcp-session-id')).toBe('session-1');
    const args = (calls[2]!.body.params as { arguments: Record<string, unknown> }).arguments;
    expect(args.query).toBe('Bun release');
    expect(args.numResults).toBe(2);
    expect(String(args.objective)).toContain('last week');
  });

  it('sends EXA_API_KEY as x-api-key when the customer supplies one', async () => {
    const { fetchImpl, calls } = mockMcpFetch();
    const adapter = new ExaWebSearchAdapter({ apiKey: 'my-exa-key', fetchImpl });

    await adapter.search({}, { query: 'x' });

    expect(calls[0]!.headers.get('x-api-key')).toBe('my-exa-key');
  });

  it('turns a keyless 403 into an actionable reason', async () => {
    const { fetchImpl } = mockMcpFetch({ initStatus: 403 });
    const adapter = new ExaWebSearchAdapter({ fetchImpl });

    const result = await adapter.search({}, { query: 'x' });

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ ok: false, provider: 'exa', reason: 'http:403' });
    expect(result.text).toContain('direct IPv4');
    expect(result.text).toContain('EXA_API_KEY');
  });

  it('turns a free-tier 429 into an actionable reason', async () => {
    const { fetchImpl } = mockMcpFetch({ callStatus: 429 });
    const adapter = new ExaWebSearchAdapter({ fetchImpl });

    const result = await adapter.search({}, { query: 'x' });

    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ reason: 'http:429' });
    expect(result.text).toContain('rate limit');
  });
});

describe('mapExaResults', () => {
  it('caps the number of hits and ignores malformed blocks', () => {
    const text = `${SEARCH_TEXT}\n---\nTitle: no url\nHighlights: nope`;

    expect(mapExaResults(text, 1)).toEqual([
      {
        title: 'First result',
        url: 'https://example.test/first',
        snippet: 'Short summary with whitespace.',
      },
    ]);
  });
});
