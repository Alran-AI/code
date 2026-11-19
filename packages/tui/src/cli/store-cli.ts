import { isBuiltIn, type AlranStoreApplication, type StoreCatalog, type StoreItem } from '../store/application.js';
import { StoreError, type StoreEntryKind } from '../store/contract.js';
import {
  formatConsent,
  formatItemDetail,
  formatItemTable,
  itemSelector,
  searchItems,
} from '../store/format.js';
import type { StagedInstall } from '../store/installer.js';
import { formatCopyAge, formatCopyDate, storeFailureKind } from '../store/status.js';

/** What the store commands need from their surroundings; tests supply their own. */
export interface StoreCliHost {
  readonly store: AlranStoreApplication;
  /** Asks a yes/no question. Resolves `undefined` when nobody can be asked (no terminal). */
  readonly confirm: (question: string) => Promise<boolean | undefined>;
  /** Writes a line to the person (standard error: standard output stays the result). */
  readonly notify: (text: string) => void;
  /** Terminal width for tables; 100 when unknown. */
  readonly width?: number;
}

const WORD: Record<StoreEntryKind, string> = { plugin: 'Plugin', skill: 'Skill' };

/** Alran Code ships without a catalogue; a person adds the store they want. */
export const NO_STORE_MESSAGE =
  'No store is configured yet. Add one with: alran plugin marketplace add <url>';

export function toCliItem(item: StoreItem) {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    displayName: item.displayName,
    origin: item.origin,
    ...(item.version ? { version: item.version } : {}),
    ...(item.installedVersion ? { installedVersion: item.installedVersion } : {}),
    description: item.description,
    ...(item.author ? { author: item.author } : {}),
    ...(item.group ? { group: item.group } : {}),
    ...(item.license ? { license: item.license } : {}),
    installed: item.installed,
    enabled: item.enabled,
    updateAvailable: item.updateAvailable,
    ...(item.conflict ? { conflict: item.conflict } : {}),
    summary: item.summary,
  };
}

function sourceNotes(catalog: StoreCatalog): string[] {
  const notes: string[] = [];
  for (const status of catalog.sources) {
    if (status.error && status.index) {
      const when = status.fetchedAtMs
        ? ` from ${formatCopyDate(status.fetchedAtMs)} (${formatCopyAge(status.fetchedAtMs)})`
        : '';
      const what =
        storeFailureKind(status.errorCode) === 'rejected'
          ? 'rejected the new index'
          : 'could not be reached';
      notes.push(`note: store "${status.source.id}" ${what} (${status.error}); showing the copy${when}.`);
    } else if (status.error) {
      const what =
        storeFailureKind(status.errorCode) === 'rejected' ? 'rejected the index' : 'could not be read';
      notes.push(`note: store "${status.source.id}" ${what}: ${status.error}`);
    }
  }
  return notes;
}

function ofKind(catalog: StoreCatalog, kind: StoreEntryKind): StoreItem[] {
  return catalog.items.filter((item) => item.kind === kind);
}

function groupedTable(items: readonly StoreItem[], width: number): string {
  const groups = new Map<string, StoreItem[]>();
  for (const item of [...items].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = item.group ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, members]) => `${group}\n${formatItemTable(members, width)}`)
    .join('\n\n');
}

export async function listItems(
  host: StoreCliHost,
  kind: StoreEntryKind,
  options: { readonly installed?: boolean; readonly json?: boolean },
): Promise<string> {
  const catalog = await host.store.catalog({ offline: options.installed === true });
  // A built-in Skill is not "installed" by anyone: it only appears in the full library.
  const items = ofKind(catalog, kind).filter((item) => !options.installed || (item.installed && !isBuiltIn(item)));
  if (options.json) {
    return JSON.stringify(
      { items: items.map(toCliItem), ...(sourceNotes(catalog).length ? { notes: sourceNotes(catalog) } : {}) },
      null,
      2,
    );
  }
  const body = items.length
    ? groupedTable(items, host.width ?? 100)
    : options.installed
      ? `No ${kind}s installed. Browse with: alran ${kind === 'plugin' ? 'plugin' : 'skills'} search`
      : catalog.sources.length === 0
        ? NO_STORE_MESSAGE
        : `No ${kind}s are available.`;
  return [body, ...sourceNotes(catalog)].join('\n');
}

