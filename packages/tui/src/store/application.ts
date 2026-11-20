import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { AlranPluginRuntimeAccess, AlranPluginView } from '../plugin/contract.js';
import {
  StoreError,
  type InstalledStoreRecord,
  type StoreEntry,
  type StoreEntryKind,
  type StoreLedger,
  type StoreSource,
  type StoreSourceStatus,
} from './contract.js';
import { isMissing, readTextIfExistsSync } from './fs-util.js';
import { locateBundledSkillsDirectory, readBundledSkills, type BundledSkill } from './bundled-skills.js';
import { readSkillFrontmatter } from './inspect.js';
import { StoreInstaller, type StagedInstall } from './installer.js';
import { StoreIndexLoader } from './loader.js';
import { StoreSourceRegistry } from './sources.js';
import { createStoreTransport, type StoreTransport } from './transport.js';

/**
 * Where a Plugin or Skill comes from: a store's id, `local` (a folder), `official` (registry) or
 * `built-in` (a Skill that ships inside Alran Code).
 */
export type StoreOrigin = string;

export const BUILT_IN_ORIGIN = 'built-in';

/** What sits under the install directories: what the Store put there, and what someone else did. */
interface InstalledNames {
  readonly skill: ReadonlySet<string>;
  readonly plugin: ReadonlySet<string>;
}

/** A Skill that ships with Alran Code: always there, not installed by anyone, not removable. */
export function isBuiltIn(item: Pick<StoreItem, 'origin'>): boolean {
  return item.origin === BUILT_IN_ORIGIN;
}

export interface StoreItem {
  readonly id: string;
  readonly kind: StoreEntryKind;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly author?: string;
  /** Plugin category or Skill group. */
  readonly group?: string;
  readonly license?: string;
  /** The version a store offers; for an item without a store entry, the installed one. */
  readonly version?: string;
  readonly installedVersion?: string;
  readonly origin: StoreOrigin;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly updateAvailable: boolean;
  /**
   * `local`: something that is not the Store's is already installed under this name, so the Store
   * will not install or replace it. `built-in`: a Skill that ships with Alran Code has this name and
   * always wins; installing the store's one would replace it.
   */
  readonly conflict?: 'local' | 'built-in';
  /** One line on what the package holds, for example `10 skills`. */
  readonly summary: string;
  readonly entry?: StoreEntry;
  readonly plugin?: AlranPluginView;
}

export interface StoreCatalog {
  /**
   * The Plugins on offer. Built when it is asked for: a store with a hundred thousand Skills would
   * otherwise build every one of them to show a list of a few hundred Plugins.
   */
  readonly plugins: readonly StoreItem[];
  /** The Skills on offer, built when they are asked for. */
  readonly skills: readonly StoreItem[];
  /** Everything on offer, Plugins and Skills. */
  readonly items: readonly StoreItem[];
  readonly sources: readonly StoreSourceStatus[];
}

type PluginAccess = Pick<
  AlranPluginRuntimeAccess,
  'listInstalledPlugins' | 'listMarketplacePlugins' | 'mutatePlugin' | 'refreshPlugins'
>;

export interface StoreApplicationOptions {
  readonly dataDir: string;
  /** The Runtime's Plugin access. Without it only Skills and the Store's own records are shown. */
  readonly plugins?: PluginAccess;
  readonly transport?: StoreTransport;
  /**
   * The Skills that ship inside Alran Code, shown in the Library as built in. By default they are read
   * from the bundled Skills folder next to the CLI (or the source tree); pass `() => []` for none.
   */
  readonly bundledSkills?: () => Promise<readonly BundledSkill[]>;
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly freshForMs?: number;
}

export interface InstallOutcome {
  readonly record: InstalledStoreRecord;
  /** Things that went wrong after the files were in place, for example a failed Runtime reload. */
  readonly warnings: readonly string[];
}

export class AlranStoreApplication {
  readonly sources: StoreSourceRegistry;
  private readonly loader: StoreIndexLoader;
  private readonly installer: StoreInstaller;
  private readonly plugins: PluginAccess | undefined;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly bundledSkills: () => Promise<readonly BundledSkill[]>;
  private bundledSkillsCache: Promise<readonly BundledSkill[]> | undefined;

