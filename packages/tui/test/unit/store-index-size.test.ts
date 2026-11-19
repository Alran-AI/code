import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { STORE_LIMITS } from '../../src/store/contract.js';
import { parseStoreIndex } from '../../src/store/index-format.js';
import { createStoreTransport } from '../../src/store/transport.js';

const URL = 'https://store.example/v1/store/index.json';

/** The live store holds 202 Plugins and 10,375 Skills in about 12 MB. */
const PLUGINS = 202;
const SKILLS = 10_375;

function buildIndex(descriptionBytes: number): string {
  const description = 'd'.repeat(descriptionBytes);
  const archive = (name: string) => ({
    url: `https://store.example/v1/store/archives/${name}.zip`,
    size: 22,
    archiveSha256: 'a'.repeat(64),
    contentDigest: `sha256-tree-v1:${'b'.repeat(64)}`,
  });
  const plugins = Array.from({ length: PLUGINS }, (_, index) => ({
    kind: 'plugin',
    name: `plugin-${index}`,
    displayName: `Plugin ${index}`,
    version: '1.0.0',
    description,
    author: 'Ottili',
    category: 'Code',
    license: 'MIT',
    exampleQueries: [`do something with plugin ${index}`],
    contents: { skills: [], mcpServers: [], apps: [], hooks: 0 },
    archive: archive(`plugin-${index}`),
  }));
  const skills = Array.from({ length: SKILLS }, (_, index) => ({
    kind: 'skill',
    name: `skill-${index}`,
    title: `Skill ${index}`,
    version: '1.0.0',
    description,
    group: 'engineering',
    files: 1,
    archive: archive(`skill-${index}`),
  }));
  return JSON.stringify({ schema: 'alran.store/v1', name: 'Alran Curated Store', plugins, skills });
}

interface FakeReply {
  readonly status?: number;
  readonly body?: string | Buffer;
  readonly headers?: Record<string, string>;
}

/** A `fetch` that answers with the given replies and records what it was asked. */
function fakeFetch(replies: readonly FakeReply[]) {
  const queue = [...replies];
  const calls: { readonly url: string; readonly headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
    const reply = queue.shift();
    if (!reply) throw new Error('the fake fetch has no reply left');
    const headers = new Headers(reply.headers ?? {});
    if (reply.body !== undefined && !headers.has('content-length')) {
      headers.set('content-length', String(Buffer.byteLength(reply.body)));
    }
    return new Response(reply.body ?? null, { status: reply.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the store index size limit', () => {
  it('accepts an index of about 12 MB with 202 Plugins and 10,375 Skills', async () => {
    const text = buildIndex(880);
    expect(Buffer.byteLength(text)).toBeGreaterThan(11 * 1024 * 1024);
    expect(Buffer.byteLength(text)).toBeLessThan(13 * 1024 * 1024);

    const { impl } = fakeFetch([{ body: text }]);
    const transport = createStoreTransport({ fetch: impl });
    const read = await transport.readText(URL, { maxBytes: STORE_LIMITS.indexBytes });
    expect(read.status).toBe('ok');
    const index = parseStoreIndex(read.status === 'ok' ? read.text : '', URL);
    expect(index.plugins).toHaveLength(PLUGINS);
    expect(index.skills).toHaveLength(SKILLS);
  });

  it('rejects an index above the limit and says what the limit is', async () => {
    const { impl } = fakeFetch([{ body: '{}', headers: { 'content-length': String(STORE_LIMITS.indexBytes + 1) } }]);
    const transport = createStoreTransport({ fetch: impl });
    await expect(transport.readText(URL, { maxBytes: STORE_LIMITS.indexBytes })).rejects.toMatchObject({
      code: 'SOURCE_REJECTED',
      message: expect.stringContaining(String(STORE_LIMITS.indexBytes)) as unknown as string,
    });
  });

  it('stops reading a body that grows past the limit', async () => {
    const { impl } = fakeFetch([{ body: 'x'.repeat(4_096) }]);
    const transport = createStoreTransport({ fetch: impl });
    await expect(transport.readText(URL, { maxBytes: 1_024 })).rejects.toMatchObject({
      code: 'SOURCE_REJECTED',
    });
  });

  it('reads a gzipped index', async () => {
    const text = JSON.stringify({ schema: 'alran.store/v1', name: 'Gzipped', plugins: [], skills: [] });
    const { impl, calls } = fakeFetch([
      { body: gzipSync(Buffer.from(text)), headers: { 'content-encoding': 'gzip' } },
    ]);
    const transport = createStoreTransport({ fetch: impl });
    const read = await transport.readText(URL, { maxBytes: STORE_LIMITS.indexBytes });
    expect(read).toEqual({ status: 'ok', text });
    expect(calls[0]?.headers['accept-encoding']).toContain('gzip');
  });

  it('applies the limit to the decompressed size', async () => {
    const body = gzipSync(Buffer.from('x'.repeat(8_192)));
    expect(body.length).toBeLessThan(1_024);
    const { impl } = fakeFetch([{ body, headers: { 'content-encoding': 'gzip' } }]);
    const transport = createStoreTransport({ fetch: impl });
    await expect(transport.readText(URL, { maxBytes: 1_024 })).rejects.toMatchObject({
      code: 'SOURCE_REJECTED',
    });
  });
});
