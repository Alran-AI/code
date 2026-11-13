import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreError } from '../../src/store/contract.js';
import { StoreIndexLoader } from '../../src/store/loader.js';
import { normalizeSourceUrl, StoreSourceRegistry } from '../../src/store/sources.js';
import {
  assertAllowedStoreUrl,
  createStoreTransport,
  type StoreTransport,
} from '../../src/store/transport.js';
import { skillFiles, writeStore } from '../helpers/store-fixtures.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'alran-store-sources-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function code(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
}

async function codeAsync(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('store source URLs', () => {
  it('accepts https, loopback http, file URLs and absolute paths, and adds index.json', () => {
    expect(normalizeSourceUrl('https://example.com/store')).toBe('https://example.com/store/index.json');
    expect(normalizeSourceUrl('https://example.com/')).toBe('https://example.com/index.json');
    expect(normalizeSourceUrl('https://example.com/a/b/index.json#frag')).toBe(
      'https://example.com/a/b/index.json',
    );
    expect(normalizeSourceUrl('http://127.0.0.1:8080/s')).toBe('http://127.0.0.1:8080/s/index.json');
    expect(normalizeSourceUrl('http://localhost/s/index.json')).toBe('http://localhost/s/index.json');
    expect(normalizeSourceUrl('/srv/store')).toBe('file:///srv/store/index.json');
    expect(normalizeSourceUrl('file:///srv/store/index.json')).toBe('file:///srv/store/index.json');
  });

  it('refuses plain http to a real host, other schemes and empty input', () => {
    expect(code(() => normalizeSourceUrl('http://example.com/store'))).toBe('SOURCE_INVALID');
    expect(code(() => normalizeSourceUrl('ftp://example.com/store'))).toBe('SOURCE_INVALID');
    // eslint-disable-next-line no-script-url
    expect(code(() => normalizeSourceUrl('javascript:alert(1)'))).toBe('SOURCE_INVALID');
    expect(code(() => normalizeSourceUrl('   '))).toBe('SOURCE_INVALID');
    expect(code(() => normalizeSourceUrl('relative/path'))).toBe('SOURCE_INVALID');
    expect(() => assertAllowedStoreUrl('http://[::1]:9/x')).not.toThrow();
  });
});

describe('store source registry', () => {
  it('reads the store Ottili hosts, unless ALRAN_STORE_URL replaces it or switches it off', async () => {
    const hosted = [
      { id: 'ottili', url: 'https://ai.ottili.one/v1/store/index.json', label: 'Alran store', builtin: true },
    ];
    expect(await new StoreSourceRegistry(dir, {}).list()).toEqual(hosted);
    expect(await new StoreSourceRegistry(dir, { ALRAN_STORE_URL: '  ' }).list()).toEqual(hosted);
    const mirror = new StoreSourceRegistry(dir, { ALRAN_STORE_URL: 'https://mirror.example/alran' });
    expect(await mirror.list()).toEqual([
      { id: 'ottili', url: 'https://mirror.example/alran/index.json', label: 'Alran store', builtin: true },
    ]);
    for (const off of ['off', 'OFF', ' Off ']) {
      expect(await new StoreSourceRegistry(dir, { ALRAN_STORE_URL: off }).list()).toEqual([]);
    }
  });

  it('adds, names and removes sources and keeps them across instances', async () => {
    const registry = new StoreSourceRegistry(dir, { ALRAN_STORE_URL: 'off' });
    const added = await registry.add({ url: 'https://plugins.acme.example/alran' });
    expect(added.id).toBe('plugins-acme-example-alran');
    const named = await registry.add({ url: '/srv/team-store', id: 'team', label: 'Team' });
    expect(named).toEqual({ id: 'team', url: 'file:///srv/team-store/index.json', label: 'Team' });
    const again = new StoreSourceRegistry(dir, { ALRAN_STORE_URL: 'off' });
    expect((await again.list()).map((source) => source.id)).toEqual(['plugins-acme-example-alran', 'team']);
    await again.remove('team');
    expect((await again.list()).map((source) => source.id)).toEqual(['plugins-acme-example-alran']);
  });

  it('refuses duplicates, bad ids, the built-in id and unknown removals', async () => {
    const registry = new StoreSourceRegistry(dir, { ALRAN_STORE_URL: 'off' });
    await registry.add({ url: 'https://a.example/s', id: 'alpha' });
    expect(await codeAsync(() => registry.add({ url: 'https://a.example/s', id: 'beta' }))).toBe('SOURCE_EXISTS');
    expect(await codeAsync(() => registry.add({ url: 'https://b.example/s', id: 'alpha' }))).toBe('SOURCE_EXISTS');
    expect(await codeAsync(() => registry.add({ url: 'https://b.example/s', id: 'ottili' }))).toBe('SOURCE_EXISTS');
    expect(await codeAsync(() => registry.add({ url: 'https://b.example/s', id: 'Bad Name' }))).toBe('SOURCE_INVALID');
    expect(await codeAsync(() => registry.remove('ottili'))).toBe('SOURCE_INVALID');
    expect(await codeAsync(() => registry.remove('nope'))).toBe('SOURCE_NOT_FOUND');
  });

  it('survives concurrent additions without losing one', async () => {
    const registry = new StoreSourceRegistry(dir, { ALRAN_STORE_URL: 'off' });
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((letter) => registry.add({ url: `https://${letter}.example/s`, id: `s-${letter}` })),
    );
    expect((await registry.list()).map((source) => source.id).sort()).toEqual([
      's-a',
      's-b',
      's-c',
      's-d',
    ]);
  });
});