  constructor(private readonly options: StoreApplicationOptions) {
    const transport = options.transport ?? createStoreTransport();
    this.environment = options.environment ?? process.env;
    this.sources = new StoreSourceRegistry(options.dataDir, this.environment);
    this.loader = new StoreIndexLoader({
      dataDir: options.dataDir,
      transport,
      ...(options.now ? { now: options.now } : {}),
      ...(options.freshForMs !== undefined ? { freshForMs: options.freshForMs } : {}),
    });
    this.installer = new StoreInstaller({ dataDir: options.dataDir, transport });
    this.plugins = options.plugins;
    this.bundledSkills =
      options.bundledSkills ??
      (async () => {
        const directory = locateBundledSkillsDirectory(import.meta.url);
        return directory ? readBundledSkills(directory) : [];
      });
  }

  /**
   * Everything on offer and everything installed. `offline` asks no store: the result holds what is
   * installed (from the ledger, the Runtime and the data directory), which is all a command about
   * installed packages needs and keeps those commands off the network.
   */
  async catalog(
    options: {
      readonly refresh?: boolean;
      readonly signal?: AbortSignal;
      readonly offline?: boolean;
    } = {},
  ): Promise<StoreCatalog> {
    const sources = options.offline ? [] : await this.sources.list();
    const [statuses, ledger, installedPlugins, officialPlugins] = await Promise.all([
      Promise.all(sources.map((source) => this.loader.load(source, options))),
      this.installer.ledger(),
      this.readInstalledPlugins(),
      this.readOfficialPlugins(),
    ]);
    const localByName = new Map(
      installedPlugins
        .filter((plugin) => plugin.marketplace === 'local')
        .map((plugin) => [plugin.name, plugin] as const),
    );
    const bundledSkills = await this.readBundledSkills();
    const builtInNames = new Set(bundledSkills.map((skill) => skill.name));
    const installedNames = await this.installedNames();
    // The Plugins and the Skills are built apart, and only when they are asked for. A store with a
    // hundred thousand Skills would otherwise build every one of them to show a list of Plugins,
    // and a list of Plugins is what `/plugin` opens.
    let plugins: StoreItem[] | undefined;
    let skills: StoreItem[] | undefined;
    let items: StoreItem[] | undefined;
    const pluginItems = (): StoreItem[] => {
      plugins ??= this.pluginItems(
        statuses,
        ledger,
        localByName,
        installedPlugins,
        officialPlugins,
        builtInNames,
        installedNames,
      );
      return plugins;
    };
    const skillItems = (): StoreItem[] => {
      skills ??= this.skillItems(statuses, ledger, localByName, builtInNames, installedNames, bundledSkills);
      return skills;
    };
    return {
      get plugins() {
        return pluginItems();
      },
      get skills() {
        return skillItems();
      },
      get items() {
        items ??= [...pluginItems(), ...skillItems()];
        return items;
      },
      sources: statuses,
    };
  }

  /** The Plugins every source offers, and the ones the Runtime holds that no store accounts for. */
  private pluginItems(
    statuses: readonly StoreSourceStatus[],
    ledger: StoreLedger,
    localByName: ReadonlyMap<string, AlranPluginView>,
    installed: readonly AlranPluginView[],
    official: readonly AlranPluginView[],
    builtInNames: ReadonlySet<string>,
    installedNames: InstalledNames,
  ): StoreItem[] {
    const items: StoreItem[] = [];
    for (const status of statuses) {
      if (!status.index) continue;
      for (const entry of status.index.plugins) {
        items.push(this.itemFor(entry, status.source, ledger, localByName, builtInNames, installedNames));
      }
    }
    items.push(...this.itemsWithoutEntry(items, ledger, installed, official));
    return items;
  }

  /**
   * The Skills every source offers, the ones that were installed from a store that cannot be read
   * now, and the ones that ship inside Alran Code.
   */
  private skillItems(
    statuses: readonly StoreSourceStatus[],
    ledger: StoreLedger,
    localByName: ReadonlyMap<string, AlranPluginView>,
    builtInNames: ReadonlySet<string>,
    installedNames: InstalledNames,
    bundledSkills: readonly BundledSkill[],
  ): StoreItem[] {
    const items: StoreItem[] = [];
    const known = new Set<string>();
    for (const status of statuses) {
      if (!status.index) continue;
      for (const entry of status.index.skills) {
        known.add(entry.name);
        items.push(this.itemFor(entry, status.source, ledger, localByName, builtInNames, installedNames));
      }
    }
    items.push(...this.orphanedSkills(known, ledger));
    items.push(...this.builtInItems(bundledSkills));
    return items;
  }

