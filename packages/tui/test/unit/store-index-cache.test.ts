import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STORE_LIMITS, StoreError, type StoreSource } from '../../src/store/contract.js';
import { StoreIndexLoader } from '../../src/store/loader.js';
import { createStoreTransport, type StoreTransport } from '../../src/store/transport.js';

const URL = 'https://store.example/v1/store/index.json';
const source: StoreSource = { id: 'ottili', url: URL };

let root: string;
let data: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-index-'));
  data = path.join(root, 'data');
  mkdirSync(data);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const cacheFile = (): string => path.join(data, 'store', 'cache', 'ottili.json');
const skillCacheFile = (): string => path.join(data, 'store', 'cache', 'ottili.skills.json');
const cacheDocument = (): {
  url: string;
  fetchedAtMs: number;
  skillsContentMs: number;
  etag?: string;
  index: { name: string; plugins: unknown[] };
} =>
  JSON.parse(readFileSync(cacheFile(), 'utf8')) as {
    url: string;
    fetchedAtMs: number;
    skillsContentMs: number;
    etag?: string;
    index: { name: string; plugins: unknown[] };
  };
/** The file of the Skills holds a line of what they are, and then the Skills. */
const skillCacheDocument = (): { url: string; contentMs: number; skills: unknown[] } => {
  const text = readFileSync(skillCacheFile(), 'utf8');
  const split = text.indexOf('\n');
  const head = JSON.parse(text.slice(0, split)) as { url: string; contentMs: number };
  const body = JSON.parse(text.slice(split + 1)) as { skills: unknown[] };
  return { ...head, skills: body.skills };
};

