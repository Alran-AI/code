import { describe, expect, it, vi } from 'vitest';

import { SearxngWebSearchAdapter, searxngUrlFromEnv } from './searxng-web-search.js';

const ctx = { sessionId: 's', turnId: 't' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const searxngPayload = {
  query: 'alran',
  results: [
    {
      url: 'https://example.test/a',
      title: 'Alpha',
      content: 'First snippet',
      engine: 'google',
    },
    {
      url: 'https://example.test/b',
      title: 'Beta',
      content: 'Second snippet',
      engine: 'bing',
    },
  ],
  unresponsive_engines: [] as string[][],
};

describe('SearxngWebSearchAdapter', () => {
  it('maps SearXNG results to the same title/url/snippet shape as the Matrix path', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(searxngPayload));
    const adapter = new SearxngWebSearchAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    const result = await adapter.search(ctx, { query: 'alran', count: 5 });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.text) as {
      results: Array<{ title: string; url: string; snippet: string }>;
    };
    expect(payload.results).toEqual([
      { title: 'Alpha', url: 'https://example.test/a', snippet: 'First snippet' },
      { title: 'Beta', url: 'https://example.test/b', snippet: 'Second snippet' },
    ]);

    const [url, request] = fetchImpl.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe('/search');
    expect(parsed.searchParams.get('q')).toBe('alran');
    expect(parsed.searchParams.get('format')).toBe('json');
    expect(request?.method).toBe('GET');
  });

  it('keeps an IPv6 host in brackets when it builds the request URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(searxngPayload));
    const adapter = new SearxngWebSearchAdapter({
      baseUrl: 'http://[fd7a::1]:18888',
      fetchImpl,
    });

    await adapter.search(ctx, { query: 'alran' });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      'http://[fd7a::1]:18888/search',
    );
  });

  it('reports the HTTP status as the failure reason instead of a generic error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'boom' }, 502));
    const adapter = new SearxngWebSearchAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    const result = await adapter.search(ctx, { query: 'alran' });

    expect(result.isError).toBe(true);
    expect(result.details?.ok).toBe(false);
    expect(result.details?.reason).toBe('http:502');
    expect(result.text).toContain('502');
  });

  it('reports a transport error code as the failure reason', async () => {
    const failure = new TypeError('fetch failed');
    (failure as TypeError & { cause?: unknown }).cause = Object.assign(
      new Error('getaddrinfo ENOTFOUND searxng.invalid'),
      { code: 'ENOTFOUND' },
    );
    const adapter = new SearxngWebSearchAdapter({
      baseUrl: 'http://searxng.invalid:18888',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(failure),
    });

    const result = await adapter.search(ctx, { query: 'alran' });

    expect(result.isError).toBe(true);
    expect(result.details?.reason).toBe('code:ENOTFOUND');
    expect(result.text).toContain('ENOTFOUND');
  });

  it('honours the result count without exceeding what SearXNG returned', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(searxngPayload));
    const adapter = new SearxngWebSearchAdapter({
      baseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
    });

    const result = await adapter.search(ctx, { query: 'alran', count: 1 });

    const payload = JSON.parse(result.text) as { results: unknown[] };
    expect(payload.results).toHaveLength(1);
  });
});

describe('searxngUrlFromEnv', () => {
  it('returns the SEARXNG_URL when set', () => {
    expect(searxngUrlFromEnv({ SEARXNG_URL: 'http://[fd7a::1]:18888' })).toBe(
      'http://[fd7a::1]:18888',
    );
  });

  it('returns undefined when unset or blank', () => {
    expect(searxngUrlFromEnv({})).toBeUndefined();
    expect(searxngUrlFromEnv({ SEARXNG_URL: '   ' })).toBeUndefined();
  });
});
