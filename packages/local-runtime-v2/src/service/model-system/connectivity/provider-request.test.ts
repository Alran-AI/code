import { describe, expect, it } from 'vitest';

import {
  normalizeProviderBaseUrl,
  providerCompletionUrl,
  providerModelsUrls,
} from './provider-request.js';

describe('provider endpoint URLs', () => {
  it('appends endpoints to the path of a plain base URL', () => {
    expect(providerCompletionUrl('openai-completions', 'https://gw.example/v1/')).toBe(
      'https://gw.example/v1/chat/completions',
    );
    expect(providerCompletionUrl('openai-responses', 'https://gw.example/v1')).toBe(
      'https://gw.example/v1/responses',
    );
    expect(providerCompletionUrl('anthropic-messages', 'https://gw.example/compat/v1')).toBe(
      'https://gw.example/compat/v1/messages',
    );
    expect(providerModelsUrls('openai-completions', 'https://gw.example/v1')).toEqual([
      'https://gw.example/v1/models',
    ]);
  });

  it('keeps the query after the endpoint path instead of appending the path to it', () => {
    expect(providerCompletionUrl('openai-completions', 'https://gw.example/v1?tenant=a')).toBe(
      'https://gw.example/v1/chat/completions?tenant=a',
    );
    expect(providerCompletionUrl('openai-responses', 'https://gw.example/v1/?tenant=a&x=b%20c')).toBe(
      'https://gw.example/v1/responses?tenant=a&x=b%20c',
    );
    expect(providerCompletionUrl('anthropic-messages', 'https://gw.example/compat?tenant=a')).toBe(
      'https://gw.example/compat/v1/messages?tenant=a',
    );
    expect(providerModelsUrls('openai-completions', 'https://gw.example/v1?tenant=a')).toEqual([
      'https://gw.example/v1/models?tenant=a',
    ]);
  });

  it('keeps the query on every model-list candidate of an Anthropic-compatible gateway', () => {
    expect(providerModelsUrls('anthropic-messages', 'https://gw.example/compat/v1?tenant=a')).toEqual([
      'https://gw.example/compat/v1/models?tenant=a',
      'https://gw.example/compat/models?tenant=a',
      'https://gw.example/models?tenant=a',
    ]);
  });

  it('strips an endpoint the user already typed before the query, and keeps the query', () => {
    expect(
      normalizeProviderBaseUrl('openai-completions', 'https://gw.example/v1/chat/completions?tenant=a'),
    ).toBe('https://gw.example/v1?tenant=a');
    expect(
      normalizeProviderBaseUrl('openai-responses', 'https://gw.example/v1/responses/?tenant=a'),
    ).toBe('https://gw.example/v1?tenant=a');
    expect(
      normalizeProviderBaseUrl('anthropic-messages', 'https://gw.example/v1/messages?tenant=a'),
    ).toBe('https://gw.example?tenant=a');
    expect(
      providerCompletionUrl('openai-completions', 'https://gw.example/v1/chat/completions?tenant=a'),
    ).toBe('https://gw.example/v1/chat/completions?tenant=a');
  });

  it('never sends a fragment: the endpoint goes on the path and the fragment is left out', () => {
    expect(providerCompletionUrl('openai-completions', 'https://gw.example/v1#frag')).toBe(
      'https://gw.example/v1/chat/completions',
    );
    expect(providerCompletionUrl('openai-completions', 'https://gw.example/v1?tenant=a#frag')).toBe(
      'https://gw.example/v1/chat/completions?tenant=a',
    );
    expect(providerModelsUrls('openai-completions', 'https://gw.example/v1?tenant=a#frag')).toEqual([
      'https://gw.example/v1/models?tenant=a',
    ]);
  });

  it('builds requests that reach the endpoint path with the original query', () => {
    const url = new URL(providerCompletionUrl('openai-completions', 'https://gw.example/v1?tenant=a&tenant=b'));

    expect(url.pathname).toBe('/v1/chat/completions');
    expect(url.searchParams.getAll('tenant')).toEqual(['a', 'b']);
  });
});
