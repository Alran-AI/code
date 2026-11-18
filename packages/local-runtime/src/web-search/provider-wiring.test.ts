import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildLocalNativeRuntimeTools } from '../api/local-native-tools.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function searchTool(fetchImpl: typeof fetch) {
  const tools = buildLocalNativeRuntimeTools({
    workspaceRoot: '/workspace',
    agentName: 'alran',
    webSearchEnabled: true,
    fetchImpl,
  });
  const tool = tools.find((candidate) => candidate.def.name === 'web_search');
  if (!tool) throw new Error('web_search was not registered');
  return tool;
}

describe('native web_search provider selection', () => {
  it('calls SearXNG directly when SEARXNG_URL is set, without any gateway request', async () => {
    vi.stubEnv('SEARXNG_URL', 'http://[fd7a::1]:18888');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ url: 'https://example.test', title: 'T', content: 'S' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const tool = searchTool(fetchImpl);
    const result = await tool.impl.execute({ sessionId: 's', turnId: 't' }, { query: 'alran' });

    expect(result.isError).toBeFalsy();
    const requested = String(fetchImpl.mock.calls[0]![0]);
    expect(requested).toContain('http://[fd7a::1]:18888/search');
    expect(requested).not.toContain('/alran/api/v1/mcp');
  });
});
