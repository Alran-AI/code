import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLocalNativeRuntimeTools } from '../api/local-native-tools.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function toolNames(extra: Record<string, unknown> = {}) {
  return buildLocalNativeRuntimeTools({
    workspaceRoot: '/workspace',
    agentName: 'alran',
    webSearchEnabled: true,
    ...extra,
  }).map((tool) => tool.def.name);
}

describe('web_search registration', () => {
  it('is registered by default through keyless Exa', () => {
    vi.stubEnv('SEARXNG_URL', '');

    expect(toolNames()).toContain('web_search');
  });

  it('is not registered when keyless Exa is off and no other route exists', () => {
    vi.stubEnv('SEARXNG_URL', '');
    vi.stubEnv('ALRAN_DISABLE_KEYLESS_EXA', '1');

    expect(toolNames()).not.toContain('web_search');
  });

  it('is registered when SEARXNG_URL is set', () => {
    vi.stubEnv('SEARXNG_URL', 'http://[fd7a::1]:18888');

    expect(toolNames()).toContain('web_search');
  });

  it('is registered when a Matrix session exists even without SEARXNG_URL', () => {
    vi.stubEnv('SEARXNG_URL', '');

    expect(toolNames({ authContext: { accessToken: 'managed-token' } })).toContain('web_search');
  });

  it('is never registered when the product gate is off, whatever the environment says', () => {
    vi.stubEnv('SEARXNG_URL', 'http://[fd7a::1]:18888');

    expect(
      buildLocalNativeRuntimeTools({
        workspaceRoot: '/workspace',
        agentName: 'alran',
        webSearchEnabled: false,
      }).map((tool) => tool.def.name),
    ).not.toContain('web_search');
  });
});
