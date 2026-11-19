import path from 'node:path';

import {
  STORE_LIMITS,
  StoreError,
  type StoreIndex,
  type StoreSource,
  type StoreSourceStatus,
} from './contract.js';
import { readTextIfExists, storeRoot, writeTextAtomic } from './fs-util.js';
import { parseStoreIndex } from './index-format.js';
import type { StoreTransport } from './transport.js';

interface CacheDocument {
  readonly url: string;
  readonly fetchedAtMs: number;
  readonly etag?: string;
  readonly text: string;
}

export interface StoreLoaderOptions {
  readonly dataDir: string;
  readonly transport: StoreTransport;
  readonly now?: () => number;
  readonly freshForMs?: number;
}

/**
 * Reads the index of a source. A remote index is cached on disk: it is reused for a few minutes,
 * revalidated with its ETag after that, and used as it was when the source cannot be reached, so
 * the Store keeps working offline. A `file:` source is read every time.
 */
export class StoreIndexLoader {
  private readonly now: () => number;
  private readonly freshForMs: number;

  constructor(private readonly options: StoreLoaderOptions) {
    this.now = options.now ?? Date.now;
    this.freshForMs = options.freshForMs ?? STORE_LIMITS.freshForMs;
  }

  async load(
    source: StoreSource,
    options: { readonly refresh?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<StoreSourceStatus> {
    const local = source.url.startsWith('file:');
    const cache = local ? undefined : await this.readCache(source);
    if (cache && !options.refresh && this.now() - cache.fetchedAtMs < this.freshForMs) {
      const index = tryParse(cache.text, source.url);
      if (index) return { source, index, stale: false, fetchedAtMs: cache.fetchedAtMs };
    }
    try {
      const read = await this.options.transport.readText(source.url, {
        maxBytes: STORE_LIMITS.indexBytes,
        ...(cache?.etag ? { etag: cache.etag } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const fetchedAtMs = this.now();
      if (read.status === 'not-modified' && cache) {
        const index = parseStoreIndex(cache.text, source.url);
        await this.writeCache(source, { ...cache, fetchedAtMs });
        return { source, index, stale: false, fetchedAtMs };
      }
      if (read.status !== 'ok') {
        throw new StoreError('SOURCE_UNREACHABLE', `${source.url} answered 304 with nothing cached.`);
      }
      const index = parseStoreIndex(read.text, source.url);
      if (!local) {
        await this.writeCache(source, {
          url: source.url,
          fetchedAtMs,
          ...(read.etag ? { etag: read.etag } : {}),
          text: read.text,
        });
      }
      return { source, index, stale: false, fetchedAtMs };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof StoreError ? error.code : 'SOURCE_UNREACHABLE';
      const index = cache ? tryParse(cache.text, source.url) : undefined;
      if (cache && index) {
        return { source, index, stale: true, fetchedAtMs: cache.fetchedAtMs, error: message, errorCode };
      }
      return { source, stale: false, error: message, errorCode };
    }
  }

  private cacheFile(source: StoreSource): string {
    return path.join(storeRoot(this.options.dataDir), 'cache', `${source.id}.json`);
  }

  private async readCache(source: StoreSource): Promise<CacheDocument | undefined> {
    const text = await readTextIfExists(this.cacheFile(source));
    if (text === undefined) return undefined;
    try {
      const document = JSON.parse(text) as Partial<CacheDocument>;
      if (
        document.url === source.url &&
        typeof document.text === 'string' &&
        typeof document.fetchedAtMs === 'number'
      ) {
        return {
          url: document.url,
          fetchedAtMs: document.fetchedAtMs,
          text: document.text,
          ...(typeof document.etag === 'string' ? { etag: document.etag } : {}),
        };
      }
    } catch {
      // A damaged cache is a cache miss.
    }
    return undefined;
  }

  private async writeCache(source: StoreSource, document: CacheDocument): Promise<void> {
    try {
      await writeTextAtomic(this.cacheFile(source), JSON.stringify(document));
    } catch {
      // The cache is an optimisation; a read-only data directory must not fail the Store.
    }
  }
}

function tryParse(text: string, url: string): StoreIndex | undefined {
  try {
    return parseStoreIndex(text, url);
  } catch {
    return undefined;
  }
}