  /** `name` or `name@store`. Throws NOT_FOUND or AMBIGUOUS. */
  resolve(catalog: StoreCatalog, kind: StoreEntryKind, selector: string): StoreItem {
    const at = selector.lastIndexOf('@');
    const name = at > 0 ? selector.slice(0, at) : selector;
    const origin = at > 0 ? selector.slice(at + 1) : undefined;
    const matches = (kind === 'plugin' ? catalog.plugins : catalog.skills).filter(
      (item) => item.name === name && (!origin || item.origin === origin),
    );
    if (matches.length === 0) {
      throw new StoreError('NOT_FOUND', `No ${kind} named "${selector}". Try: alran ${kind === 'plugin' ? 'plugin' : 'skills'} search`);
    }
    // Prefer an installed copy; otherwise the choice must be unambiguous.
    const installed = matches.filter((item) => item.installed);
    if (matches.length > 1 && installed.length === 1) return installed[0] as StoreItem;
    if (matches.length > 1) {
      throw new StoreError(
        'AMBIGUOUS',
        `"${name}" exists in several places (${matches.map((item) => `${name}@${item.origin}`).join(', ')}); name one of them.`,
      );
    }
    return matches[0] as StoreItem;
  }

  stage(item: StoreItem, options: { readonly signal?: AbortSignal } = {}): Promise<StagedInstall> {
    if (!item.entry) {
      throw new StoreError('NOT_FOUND', `${item.name} has no store entry to install from.`);
    }
    if (item.conflict === 'built-in') {
      throw new StoreError(
        'CONFLICT',
        `A Skill named "${item.name}" is built in to Alran Code; installing this one would replace it, so the Store does not.`,
      );
    }
    if (item.conflict) {
      throw new StoreError(
        'CONFLICT',
        `A ${item.kind} named "${item.name}" is already installed outside the Store; the Store leaves it alone.`,
      );
    }
    return this.installer.stage(item.entry, item.origin, options);
  }

  async commit(staged: StagedInstall, options: { readonly consent: boolean }): Promise<InstallOutcome> {
    const record = await this.installer.commit(staged, options);
    const warnings: string[] = [];
    if (staged.entry.kind === 'plugin') await this.reloadPlugins(warnings);
    return { record, warnings };
  }

  async remove(item: StoreItem): Promise<InstallOutcome['warnings']> {
    if (isBuiltIn(item)) {
      throw new StoreError('INSTALL_FAILED', `${item.name} is built in to Alran Code and cannot be removed.`);
    }
    const warnings: string[] = [];
    if (item.kind === 'skill') {
      await this.installer.remove('skill', item.name);
      return warnings;
    }
    if (item.origin === 'official' || item.origin === 'local') {
      await this.requirePlugins().mutatePlugin({
        action: 'remove',
        plugin: { name: item.name, marketplace: item.origin },
      });
      return warnings;
    }
    // A Plugin from a store lives in the local Plugin directory: let the Runtime drop its own
    // state first, then delete what is left and the ledger record.
    await this.plugins
      ?.mutatePlugin({ action: 'remove', plugin: { name: item.name, marketplace: 'local' } })
      .catch(() => undefined);
    await this.installer.remove('plugin', item.name);
    await this.reloadPlugins(warnings);
    return warnings;
  }

  async setEnabled(item: StoreItem, enabled: boolean): Promise<void> {
    if (item.kind !== 'plugin') {
      throw new StoreError('INSTALL_FAILED', 'Only Plugins can be switched on and off.');
    }
    const marketplace = item.origin === 'official' ? 'official' : 'local';
    await this.requirePlugins().mutatePlugin({
      action: enabled ? 'enable' : 'disable',
      plugin: { name: item.name, marketplace },
    });
  }

  /** Installs a Plugin of the Runtime's own `official` registry (only reachable when one is set up). */
  async installOfficial(item: StoreItem): Promise<void> {
    await this.requirePlugins().mutatePlugin({
      action: 'install',
      plugin: { name: item.name, marketplace: 'official' },
    });
  }

  async refreshRuntime(): Promise<void> {
    await this.plugins?.refreshPlugins();
  }

