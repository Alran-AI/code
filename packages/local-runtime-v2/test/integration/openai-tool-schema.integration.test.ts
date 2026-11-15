import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { UpdateGoalToolDef } from '@alran/goal';
import { streamSimple, type Model, type Tool } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Api = 'openai-completions' | 'openai-responses';

/** The tool parameter schemas as they appear in the request body an endpoint receives. */
describe('tool parameter schemas sent to OpenAI-compatible endpoints', () => {
  let server: ReturnType<typeof createServer>;
  let received: Record<string, unknown> | undefined;
  let port: number;

  beforeEach(async () => {
    received = undefined;
    server = createServer(async (request, response) => {
      let raw = '';
      for await (const part of request) raw += String(part);
      received = JSON.parse(raw) as Record<string, unknown>;
      response.writeHead(400, { 'content-type': 'application/json' }).end('{"error":{"message":"stop"}}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  async function send(api: Api, parameters: unknown): Promise<Record<string, unknown>> {
    const model: Model<Api> = {
      id: 'gemini-like',
      name: 'gemini-like',
      api,
      provider: 'custom',
      baseUrl: `http://127.0.0.1:${String(port)}/v1`,
      reasoning: false,
      input: ['text'],
      contextWindow: 32_768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const tools = [{ name: 'probe', description: 'probe', parameters }] as Tool[];
    await streamSimple(
      model,
      { messages: [{ role: 'user', content: 'hi', timestamp: 1 }], tools },
      { apiKey: 'k', maxRetries: 0 },
    ).result();
    const tool = (received?.tools as Array<Record<string, unknown>> | undefined)?.[0];
    const sent = api === 'openai-completions' ? (tool?.function as Record<string, unknown>) : tool;
    return sent?.parameters as Record<string, unknown>;
  }

  describe.each<Api>(['openai-completions', 'openai-responses'])('%s', (api) => {
    it('names the type of a nullable integer instead of sending a bare anyOf', async () => {
      const sent = await send(
        api,
        Type.Object({
          budget: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
        }),
      );

      expect(sent.properties).toEqual({ budget: { type: ['integer', 'null'], minimum: 1 } });
      expect(sent.required).toBeUndefined();
    });

    it('keeps the description of the union and of the branch that has one', async () => {
      const sent = await send(
        api,
        Type.Object({
          a: Type.Union([Type.String({ description: 'inner' }), Type.Null()]),
          b: Type.Union([Type.String(), Type.Null()], { description: 'outer' }),
        }),
      );

      expect(sent.properties).toEqual({
        a: { type: ['string', 'null'], description: 'inner' },
        b: { type: ['string', 'null'], description: 'outer' },
      });
    });

    it('rewrites a nullable inside arrays of objects and in the goal tool the model really gets', async () => {
      const goal = await send(api, UpdateGoalToolDef.schema);
      const budget = (goal.properties as Record<string, Record<string, unknown>>).token_budget;
      expect(budget?.type).toEqual(['integer', 'null']);
      expect(budget?.minimum).toBe(1);
      // Only the copy on the wire changes: the schema the runtime validates arguments with does not.
      const own = (UpdateGoalToolDef.schema.properties as Record<string, Record<string, unknown>>)
        .token_budget;
      expect(own?.anyOf).toBeDefined();

      const nested = await send(
        api,
        Type.Object({
          items: Type.Array(Type.Object({ n: Type.Union([Type.Number(), Type.Null()]) })),
        }),
      );
      expect(JSON.stringify(nested)).toContain('"n":{"type":["number","null"]}');
    });

    it('leaves other unions, enums and plain schemas exactly as they were', async () => {
      const original = {
        type: 'object',
        properties: {
          either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
          mode: { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }] },
          plain: { type: 'string', description: 'x' },
          three: { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
        },
      };

      expect(await send(api, original)).toEqual(original);
    });
  });
});
