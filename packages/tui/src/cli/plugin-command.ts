import path from 'node:path';

import { AlranPluginApplication, unavailableMessage } from '../plugin/application.js';
import type {
  AlranPluginCatalog,
  AlranPluginCliRequest,
  AlranPluginMarketplace,
  AlranPluginView,
} from '../plugin/contract.js';
import { prepareTuiDataDir } from '../runtime/data-dir.js';
import { createTuiRuntime, shutdownTuiRuntime } from '../runtime/lifecycle.js';
import { AlranStoreApplication, type StoreItem } from '../store/application.js';
import { StoreError } from '../store/contract.js';
import {
  addSource,
  createTerminalHost,
  installItem,
  listSources,
  removeItem,
  removeSource,
  searchStore,
  showItem,
  updateItems,
  type StoreCliHost,
} from './store-cli.js';

interface AlranPluginCommandApplication {
  catalog(input: {
    readonly includeAvailable: boolean;
    readonly marketplace?: AlranPluginMarketplace;
  }): Promise<AlranPluginCatalog>;
  install(plugin: AlranPluginView): Promise<AlranPluginView>;
  remove(plugin: AlranPluginView): Promise<AlranPluginView>;
  setEnabled(plugin: AlranPluginView, enabled: boolean): Promise<AlranPluginView>;
  refresh(): Promise<void>;
}

interface AlranPluginCommandContext {
  readonly application: AlranPluginCommandApplication;
  readonly dataDir: string;
  /** The Runtime's Plugin access; the Store reloads Plugins through it after an install. */
  readonly access?: ConstructorParameters<typeof AlranStoreApplication>[0]['plugins'];
  shutdown(): Promise<void>;
}

export interface RunAlranPluginCommandOptions {
  readonly version: string;
  readonly request: AlranPluginCliRequest;
  readonly lane?: string;
  readonly createContext?: (lane?: string) => Promise<AlranPluginCommandContext>;
  /** Tests supply a host; the command line uses the terminal. */
  readonly createHost?: (context: { readonly dataDir: string; readonly access?: AlranPluginCommandContext['access'] }) => StoreCliHost;
  /** Where the Store keeps its files when no Runtime is started (store-only commands). */
  readonly dataDir?: string;
}

/** Commands that only read or edit the Store's own files start no Runtime. */
function needsNoRuntime(request: AlranPluginCliRequest): boolean {
  return (
    request.action === 'search' ||
    request.action === 'marketplace-list' ||
    request.action === 'marketplace-add' ||
    request.action === 'marketplace-remove'
  );
}

export async function runAlranPluginCommand(
  options: RunAlranPluginCommandOptions,
): Promise<string> {
  const request = options.request;
  if (needsNoRuntime(request)) {
    const dataDir = options.dataDir ?? (await prepareTuiDataDir());
    const host = (options.createHost ?? defaultHost)({ dataDir });
    return runStoreOnly(request, host, dataDir);
  }
  const context = options.createContext
    ? await options.createContext(options.lane)
    : await createPluginCommandContext(options.version, options.lane);
  try {
    const host = (options.createHost ?? defaultHost)({
      dataDir: context.dataDir,
      ...(context.access ? { access: context.access } : {}),
    });
    if (request.action === 'marketplace-upgrade') {
      await context.application.refresh();
      await host.store.catalog({ refresh: true });
      const result = { marketplace: 'all', refreshed: true };
      return request.json ? JSON.stringify(result, null, 2) : 'Refreshed all Plugin sources.';
    }
    if (request.action === 'info') return showItem(host, 'plugin', request.selector, request.json);
    if (request.action === 'update') {
      return updateItems(host, 'plugin', {
        selector: request.selector,
        yes: request.yes,
        json: request.json,
      });
    }
    if (request.action === 'list') return listPlugins(host, request);
    if (request.action !== 'marketplace-list' && request.action !== 'marketplace-add' && request.action !== 'marketplace-remove' && request.action !== 'search') {
      const handled = await tryStore(host, request);
      if (handled !== undefined) return handled;
    }
    if (request.action !== 'add' && request.action !== 'remove' && request.action !== 'enable' && request.action !== 'disable') {
      throw new Error(`Unhandled Plugin action: ${request.action}`);
    }
    const { name, marketplace } = parseSelector(request.selector, request.marketplace);
    const catalog = await context.application.catalog({
      includeAvailable: request.action === 'add',
      marketplace,
    });
    const candidates =
      request.action === 'add' ? [...catalog.installed, ...catalog.available] : catalog.installed;
    if (
      catalog.unavailable?.length &&
      !candidates.some((candidate) => candidate.name === name || candidate.pluginId === name)
    ) {
      throw new Error(unavailableMessage(catalog.unavailable[0]!));
    }
    const plugin = selectPlugin(candidates, name, marketplace);
    // A local Plugin is installed by its folder being in the local Plugin directory; there is
    // nothing to install, and the Runtime refuses the request with a bare error code.
    if (request.action === 'add' && plugin.marketplace === 'local' && plugin.installed) {
      return request.json ? JSON.stringify(toCliPlugin(plugin), null, 2) : formatPlugin(plugin);
    }
    const result =
      request.action === 'add'
        ? await context.application.install(plugin)
        : request.action === 'remove'
          ? await context.application.remove(plugin)
          : await context.application.setEnabled(plugin, request.action === 'enable');
    return request.json ? JSON.stringify(toCliPlugin(result), null, 2) : formatPlugin(result);
  } finally {
    await context.shutdown();
  }
}

