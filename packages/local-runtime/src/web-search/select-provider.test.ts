import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalWebSearchAdapter } from './index.js';
import { SearxngWebSearchAdapter } from './searxng-web-search.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createLocalWebSearchAdapter', () => {
  it('uses the direct SearXNG provider when SEARXNG_URL is set', () => {
    const adapter = createLocalWebSearchAdapter({
      SEARXNG_URL: 'http://[fd7a::1]:18888',
    });

    expect(adapter).toBeInstanceOf(SearxngWebSearchAdapter);
  });

  it('keeps the managed Matrix client when SEARXNG_URL is absent', () => {
    const adapter = createLocalWebSearchAdapter({});

    expect(adapter).not.toBeInstanceOf(SearxngWebSearchAdapter);
  });
});
