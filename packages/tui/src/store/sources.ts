import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_STORE_INDEX_URL,
  DEFAULT_STORE_SOURCE_ID,
  SOURCE_ID_PATTERN,
  STORE_SOURCES_SCHEMA,
  STORE_URL_ENVIRONMENT_VARIABLE,
  StoreError,
  type StoreSource,
} from './contract.js';
import { readTextIfExists, storeRoot, withStoreLock, writeTextAtomic } from './fs-util.js';
import { assertAllowedStoreUrl } from './transport.js';

/**
 * The stores Alran Code reads: the one that ships with it, then the ones a person added. The list
 * of added sources lives in `<data-dir>/store/sources.json`.
 */
export class StoreSourceRegistry {
  constructor(
    private readonly dataDir: string,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async list(): Promise<readonly StoreSource[]> {
    const override = this.environment[STORE_URL_ENVIRONMENT_VARIABLE]?.trim();
    const url = override || DEFAULT_STORE_INDEX_URL;
    const defaultStore: StoreSource[] = url
      ? [{ id: DEFAULT_STORE_SOURCE_ID, url: normalizeSourceUrl(url), label: 'Default store', builtin: true }]
      : [];
    return [...defaultStore, ...(await this.readAdded())];
  }

  async add(input: {
    readonly url: string;
    readonly id?: string;
    readonly label?: string;
  }): Promise<StoreSource> {
    const url = normalizeSourceUrl(input.url);
    return withStoreLock(this.dataDir, async () => {
      const added = await this.readAdded();
      const all = [{ id: DEFAULT_STORE_SOURCE_ID }, ...added];
      const duplicate = added.find((source) => source.url === url);
      if (duplicate) {
        throw new StoreError('SOURCE_EXISTS', `That store is already added as "${duplicate.id}".`);
      }
      const id = input.id?.trim() || deriveSourceId(url, new Set(all.map((source) => source.id)));
      if (!SOURCE_ID_PATTERN.test(id) || id.length > 40) {
        throw new StoreError(
          'SOURCE_INVALID',
          `"${id}" is not a store name: use lowercase letters, digits and dashes, starting with a letter.`,
        );
      }
      if (all.some((source) => source.id === id)) {
        throw new StoreError('SOURCE_EXISTS', `A store named "${id}" already exists.`);
      }
      const label = input.label?.trim();
      const source: StoreSource = { id, url, ...(label ? { label } : {}) };
      await this.writeAdded([...added, source]);
      return source;
    });
  }

  async remove(id: string): Promise<StoreSource> {
    if (id === DEFAULT_STORE_SOURCE_ID) {
      throw new StoreError(
        'SOURCE_INVALID',
        `"${DEFAULT_STORE_SOURCE_ID}" is the default store, set by ${STORE_URL_ENVIRONMENT_VARIABLE}; ` +
          `unset that variable to drop it.`,
      );
    }
    return withStoreLock(this.dataDir, async () => {
      const added = await this.readAdded();
      const source = added.find((candidate) => candidate.id === id);
      if (!source) throw new StoreError('SOURCE_NOT_FOUND', `No store named "${id}".`);
      await this.writeAdded(added.filter((candidate) => candidate.id !== id));
      return source;
    });
  }

  private file(): string {
    return path.join(storeRoot(this.dataDir), 'sources.json');
  }

  private async readAdded(): Promise<StoreSource[]> {
    const text = await readTextIfExists(this.file());
    if (text === undefined) return [];
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new StoreError('SOURCE_INVALID', `${this.file()} is not valid JSON.`, { cause: error });
    }
    const list =
      typeof document === 'object' && document !== null && 'sources' in document
        ? document.sources
        : undefined;
    if (!Array.isArray(list)) {
      throw new StoreError('SOURCE_INVALID', `${this.file()} has no "sources" list.`);
    }
    const sources: StoreSource[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue;
      const { id, url, label } = item as Record<string, unknown>;
      if (typeof id !== 'string' || typeof url !== 'string') continue;
      if (!SOURCE_ID_PATTERN.test(id) || id === DEFAULT_STORE_SOURCE_ID) continue;
      sources.push({
        id,
        url: normalizeSourceUrl(url),
        ...(typeof label === 'string' && label.trim() ? { label: label.trim() } : {}),
      });
    }
    return sources;
  }

  private async writeAdded(sources: readonly StoreSource[]): Promise<void> {
    await writeTextAtomic(
      this.file(),
      `${JSON.stringify({ schema: STORE_SOURCES_SCHEMA, sources }, null, 2)}\n`,
    );
  }
}

/**
 * A source is an `https:` URL, a loopback `http:` URL, a `file:` URL or an absolute path. A URL
 * that names a directory (or has no file name) means `<url>/index.json`.
 */
export function normalizeSourceUrl(value: string): string {
  const text = value.trim();
  if (!text) throw new StoreError('SOURCE_INVALID', 'A store location is empty.');
  const isWindowsPath = /^[A-Za-z]:[\\/]/u.test(text);
  const url = text.startsWith('/') || isWindowsPath ? pathToFileURL(text) : assertAllowedStoreUrl(text);
  if (!url.pathname.endsWith('.json')) {
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/index.json`;
  }
  url.hash = '';
  return url.toString();
}

function deriveSourceId(url: string, taken: ReadonlySet<string>): string {
  const parsed = new URL(url);
  const raw =
    parsed.protocol === 'file:'
      ? path.basename(path.dirname(decodeURIComponent(parsed.pathname)))
      : `${parsed.hostname}${parsed.pathname.replace(/\/index\.json$/u, '')}`;
  let base = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32);
  if (!/^[a-z]/u.test(base)) base = `store-${base}`.replace(/-+$/u, '');
  if (!taken.has(base)) return base;
  for (let counter = 2; ; counter += 1) {
    const candidate = `${base}-${counter}`;
    if (!taken.has(candidate)) return candidate;
  }
}