function defaultHost(context: {
  readonly dataDir: string;
  readonly access?: AlranPluginCommandContext['access'];
}): StoreCliHost {
  return createTerminalHost(
    new AlranStoreApplication({
      dataDir: context.dataDir,
      ...(context.access ? { plugins: context.access } : {}),
    }),
  );
}

async function runStoreOnly(
  request: AlranPluginCliRequest,
  host: StoreCliHost,
  dataDir: string,
): Promise<string> {
  switch (request.action) {
    case 'search':
      return searchStore(host, 'plugin', request);
    case 'marketplace-list':
      return listSources(host, dataDir, request.json);
    case 'marketplace-add':
      return addSource(host, request);
    case 'marketplace-remove':
      return removeSource(host, request.name, request.json);
    default:
      throw new Error(`Not a store-only Plugin action: ${request.action}`);
  }
}

/**
 * `plugin add|remove|enable|disable <name>` act on the Store when the name is one of its Plugins
 * (or one it installed); `undefined` means the Runtime's own sources should handle it.
 */
async function tryStore(
  host: StoreCliHost,
  request: Extract<AlranPluginCliRequest, { action: 'add' | 'remove' | 'enable' | 'disable' }>,
): Promise<string | undefined> {
  if (request.marketplace || /@(official|local)$/u.test(request.selector)) return undefined;
  // Removing and switching are about what is installed: they need no store and no network.
  const local = request.action === 'remove' || request.action === 'enable' || request.action === 'disable';
  const catalog = await host.store.catalog({ offline: local });
  let item: StoreItem;
  try {
    item = host.store.resolve(catalog, 'plugin', request.selector);
  } catch (error) {
    if (error instanceof StoreError && error.code === 'NOT_FOUND') return undefined;
    throw error;
  }
  // A folder Plugin or a registry Plugin is the Runtime's business, not the Store's.
  if (item.origin === 'local' || item.origin === 'official') return undefined;
  if (request.action === 'add') {
    return installItem(host, 'plugin', request.selector, { yes: request.yes, json: request.json });
  }
  if (request.action === 'remove') {
    return removeItem(host, 'plugin', request.selector, request.json);
  }
  if (!item.installed) {
    throw new StoreError('NOT_FOUND', `Plugin ${item.name}@${item.origin} is not installed.`);
  }
  await host.store.setEnabled(item, request.action === 'enable');
  const next = host.store.resolve(await host.store.catalog({ offline: true }), 'plugin', `${item.name}@${item.origin}`);
  return request.json
    ? JSON.stringify(toLegacyPlugin(next), null, 2)
    : `${next.enabled ? '[*]' : '[-]'} ${next.name}@${next.origin}\t${next.enabled ? 'enabled' : 'disabled'}`;
}

async function listPlugins(
  host: StoreCliHost,
  request: Extract<AlranPluginCliRequest, { action: 'list' }>,
): Promise<string> {
  // Installed packages, or a `--marketplace` filter, never need a store: stay off the network.
  const catalog = await host.store.catalog({ offline: !request.available || request.marketplace !== undefined });
  const items = catalog.items.filter(
    (item) =>
      item.kind === 'plugin' &&
      (request.available || item.installed) &&
      // `--marketplace` names a Runtime source: a Plugin a store installed is a `local` one there.
      (!request.marketplace || (item.plugin ? item.plugin.marketplace : item.origin) === request.marketplace),
  );
  const notes = catalog.sources.flatMap((status) =>
    status.error
      ? [`store "${status.source.id}" ${status.index ? 'is unreachable, showing a cached copy' : 'could not be read'}: ${status.error}`]
      : [],
  );
  if (request.json) {
    return JSON.stringify(
      {
        installed: items.filter((item) => item.installed).map(toLegacyPlugin),
        available: items.filter((item) => !item.installed).map(toLegacyPlugin),
        ...(notes.length ? { notes } : {}),
      },
      null,
      2,
    );
  }
  const rows = items
    .map((item) => {
      const marker = item.enabled ? '[*]' : item.installed ? '[-]' : '[ ]';
      const state = item.installed ? (item.enabled ? 'enabled' : 'disabled') : 'available';
      const update = item.updateAvailable ? ' (update available)' : '';
      return `${marker} ${item.name}@${item.origin}\t${state}${update}`;
    })
    .join('\n');
  return [rows, ...notes.map((note) => `note: ${note}`)].filter(Boolean).join('\n');
}

