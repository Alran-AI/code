export type AlranPluginMarketplace = 'official' | 'local';

export interface AlranPluginCapabilities {
  readonly appCount: number;
  readonly mcpServerCount: number;
  readonly skillCount: number;
}

export interface AlranPluginView {
  readonly pluginId: string;
  readonly name: string;
  readonly displayName: string;
  readonly marketplace: AlranPluginMarketplace;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly capabilities: AlranPluginCapabilities;
}

export interface AlranPluginCatalog {
  readonly installed: readonly AlranPluginView[];
  readonly available: readonly AlranPluginView[];
}

export interface AlranPluginRuntimeAccess {
  listInstalledPlugins(input?: {
    readonly marketplace?: AlranPluginMarketplace;
  }): Promise<readonly AlranPluginView[]>;
  listMarketplacePlugins(input: {
    readonly marketplace: AlranPluginMarketplace;
  }): Promise<readonly AlranPluginView[]>;
  mutatePlugin(input: {
    readonly action: 'install' | 'remove' | 'enable' | 'disable';
    readonly plugin: { readonly name: string; readonly marketplace: AlranPluginMarketplace };
  }): Promise<{ readonly installed: boolean; readonly enabled: boolean }>;
  refreshPlugins(): Promise<void>;
}

export type AlranPluginCliRequest =
  | {
      readonly action: 'list';
      readonly marketplace?: AlranPluginMarketplace;
      readonly available?: boolean;
      readonly json?: boolean;
    }
  | {
      readonly action: 'add' | 'remove' | 'enable' | 'disable';
      readonly selector: string;
      readonly marketplace?: AlranPluginMarketplace;
      readonly json?: boolean;
    }
  | { readonly action: 'marketplace-list'; readonly json?: boolean }
  | {
      readonly action: 'marketplace-upgrade';
      readonly json?: boolean;
    };
