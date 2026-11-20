import path from 'node:path';

import {
  STORE_LIMITS,
  StoreError,
  type StoreIndex,
  type StorePluginEntry,
  type StoreSkillEntry,
  type StoreSource,
  type StoreSourceStatus,
} from './contract.js';
import { readFirstLineSync, readTextIfExists, readTextIfExistsSync, storeRoot, writeTextAtomic } from './fs-util.js';
import { parseStoreIndex } from './index-format.js';
import type { StoreTransport } from './transport.js';

/**
 * What the cache remembers about a fetched index.
 *
 * The index of a store with a hundred thousand Skills is over a hundred megabytes, and reading it
 * is the slow part of opening the Store. So the cache holds it in two parts: the Plugins, which
 * are a few hundred entries, and the Skills, which are every one of them. A list of Plugins is
 * then read without touching the Skills at all.
 */
interface CacheMeta {
  readonly version: 2;
  readonly url: string;
  /** When the source was last asked, and answered. */
  readonly fetchedAtMs: number;
  /**
   * The content the cached Skills belong to. It does not change when the source is asked again and
   * answers that nothing has changed, so the Skills of the cache stay the Skills of the index.
   */
  readonly skillsContentMs: number;
  readonly etag?: string;
}

/** The cached Plugins, and what the index holds besides them. */
interface PluginCache extends CacheMeta {
  readonly index: Omit<StoreIndex, 'skills'>;
}

/** The head of the cached Skills: what they are, and which content they belong to. */
interface SkillCacheHead {
  readonly version: 2;
  readonly url: string;
  readonly contentMs: number;
}

/** The cached Skills themselves. */
interface SkillCacheBody {
  readonly skills: readonly StoreSkillEntry[];
}

export interface StoreLoaderOptions {
  readonly dataDir: string;
  readonly transport: StoreTransport;
  readonly now?: () => number;
  readonly freshForMs?: number;
}

/**
 * Reads the index of a source. A remote index is cached on disk: it is reused for a few hours,
 * revalidated with its ETag after that, and used as it was when the source cannot be reached, so
 * the Store keeps working offline. A `file:` source is read every time.
 *
 * The index of a store with a hundred thousand Skills is over a hundred megabytes, so it is parsed
 * once per process and kept, and the copy on disk is the index as the client read it rather than a
 * document that carries it.
 */
