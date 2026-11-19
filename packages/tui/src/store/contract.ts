/**
 * The Alran Store: a catalog of Plugins and Skills that Alran Code can browse and install.
 *
 * A store is one JSON document (`index.json`, format `alran.store/v1`) plus the archives it
 * points at. Nothing in it is trusted by name: every archive is pinned by `archiveSha256` and
 * `contentDigest`, and an install is derived from the verified archive bytes, never from the
 * descriptions in the index. The format is specified in `docs/store/index-format-v1.md`.
 */

export const STORE_INDEX_SCHEMA = 'alran.store/v1';
export const STORE_LEDGER_SCHEMA = 'alran.store.installed/v1';
export const STORE_SOURCES_SCHEMA = 'alran.store.sources/v1';

export const DEFAULT_STORE_SOURCE_ID = 'ottili';
/**
 * The store Ottili hosts, served by the AI platform next to the model gateway. `ALRAN_STORE_URL`
 * replaces it (the slot keeps the name `ottili`); `ALRAN_STORE_URL=off` leaves the slot empty.
 * Stores a person adds are separate.
 */
export const DEFAULT_STORE_INDEX_URL = 'https://ai.ottili.one/v1/store/index.json';
/** The value of `ALRAN_STORE_URL` that switches the default store off. */
export const STORE_URL_OFF = 'off';
/** Environment variable that replaces the URL of the default store source. */
export const STORE_URL_ENVIRONMENT_VARIABLE = 'ALRAN_STORE_URL';

export const STORE_LIMITS = {
  /**
   * The largest index the client accepts, in bytes, measured after the response is decompressed.
   * The store Ottili hosts holds about 12 MB in 10,577 entries; 64 MiB leaves it room to grow
   * without making the limit meaningless.
   */
  indexBytes: 64 * 1024 * 1024,
  /**
   * The most entries one index may hold. The byte limit is the real bound; this one keeps an index
   * of very many tiny entries from turning into a very long list.
   */
  entries: 200_000,
  fetchTimeoutMs: 20_000,
  /** Cached indexes younger than this are used without asking the source again. */
  freshForMs: 10 * 60 * 1000,
} as const;

export type StoreEntryKind = 'plugin' | 'skill';

export const PLUGIN_CATEGORIES = [
  'Office',
  'Studio',
  'Design & Sites',
  'Code',
  'Business',
  'Sales',
  'Productivity',
  'Science & Healthcare',
  'Education',
  'Other',
] as const;
export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/** Where the bytes of a package come from and what they must hash to. */
export interface StoreArchiveRef {
  /** Absolute after parsing; the index may give a path relative to itself. */
  readonly url: string;
  readonly size: number;
  /** SHA-256 of the raw archive bytes, 64 lowercase hex digits. */
  readonly archiveSha256: string;
  /** `sha256-tree-v1:<hex>` over the unpacked file tree (package-format-v1 section 5). */
  readonly contentDigest: string;
}

export interface StorePluginContents {
  readonly skills: readonly { readonly name: string; readonly description?: string }[];
  readonly mcpServers: readonly string[];
  readonly apps: readonly string[];
  readonly hooks: number;
}

export interface StorePluginEntry {
  readonly kind: 'plugin';
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly category: PluginCategory;
  readonly license?: string;
  readonly homepage?: string;
  readonly exampleQueries: readonly string[];
  /** What the index says the package holds. An install re-derives this from the archive. */
  readonly contents: StorePluginContents;
  readonly archive: StoreArchiveRef;
}

export interface StoreSkillEntry {
  readonly kind: 'skill';
  readonly name: string;
  readonly title: string;
  readonly version: string;
  readonly description: string;
  /** The library group the Skill belongs to (for example `engineering`). */
  readonly group: string;
  readonly author?: string;
  readonly license?: string;
  readonly files: number;
  readonly archive: StoreArchiveRef;
}

export type StoreEntry = StorePluginEntry | StoreSkillEntry;

export interface StoreIndex {
  readonly schema: typeof STORE_INDEX_SCHEMA;
  readonly name: string;
  readonly description?: string;
  readonly updatedAt?: string;
  readonly plugins: readonly StorePluginEntry[];
  readonly skills: readonly StoreSkillEntry[];
}

export interface StoreSource {
  readonly id: string;
  /** `https://…/index.json`, `http://localhost…`, `file:///…/index.json` or an absolute path. */
  readonly url: string;
  readonly label?: string;
  /** True for the default store (from `ALRAN_STORE_URL` or a built-in address); not removable here. */
  readonly builtin?: boolean;
}

/** The state of one source after the last attempt to read it. */
export interface StoreSourceStatus {
  readonly source: StoreSource;
  /** Absent when the source could not be read and nothing is cached. */
  readonly index?: StoreIndex;
  /** The index came from the local cache because the source could not be reached. */
  readonly stale: boolean;
  readonly fetchedAtMs?: number;
  readonly error?: string;
  /** Why the last attempt failed, so the Store can say what went wrong. */
  readonly errorCode?: StoreErrorCode;
}

export interface InstalledStoreRecord {
  readonly source: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly installedAt: string;
}

export interface StoreLedger {
  readonly schema: typeof STORE_LEDGER_SCHEMA;
  readonly plugins: Readonly<Record<string, InstalledStoreRecord>>;
  readonly skills: Readonly<Record<string, InstalledStoreRecord>>;
}

export type StoreErrorCode =
  | 'SOURCE_UNREACHABLE'
  | 'SOURCE_REJECTED'
  | 'SOURCE_INVALID'
  | 'SOURCE_EXISTS'
  | 'SOURCE_NOT_FOUND'
  | 'INDEX_INVALID'
  | 'ARCHIVE_INVALID'
  | 'DIGEST_MISMATCH'
  | 'PACKAGE_INVALID'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'CONSENT_REQUIRED'
  | 'INSTALL_FAILED';

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = 'StoreError';
  }
}

export const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SOURCE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
export const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
export const ARCHIVE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
export const CONTENT_DIGEST_PATTERN = /^sha256-tree-v1:[0-9a-f]{64}$/u;
