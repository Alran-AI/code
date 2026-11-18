import { describe, expect, it } from 'vitest';

import { callMatrixTool, type CallMatrixToolOptions } from './client.js';

function options(overrides: Partial<CallMatrixToolOptions> = {}): CallMatrixToolOptions {
  return {
    toolName: 'web_search',
    path: '/matrix/api/v1/mcp/web_search',
    input: { query: 'test' },
    ctx: { sessionId: 'session-1', turnId: 'turn-1' },
    archonServer: {
      postJson: async () => ({}),
    },
    ...overrides,
  };
}

/** A transport error shaped like the one Undici raises for an unreachable host. */
function dnsFailure(): Error {
  const error = new TypeError('fetch failed');
  (error as TypeError & { cause?: unknown }).cause = Object.assign(
    new Error('getaddrinfo ENOTFOUND matrix-overseas-test.example.invalid'),
    { code: 'ENOTFOUND' },
  );
  return error;
}

describe('matrix tool request failures', () => {
  it('surfaces the transport cause instead of a generic message', async () => {
    const result = await callMatrixTool(
      options({
        archonServer: {
          postJson: async () => {
            throw dnsFailure();
          },
        },
      }),
    );

    expect(result.details?.ok).toBe(false);
    expect(result.details?.error_code).toBe('MATRIX_TOOL_REQUEST_FAILED');
    // A DNS failure has no HTTP status; the reason must still be actionable.
    expect(result.details?.http_status).toBeUndefined();
    expect(result.details?.reason).toBe('code:ENOTFOUND');
    expect(result.text).toContain('ENOTFOUND');
  });

  it('keeps the HTTP status when the backend answered with an error status', async () => {
    const result = await callMatrixTool(
      options({
        archonServer: {
          postJson: async () => {
            throw new Error('Matrix backend /matrix/api/v1/mcp/web_search HTTP 502: bad gateway');
          },
        },
      }),
    );

    expect(result.details?.http_status).toBe(502);
    expect(result.details?.reason).toBe('http:502');
    expect(result.text).toContain('502');
  });
});