export async function searchStore(
  host: StoreCliHost,
  kind: StoreEntryKind,
  options: { readonly query?: string; readonly refresh?: boolean; readonly json?: boolean },
): Promise<string> {
  const catalog = await host.store.catalog({ ...(options.refresh ? { refresh: true } : {}) });
  const matches = searchItems(ofKind(catalog, kind), options.query ?? '');
  if (options.json) {
    return JSON.stringify(
      { query: options.query ?? '', items: matches.map(toCliItem), ...(sourceNotes(catalog).length ? { notes: sourceNotes(catalog) } : {}) },
      null,
      2,
    );
  }
  const body = matches.length
    ? formatItemTable(matches, host.width ?? 100)
    : catalog.sources.length === 0
      ? NO_STORE_MESSAGE
      : `No ${kind}s match "${options.query ?? ''}".`;
  return [body, ...sourceNotes(catalog)].join('\n');
}

export async function showItem(
  host: StoreCliHost,
  kind: StoreEntryKind,
  selector: string,
  json?: boolean,
): Promise<string> {
  const catalog = await host.store.catalog();
  const item = host.store.resolve(catalog, kind, selector);
  return json ? JSON.stringify(toCliItem(item), null, 2) : formatItemDetail(item, undefined, host.width ?? 100);
}

/** Asks for approval of what a package runs. Throws when approval is needed and cannot be had. */
async function approve(host: StoreCliHost, staged: StagedInstall, yes: boolean | undefined): Promise<boolean> {
  if (!staged.inspection.requiresConsent) return false;
  const notes = formatConsent(staged.inspection.executes.map((note) => note.line));
  host.notify(`${WORD[staged.entry.kind]} ${staged.entry.name} ${staged.entry.version}\n${notes}`);
  if (yes) return true;
  const answer = await host.confirm(`Install ${staged.entry.name}? [y/N] `);
  if (answer === undefined) {
    throw new StoreError(
      'CONSENT_REQUIRED',
      `${staged.entry.name} runs commands or connects to services (listed above). Nobody can be asked here: read the list and run again with --yes to approve it.`,
    );
  }
  if (!answer) throw new StoreError('CONSENT_REQUIRED', `Not installed: ${staged.entry.name} was not approved.`);
  return true;
}

async function installOne(
  host: StoreCliHost,
  item: StoreItem,
  yes: boolean | undefined,
): Promise<{ readonly item: StoreItem; readonly warnings: readonly string[]; readonly executes: readonly string[]; readonly updated: boolean }> {
  const staged = await host.store.stage(item);
  const consent = await approve(host, staged, yes);
  const outcome = await host.store.commit(staged, { consent });
  return {
    item,
    warnings: outcome.warnings,
    executes: staged.inspection.executes.map((note) => note.line),
    updated: staged.replacesVersion !== undefined,
  };
}

export async function installItem(
  host: StoreCliHost,
  kind: StoreEntryKind,
  selector: string,
  options: { readonly yes?: boolean; readonly json?: boolean },
): Promise<string> {
  const catalog = await host.store.catalog();
  const item = host.store.resolve(catalog, kind, selector);
  if (isBuiltIn(item)) {
    return options.json
      ? JSON.stringify({ ...toCliItem(item), changed: false }, null, 2)
      : `${WORD[kind]} ${item.name} is built in to Alran Code; there is nothing to install.`;
  }
  if (item.installed && !item.updateAvailable) {
    return options.json
      ? JSON.stringify({ ...toCliItem(item), changed: false }, null, 2)
      : `${WORD[kind]} ${itemSelector(item)} is already installed (${item.installedVersion ?? item.version ?? 'unknown version'}).`;
  }
  const result = await installOne(host, item, options.yes);
  const after = host.store.resolve(await host.store.catalog(), kind, `${item.name}@${item.origin}`);
  if (options.json) {
    return JSON.stringify({ ...toCliItem(after), changed: true, executes: result.executes, warnings: result.warnings }, null, 2);
  }
  const verb = result.updated ? 'Updated' : 'Installed';
  const version = after.installedVersion ? ` ${after.installedVersion}` : '';
  return [
    `${verb} ${WORD[kind]} ${itemSelector(after)}${version} — ${after.summary}.`,
    ...(kind === 'plugin' ? ['It is enabled; Alran loads its skills in new sessions and after /reload.'] : ['Alran picks it up in new sessions and after /reload.']),
    ...result.warnings.map((warning) => `warning: ${warning}`),
  ].join('\n');
}

