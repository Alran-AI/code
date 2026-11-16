import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
} from '@earendil-works/pi-ai';
import {
  isLLMPermanentFailure,
  normalizeLLMError,
  toLLMRetryDecision,
} from '@alran/shared/llm-error-classifier';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEGENERATE_OUTPUT_MESSAGE,
  DegenerateOutputDetector,
  OUTPUT_LOOP_GUARD_ENV,
  withDegenerateOutputGuard,
} from '../../../src/pi-turn-runner/degenerate-output-guard.js';
import { composeStreamFn } from '../../../src/pi-turn-runner/llm.js';

function loops(chunks: Iterable<string>): boolean {
  const detector = new DegenerateOutputDetector();
  for (const chunk of chunks) if (detector.feed(chunk)) return true;
  return false;
}

const chunked = (text: string, size: number): string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );

describe('DegenerateOutputDetector', () => {
  it('stops an endless emoji stream, however it is cut into deltas', () => {
    const emoji = '😵'.repeat(400);

    expect(loops(chunked(emoji, 1))).toBe(true);
    expect(loops(chunked(emoji, 7))).toBe(true);
    expect(loops([emoji])).toBe(true);
  });

  it('stops short repeated patterns and a line written again and again', () => {
    expect(loops(chunked('🔥✨ '.repeat(300), 5))).toBe(true);
    expect(loops(chunked('▲▼◆'.repeat(200), 3))).toBe(true);
    const line = 'I will now proceed to fix the failing test.\n';
    expect(loops(chunked(line.repeat(60), 11))).toBe(true);
  });

  it('stops a very long run of one word-like unit', () => {
    expect(loops(chunked('ha '.repeat(2_500), 20))).toBe(true);
    expect(loops(chunked('a'.repeat(7_000), 100))).toBe(true);
  });

  it('does not touch ordinary output', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(40);
    const code = 'function add(a, b) {\n  return a + b;\n}\n\n'.repeat(20);
    const table = `| a | b |\n|---|---|\n${'| 1 | 2 |\n'.repeat(80)}`;
    const rules = `${'-'.repeat(400)}\n${'='.repeat(400)}\n${'*'.repeat(300)}\n${'█'.repeat(300)}\n${' '.repeat(500)}`;
    const indentation = `${'\n'.repeat(300)}${'    '.repeat(200)}x`;

    for (const text of [prose, code, table, rules, indentation]) {
      expect(loops(chunked(text, 13))).toBe(false);
    }
  });

  it('does not touch repetitive data that real files contain', () => {
    // A zero-filled table and a list of identical short records are legitimate.
    expect(loops(chunked('0, '.repeat(300), 9))).toBe(false);
    expect(loops(chunked('0x00, '.repeat(250), 6))).toBe(false);
    expect(loops(chunked('<td></td>\n'.repeat(49), 10))).toBe(false);
    expect(loops(chunked('same line of text here\n'.repeat(49), 10))).toBe(false);
    // 49 identical lines, one different, then the pattern starts over: no loop.
    const interrupted = `${'same line of text here\n'.repeat(49)}other line of text\n`.repeat(3);
    expect(loops(chunked(interrupted, 10))).toBe(false);
  });

  it('keeps working over a long stream without growing without bound', () => {
    const detector = new DegenerateOutputDetector();
    for (let index = 0; index < 5_000; index += 1) {
      expect(detector.feed(`line ${String(index)} says something different\n`)).toBe(false);
    }
  });
});