function fakeTransport(handler: (call: { url: string; etag?: string }) => Promise<unknown> | unknown) {
  const calls: { url: string; etag?: string }[] = [];
  const transport: StoreTransport = {
    async readText(url, options) {
      const call = { url, ...(options.etag ? { etag: options.etag } : {}) };
      calls.push(call);
      return (await handler(call)) as never;
    },
    readBytes: () => Promise.reject(new Error('not used')),
  };
  return { transport, calls };
}

const INDEX = (name: string) =>
  JSON.stringify({ schema: 'alran.store/v1', name, plugins: [], skills: [] });

describe('store index loader', () => {
  const source = { id: 'remote', url: 'https://store.example/index.json' };

  it('caches a fetched index and does not ask again while it is fresh', async () => {
    let now = 1_000_000;
    const { transport, calls } = fakeTransport(() => ({ status: 'ok', text: INDEX('one'), etag: '"v1"' }));
    const loader = new StoreIndexLoader({ dataDir: dir, transport, now: () => now, freshForMs: 60_000 });
    const first = await loader.load(source);
    expect(first.index?.name).toBe('one');
    expect(first.stale).toBe(false);
    now += 30_000;
    expect((await loader.load(source)).index?.name).toBe('one');
    expect(calls).toHaveLength(1);
  });

  it('revalidates with the ETag once stale and keeps the cache on 304', async () => {
    let now = 0;
    const { transport, calls } = fakeTransport((call) =>
      call.etag === '"v1"' ? { status: 'not-modified' } : { status: 'ok', text: INDEX('one'), etag: '"v1"' },
    );
    const loader = new StoreIndexLoader({ dataDir: dir, transport, now: () => now, freshForMs: 1_000 });
    await loader.load(source);
    now = 5_000;
    const second = await loader.load(source);
    expect(second.index?.name).toBe('one');
    expect(second.fetchedAtMs).toBe(5_000);
    expect(calls.map((call) => call.etag)).toEqual([undefined, '"v1"']);
  });

  it('forces a fetch on refresh', async () => {
    let name = 'one';
    const { transport, calls } = fakeTransport(() => ({ status: 'ok', text: INDEX(name) }));
    const loader = new StoreIndexLoader({ dataDir: dir, transport, freshForMs: 3_600_000 });
    await loader.load(source);
    name = 'two';
    expect((await loader.load(source, { refresh: true })).index?.name).toBe('two');
    expect(calls).toHaveLength(2);
  });

  it('serves the cached index as stale when the source cannot be reached', async () => {
    let online = true;
    const { transport } = fakeTransport(() => {
      if (online) return { status: 'ok', text: INDEX('one') };
      throw new StoreError('SOURCE_UNREACHABLE', 'offline');
    });
    const loader = new StoreIndexLoader({ dataDir: dir, transport, freshForMs: 0 });
    await loader.load(source);
    online = false;
    const status = await loader.load(source);
    expect(status.index?.name).toBe('one');
    expect(status.stale).toBe(true);
    expect(status.error).toContain('offline');
  });

  it('reports an error when nothing is cached, and falls back when the new index is invalid', async () => {
    const offline = fakeTransport(() => {
      throw new StoreError('SOURCE_UNREACHABLE', 'offline');
    });
    const first = await new StoreIndexLoader({ dataDir: dir, transport: offline.transport }).load(source);
    expect(first.index).toBeUndefined();
    expect(first.error).toContain('offline');

    let text = INDEX('good');
    const flaky = fakeTransport(() => ({ status: 'ok', text }));
    const loader = new StoreIndexLoader({ dataDir: dir, transport: flaky.transport, freshForMs: 0 });
    await loader.load(source);
    text = '{"schema":"wrong"}';
    const status = await loader.load(source);
    expect(status.index?.name).toBe('good');
    expect(status.stale).toBe(true);
    expect(status.error).toContain('schema');
  });

  it('ignores a cache that belongs to another URL or is damaged', async () => {
    const { transport, calls } = fakeTransport(() => ({ status: 'ok', text: INDEX('one') }));
    const loader = new StoreIndexLoader({ dataDir: dir, transport, freshForMs: 3_600_000 });
    await loader.load(source);
    await loader.load({ ...source, url: 'https://other.example/index.json' });
    expect(calls).toHaveLength(2);
    writeFileSync(path.join(dir, 'store', 'cache', 'remote.json'), '{ not json');
    await loader.load(source);
    expect(calls).toHaveLength(3);
  });

  it('reads a file source from disk every time without caching', async () => {
    const store = writeStore(path.join(dir, 'disk'), [{ kind: 'skill', name: 'alpha', files: skillFiles('alpha') }]);
    const loader = new StoreIndexLoader({ dataDir: dir, transport: createStoreTransport() });
    const status = await loader.load({ id: 'disk', url: store.url });
    expect(status.index?.skills.map((skill) => skill.name)).toEqual(['alpha']);
    expect(status.index?.skills[0]?.archive.url).toMatch(/^file:\/\/.*archives\/skill-alpha-1\.0\.0\.zip$/u);
    expect(() => readFileSync(path.join(dir, 'store', 'cache', 'disk.json'))).toThrow();
  });
});

