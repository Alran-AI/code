import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreError, type StoreEntry } from '../../src/store/contract.js';
import { removeTree } from '../../src/store/fs-util.js';
import { parseStoreIndex } from '../../src/store/index-format.js';
import { StoreInstaller } from '../../src/store/installer.js';
import { createStoreTransport } from '../../src/store/transport.js';
import {
  buildArchive,
  pluginFiles,
  rawZip,
  sha256Hex,
  skillFiles,
  writeStore,
  type StoreFixtureEntry,
} from '../helpers/store-fixtures.js';

let root: string;
let data: string;
let storeDir: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-installer-'));
  data = path.join(root, 'data');
  storeDir = path.join(root, 'store');
  mkdirSync(data);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function installer(): StoreInstaller {
  return new StoreInstaller({ dataDir: data, transport: createStoreTransport() });
}

function entries(fixtures: readonly StoreFixtureEntry[]): Map<string, StoreEntry> {
  const store = writeStore(storeDir, fixtures);
  const index = parseStoreIndex(readFileSync(new URL(store.url), 'utf8'), store.url);
  return new Map([...index.plugins, ...index.skills].map((entry) => [`${entry.kind}:${entry.name}`, entry]));
}

async function code(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof StoreError) return error.code;
    throw error;
  }
  return 'no error';
}

const tree = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();

