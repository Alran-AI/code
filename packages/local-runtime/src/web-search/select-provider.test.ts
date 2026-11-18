import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalWebSearchAdapter } from './index.js';
import { ExaWebSearchAdapter } from './exa-web-search.js';
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

  it('uses keyless Exa when no provider is configured', () => {
    const adapter = createLocalWebSearchAdapter({});

    expect(adapter).toBeInstanceOf(ExaWebSearchAdapter);
    expect(adapter).not.toBeInstanceOf(SearxngWebSearchAdapter);
  });

  it('uses an authenticated Exa adapter for EXA_API_KEY', () => {
    const adapter = createLocalWebSearchAdapter({ EXA_API_KEY: 'exa-key' });

    expect(adapter).toBeInstanceOf(ExaWebSearchAdapter);
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

  it('treats blank keys as unset and falls back to keyless Exa', async () => {
    const { resolveWebSearchProvider } = await import('./provider-resolution.js');

    expect(resolveWebSearchProvider({ BRAVE_API_KEY: '  ' }, false)).toEqual({
      kind: 'exa',
      apiKey: undefined,
    });
  });
});