export class StoreIndexLoader {
  private readonly now: () => number;
  private readonly freshForMs: number;
  /** The index of each source, for as long as the process runs. */
  private readonly parsed = new Map<string, { url: string; index: StoreIndex; fetchedAtMs: number }>();

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
    // The cache is whole only when the Skills are in it as well: the Plugins are in a file of their
    // own, and a source that answers "nothing has changed" cannot fill a file that is missing.
    const whole = cache !== undefined && this.skillsAreCached(source, cache);
    const fresh = cache !== undefined && this.now() - cache.fetchedAtMs < this.freshForMs;
    if (!options.refresh && fresh && cache && whole) {
      // The index is kept for as long as the process runs, so a second read of the same source
      // costs nothing. Once the copy on disk is old, the source is asked again.
      const held = this.parsed.get(source.id);
      if (held && held.url === source.url && held.fetchedAtMs === cache.fetchedAtMs) {
        return { source, index: held.index, stale: false, fetchedAtMs: held.fetchedAtMs };
      }
      const index = this.indexOf(source, cache);
      this.parsed.set(source.id, { url: source.url, index, fetchedAtMs: cache.fetchedAtMs });
      return { source, index, stale: false, fetchedAtMs: cache.fetchedAtMs };
    }
    try {
      const read = await this.options.transport.readText(source.url, {
        maxBytes: STORE_LIMITS.indexBytes,
        // The ETag is only sent when the cache is whole. A source that answers "nothing has
        // changed" cannot give back the Skills that the cache is missing.
        ...(cache?.etag && whole ? { etag: cache.etag } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const fetchedAtMs = this.now();
      if (read.status === 'not-modified' && cache && whole) {
        // Nothing has changed, so the Skills of the cache are the Skills of the index.
        const index = this.indexOf(source, cache);
        this.parsed.set(source.id, { url: source.url, index, fetchedAtMs });
        await this.writeCacheMeta(source, { ...cache, fetchedAtMs });
        return { source, index, stale: false, fetchedAtMs };
      }
      if (read.status !== 'ok') {
        throw new StoreError('SOURCE_UNREACHABLE', `${source.url} answered 304 with nothing cached.`);
      }
      const index = parseStoreIndex(read.text, source.url);
      this.parsed.set(source.id, { url: source.url, index, fetchedAtMs });
      if (!local) {
        await this.writeCache(
          source,
          {
            url: source.url,
            fetchedAtMs,
            skillsContentMs: fetchedAtMs,
            ...(read.etag ? { etag: read.etag } : {}),
          },
          index,
        );
      }
      return { source, index, stale: false, fetchedAtMs };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = error instanceof StoreError ? error.code : 'SOURCE_UNREACHABLE';
      if (cache) {
        const index = this.indexOf(source, cache);
        this.parsed.set(source.id, { url: source.url, index, fetchedAtMs: cache.fetchedAtMs });
        return {
          source,
          index,
          stale: true,
          fetchedAtMs: cache.fetchedAtMs,
          error: message,
          errorCode,
        };
      }
      return { source, stale: false, error: message, errorCode };
    }
  }

  /**
   * The index as the cache holds it. The Plugins are read at once; the Skills are read when they
   * are asked for, so that a list of Plugins never waits for a hundred thousand Skills.
   */
  private indexOf(source: StoreSource, cache: PluginCache): StoreIndex {
    const rest = cache.index;
    let skills: readonly StoreSkillEntry[] | undefined;
    const readSkills = (): readonly StoreSkillEntry[] => {
      skills ??= this.readCachedSkills(source, cache);
      return skills;
    };
    return {
      schema: rest.schema,
      name: rest.name,
      ...(rest.description ? { description: rest.description } : {}),
      ...(rest.updatedAt ? { updatedAt: rest.updatedAt } : {}),
      plugins: rest.plugins,
      get skills() {
        return readSkills();
      },
    };
  }

  /** The cached Plugins, and what the cache remembers about the index. */
  private pluginCacheFile(source: StoreSource): string {
    return path.join(storeRoot(this.options.dataDir), 'cache', `${source.id}.json`);
  }

  /** The cached Skills. */
  private skillCacheFile(source: StoreSource): string {
    return path.join(storeRoot(this.options.dataDir), 'cache', `${source.id}.skills.json`);
  }

  private async readCache(source: StoreSource): Promise<PluginCache | undefined> {
    const text = await readTextIfExists(this.pluginCacheFile(source));
    if (text === undefined) return undefined;
    let document: PluginCache;
    try {
      document = JSON.parse(text) as PluginCache;
    } catch {
      // A damaged cache is a cache miss.
      return undefined;
    }
    if (
      document.version !== 2 ||
      document.url !== source.url ||
      typeof document.fetchedAtMs !== 'number' ||
      typeof document.skillsContentMs !== 'number' ||
      !document.index ||
      !Array.isArray(document.index.plugins)
    ) {
      return undefined;
    }
    return document;
  }

  /**
   * Whether the Skills of the cache are there. The head of the file of the Skills says which
   * content they belong to, and is read without reading the hundred megabytes behind it.
   */
  private skillsAreCached(source: StoreSource, cache: PluginCache): boolean {
    const head = readFirstLineSync(this.skillCacheFile(source));
    if (head === undefined) return false;
    try {
      const document = JSON.parse(head) as SkillCacheHead;
      return (
        document.version === 2 &&
        document.url === cache.url &&
        document.contentMs === cache.skillsContentMs
      );
    } catch {
      return false;
    }
  }

  private readCachedSkills(source: StoreSource, cache: PluginCache): readonly StoreSkillEntry[] {
    try {
      const text = readTextIfExistsSync(this.skillCacheFile(source));
      if (text === undefined) return [];
      const split = text.indexOf('\n');
      if (split < 0) return [];
      const head = JSON.parse(text.slice(0, split)) as SkillCacheHead;
      if (head.version !== 2 || head.url !== cache.url || head.contentMs !== cache.skillsContentMs) {
        return [];
      }
      const body = JSON.parse(text.slice(split + 1)) as SkillCacheBody;
      return Array.isArray(body.skills) ? body.skills : [];
    } catch {
      // A cache that no longer reads is a cache miss.
      return [];
    }
  }

  private async writeCache(
    source: StoreSource,
    meta: Omit<CacheMeta, 'version'>,
    index: StoreIndex,
  ): Promise<void> {
    try {
      // The Skills of a Plugin are listed by name: the descriptions are in the Skills themselves,
      // and carrying them twice would make the cache of the Plugins as big as the cache of the
      // Skills.
      const plugins = index.plugins.map((plugin) => ({
        ...plugin,
        contents: {
          ...plugin.contents,
          skills: plugin.contents.skills.map((skill) => ({ name: skill.name })),
        },
      }));
      const { skills: _skills, ...rest } = index;
      // The Skills are written in two parts: a line of what they are, and then the Skills. The
      // line is what the loader reads to know that the Skills are the ones it expects.
      const head = JSON.stringify({
        version: 2,
        url: meta.url,
        contentMs: meta.skillsContentMs,
      } satisfies SkillCacheHead);
      await writeTextAtomic(
        this.skillCacheFile(source),
        `${head}\n${JSON.stringify({ skills: index.skills } satisfies SkillCacheBody)}`,
      );
      await writeTextAtomic(
        this.pluginCacheFile(source),
        JSON.stringify({ version: 2, ...meta, index: { ...rest, plugins } } satisfies PluginCache),
      );
    } catch {
      // The cache is an optimisation; a read-only data directory must not fail the Store.
    }
  }

  private async writeCacheMeta(source: StoreSource, meta: PluginCache): Promise<void> {
    try {
      await writeTextAtomic(this.pluginCacheFile(source), JSON.stringify(meta));
    } catch {
      // The cache is an optimisation; a read-only data directory must not fail the Store.
    }
  }
}