describe('store transport', () => {
  const response = (body: BodyInit | null, init: ResponseInit & { url?: string } = {}) => {
    const result = new Response(body, init);
    if (init.url) Object.defineProperty(result, 'url', { value: init.url });
    return result;
  };

  it('sends the ETag, parses the body and reports 304', async () => {
    const doFetch = vi.fn(async (_url: unknown, init?: RequestInit) =>
      (init?.headers as Record<string, string>)['if-none-match']
        ? response(null, { status: 304 })
        : response('{"a":1}', { headers: { etag: '"x"' } }),
    );
    const transport = createStoreTransport({ fetch: doFetch as unknown as typeof fetch });
    expect(await transport.readText('https://s.example/i.json', { maxBytes: 100 })).toEqual({
      status: 'ok',
      text: '{"a":1}',
      etag: '"x"',
    });
    expect(await transport.readText('https://s.example/i.json', { maxBytes: 100, etag: '"x"' })).toEqual({
      status: 'not-modified',
    });
  });

  it('refuses a disallowed URL before any request', async () => {
    const doFetch = vi.fn();
    const transport = createStoreTransport({ fetch: doFetch as unknown as typeof fetch });
    expect(await codeAsync(() => transport.readText('http://example.com/i.json', { maxBytes: 10 }))).toBe(
      'SOURCE_INVALID',
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect that downgrades to plain http', async () => {
    const doFetch = async () => response('{}', { url: 'http://evil.example/i.json' });
    const transport = createStoreTransport({ fetch: doFetch as unknown as typeof fetch });
    expect(await codeAsync(() => transport.readBytes('https://s.example/a.zip', { maxBytes: 100 }))).toBe(
      'SOURCE_UNREACHABLE',
    );
  });

  it('enforces the size limit from the header and from the stream', async () => {
    const declared = async () => response('x', { headers: { 'content-length': '5000' } });
    const streamed = async () => response('y'.repeat(500));
    const small = createStoreTransport({ fetch: declared as unknown as typeof fetch });
    expect(await codeAsync(() => small.readBytes('https://s.example/a', { maxBytes: 100 }))).toBe('SOURCE_UNREACHABLE');
    const stream = createStoreTransport({ fetch: streamed as unknown as typeof fetch });
    expect(await codeAsync(() => stream.readBytes('https://s.example/a', { maxBytes: 100 }))).toBe('SOURCE_UNREACHABLE');
    expect((await stream.readBytes('https://s.example/a', { maxBytes: 1000 })).length).toBe(500);
  });

  it('turns HTTP errors and network failures into SOURCE_UNREACHABLE with the status', async () => {
    const notFound = async () => response('no', { status: 404, statusText: 'Not Found' });
    const transport = createStoreTransport({ fetch: notFound as unknown as typeof fetch });
    await expect(transport.readText('https://s.example/i.json', { maxBytes: 10 })).rejects.toThrow(/404 Not Found/u);
    const broken = async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    };
    const down = createStoreTransport({ fetch: broken as unknown as typeof fetch });
    await expect(down.readText('https://s.example/i.json', { maxBytes: 10 })).rejects.toThrow(/ECONNREFUSED|fetch failed/u);
  });

  it('reads and limits local files', async () => {
    mkdirSync(path.join(dir, 'f'));
    writeFileSync(path.join(dir, 'f', 'a.json'), '{"ok":true}');
    const transport = createStoreTransport();
    const url = `file://${path.join(dir, 'f', 'a.json')}`;
    expect(await transport.readText(url, { maxBytes: 100 })).toMatchObject({ status: 'ok', text: '{"ok":true}' });
    expect(await codeAsync(() => transport.readText(url, { maxBytes: 3 }))).toBe('SOURCE_UNREACHABLE');
    expect(await codeAsync(() => transport.readText(`file://${path.join(dir, 'f', 'missing.json')}`, { maxBytes: 3 }))).toBe(
      'SOURCE_UNREACHABLE',
    );
    expect(await codeAsync(() => transport.readText(`file://${path.join(dir, 'f')}`, { maxBytes: 3 }))).toBe(
      'SOURCE_UNREACHABLE',
    );
  });
});