function toLegacyPlugin(item: StoreItem) {
  const contents = item.entry?.kind === 'plugin' ? item.entry.contents : undefined;
  return {
    pluginId: `${item.name}@${item.origin}`,
    name: item.name,
    displayName: item.displayName,
    marketplaceName: item.origin,
    ...(item.version ? { version: item.version } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.author ? { author: item.author } : {}),
    installed: item.installed,
    enabled: item.enabled,
    ...(item.updateAvailable ? { updateAvailable: true } : {}),
    capabilities: item.plugin?.capabilities ?? {
      appCount: contents?.apps.length ?? 0,
      mcpServerCount: contents?.mcpServers.length ?? 0,
      skillCount: contents?.skills.length ?? 0,
    },
  };
}

function toCliPlugin(plugin: AlranPluginView) {
  return {
    pluginId: plugin.pluginId,
    name: plugin.name,
    displayName: plugin.displayName,
    marketplaceName: plugin.marketplace,
    ...(plugin.version ? { version: plugin.version } : {}),
    ...(plugin.description ? { description: plugin.description } : {}),
    ...(plugin.author ? { author: plugin.author } : {}),
    installed: plugin.installed,
    enabled: plugin.enabled,
    capabilities: plugin.capabilities,
  };
}

function formatPluginRows(catalog: AlranPluginCatalog): string {
  return [...catalog.installed, ...catalog.available]
    .map((plugin) => {
      const marker = plugin.enabled ? '[*]' : plugin.installed ? '[-]' : '[ ]';
      const state = plugin.installed ? (plugin.enabled ? 'enabled' : 'disabled') : 'available';
      return `${marker} ${plugin.pluginId}\t${state}`;
    })
    .join('\n');
}

function formatPlugin(plugin: AlranPluginView): string {
  return formatPluginRows({
    installed: plugin.installed ? [plugin] : [],
    available: plugin.installed ? [] : [plugin],
  });
}

function parseSelector(
  selector: string,
  explicitMarketplace?: AlranPluginMarketplace,
): { readonly name: string; readonly marketplace?: AlranPluginMarketplace } {
  const match = /^([^@]+?)(?:@(official|local))?$/.exec(selector.trim());
  if (!match?.[1]) throw new Error(`Invalid Plugin selector: ${selector}`);
  const marketplace = match[2] as AlranPluginMarketplace | undefined;
  if (marketplace && explicitMarketplace && marketplace !== explicitMarketplace) {
    throw new Error(
      `Plugin selector marketplace conflicts with --marketplace ${explicitMarketplace}.`,
    );
  }
  return { name: match[1], marketplace: marketplace ?? explicitMarketplace };
}

function selectPlugin(
  plugins: readonly AlranPluginView[],
  name: string,
  marketplace?: AlranPluginMarketplace,
): AlranPluginView {
  const matches = plugins.filter(
    (plugin) =>
      plugin.name === name && (marketplace === undefined || plugin.marketplace === marketplace),
  );
  if (matches.length === 0)
    throw new Error(`Plugin not found: ${name}${marketplace ? `@${marketplace}` : ''}`);
  if (matches.length > 1) {
    throw new Error(
      `Plugin ${name} matches multiple marketplaces; use ${name}@official or ${name}@local.`,
    );
  }
  return matches[0] as AlranPluginView;
}

async function createPluginCommandContext(
  version: string = 'unknown',
  lane?: string,
): Promise<AlranPluginCommandContext> {
  const dataDir = await prepareTuiDataDir();
  const runtime = await createTuiRuntime({
    dataDir,
    workspaceDir: process.cwd(),
    version,
    surface: 'headless',
    ...(lane ? { lane } : {}),
  });
  return {
    application: new AlranPluginApplication(runtime.adapter),
    access: runtime.adapter,
    dataDir,
    shutdown: async () => {
      await shutdownTuiRuntime(runtime);
    },
  };
}
