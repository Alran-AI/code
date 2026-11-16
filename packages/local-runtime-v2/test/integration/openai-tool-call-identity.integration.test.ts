import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  streamSimple,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Delta = Record<string, unknown>;

/** A completed read call and its result, as they sit in the conversation. */
function completedCall(model: Model<'openai-completions'>, id: string): Context['messages'] {
  return [
    { role: 'user', content: 'Poll the task.', timestamp: 1 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id, name: 'read', arguments: { path: 'a.txt' } }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: 'toolUse',
      timestamp: 2,
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
    {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'read',
      content: [{ type: 'text', text: 'contents' }],
      isError: false,
      timestamp: 3,
    },
  ];
}

function toolCallsOf(message: AssistantMessage): ToolCall[] {
  return message.content.filter((block): block is ToolCall => block.type === 'toolCall');
}

describe('tool call identities returned by an OpenAI-compatible provider', () => {
  let server: ReturnType<typeof createServer>;
  let model: Model<'openai-completions'>;
  let chunks: Delta[];

  beforeEach(async () => {
    chunks = [];
    server = createServer(async (request, response) => {
      for await (const part of request) void part;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const delta of chunks) {
        response.write(
          `data: ${JSON.stringify({
            id: 'synthetic',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta, finish_reason: null }],
          })}\n\n`,
        );
      }
      response.end(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    model = {
      id: 'fixture-model',
      name: 'Fixture model',
      api: 'openai-completions',
      provider: 'custom',
      baseUrl: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`,
      reasoning: false,
      input: ['text'],
      contextWindow: 32_768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function run(
    messages: Context['messages'],
  ): Promise<{ message: AssistantMessage; events: AssistantMessageEvent[] }> {
    const stream = streamSimple(
      model,
      { messages: [...messages, { role: 'user', content: 'Again.', timestamp: 4 }] },
      { apiKey: 'k', maxRetries: 0 },
    );
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    return { message: await stream.result(), events };
  }

  const call = (index: number, id: string | undefined, args: string, name = 'read'): Delta => ({
    tool_calls: [
      {
        index,
        ...(id === undefined ? {} : { id }),
        type: 'function',
        function: { ...(name ? { name } : {}), arguments: args },
      },
    ],
  });

  it('gives a call that reuses the id of an earlier completed call a new identity', async () => {
    chunks = [call(0, 'reused-call', '{"path":"b.txt"}')];

    const { message, events } = await run(completedCall(model, 'reused-call'));

    const [only] = toolCallsOf(message);
    expect(toolCallsOf(message)).toHaveLength(1);
    expect(only?.id).not.toBe('reused-call');
    expect(only?.id.length).toBeGreaterThan(0);
    expect(only?.arguments).toEqual({ path: 'b.txt' });
    // Every event that mentions the call shows the same identity the final message has.
    const ended = events.find((event) => event.type === 'toolcall_end');
    expect(ended?.type === 'toolcall_end' ? ended.toolCall.id : undefined).toBe(only?.id);
  });

  it('keeps one identity while the arguments of a reused id arrive in several deltas', async () => {
    chunks = [
      call(0, 'reused-call', '{"path":'),
      { tool_calls: [{ index: 0, function: { arguments: '"b.txt"}' } }] },
    ];

    const { message } = await run(completedCall(model, 'reused-call'));

    expect(toolCallsOf(message)).toHaveLength(1);
    expect(toolCallsOf(message)[0]?.id).not.toBe('reused-call');
    expect(toolCallsOf(message)[0]?.arguments).toEqual({ path: 'b.txt' });
  });

  it('gives an id that arrives after the first delta a new identity too', async () => {
    chunks = [call(0, undefined, '{"path":'), call(0, 'reused-call', '"b.txt"}', '')];

    const { message } = await run(completedCall(model, 'reused-call'));

    expect(toolCallsOf(message)).toHaveLength(1);
    expect(toolCallsOf(message)[0]?.id).not.toBe('reused-call');
    expect(toolCallsOf(message)[0]?.arguments).toEqual({ path: 'b.txt' });
  });

  it('does not merge two parallel calls that share one id, and keeps both identities distinct', async () => {
    chunks = [
      call(0, 'same', '{"path":"one.txt"}'),
      call(1, 'same', '{"path":"two.txt"}'),
    ];

    const { message } = await run([]);

    const calls = toolCallsOf(message);
    expect(calls.map((entry) => entry.arguments)).toEqual([
      { path: 'one.txt' },
      { path: 'two.txt' },
    ]);
    expect(new Set(calls.map((entry) => entry.id)).size).toBe(2);
  });

  it('skips identities that are already taken when it makes a new one', async () => {
    const earlier = completedCall(model, 'reused-call');
    chunks = [call(0, 'reused-call', '{"path":"b.txt"}')];
    const first = toolCallsOf((await run(earlier)).message)[0]?.id ?? '';
    const taken = [...earlier, ...completedCall(model, first).slice(1)];

    const second = toolCallsOf((await run(taken)).message)[0]?.id;

    expect(second).not.toBe('reused-call');
    expect(second).not.toBe(first);
  });

  it('leaves ids that do not collide untouched', async () => {
    chunks = [call(0, 'fresh-1', '{"path":"b.txt"}')];

    const { message } = await run(completedCall(model, 'reused-call'));

    expect(toolCallsOf(message)[0]?.id).toBe('fresh-1');
  });
});