function assistant(text: string, stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
  return {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    api: 'test-messages',
    provider: 'custom_provider:test',
    model: 'fake-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

const model = { id: 'fake-model', provider: 'custom_provider:test', api: 'test-messages' } as Model<any>;
const context: Context = { messages: [] };

/** A provider that writes `deltas` and then, unless it is aborted, finishes normally. */
function provider(deltas: readonly string[], observed: { signal?: AbortSignal; sent: number } = { sent: 0 }): StreamFn {
  return ((_model, _context, options) => {
    observed.signal = options?.signal;
    const stream = createAssistantMessageEventStream();
    void (async () => {
      let text = '';
      const partial = assistant('');
      stream.push({ type: 'start', partial });
      for (const delta of deltas) {
        if (options?.signal?.aborted) {
          stream.push({ type: 'error', reason: 'aborted', error: { ...partial, stopReason: 'aborted' } });
          stream.end();
          return;
        }
        text += delta;
        observed.sent += 1;
        partial.content = [{ type: 'text', text }];
        stream.push({ type: 'text_delta', contentIndex: 0, delta, partial });
        await new Promise((resolve) => setImmediate(resolve));
      }
      const final = assistant(text);
      stream.push({ type: 'done', reason: 'stop', message: final });
      stream.end();
    })();
    return stream;
  }) as StreamFn;
}

async function drain(stream: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('withDegenerateOutputGuard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('cuts off a looping response, keeps what came before and stops the provider request', async () => {
    const observed: { signal?: AbortSignal; sent: number } = { sent: 0 };
    const deltas = ['Here is the answer: ', ...Array.from({ length: 2_000 }, () => '😵')];
    const guarded = withDegenerateOutputGuard(provider(deltas, observed));

    const stream = await guarded(model, context, {});
    const events = await drain(stream);
    const last = events.at(-1);

    expect(last?.type).toBe('error');
    const message = last?.type === 'error' ? last.error : undefined;
    expect(message?.stopReason).toBe('error');
    expect(message?.errorMessage).toBe(DEGENERATE_OUTPUT_MESSAGE);
    expect(JSON.stringify(message?.content)).toContain('Here is the answer: ');
    expect((await stream.result()).errorMessage).toBe(DEGENERATE_OUTPUT_MESSAGE);
    // The request was aborted long before the provider had written everything.
    expect(observed.signal?.aborted).toBe(true);
    expect(observed.sent).toBeLessThan(deltas.length);
  });

  it('is not retried: the message carries none of the retryable transport markers', () => {
    const decision = toLLMRetryDecision(
      normalizeLLMError({ finishReason: 'error', errorMessage: DEGENERATE_OUTPUT_MESSAGE }),
    );

    expect(decision.retryable).toBe(false);
    expect(typeof isLLMPermanentFailure).toBe('function');
  });

  it('lets a normal response through event for event', async () => {
    const guarded = withDegenerateOutputGuard(provider(['Hello', ', ', 'world']));

    const events = await drain(await guarded(model, context, {}));

    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text_delta',
      'text_delta',
      'text_delta',
      'done',
    ]);
    const done = events.at(-1);
    expect(done?.type === 'done' ? done.message.content : undefined).toEqual([
      { type: 'text', text: 'Hello, world' },
    ]);
  });

  it('passes a caller abort through as an abort, not as a loop', async () => {
    const controller = new AbortController();
    const guarded = withDegenerateOutputGuard(provider(Array.from({ length: 50 }, () => 'word ')));

    const stream = await guarded(model, context, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    controller.abort(new Error('user stop'));
    const rest: AssistantMessageEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      rest.push(next.value);
    }

    const last = rest.at(-1);
    expect(last?.type).toBe('error');
    expect(last?.type === 'error' ? last.reason : undefined).toBe('aborted');
    expect((await stream.result()).errorMessage).not.toBe(DEGENERATE_OUTPUT_MESSAGE);
  });

  it.each(['0', 'off'])('can be switched off with %s', async (value) => {
    vi.stubEnv(OUTPUT_LOOP_GUARD_ENV, value);
    const deltas = Array.from({ length: 700 }, () => '😵');
    const guarded = withDegenerateOutputGuard(provider(deltas));

    const events = await drain(await guarded(model, context, {}));

    expect(events.at(-1)?.type).toBe('done');
  });

  it('is part of the stream every request goes through', async () => {
    const deltas = Array.from({ length: 1_000 }, () => '😵');
    const composed = composeStreamFn({ streamFn: provider(deltas) } as never);

    const events = await drain(await composed(model, context, {}));

    const last = events.at(-1);
    expect(last?.type === 'error' ? last.error.errorMessage : undefined).toBe(
      DEGENERATE_OUTPUT_MESSAGE,
    );
  });
});