export async function updateItems(
  host: StoreCliHost,
  kind: StoreEntryKind,
  options: { readonly selector?: string; readonly yes?: boolean; readonly json?: boolean },
): Promise<string> {
  const catalog = await host.store.catalog({ refresh: true });
  const targets = options.selector
    ? [host.store.resolve(catalog, kind, options.selector)]
    : ofKind(catalog, kind).filter((item) => item.installed && item.updateAvailable);
  const updated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const item of targets) {
    if (!item.installed) {
      failed.push(`${itemSelector(item)}: not installed`);
      continue;
    }
    if (!item.updateAvailable) {
      skipped.push(`${itemSelector(item)}: already current`);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await installOne(host, item, options.yes);
      updated.push(`${itemSelector(item)}: ${item.installedVersion ?? '?'} → ${item.version ?? '?'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A named item fails loudly; a sweep carries on with the others.
      if (options.selector) throw error;
      failed.push(`${itemSelector(item)}: ${message}`);
    }
  }
  if (options.json) return JSON.stringify({ updated, skipped, failed }, null, 2);
  const lines = [
    ...updated.map((line) => `updated ${line}`),
    ...skipped.map((line) => `skipped ${line}`),
    ...failed.map((line) => `failed ${line}`),
  ];
  return lines.length ? lines.join('\n') : `All ${kind}s from stores are up to date.`;
}

export async function removeItem(
  host: StoreCliHost,
  kind: StoreEntryKind,
  selector: string,
  json?: boolean,
): Promise<string> {
  // Removing is about what is installed; no store is asked, so an unknown name is simply not installed.
  const catalog = await host.store.catalog({ offline: true });
  let item: StoreItem;
  try {
    item = host.store.resolve(catalog, kind, selector);
  } catch (error) {
    if (error instanceof StoreError && error.code === 'NOT_FOUND') {
      throw new StoreError('NOT_FOUND', `${WORD[kind]} ${selector} is not installed.`);
    }
    throw error;
  }
  if (isBuiltIn(item)) {
    throw new StoreError('INSTALL_FAILED', `${WORD[kind]} ${item.name} is built in to Alran Code and cannot be removed.`);
  }
  if (!item.installed) throw new StoreError('NOT_FOUND', `${WORD[kind]} ${itemSelector(item)} is not installed.`);
  const warnings = await host.store.remove(item);
  return json
    ? JSON.stringify({ ...toCliItem(item), installed: false, enabled: false, warnings }, null, 2)
    : [`Removed ${WORD[kind]} ${itemSelector(item)}.`, ...warnings.map((warning) => `warning: ${warning}`)].join('\n');
}

export async function listSources(host: StoreCliHost, dataDirectory: string, json?: boolean): Promise<string> {
  const sources = await host.store.sources.list();
  const rows = [
    ...sources.map((source) => ({ name: source.id, kind: 'store', location: source.url, builtin: source.builtin === true })),
    { name: 'local', kind: 'directory', location: `${dataDirectory}/plugins`, builtin: true },
  ];
  if (json) return JSON.stringify(rows, null, 2);
  return rows.map((row) => `${row.name}\t${row.kind}\t${row.location}`).join('\n');
}

export async function addSource(
  host: StoreCliHost,
  options: { readonly url: string; readonly name?: string; readonly json?: boolean },
): Promise<string> {
  const source = await host.store.sources.add({ url: options.url, ...(options.name ? { id: options.name } : {}) });
  // Read it once now so a wrong address is reported while the person is looking.
  const catalog = await host.store.catalog({ refresh: true });
  const status = catalog.sources.find((candidate) => candidate.source.id === source.id);
  if (options.json) {
    return JSON.stringify({ source, readable: Boolean(status?.index), ...(status?.error ? { error: status.error } : {}) }, null, 2);
  }
  const counts = status?.index
    ? `${status.index.plugins.length} plugins, ${status.index.skills.length} skills`
    : `not readable yet: ${status?.error ?? 'unknown error'}`;
  return `Added store "${source.id}" (${source.url}): ${counts}.`;
}

export async function removeSource(host: StoreCliHost, name: string, json?: boolean): Promise<string> {
  const source = await host.store.sources.remove(name);
  return json ? JSON.stringify({ removed: source }, null, 2) : `Removed store "${source.id}". Packages installed from it stay installed.`;
}

/** A host for a command line: questions on the terminal, notes on standard error. */
export function createTerminalHost(
  store: AlranStoreApplication,
  streams: {
    readonly stdin: NodeJS.ReadStream;
    readonly stderr: NodeJS.WriteStream;
    readonly stdout: NodeJS.WriteStream;
  } = { stdin: process.stdin, stderr: process.stderr, stdout: process.stdout },
): StoreCliHost {
  return {
    store,
    width: streams.stdout.columns && streams.stdout.columns > 40 ? streams.stdout.columns : 100,
    notify: (text) => {
      streams.stderr.write(`${text}\n`);
    },
    confirm: async (question) => {
      if (!streams.stdin.isTTY || !streams.stderr.isTTY) return undefined;
      const { createInterface } = await import('node:readline');
      const reader = createInterface({ input: streams.stdin, output: streams.stderr });
      try {
        const answer = await new Promise<string>((resolve) => {
          reader.question(question, resolve);
        });
        return /^y(es)?$/iu.test(answer.trim());
      } finally {
        reader.close();
      }
    },
  };
}
