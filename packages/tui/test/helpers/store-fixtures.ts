import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';

import type { AlranPluginView } from '../../src/plugin/contract.js';

// The builder is a repository tool, not a package: tests reach it by path.
/* eslint-disable import/no-relative-packages */
// @ts-expect-error the store builder library is plain ESM JavaScript
import { buildArchive, contentDigest, crc32, sha256Hex } from '../../../../tools/store/lib/package-archive.mjs';
/* eslint-enable import/no-relative-packages */

export interface FixtureFile {
  readonly path: string;
  readonly content: Buffer;
}

export const ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export function skillFiles(name: string, description = `Use when testing ${name}.`): FixtureFile[] {
  return [
    {
      path: 'SKILL.md',
      content: Buffer.from(`---\nname: ${name}\ndescription: "${description}"\n---\n\nBody of ${name}.\n`),
    },
    { path: 'references/notes.md', content: Buffer.from(`Notes for ${name}.\n`) },
  ];
}

export interface PluginFixtureOptions {
  readonly name: string;
  readonly version?: string;
  readonly skills?: readonly string[];
  readonly mcp?: Readonly<Record<string, Record<string, unknown>>>;
  readonly hooks?: readonly { readonly event: string; readonly command: string }[];
  readonly apps?: readonly string[];
  readonly extraFiles?: readonly FixtureFile[];
}

export function pluginFiles(options: PluginFixtureOptions): FixtureFile[] {
  const version = options.version ?? '1.0.0';
  const skills = options.skills ?? [];
  const files: FixtureFile[] = [{ path: 'icon.png', content: ICON_PNG }];
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    name: options.name,
    version,
    description: `The ${options.name} plugin.`,
    author: 'Fixture Author',
    icon: 'icon.png',
    category: 'Code',
    exampleQueries: [`Use ${options.name}`],
    apps: [] as string[],
    mcpServers: [] as string[],
    skills: skills.map((skill) => `skills/${skill}/SKILL.md`),
  };
  for (const skill of skills) {
    for (const file of skillFiles(skill)) {
      files.push({ path: `skills/${skill}/${file.path}`, content: file.content });
    }
  }
  if (options.mcp) {
    manifest.mcpServers = ['tools.mcp.json'];
    files.push({
      path: 'tools.mcp.json',
      content: Buffer.from(JSON.stringify({ schemaVersion: 1, mcpServers: options.mcp })),
    });
  }
  if (options.apps?.length) {
    manifest.apps = options.apps.map((provider) => `${provider}.app.json`);
    for (const provider of options.apps) {
      files.push({
        path: `${provider}.app.json`,
        content: Buffer.from(JSON.stringify({ schemaVersion: 1, provider })),
      });
    }
  }
  if (options.hooks?.length) {
    manifest.hooks = ['hooks/hooks.json'];
    const grouped: Record<string, unknown[]> = {};
    for (const hook of options.hooks) {
      (grouped[hook.event] ??= []).push({
        matcher: '*',
        hooks: [{ type: 'command', command: hook.command, timeout: 5 }],
      });
    }
    files.push({
      path: 'hooks/hooks.json',
      content: Buffer.from(JSON.stringify({ hooks: grouped })),
    });
  }
  files.push({
    path: '.alran-plugin/plugin.json',
    content: Buffer.from(JSON.stringify(manifest)),
  });
  files.push(...(options.extraFiles ?? []));
  return files;
}

export interface StoreFixtureEntry {
  readonly kind: 'plugin' | 'skill';
  readonly name: string;
  readonly version?: string;
  readonly files: readonly FixtureFile[];
  readonly description?: string;
  readonly category?: string;
}

/** What the builder would put in `contents`, read from the package files. */
function describeContents(files: readonly FixtureFile[]) {
  const text = (file: string) => files.find((candidate) => candidate.path === file)?.content.toString('utf8');
  const manifest = JSON.parse(text('.alran-plugin/plugin.json') ?? '{}') as Record<string, string[]>;
  const mcpServers = (manifest.mcpServers ?? []).flatMap((file) => Object.keys(JSON.parse(text(file) ?? '{}').mcpServers));
  const apps = (manifest.apps ?? []).map((file) => String(JSON.parse(text(file) ?? '{}').provider));
  const hooks = (manifest.hooks ?? []).reduce((count, file) => {
    const groups = Object.values(JSON.parse(text(file) ?? '{}').hooks ?? {}) as { hooks: unknown[] }[][];
    return count + groups.flat().reduce((sum, group) => sum + group.hooks.length, 0);
  }, 0);
  return {
    skills: (manifest.skills ?? []).map((file) => ({ name: file.split('/')[1] ?? '' })),
    mcpServers,
    apps,
    hooks,
  };
}

