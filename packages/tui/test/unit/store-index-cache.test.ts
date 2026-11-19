import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