describe('StoreInstaller', () => {
  it('installs a Skill into the user Skill directory and records where it came from', async () => {
    const all = entries([{ kind: 'skill', name: 'honest-status', files: skillFiles('honest-status') }]);
    const staged = await installer().stage(all.get('skill:honest-status') as StoreEntry, 'ottili');
    expect(staged.inspection).toMatchObject({ kind: 'skill', name: 'honest-status', requiresConsent: false });
    const record = await installer().commit(staged, { consent: false });
    expect(tree(path.join(data, 'skills', 'honest-status'))).toEqual(['SKILL.md', 'references/notes.md']);
    expect(record).toMatchObject({ source: 'ottili', version: '1.0.0' });
    expect((await installer().ledger()).skills['honest-status']).toEqual(record);
  });

  it('installs a skill-only Plugin without asking for consent', async () => {
    const all = entries([
      { kind: 'plugin', name: 'playbooks', files: pluginFiles({ name: 'playbooks', skills: ['one', 'two'] }) },
    ]);
    const staged = await installer().stage(all.get('plugin:playbooks') as StoreEntry, 'ottili');
    expect(staged.inspection).toMatchObject({ kind: 'plugin', requiresConsent: false, executes: [] });
    if (staged.inspection.kind === 'plugin') {
      expect(staged.inspection.skills.map((skill) => skill.name)).toEqual(['one', 'two']);
    }
    await installer().commit(staged, { consent: false });
    expect(existsSync(path.join(data, 'plugins', 'playbooks', '.alran-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(path.join(data, 'plugins', 'playbooks', 'skills', 'two', 'SKILL.md'))).toBe(true);
  });

  it('derives the consent notes from the archive, not from the index', async () => {
    // The index claims an empty package; the archive holds a command-running server and a hook.
    const all = entries([
      {
        kind: 'plugin',
        name: 'sneaky',
        files: pluginFiles({
          name: 'sneaky',
          skills: ['s'],
          mcp: { search: { type: 'stdio', command: 'npx', args: ['-y', 'search-mcp'] }, web: { type: 'sse', url: 'https://x.example/sse' } },
          hooks: [{ event: 'Stop', command: 'bash "$PLUGIN_ROOT/scripts/done.sh"' }],
          apps: ['github'],
          extraFiles: [{ path: 'scripts/done.sh', content: Buffer.from('echo done') }],
        }),
      },
    ]);
    const listed = all.get('plugin:sneaky') as StoreEntry;
    // A dishonest index: it says the package holds nothing that runs.
    const entry = (listed.kind === 'plugin'
      ? { ...listed, contents: { skills: listed.contents.skills, mcpServers: [], apps: [], hooks: 0 } }
      : listed) as StoreEntry;
    expect(entry.kind === 'plugin' && entry.contents.mcpServers).toEqual([]);
    const staged = await installer().stage(entry, 'ottili');
    expect(staged.inspection.requiresConsent).toBe(true);
    expect(staged.inspection.executes.map((note) => note.line)).toEqual([
      'MCP server "search" runs: npx -y search-mcp',
      'MCP server "web" connects to: https://x.example/sse',
      'Connector "github" asks to link an account',
      'Hook on Stop runs: bash "$PLUGIN_ROOT/scripts/done.sh"',
    ]);
  });

  it('writes nothing when a package that runs commands is not approved', async () => {
    const all = entries([
      { kind: 'plugin', name: 'runner', files: pluginFiles({ name: 'runner', mcp: { s: { type: 'stdio', command: 'node' } } }) },
    ]);
    const staged = await installer().stage(all.get('plugin:runner') as StoreEntry, 'ottili');
    expect(await code(() => installer().commit(staged, { consent: false }))).toBe('CONSENT_REQUIRED');
    expect(existsSync(path.join(data, 'plugins'))).toBe(false);
    expect((await installer().ledger()).plugins).toEqual({});
    await installer().commit(staged, { consent: true });
    expect(existsSync(path.join(data, 'plugins', 'runner'))).toBe(true);
  });

  describe('verification', () => {
    it('rejects an archive whose bytes changed after the index was written', async () => {
      const all = entries([{ kind: 'skill', name: 'alpha', files: skillFiles('alpha') }]);
      const archive = path.join(storeDir, 'archives', 'skill-alpha-1.0.0.zip');
      const bytes = readFileSync(archive);
      bytes[bytes.length - 40] ^= 0xff;
      writeFileSync(archive, bytes);
      expect(await code(() => installer().stage(all.get('skill:alpha') as StoreEntry, 'ottili'))).toBe('DIGEST_MISMATCH');
      expect(existsSync(path.join(data, 'skills'))).toBe(false);
    });

    it('rejects an archive of the wrong size', async () => {
      const all = entries([{ kind: 'skill', name: 'alpha', files: skillFiles('alpha') }]);
      const entry = all.get('skill:alpha') as StoreEntry;
      writeFileSync(path.join(storeDir, 'archives', 'skill-alpha-1.0.0.zip'), buildArchive(skillFiles('alpha')) as Buffer);
      const smaller = { ...entry, archive: { ...entry.archive, size: entry.archive.size + 10 } } as StoreEntry;
      expect(await code(() => installer().stage(smaller, 'ottili'))).toBe('DIGEST_MISMATCH');
    });

    it('rejects a valid archive whose content digest the index does not know', async () => {
      const all = entries([{ kind: 'skill', name: 'alpha', files: skillFiles('alpha') }]);
      const entry = all.get('skill:alpha') as StoreEntry;
      const forged = {
        ...entry,
        archive: { ...entry.archive, contentDigest: `sha256-tree-v1:${'0'.repeat(64)}` },
      } as StoreEntry;
      expect(await code(() => installer().stage(forged, 'ottili'))).toBe('DIGEST_MISMATCH');
    });

    it('rejects a package whose manifest disagrees with the listing', async () => {
      const wrongName = entries([
        { kind: 'plugin', name: 'listed', files: pluginFiles({ name: 'other', skills: ['s'] }) },
      ]);
      expect(await code(() => installer().stage(wrongName.get('plugin:listed') as StoreEntry, 'ottili'))).toBe('PACKAGE_INVALID');
      const wrongVersion = entries([
        { kind: 'plugin', name: 'v', version: '2.0.0', files: pluginFiles({ name: 'v', version: '1.0.0', skills: ['s'] }) },
      ]);
      expect(await code(() => installer().stage(wrongVersion.get('plugin:v') as StoreEntry, 'ottili'))).toBe('PACKAGE_INVALID');
    });

    it('rejects a Skill whose SKILL.md names another skill, and a Plugin with a missing file', async () => {
      const skill = entries([{ kind: 'skill', name: 'listed', files: skillFiles('different') }]);
      expect(await code(() => installer().stage(skill.get('skill:listed') as StoreEntry, 'ottili'))).toBe('PACKAGE_INVALID');
      const files = pluginFiles({ name: 'broken', skills: ['s'] }).filter((file) => file.path !== 'skills/s/SKILL.md');
      const plugin = entries([{ kind: 'plugin', name: 'broken', files }]);
      expect(await code(() => installer().stage(plugin.get('plugin:broken') as StoreEntry, 'ottili'))).toBe('PACKAGE_INVALID');
    });

    it('rejects a hostile archive even when its SHA-256 matches the index', async () => {
      const all = entries([{ kind: 'skill', name: 'evil', files: skillFiles('evil') }]);
      const entry = all.get('skill:evil') as StoreEntry;
      const hostile = rawZip([{ name: '../../escape.txt', content: Buffer.from('owned') }]);
      writeFileSync(path.join(storeDir, 'archives', 'skill-evil-1.0.0.zip'), hostile);
      const matching = {
        ...entry,
        archive: { ...entry.archive, size: hostile.length, archiveSha256: sha256Hex(hostile) as string },
      } as StoreEntry;
      expect(await code(() => installer().stage(matching, 'ottili'))).toBe('ARCHIVE_INVALID');
      expect(existsSync(path.join(root, 'escape.txt'))).toBe(false);
      expect(existsSync(path.join(data, 'skills'))).toBe(false);
    });
  });

  describe('ownership', () => {
    it('never overwrites a directory the Store did not install', async () => {
      const all = entries([{ kind: 'skill', name: 'mine', files: skillFiles('mine') }]);
      const own = path.join(data, 'skills', 'mine');
      mkdirSync(own, { recursive: true });
      writeFileSync(path.join(own, 'SKILL.md'), 'my own skill');
      expect(await code(() => installer().stage(all.get('skill:mine') as StoreEntry, 'ottili'))).toBe('CONFLICT');
      expect(readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('my own skill');
      expect(await code(() => installer().remove('skill', 'mine'))).toBe('NOT_FOUND');
      expect(readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('my own skill');
    });

    it('refuses a directory that appears between staging and committing', async () => {
      const all = entries([{ kind: 'skill', name: 'race', files: skillFiles('race') }]);
      const staged = await installer().stage(all.get('skill:race') as StoreEntry, 'ottili');
      mkdirSync(path.join(data, 'skills', 'race'), { recursive: true });
      writeFileSync(path.join(data, 'skills', 'race', 'SKILL.md'), 'late arrival');
      expect(await code(() => installer().commit(staged, { consent: false }))).toBe('CONFLICT');
      expect(readFileSync(path.join(data, 'skills', 'race', 'SKILL.md'), 'utf8')).toBe('late arrival');
    });

    it('keeps an install from one store apart from another store', async () => {
      const all = entries([{ kind: 'skill', name: 'shared', files: skillFiles('shared') }]);
      const entry = all.get('skill:shared') as StoreEntry;
      await installer().commit(await installer().stage(entry, 'first'), { consent: false });
      expect(await code(() => installer().stage(entry, 'second'))).toBe('CONFLICT');
    });
  });

  it('replaces an installed package on update and leaves no staging or trash behind', async () => {
    const v1 = entries([{ kind: 'skill', name: 'evolving', version: '1.0.0', files: skillFiles('evolving') }]);
    await installer().commit(await installer().stage(v1.get('skill:evolving') as StoreEntry, 'ottili'), { consent: false });
    const next = [
      ...skillFiles('evolving').filter((file) => file.path === 'SKILL.md'),
      { path: 'references/new.md', content: Buffer.from('new') },
    ];
    const v2 = entries([{ kind: 'skill', name: 'evolving', version: '1.1.0', files: next }]);
    const staged = await installer().stage(v2.get('skill:evolving') as StoreEntry, 'ottili');
    expect(staged.replacesVersion).toBe('1.0.0');
    await installer().commit(staged, { consent: false });
    expect(tree(path.join(data, 'skills', 'evolving'))).toEqual(['SKILL.md', 'references/new.md']);
    expect((await installer().ledger()).skills.evolving?.version).toBe('1.1.0');
    for (const leftover of ['staging', 'trash']) {
      const dir = path.join(data, 'store', leftover);
      expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    }
  });

  it('removes what it installed and nothing else', async () => {
    const all = entries([
      { kind: 'skill', name: 'one', files: skillFiles('one') },
      { kind: 'skill', name: 'two', files: skillFiles('two') },
    ]);
    for (const name of ['one', 'two']) {
      await installer().commit(await installer().stage(all.get(`skill:${name}`) as StoreEntry, 'ottili'), { consent: false });
    }
    expect(await installer().remove('skill', 'one')).toBe(true);
    expect(existsSync(path.join(data, 'skills', 'one'))).toBe(false);
    expect(existsSync(path.join(data, 'skills', 'two', 'SKILL.md'))).toBe(true);
    expect(Object.keys((await installer().ledger()).skills)).toEqual(['two']);
  });

  it('keeps the old version in place when the new one cannot be written', async () => {
    const v1 = entries([{ kind: 'plugin', name: 'steady', version: '1.0.0', files: pluginFiles({ name: 'steady', skills: ['s'] }) }]);
    await installer().commit(await installer().stage(v1.get('plugin:steady') as StoreEntry, 'ottili'), { consent: false });
    const v2 = entries([{ kind: 'plugin', name: 'steady', version: '1.1.0', files: pluginFiles({ name: 'steady', version: '1.1.0', skills: ['s'] }) }]);
    const staged = await installer().stage(v2.get('plugin:steady') as StoreEntry, 'ottili');
    // The staging area cannot be created: a file sits where the directory must go.
    rmSync(path.join(data, 'store', 'staging'), { recursive: true, force: true });
    writeFileSync(path.join(data, 'store', 'staging'), 'blocker');
    expect(await code(() => installer().commit(staged, { consent: false }))).toBe('INSTALL_FAILED');
    expect(JSON.parse(readFileSync(path.join(data, 'plugins', 'steady', '.alran-plugin', 'plugin.json'), 'utf8')).version).toBe('1.0.0');
    expect((await installer().ledger()).plugins.steady?.version).toBe('1.0.0');
  });

  it('serialises concurrent installs so the ledger keeps every record', async () => {
    const names = ['a', 'b', 'c', 'd', 'e'].map((letter) => `skill-${letter}`);
    const all = entries(names.map((name) => ({ kind: 'skill' as const, name, files: skillFiles(name) })));
    await Promise.all(
      names.map(async (name) => {
        const staged = await installer().stage(all.get(`skill:${name}`) as StoreEntry, 'ottili');
        await installer().commit(staged, { consent: false });
      }),
    );
    expect(Object.keys((await installer().ledger()).skills).sort()).toEqual(names);
  });

  it('sets a damaged ledger aside instead of deleting it', async () => {
    mkdirSync(path.join(data, 'store'), { recursive: true });
    writeFileSync(path.join(data, 'store', 'installed.json'), '{ broken');
    expect((await installer().ledger()).skills).toEqual({});
    expect(readdirSync(path.join(data, 'store')).some((name) => name.startsWith('installed.json.corrupt-'))).toBe(true);
  });

  it('treats a path that cannot exist as already removed', () => {
    // A file sits where the directory of the path would have to be, so the path cannot exist.
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'blocker');
    expect(() => removeTree(path.join(blocker, 'child'))).not.toThrow();
  });
});
