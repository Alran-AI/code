import { describe, expect, it } from 'vitest';

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
