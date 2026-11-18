import { describe, expect, it, vi } from 'vitest';

import {
  BraveWebSearchAdapter,
  SerperWebSearchAdapter,
  TavilyWebSearchAdapter,
} from './direct-providers.js';

const ctx = { sessionId: 's', turnId: 't' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const hits = [
  { title: 'Alpha', url: 'https://example.test/a', snippet: 'first' },
  { title: 'Beta', url: 'https://example.test/b', snippet: 'second' },
];

describe('BraveWebSearchAdapter', () => {
  it('maps web.results to title/url/snippet and sends q/count/freshness', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        web: {
          results: [
            { title: 'Alpha', url: 'https://example.test/a', description: 'first' },
            { title: 'Beta', url: 'https://example.test/b', description: 'second' },
          ],
        },
      }),
    );
    const adapter = new BraveWebSearchAdapter({ apiKey: 'brave-key', fetchImpl });

    const result = await adapter.search(ctx, { query: 'alran', count: 2, freshness: 'week' });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.text).results).toEqual(hits);

    const [rawUrl, request] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin).toBe('https://api.search.brave.com');
    expect(url.pathname).toBe('/res/v1/web/search');
    expect(url.searchParams.get('q')).toBe('alran');
    expect(url.searchParams.get('count')).toBe('2');
    expect(url.searchParams.get('freshness')).toBe('pw');
    expect(new Headers(request?.headers).get('x-subscription-token')).toBe('brave-key');
  });

  it('reports the HTTP status as reason', async () => {
    const adapter = new BraveWebSearchAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(json({}, 401)),
    });

    const result = await adapter.search(ctx, { query: 'x' });

    expect(result.isError).toBe(true);
    expect(result.details?.reason).toBe('http:401');
  });
});

describe('SerperWebSearchAdapter', () => {
  it('maps organic results and posts q/num/tbs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        organic: [
          { title: 'Alpha', link: 'https://example.test/a', snippet: 'first' },
          { title: 'Beta', link: 'https://example.test/b', snippet: 'second' },
        ],
      }),
    );
    const adapter = new SerperWebSearchAdapter({ apiKey: 'serper-key', fetchImpl });

    const result = await adapter.search(ctx, { query: 'alran', count: 2, freshness: 'month' });

    expect(JSON.parse(result.text).results).toEqual(hits);

    const [rawUrl, request] = fetchImpl.mock.calls[0]!;
    expect(String(rawUrl)).toBe('https://google.serper.dev/search');
    expect(request?.method).toBe('POST');
    expect(new Headers(request?.headers).get('x-api-key')).toBe('serper-key');
    expect(JSON.parse(String(request?.body))).toMatchObject({ q: 'alran', num: 2, tbs: 'qdr:m' });
  });

  it('reports a transport error code as reason', async () => {
    const failure = new TypeError('fetch failed');
    (failure as TypeError & { cause?: unknown }).cause = Object.assign(
      new Error('getaddrinfo ENOTFOUND google.serper.dev'),
      { code: 'ENOTFOUND' },
    );
    const adapter = new SerperWebSearchAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(failure),
    });

    const result = await adapter.search(ctx, { query: 'x' });

    expect(result.details?.reason).toBe('code:ENOTFOUND');
    expect(result.text).toContain('ENOTFOUND');
  });
});

describe('TavilyWebSearchAdapter', () => {
  it('maps results and posts query/max_results/time_range', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        results: [
          { title: 'Alpha', url: 'https://example.test/a', content: 'first' },
          { title: 'Beta', url: 'https://example.test/b', content: 'second' },
        ],
      }),
    );
    const adapter = new TavilyWebSearchAdapter({ apiKey: 'tvly-key', fetchImpl });

    const result = await adapter.search(ctx, { query: 'alran', count: 2, freshness: 'day' });

    expect(JSON.parse(result.text).results).toEqual(hits);

    const [rawUrl, request] = fetchImpl.mock.calls[0]!;
    expect(String(rawUrl)).toBe('https://api.tavily.com/search');
    expect(new Headers(request?.headers).get('authorization')).toBe('Bearer tvly-key');
    expect(JSON.parse(String(request?.body))).toMatchObject({
      query: 'alran',
      max_results: 2,
      time_range: 'day',
    });
  });

  it('reports a bad JSON body as reason', async () => {
    const adapter = new TavilyWebSearchAdapter({
      apiKey: 'k',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 200 })),
    });

    const result = await adapter.search(ctx, { query: 'x' });

    expect(result.details?.reason).toBe('error:invalid-json');
  });
});
