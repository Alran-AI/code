import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  streamSimple,
  type AssistantMessage,
} from '@earendil-works/pi-ai';
import { isRequestMediaRejection } from '@alran/context-manager';
import {
  isLLMDeterministicRequestRejection,
  LLM_ERROR_CODES,
  normalizeLLMError,
  toLLMRetryDecision,
} from '@alran/shared/llm-error-classifier';
import { logger } from '@alran/shared/local-runtime-logging';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withByokErrorAttribution } from './byok-error-attribution.js';

const JSON_BODY_413 =
  '413 {"type":"error","error":{"type":"request_too_large","message":"Request exceeds the maximum allowed number of bytes."}}';

function failedWith(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'custom',
    model: 'm',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'error',
    errorMessage,
    timestamp: 0,
  };
}

async function attributed(errorMessage: string): Promise<AssistantMessage> {
  const base: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    const final = failedWith(errorMessage);
    stream.push({ type: 'error', reason: 'error', error: final });
    stream.end();
    return stream;
  };
  const streamFn = withByokErrorAttribution({ streamFn: base, providerId: 'custom_provider:p' });
  const stream = await streamFn({} as never, { messages: [] }, {});
  return stream.result();
}

function payloadOf(message: AssistantMessage): Record<string, unknown> {
  const text = message.errorMessage ?? '';
  return JSON.parse(text.slice(text.indexOf('{'))) as Record<string, unknown>;
}

