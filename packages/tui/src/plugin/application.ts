import type {
  AlranPluginCatalog,
  AlranPluginMarketplace,
  AlranPluginRuntimeAccess,
  AlranPluginView,
} from './contract.js';

export class AlranPluginApplication {
  constructor(private readonly access: AlranPluginRuntimeAccess) {}

  async catalog(input: {
    readonly includeAvailable: boolean;
    readonly marketplace?: AlranPluginMarketplace;
  }): Promise<AlranPluginCatalog> {
    if (!input.includeAvailable) {
      return {
        installed: await this.access.listInstalledPlugins({
          marketplace: input.marketplace,
        }),
        available: [],
      };
    }
    const marketplaces: readonly AlranPluginMarketplace[] = input.marketplace
      ? [input.marketplace]
      : ['official', 'local'];
    const [installed, settled] = await Promise.all([
      this.access.listInstalledPlugins({ marketplace: input.marketplace }),
      Promise.allSettled(
        marketplaces.map((marketplace) => this.access.listMarketplacePlugins({ marketplace })),
      ),
    ]);
    // One unreachable source (the plugin registry is a network service; the local directory is
    // not) must not hide what the other offers. A source asked for by name still fails loudly.
    const unavailable: { marketplace: AlranPluginMarketplace; reason: string }[] = [];
    const marketplaceCatalogs: (readonly AlranPluginView[])[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') marketplaceCatalogs.push(result.value);
      else unavailable.push({ marketplace: marketplaces[index]!, reason: describeFailure(result.reason) });
    });
    if (input.marketplace && unavailable.length > 0) {
      throw new Error(unavailableMessage(unavailable[0]!));
    }
    const merged = new Map(
      marketplaceCatalogs.flat().map((plugin) => [plugin.pluginId, plugin] as const),
    );
    for (const plugin of installed) merged.set(plugin.pluginId, plugin);
    const catalog = partitionCatalog([...merged.values()]);
    return unavailable.length > 0 ? { ...catalog, unavailable } : catalog;
  }

  install(plugin: AlranPluginView): Promise<AlranPluginView> {
    return this.mutate(plugin, 'install');
  }

  remove(plugin: AlranPluginView): Promise<AlranPluginView> {
    return this.mutate(plugin, 'remove');
  }

  setEnabled(plugin: AlranPluginView, enabled: boolean): Promise<AlranPluginView> {
    return this.mutate(plugin, enabled ? 'enable' : 'disable');
  }

  refresh(): Promise<void> {
    return this.access.refreshPlugins();
  }

  private async mutate(
    plugin: AlranPluginView,
    action: 'install' | 'remove' | 'enable' | 'disable',
  ): Promise<AlranPluginView> {
    const result = await this.access.mutatePlugin({
      action,
      plugin: { name: plugin.name, marketplace: plugin.marketplace },
    });
    return { ...plugin, ...result };
  }
}

function partitionCatalog(plugins: readonly AlranPluginView[]): AlranPluginCatalog {
  const installed: AlranPluginView[] = [];
  const available: AlranPluginView[] = [];
  for (const plugin of plugins) {
    (plugin.installed ? installed : available).push(plugin);
  }
  return { installed, available };
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a person reads when a Plugin source cannot be reached. */
export function unavailableMessage(entry: {
  readonly marketplace: AlranPluginMarketplace;
  readonly reason: string;
}): string {
  return entry.marketplace === 'official'
    ? `The Ottili Plugin registry is not reachable (${entry.reason}). Set ALRAN_PLUGIN_REGISTRY_URL to a registry you run, or add a Plugin from a directory: copy the Plugin's folder into the local Plugin directory (\`alran plugins marketplace list\` shows where); a Plugin there is installed and enabled.`
    : `The local Plugin directory could not be read (${entry.reason}).`;
}
