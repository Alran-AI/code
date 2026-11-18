import { describe, expect, it, vi } from 'vitest';

import { resolveWebSearchProvider, SEARXNG_SETUP_HINT } from './provider-resolution.js';

describe('resolveWebSearchProvider', () => {
  it('picks SearXNG when SEARXNG_URL is set', () => {
    expect(resolveWebSearchProvider({ SEARXNG_URL: 'http://[fd7a::1]:18888' }, false)).toEqual({
      kind: 'searxng',
      baseUrl: 'http://[fd7a::1]:18888',
    });
  });

  it('falls back to the managed Matrix route when a login token exists', () => {
    expect(resolveWebSearchProvider({}, true)).toEqual({ kind: 'matrix' });
  });

  it('answers none when neither SearXNG nor a Matrix token exists', () => {
    expect(resolveWebSearchProvider({}, false)).toEqual({ kind: 'none' });
  });

  it('prefers SearXNG even when Matrix would also be available', () => {
    expect(
      resolveWebSearchProvider({ SEARXNG_URL: 'http://[fd7a::1]:18888' }, true),
    ).toMatchObject({ kind: 'searxng' });
  });

  it('treats a blank SEARXNG_URL as unset', () => {
    expect(resolveWebSearchProvider({ SEARXNG_URL: '   ' }, false)).toEqual({ kind: 'none' });
  });

  it('names SEARXNG_URL in the setup hint that the host shows at start', () => {
    expect(SEARXNG_SETUP_HINT).toContain('SEARXNG_URL');
  });
});

describe('createLocalWebSearchAdapter with a gateway key', () => {
  it('passes SEARXNG_API_KEY to the SearXNG adapter', async () => {
    const { createLocalWebSearchAdapter } = await import('./index.js');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = createLocalWebSearchAdapter(
      { SEARXNG_URL: 'https://search.example.test', SEARXNG_API_KEY: 'gateway-key' },
      { fetchImpl },
    );
    await adapter.search({}, { query: 'x' });

    const [, request] = fetchImpl.mock.calls[0]!;
    expect(new Headers(request?.headers).get('x-api-key')).toBe('gateway-key');
  });
});