describe('withByokErrorAttribution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the HTTP status of a JSON error body so a 413 stays a request-size rejection', async () => {
    const message = await attributed(JSON_BODY_413);

    expect(payloadOf(message)).toMatchObject({
      errorDetail: '413 Request exceeds the maximum allowed number of bytes.',
      errorProviderId: 'custom_provider:p',
      errorSource: 'byok_upstream',
    });
    expect(isRequestMediaRejection(message)).toBe(true);
    expect(
      isLLMDeterministicRequestRejection(
        normalizeLLMError({ finishReason: 'error', errorMessage: message.errorMessage }),
      ),
    ).toBe(true);
  });

  it('keeps the error code and only prefixes the status of other JSON error bodies', async () => {
    const message = await attributed(
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    );

    expect(payloadOf(message)).toMatchObject({
      errorCode: LLM_ERROR_CODES.LLM_AUTH_ERROR,
      errorDetail: '401 invalid x-api-key',
    });
  });

  it('leaves a message that already starts with its status unchanged', async () => {
    const message = await attributed('413 Request exceeds the maximum allowed number of bytes.');

    expect(payloadOf(message).errorDetail).toBe(
      '413 Request exceeds the maximum allowed number of bytes.',
    );
  });

  it('adds nothing to a message without a status', async () => {
    const message = await attributed('Connection error.');

    expect(payloadOf(message).errorDetail).toBe('Connection error.');
  });

  describe('a connection that never produced an HTTP response', () => {
    /** What the HTTP client reports: a bare sentence on top, the real cause underneath. */
    function connectionFailure(code: string, message: string): Error {
      const root = Object.assign(new Error(message), { code });
      const fetchFailure = new TypeError('fetch failed', { cause: root });
      return Object.assign(new Error('Connection error.'), { cause: fetchFailure });
    }

    async function failingWith(error: Error, errorMessage: string): Promise<AssistantMessage> {
      const base: StreamFn = (model, _context, options) => {
        // pi-ai hands the original exception to the host before it keeps only its text.
        options?.onProviderError?.(error, model);
        const stream = createAssistantMessageEventStream();
        stream.push({ type: 'error', reason: 'error', error: failedWith(errorMessage) });
        stream.end();
        return stream;
      };
      const streamFn = withByokErrorAttribution({ streamFn: base, providerId: 'custom_provider:p' });
      return (await streamFn({} as never, { messages: [] }, {})).result();
    }

    it('names the refused address instead of only "Connection error."', async () => {
      const message = await failingWith(
        connectionFailure('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.7:8443'),
        'Connection error.',
      );

      expect(payloadOf(message)).toMatchObject({
        errorCode: LLM_ERROR_CODES.LLM_UPSTREAM_ERROR,
        errorDetail: 'Connection error. (connect ECONNREFUSED 10.0.0.7:8443)',
        errorSource: 'byok_upstream',
      });
    });

    it('names the host that did not resolve and the certificate problem of a TLS failure', async () => {
      const dns = await failingWith(
        connectionFailure('ENOTFOUND', 'getaddrinfo ENOTFOUND relay.example.invalid'),
        'Connection error.',
      );
      const tls = await failingWith(
        connectionFailure('DEPTH_ZERO_SELF_SIGNED_CERT', 'self-signed certificate'),
        'Connection error.',
      );

      expect(payloadOf(dns).errorDetail).toBe(
        'Connection error. (getaddrinfo ENOTFOUND relay.example.invalid)',
      );
      expect(payloadOf(tls).errorDetail).toBe(
        'Connection error. (self-signed certificate [DEPTH_ZERO_SELF_SIGNED_CERT])',
      );
    });

    it('still classifies the failure as a retryable network failure', async () => {
      const message = await failingWith(
        connectionFailure('ECONNRESET', 'read ECONNRESET'),
        'Connection error.',
      );

      expect(
        toLLMRetryDecision(
          normalizeLLMError({ finishReason: 'error', errorMessage: message.errorMessage }),
        ),
      ).toEqual({ retryable: true, reason: 'network' });
    });

    it('does not add the cause of an error that carries an HTTP status', async () => {
      const failure = Object.assign(new Error('429 slow down'), {
        status: 429,
        cause: new Error('socket hang up'),
      });
      const message = await failingWith(failure, '429 slow down');

      expect(payloadOf(message).errorDetail).toBe('429 slow down');
    });

    it('keeps credentials out of the added cause', async () => {
      const message = await failingWith(
        connectionFailure('ECONNRESET', 'read ECONNRESET api_key=sk-secretsecretsecret'),
        'Connection error.',
      );

      expect(message.errorMessage).not.toContain('sk-secretsecretsecret');
    });

    it('reports the real cause for a refused local port through the provider client', async () => {
      // A port that was just free and has no listener: the connection is refused.
      const port = await new Promise<number>((resolve) => {
        const probe = createServer();
        probe.listen(0, '127.0.0.1', () => {
          const { port: freePort } = probe.address() as { port: number };
          probe.close(() => resolve(freePort));
        });
      });
      const model = {
        id: 'm',
        name: 'm',
        api: 'openai-completions',
        provider: 'custom',
        baseUrl: `http://127.0.0.1:${String(port)}/v1`,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000,
        maxTokens: 100,
      };
      const streamFn = withByokErrorAttribution({
        streamFn: streamSimple as unknown as StreamFn,
        providerId: 'custom_provider:p',
      });
      const stream = await streamFn(
        model as never,
        { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] },
        { apiKey: 'k', maxRetries: 0 } as never,
      );

      const detail = payloadOf(await stream.result()).errorDetail;

      expect(detail).toBe(`Connection error. (connect ECONNREFUSED 127.0.0.1:${String(port)})`);
    });
  });

  describe('the runtime log', () => {
    it('records the redacted upstream failure once, however it is read', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const base: StreamFn = () => {
        const stream = createAssistantMessageEventStream();
        stream.push({
          type: 'error',
          reason: 'error',
          error: failedWith('429 busy, key sk-abcdefghijklmnop was rejected'),
        });
        stream.end();
        return stream;
      };
      const streamFn = withByokErrorAttribution({ streamFn: base, providerId: 'custom_provider:p' });
      const stream = await streamFn({} as never, { messages: [] }, {});
      for await (const event of stream) void event;
      await stream.result();

      expect(warn).toHaveBeenCalledTimes(1);
      const [fields, text] = warn.mock.calls[0] ?? [];
      expect(text).toBe('[byok] upstream request failed');
      expect(fields).toMatchObject({
        provider_id: 'custom_provider:p',
        error_code: LLM_ERROR_CODES.LLM_RATE_LIMITED,
      });
      expect(String(fields?.error_detail)).toContain('429');
      expect(JSON.stringify(fields)).not.toContain('sk-abcdefghijklmnop');
    });
  });
});