/** Writes `index.json` and its archives under `dir`; returns the index file URL. */
export function writeStore(
  dir: string,
  entries: readonly StoreFixtureEntry[],
  overrides: { readonly name?: string } = {},
): { readonly url: string; readonly index: Record<string, unknown> } {
  mkdirSync(path.join(dir, 'archives'), { recursive: true });
  const plugins: unknown[] = [];
  const skills: unknown[] = [];
  for (const entry of entries) {
    const version = entry.version ?? '1.0.0';
    const archive = buildArchive(entry.files) as Buffer;
    const file = `archives/${entry.kind}-${entry.name}-${version}.zip`;
    writeFileSync(path.join(dir, file), archive);
    const ref = {
      url: file,
      size: archive.length,
      archiveSha256: sha256Hex(archive) as string,
      contentDigest: contentDigest(entry.files) as string,
    };
    if (entry.kind === 'plugin') {
      plugins.push({
        name: entry.name,
        displayName: entry.name.replace(/(^|-)([a-z])/gu, (_m, _s, c: string) => ` ${c.toUpperCase()}`).trim(),
        version,
        description: entry.description ?? `The ${entry.name} plugin.`,
        author: 'Fixture Author',
        category: entry.category ?? 'Code',
        exampleQueries: [`Use ${entry.name}`],
        contents: describeContents(entry.files),
        archive: ref,
      });
    } else {
      skills.push({
        name: entry.name,
        title: entry.name,
        version,
        description: entry.description ?? `Use when testing ${entry.name}.`,
        group: 'fixtures',
        files: entry.files.length,
        archive: ref,
      });
    }
  }
  const index = { schema: 'alran.store/v1', name: overrides.name ?? 'Fixture Store', plugins, skills };
  const indexPath = path.join(dir, 'index.json');
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return { url: pathToFileURL(indexPath).toString(), index };
}

export interface RawEntry {
  readonly name: string;
  readonly content?: Buffer;
  readonly method?: number;
  readonly flags?: number;
  readonly extra?: Buffer;
  readonly versionMadeBy?: number;
  readonly externalAttributes?: number;
  readonly comment?: Buffer;
  /** Written into the central directory only (a lying size). */
  readonly centralUncompressedSize?: number;
}

/** A ZIP writer that can produce the malformed archives a real publisher never would. */
export function rawZip(entries: readonly RawEntry[], archiveComment = Buffer.alloc(0)): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = entry.content ?? Buffer.alloc(0);
    const extra = entry.extra ?? Buffer.alloc(0);
    const comment = entry.comment ?? Buffer.alloc(0);
    const crc = crc32(content) as number;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method ?? 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, name, extra, content);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(entry.versionMadeBy ?? (3 << 8) | 20, 4);
    header.writeUInt16LE(10, 6);
    header.writeUInt16LE(entry.flags ?? 0, 8);
    header.writeUInt16LE(entry.method ?? 0, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(content.length, 20);
    header.writeUInt32LE(entry.centralUncompressedSize ?? content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt16LE(comment.length, 32);
    header.writeUInt32LE(entry.externalAttributes ?? (0o100644 << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name, extra, comment);
    offset += 30 + name.length + extra.length + content.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(archiveComment.length, 20);
  return Buffer.concat([...parts, centralBytes, end, archiveComment]);
}

export { buildArchive, contentDigest, sha256Hex };

export function runtimeView(name: string, extra: Partial<AlranPluginView> = {}): AlranPluginView {
  return {
    pluginId: `${name}@local`,
    name,
    displayName: name,
    marketplace: 'local',
    installed: true,
    enabled: true,
    capabilities: { appCount: 0, mcpServerCount: 0, skillCount: 1 },
    ...extra,
  };
}

/** A fake Runtime that "sees" whatever sits in `<dataDir>/plugins`, as the real one does. */
export function createFakeRuntime(dataDir: string, seed: AlranPluginView[] = []) {
  const views = new Map(seed.map((view) => [view.name, view] as const));
  const access = {
    listInstalledPlugins: vi.fn(async () => [...views.values()]),
    listMarketplacePlugins: vi.fn(async () => [] as AlranPluginView[]),
    mutatePlugin: vi.fn(
      async (input: { action: string; plugin: { name: string; marketplace: string } }) => {
        const view = views.get(input.plugin.name);
        if (input.action === 'remove') views.delete(input.plugin.name);
        else if (view) views.set(view.name, { ...view, enabled: input.action === 'enable' });
        return { installed: input.action !== 'remove', enabled: input.action === 'enable' };
      },
    ),
    refreshPlugins: vi.fn(async () => {
      try {
        for (const name of readdirSync(path.join(dataDir, 'plugins'))) {
          if (!views.has(name)) views.set(name, runtimeView(name));
        }
      } catch {
        // no plugins directory yet
      }
    }),
  };
  return { access, views };
}
