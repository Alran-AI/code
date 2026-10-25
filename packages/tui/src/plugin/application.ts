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
    const [installed, ...marketplaceCatalogs] = await Promise.all([
      this.access.listInstalledPlugins({ marketplace: input.marketplace }),
      ...marketplaces.map((marketplace) => this.access.listMarketplacePlugins({ marketplace })),
    ]);
    const merged = new Map(
      marketplaceCatalogs.flat().map((plugin) => [plugin.pluginId, plugin] as const),
    );
    for (const plugin of installed) merged.set(plugin.pluginId, plugin);
    return partitionCatalog([...merged.values()]);
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