  private requirePlugins(): PluginAccess {
    if (!this.plugins) throw new StoreError('INSTALL_FAILED', 'Plugin management is unavailable.');
    return this.plugins;
  }

  private async reloadPlugins(warnings: string[]): Promise<void> {
    try {
      await this.plugins?.refreshPlugins();
    } catch (error) {
      warnings.push(
        `The Plugin is in place but Alran could not reload Plugins (${error instanceof Error ? error.message : String(error)}). Restart Alran or run /reload.`,
      );
    }
  }

  private async readInstalledPlugins(): Promise<readonly AlranPluginView[]> {
    if (!this.plugins) return [];
    // A Runtime that cannot list Plugins must not hide the Store.
    return this.plugins.listInstalledPlugins().catch(() => []);
  }

  /** The Runtime's `official` registry is only asked when someone set one up; it has no default host. */
  private async readOfficialPlugins(): Promise<readonly AlranPluginView[]> {
    if (!this.plugins || !this.environment.ALRAN_PLUGIN_REGISTRY_URL?.trim()) return [];
    return this.plugins.listMarketplacePlugins({ marketplace: 'official' }).catch(() => []);
  }

  /**
   * The names under `<data-dir>/skills` and `<data-dir>/plugins`. The catalogue asks what is
   * installed for every entry it holds, and a store with a hundred thousand Skills would otherwise
   * ask the file system a hundred thousand times; two listings answer for all of them.
   */
  private async installedNames(): Promise<InstalledNames> {
    const list = async (kind: StoreEntryKind): Promise<ReadonlySet<string>> => {
      const directory = path.join(this.options.dataDir, kind === 'plugin' ? 'plugins' : 'skills');
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        return new Set(entries.map((entry) => entry.name));
      } catch (error) {
        if (isMissing(error)) return new Set<string>();
        throw error;
      }
    };
    const [skill, plugin] = await Promise.all([list('skill'), list('plugin')]);
    return { skill, plugin };
  }

  private itemFor(
    entry: StoreEntry,
    source: StoreSource,
    ledger: StoreLedger,
    localByName: ReadonlyMap<string, AlranPluginView>,
    builtInNames: ReadonlySet<string>,
    installedNames: InstalledNames,
  ): StoreItem {
    const table = entry.kind === 'plugin' ? ledger.plugins : ledger.skills;
    const record = table[entry.name];
    const owned = record?.source === source.id ? record : undefined;
    const runtimePlugin = entry.kind === 'plugin' ? localByName.get(entry.name) : undefined;
    const present = runtimePlugin !== undefined || installedNames[entry.kind].has(entry.name);
    // Something sits under this name and no store recorded it: it is the person's own.
    const conflict =
      entry.kind === 'skill' && builtInNames.has(entry.name)
        ? ('built-in' as const)
        : present && !record
          ? ('local' as const)
          : undefined;
    const installed = owned !== undefined && present;
    // Without a Runtime the on/off state of a Plugin cannot be read; an installed Plugin starts
    // enabled, so that is what is reported until the Runtime says otherwise.
    const enabled =
      installed &&
      (entry.kind === 'skill' || (runtimePlugin ? runtimePlugin.enabled : this.plugins === undefined));
    const updateAvailable =
      installed &&
      owned !== undefined &&
      (owned.version !== entry.version || owned.contentDigest !== entry.archive.contentDigest);
    // One shape for every item: a store with a hundred thousand Skills builds a hundred thousand of
    // them, and a field that is sometimes missing would give each of them a shape of its own.
    const id = `${entry.kind}:${entry.name}@${source.id}`;
    if (entry.kind === 'plugin') {
      return {
        id,
        kind: 'plugin',
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        author: entry.author,
        group: entry.category,
        license: entry.license,
        origin: source.id,
        version: entry.version,
        installedVersion: owned?.version,
        installed,
        enabled,
        updateAvailable,
        conflict,
        summary: pluginSummary(entry),
        entry,
        plugin: runtimePlugin,
      };
    }
    return {
      id,
      kind: 'skill',
      name: entry.name,
      displayName: entry.title,
      description: entry.description,
      author: entry.author,
      group: entry.group,
      license: entry.license,
      origin: source.id,
      version: entry.version,
      installedVersion: owned?.version,
      installed,
      enabled,
      updateAvailable,
      conflict,
      summary: `${entry.files} ${entry.files === 1 ? 'file' : 'files'}`,
      entry,
      plugin: runtimePlugin,
    };
  }

  /** Plugins the Runtime reports that no store entry accounts for: folders and registry Plugins. */
  private itemsWithoutEntry(
    existing: readonly StoreItem[],
    ledger: StoreLedger,
    installed: readonly AlranPluginView[],
    official: readonly AlranPluginView[],
  ): StoreItem[] {
    const seen = new Set(existing.filter((item) => item.kind === 'plugin').map((item) => item.name));
    const result: StoreItem[] = [];
    for (const plugin of [...installed, ...official]) {
      // A folder Plugin whose name a store entry also has is shown as that entry.
      if (plugin.marketplace === 'local' && seen.has(plugin.name)) continue;
      const record = plugin.marketplace === 'local' ? ledger.plugins[plugin.name] : undefined;
      const origin = record ? record.source : plugin.marketplace;
      const id = `plugin:${plugin.name}@${origin}`;
      if (result.some((item) => item.id === id)) continue;
      result.push({
        id,
        kind: 'plugin',
        name: plugin.name,
        displayName: plugin.displayName,
        description: plugin.description ?? '',
        ...(plugin.author ? { author: plugin.author } : {}),
        ...(plugin.version ? { version: plugin.version, installedVersion: plugin.version } : {}),
        origin,
        installed: plugin.installed,
        enabled: plugin.enabled,
        updateAvailable: false,
        summary: runtimeSummary(plugin),
        plugin,
      });
    }
    return result;
  }

  private readBundledSkills(): Promise<readonly BundledSkill[]> {
    this.bundledSkillsCache ??= this.bundledSkills().catch(() => []);
    return this.bundledSkillsCache;
  }

  /** The Skills that ship inside Alran Code. They always win over a store Skill of the same name. */
  private builtInItems(bundledSkills: readonly BundledSkill[]): StoreItem[] {
    return bundledSkills.map((skill) => ({
      id: `skill:${skill.name}@${BUILT_IN_ORIGIN}`,
      kind: 'skill' as const,
      name: skill.name,
      displayName: skill.name,
      description: skill.description,
      group: 'Built in',
      origin: BUILT_IN_ORIGIN,
      installed: true,
      enabled: true,
      updateAvailable: false,
      summary: '',
    }));
  }

  /** Skills the ledger knows whose store cannot be read right now. */
  private orphanedSkills(known: ReadonlySet<string>, ledger: StoreLedger): StoreItem[] {
    const result: StoreItem[] = [];
    for (const [name, record] of Object.entries(ledger.skills)) {
      if (known.has(name)) continue;
      const directory = this.installer.installDirectory('skill', name);
      const text = readTextIfExistsSync(path.join(directory, 'SKILL.md'));
      if (text === undefined) continue;
      let description = '';
      try {
        description = readSkillFrontmatter(text, 'SKILL.md').description;
      } catch {
        // Shown without a description.
      }
      result.push({
        id: `skill:${name}@${record.source}`,
        kind: 'skill',
        name,
        displayName: name,
        description,
        version: record.version,
        installedVersion: record.version,
        origin: record.source,
        installed: true,
        enabled: true,
        updateAvailable: false,
        summary: 'installed',
      });
    }
    return result;
  }
}

function pluginSummary(entry: Extract<StoreEntry, { kind: 'plugin' }>): string {
  const parts: string[] = [];
  const { skills, mcpServers, apps, hooks } = entry.contents;
  if (skills.length) parts.push(`${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  if (mcpServers.length) parts.push(`${mcpServers.length} MCP`);
  if (apps.length) parts.push(`${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`);
  if (hooks) parts.push(`${hooks} ${hooks === 1 ? 'hook' : 'hooks'}`);
  return parts.join(' · ') || 'empty';
}

function runtimeSummary(plugin: AlranPluginView): string {
  const { appCount, mcpServerCount, skillCount, agentCount } = plugin.capabilities;
  const parts: string[] = [];
  if (skillCount) parts.push(`${skillCount} ${skillCount === 1 ? 'skill' : 'skills'}`);
  if (mcpServerCount) parts.push(`${mcpServerCount} MCP`);
  if (appCount) parts.push(`${appCount} ${appCount === 1 ? 'app' : 'apps'}`);
  if (agentCount) parts.push(`${agentCount} subagents`);
  return parts.join(' · ') || 'empty';
}
