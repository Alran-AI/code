import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalWebSearchAdapter } from './index.js';
import { SearxngWebSearchAdapter } from './searxng-web-search.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLocalWebSearchAdapter', () => {
  it('uses the direct SearXNG provider when SEARXNG_URL is set', () => {
    const adapter = createLocalWebSearchAdapter({
      SEARXNG_URL: 'http://127.0.0.1:8080',
    });

    expect(adapter).toBeInstanceOf(SearxngWebSearchAdapter);
  });

  it('keeps the managed Matrix client when SEARXNG_URL is absent', () => {
    const adapter = createLocalWebSearchAdapter({});

    expect(adapter).not.toBeInstanceOf(SearxngWebSearchAdapter);
  });
});

describe('BYOK provider order', () => {
  it('prefers the customer key order: Brave, Serper, Tavily, then SearXNG', async () => {
    const { resolveWebSearchProvider } = await import('./provider-resolution.js');

    expect(resolveWebSearchProvider({ BRAVE_API_KEY: 'b', SERPER_API_KEY: 's' }, false)).toMatchObject({
      kind: 'brave',
    });
    expect(resolveWebSearchProvider({ SERPER_API_KEY: 's', TAVILY_API_KEY: 't' }, false)).toMatchObject({
      kind: 'serper',
    });
    expect(resolveWebSearchProvider({ TAVILY_API_KEY: 't' }, false)).toMatchObject({ kind: 'tavily' });
    expect(resolveWebSearchProvider({ SEARXNG_URL: 'http://127.0.0.1:8080' }, false)).toMatchObject({
      kind: 'searxng',
    });
  });

  it('lets a customer key win over a shared SearXNG instance', async () => {
    const { resolveWebSearchProvider } = await import('./provider-resolution.js');

    expect(
      resolveWebSearchProvider(
        { BRAVE_API_KEY: 'b', SEARXNG_URL: 'http://127.0.0.1:8080' },
        false,
      ),
    ).toMatchObject({ kind: 'brave' });
  });

  it('treats blank keys as unset', async () => {
    const { resolveWebSearchProvider } = await import('./provider-resolution.js');

    expect(resolveWebSearchProvider({ BRAVE_API_KEY: '  ' }, false)).toEqual({ kind: 'none' });
  });
});