describe('the cached index and its ETag', () => {
  const indexText = JSON.stringify({
    schema: 'alran.store/v1',
    name: 'Store One',
    plugins: [],
    skills: [],
  });
  const nextText = JSON.stringify({
    schema: 'alran.store/v1',
    name: 'Store Two',
    plugins: [],
    skills: [],
  });

  function fakeTransport(replies: readonly { readonly status: 'ok' | 'not-modified'; readonly text?: string; readonly etag?: string }[]) {
    const queue = [...replies];
    const calls: { readonly url: string; readonly etag?: string }[] = [];
    const transport: StoreTransport = {
      async readText(url, options) {
        calls.push({ url, ...(options.etag ? { etag: options.etag } : {}) });
        const reply = queue.shift();
        if (!reply) throw new Error('the fake transport has no reply left');
        if (reply.status === 'not-modified') return { status: 'not-modified' };
        return { status: 'ok', text: reply.text ?? '', ...(reply.etag ? { etag: reply.etag } : {}) };
      },
      async readBytes() {
        return Buffer.alloc(0);
      },
    };
    return { transport, calls };
  }

  it('does not ask the source while the cached index is fresh', async () => {
    const { transport, calls } = fakeTransport([{ status: 'ok', text: indexText, etag: '"one"' }]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => 1_000 });
    await loader.load(source);
    const second = await loader.load(source);
    expect(calls).toHaveLength(1);
    expect(second.index?.name).toBe('Store One');
  });

  it('asks the source again once the cached index is old enough', async () => {
    let now = 1_000;
    const { transport, calls } = fakeTransport([
      { status: 'ok', text: indexText, etag: '"one"' },
      { status: 'ok', text: nextText, etag: '"two"' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    now += STORE_LIMITS.freshForMs + 1;
    const second = await loader.load(source);
    expect(calls).toHaveLength(2);
    expect(second.index?.name).toBe('Store Two');
  });

  it('sends the stored ETag and keeps the cached copy when the source answers 304', async () => {
    let now = 1_000;
    const { transport, calls } = fakeTransport([
      { status: 'ok', text: indexText, etag: '"one"' },
      { status: 'not-modified' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    now += STORE_LIMITS.freshForMs + 1;
    const second = await loader.load(source);
    expect(calls[1]?.etag).toBe('"one"');
    expect(second.index?.name).toBe('Store One');
    expect(second.stale).toBe(false);
    expect(cacheDocument().index.name).toBe('Store One');
    expect(cacheDocument().etag).toBe('"one"');
  });

  it('replaces the cached copy when the ETag changed', async () => {
    let now = 1_000;
    const { transport, calls } = fakeTransport([
      { status: 'ok', text: indexText, etag: '"one"' },
      { status: 'ok', text: nextText, etag: '"two"' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    now += STORE_LIMITS.freshForMs + 1;
    const second = await loader.load(source);
    expect(calls[1]?.etag).toBe('"one"');
    expect(second.index?.name).toBe('Store Two');
    expect(cacheDocument().index.name).toBe('Store Two');
    expect(cacheDocument().etag).toBe('"two"');
  });

  it('ignores the interval on a manual refresh', async () => {
    const { transport, calls } = fakeTransport([
      { status: 'ok', text: indexText, etag: '"one"' },
      { status: 'ok', text: nextText, etag: '"two"' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => 1_000 });
    await loader.load(source);
    const refreshed = await loader.load(source, { refresh: true });
    expect(calls).toHaveLength(2);
    expect(refreshed.index?.name).toBe('Store Two');
  });

  it('caches the Plugins and the Skills apart, so that a list of Plugins does not read the Skills', async () => {
    const text = JSON.stringify({
      schema: 'alran.store/v1',
      name: 'Store One',
      plugins: [],
      skills: [
        {
          name: 'one',
          title: 'One',
          version: '1.0.0',
          description: 'The first Skill.',
          group: 'Group',
          files: 1,
          archive: {
            url: 'archives/skill-one-1.0.0.zip',
            size: 100,
            archiveSha256: 'a'.repeat(64),
            contentDigest: `sha256-tree-v1:${'b'.repeat(64)}`,
          },
        },
      ],
    });
    const { transport } = fakeTransport([{ status: 'ok', text, etag: '"one"' }]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => 1_000 });
    const status = await loader.load(source);
    expect(status.index?.skills).toHaveLength(1);
    expect(status.index?.skills[0]?.name).toBe('one');
    // the Plugins are in the file of their own, and the Skills in another
    expect(cacheDocument().index.plugins).toEqual([]);
    expect(skillCacheDocument().skills).toHaveLength(1);
  });

  it('reads the Skills from the cache when the store cannot be reached', async () => {
    const text = JSON.stringify({
      schema: 'alran.store/v1',
      name: 'Store One',
      plugins: [],
      skills: [
        {
          name: 'one',
          title: 'One',
          version: '1.0.0',
          description: 'The first Skill.',
          group: 'Group',
          files: 1,
          archive: {
            url: 'archives/skill-one-1.0.0.zip',
            size: 100,
            archiveSha256: 'a'.repeat(64),
            contentDigest: `sha256-tree-v1:${'b'.repeat(64)}`,
          },
        },
      ],
    });
    let now = 1_000;
    let reachable = true;
    const transport: StoreTransport = {
      async readText(url) {
        if (!reachable) throw new StoreError('SOURCE_UNREACHABLE', `${url} could not be reached.`);
        return { status: 'ok', text, etag: '"one"' };
      },
      async readBytes() {
        return Buffer.alloc(0);
      },
    };
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    reachable = false;
    now += STORE_LIMITS.freshForMs + 1;
    const status = await loader.load(source);
    expect(status.stale).toBe(true);
    expect(status.index?.skills.map((skill) => skill.name)).toEqual(['one']);
  });

  it('keeps the Skills in the cache when the source answers that nothing has changed', async () => {
    const text = JSON.stringify({
      schema: 'alran.store/v1',
      name: 'Store One',
      plugins: [],
      skills: [
        {
          name: 'one',
          title: 'One',
          version: '1.0.0',
          description: 'The first Skill.',
          group: 'Group',
          files: 1,
          archive: {
            url: 'archives/skill-one-1.0.0.zip',
            size: 100,
            archiveSha256: 'a'.repeat(64),
            contentDigest: `sha256-tree-v1:${'b'.repeat(64)}`,
          },
        },
      ],
    });
    let now = 1_000;
    const { transport } = fakeTransport([
      { status: 'ok', text, etag: '"one"' },
      { status: 'not-modified' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    now += STORE_LIMITS.freshForMs + 1;
    const second = await loader.load(source);
    expect(second.index?.skills.map((skill) => skill.name)).toEqual(['one']);
    // The cache is asked again by a new process, which knows nothing of the copy in memory.
    const fresh = new StoreIndexLoader({
      dataDir: data,
      transport: {
        async readText() {
          throw new Error('the source should not be asked again');
        },
        async readBytes() {
          return Buffer.alloc(0);
        },
      },
      now: () => now,
    });
    const third = await fresh.load(source);
    expect(third.error).toBeUndefined();
    expect(third.index?.skills.map((skill) => skill.name)).toEqual(['one']);
  });

  it('asks the source again when the Skills of the cache are missing', async () => {
    const text = JSON.stringify({
      schema: 'alran.store/v1',
      name: 'Store One',
      plugins: [],
      skills: [
        {
          name: 'one',
          title: 'One',
          version: '1.0.0',
          description: 'The first Skill.',
          group: 'Group',
          files: 1,
          archive: {
            url: 'archives/skill-one-1.0.0.zip',
            size: 100,
            archiveSha256: 'a'.repeat(64),
            contentDigest: `sha256-tree-v1:${'b'.repeat(64)}`,
          },
        },
      ],
    });
    const { transport, calls } = fakeTransport([
      { status: 'ok', text, etag: '"one"' },
      { status: 'ok', text, etag: '"two"' },
    ]);
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => 1_000 });
    await loader.load(source);
    rmSync(skillCacheFile());
    const second = await loader.load(source);
    // The ETag is left out: a source that answers "nothing has changed" cannot give back the
    // Skills that are missing from the cache.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.etag).toBeUndefined();
    expect(second.index?.skills.map((skill) => skill.name)).toEqual(['one']);
    expect(skillCacheDocument().skills).toHaveLength(1);
  });
});

describe('honest failures', () => {
  it('says the index was rejected, not unreachable, when it is too large', async () => {
    const impl = (async () =>
      new Response('{}', {
        headers: { 'content-length': String(STORE_LIMITS.indexBytes + 1) },
      })) as unknown as typeof fetch;
    const loader = new StoreIndexLoader({
      dataDir: data,
      transport: createStoreTransport({ fetch: impl }),
      now: () => 1_000,
    });
    const status = await loader.load(source);
    expect(status.errorCode).toBe('SOURCE_REJECTED');
    expect(status.index).toBeUndefined();
  });

  it('says the source could not be reached when it is not there', async () => {
    const impl = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const loader = new StoreIndexLoader({
      dataDir: data,
      transport: createStoreTransport({ fetch: impl }),
      now: () => 1_000,
    });
    const status = await loader.load(source);
    expect(status.errorCode).toBe('SOURCE_UNREACHABLE');
  });

  it('falls back to the cached copy and keeps the age of that copy', async () => {
    let now = 1_000;
    let reachable = true;
    const text = JSON.stringify({ schema: 'alran.store/v1', name: 'Store One', plugins: [], skills: [] });
    const transport: StoreTransport = {
      async readText(url) {
        if (!reachable) throw new StoreError('SOURCE_UNREACHABLE', `${url} could not be reached.`);
        return { status: 'ok', text, etag: '"one"' };
      },
      async readBytes() {
        return Buffer.alloc(0);
      },
    };
    const loader = new StoreIndexLoader({ dataDir: data, transport, now: () => now });
    await loader.load(source);
    reachable = false;
    now += STORE_LIMITS.freshForMs + 1;
    const status = await loader.load(source);
    expect(status.stale).toBe(true);
    expect(status.index?.name).toBe('Store One');
    expect(status.errorCode).toBe('SOURCE_UNREACHABLE');
    expect(status.fetchedAtMs).toBe(1_000);
  });
});
