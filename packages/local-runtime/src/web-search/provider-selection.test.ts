import { describe, expect, it, vi } from 'vitest';

import {
  KEYLESS_EXA_DISABLE_ENV,
  resolveWebSearchProvider,
  SEARXNG_SETUP_HINT,
} from './provider-resolution.js';

describe('resolveWebSearchProvider', () => {
  it('uses keyless Exa when nothing is configured', () => {
    expect(resolveWebSearchProvider({}, false)).toEqual({ kind: 'exa', apiKey: undefined });
  });

  it('uses keyless Exa even when a Matrix login exists', () => {
    expect(resolveWebSearchProvider({}, true)).toEqual({ kind: 'exa', apiKey: undefined });
  });

  it('picks SearXNG when SEARXNG_URL is set', () => {
    expect(resolveWebSearchProvider({ SEARXNG_URL: 'http://[fd7a::1]:18888' }, false)).toEqual({
      kind: 'searxng',
      baseUrl: 'http://[fd7a::1]:18888',
    });
  });

  it('uses an explicit Exa key on the customer own plan', () => {
    expect(resolveWebSearchProvider({ EXA_API_KEY: 'exa-key' }, false)).toEqual({
      kind: 'exa',
      apiKey: 'exa-key',
    });
  });

  it('falls back to Matrix only when keyless Exa is disabled and a login exists', () => {
    expect(
      resolveWebSearchProvider({ [KEYLESS_EXA_DISABLE_ENV]: '1' }, true),
    ).toEqual({ kind: 'matrix' });
  });

  it('answers none when keyless Exa is disabled and no alternative exists', () => {
    expect(resolveWebSearchProvider({ [KEYLESS_EXA_DISABLE_ENV]: '1' }, false)).toEqual({
      kind: 'none',
    });
  });

  it('prefers SearXNG even when Matrix would also be available', () => {
    expect(
      resolveWebSearchProvider({ SEARXNG_URL: 'http://[fd7a::1]:18888' }, true),
    ).toMatchObject({ kind: 'searxng' });
  });

  it('treats a blank SEARXNG_URL as unset', () => {
    expect(resolveWebSearchProvider({ SEARXNG_URL: '   ' }, false)).toEqual({
      kind: 'exa',
      apiKey: undefined,
    });
  });

  it('names the setup options in the hint the host shows at start', () => {
    expect(SEARXNG_SETUP_HINT).toContain('EXA_API_KEY');
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
    await adapter!.search({}, { query: 'x' });

    const [, request] = fetchImpl.mock.calls[0]!;
    expect(new Headers(request?.headers).get('x-api-key')).toBe('gateway-key');
  });
});
