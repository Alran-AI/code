export type AlranPluginMarketplace = 'official' | 'local';

export interface AlranPluginCapabilities {
  readonly appCount: number;
  readonly mcpServerCount: number;
  readonly skillCount: number;
  /** Plugin subagents (official or local); absent when the Runtime reports none. */
  readonly agentCount?: number;
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
  /** Plugin sources that could not be read; the catalog shows what the others offer. */
  readonly unavailable?: readonly { readonly marketplace: AlranPluginMarketplace; readonly reason: string }[];
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
      /** Approve a package that runs commands without asking (installing from a store). */
      readonly yes?: boolean;
      readonly json?: boolean;
    }
  | {
      readonly action: 'search';
      readonly query?: string;
      readonly refresh?: boolean;
      readonly json?: boolean;
    }
  | { readonly action: 'info'; readonly selector: string; readonly json?: boolean }
  | {
      readonly action: 'update';
      /** Absent: every installed Plugin that has an update. */
      readonly selector?: string;
      readonly yes?: boolean;
      readonly json?: boolean;
    }
  | { readonly action: 'marketplace-list'; readonly json?: boolean }
  | {
      readonly action: 'marketplace-add';
      readonly url: string;
      readonly name?: string;
      readonly json?: boolean;
    }
  | { readonly action: 'marketplace-remove'; readonly name: string; readonly json?: boolean }
  | {
      readonly action: 'marketplace-upgrade';
      readonly json?: boolean;
    };

/** `alran skills …`: the Skill Library of the Store. */
export type AlranSkillCliRequest =
  | { readonly action: 'list'; readonly installed?: boolean; readonly json?: boolean }
  | {
      readonly action: 'search';
      readonly query?: string;
      readonly refresh?: boolean;
      readonly json?: boolean;
    }
  | { readonly action: 'info'; readonly selector: string; readonly json?: boolean }
  | {
      readonly action: 'add';
      readonly selector: string;
      readonly yes?: boolean;
      readonly json?: boolean;
    }
  | {
      readonly action: 'update';
      readonly selector?: string;
      readonly yes?: boolean;
      readonly json?: boolean;
    }
  | { readonly action: 'remove'; readonly selector: string; readonly json?: boolean };
