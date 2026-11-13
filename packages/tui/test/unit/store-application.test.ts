import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlranPluginView } from '../../src/plugin/contract.js';
import { AlranStoreApplication, type StoreCatalog } from '../../src/store/application.js';
import { StoreError } from '../../src/store/contract.js';
import { parseStoreIndex } from '../../src/store/index-format.js';
import { createFakeRuntime, pluginFiles, runtimeView, skillFiles, writeStore } from '../helpers/store-fixtures.js';

let root: string;
let data: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-app-'));
  data = path.join(root, 'data');
  mkdirSync(data);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fakeRuntime = (seed: AlranPluginView[] = []) => createFakeRuntime(data, seed);

function application(storeUrl: string, runtime = fakeRuntime(), environment: NodeJS.ProcessEnv = {}) {
  return new AlranStoreApplication({
    dataDir: data,
    plugins: runtime.access,
    environment: { ALRAN_STORE_URL: storeUrl, ...environment },
  });
}

const item = (catalog: StoreCatalog, id: string) => {
  const found = catalog.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no item ${id}; have ${catalog.items.map((entry) => entry.id).join(', ')}`);
  return found;
};

describe('AlranStoreApplication', () => {
  it('lists Plugins and Skills of the store with their state', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'plugin', name: 'playbooks', files: pluginFiles({ name: 'playbooks', skills: ['a', 'b'] }) },
      { kind: 'skill', name: 'honest-status', files: skillFiles('honest-status') },
    ]);
    const catalog = await application(store.url).catalog();
    expect(catalog.sources.map((source) => [source.source.id, source.index?.name])).toEqual([['ottili', 'Fixture Store']]);
    expect(catalog.items.map((entry) => entry.id).sort()).toEqual(['plugin:playbooks@ottili', 'skill:honest-status@ottili']);
    expect(item(catalog, 'plugin:playbooks@ottili')).toMatchObject({
      kind: 'plugin',
      origin: 'ottili',
      installed: false,
      enabled: false,
      updateAvailable: false,
      group: 'Code',
    });
  });

  it('installs a Plugin, reloads the Runtime and reports it installed and enabled', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'plugin', name: 'playbooks', files: pluginFiles({ name: 'playbooks', skills: ['a'] }) },
    ]);
    const runtime = fakeRuntime();
    const app = application(store.url, runtime);
    const target = item(await app.catalog(), 'plugin:playbooks@ottili');
    const outcome = await app.commit(await app.stage(target), { consent: false });
    expect(outcome.warnings).toEqual([]);
    expect(runtime.access.refreshPlugins).toHaveBeenCalledTimes(1);
    expect(item(await app.catalog(), 'plugin:playbooks@ottili')).toMatchObject({
      installed: true,
      enabled: true,
      installedVersion: '1.0.0',
    });
  });

  it('reports an installed Plugin as enabled, not disabled, when no Runtime can say', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'plugin', name: 'p', files: pluginFiles({ name: 'p', skills: ['a'] }) },
    ]);
    const environment = { ALRAN_STORE_URL: store.url };
    const withRuntime = application(store.url);
    await withRuntime.commit(await withRuntime.stage(item(await withRuntime.catalog(), 'plugin:p@ottili')), { consent: false });
    const alone = new AlranStoreApplication({ dataDir: data, environment });
    expect(item(await alone.catalog(), 'plugin:p@ottili')).toMatchObject({ installed: true, enabled: true });
  });

  it('warns, but keeps the install, when the Runtime cannot reload', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'plugin', name: 'p', files: pluginFiles({ name: 'p', skills: ['a'] }) },
    ]);
    const runtime = fakeRuntime();
    runtime.access.refreshPlugins.mockRejectedValueOnce(new Error('runtime busy'));
    const app = application(store.url, runtime);
    const outcome = await app.commit(await app.stage(item(await app.catalog(), 'plugin:p@ottili')), { consent: false });
    expect(outcome.warnings[0]).toContain('runtime busy');
    expect((await app.catalog()).items.find((entry) => entry.id === 'plugin:p@ottili')?.installed).toBe(true);
  });

  it('flags an update when the store offers another version or content', async () => {
    const dir = path.join(root, 's');
    writeStore(dir, [{ kind: 'skill', name: 'evolving', version: '1.0.0', files: skillFiles('evolving') }]);
    const app = application(writeStore(dir, [{ kind: 'skill', name: 'evolving', version: '1.0.0', files: skillFiles('evolving') }]).url);
    await app.commit(await app.stage(item(await app.catalog(), 'skill:evolving@ottili')), { consent: false });
    expect(item(await app.catalog(), 'skill:evolving@ottili').updateAvailable).toBe(false);
    writeStore(dir, [{ kind: 'skill', name: 'evolving', version: '1.1.0', files: skillFiles('evolving', 'Use when evolving, better.') }]);
    const next = item(await app.catalog({ refresh: true }), 'skill:evolving@ottili');
    expect(next).toMatchObject({ installed: true, updateAvailable: true, version: '1.1.0', installedVersion: '1.0.0' });
    await app.commit(await app.stage(next), { consent: false });
    expect(item(await app.catalog(), 'skill:evolving@ottili').updateAvailable).toBe(false);
  });

  it('treats a same-named thing the Store did not install as the person\'s own', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'skill', name: 'mine', files: skillFiles('mine') },
      { kind: 'plugin', name: 'folder', files: pluginFiles({ name: 'folder', skills: ['s'] }) },
    ]);
    mkdirSync(path.join(data, 'skills', 'mine'), { recursive: true });
    writeFileSync(path.join(data, 'skills', 'mine', 'SKILL.md'), 'mine');
    const runtime = fakeRuntime([runtimeView('folder')]);
    const app = application(store.url, runtime);
    const catalog = await app.catalog();
    expect(item(catalog, 'skill:mine@ottili')).toMatchObject({ installed: false, conflict: 'local' });
    expect(item(catalog, 'plugin:folder@ottili')).toMatchObject({ installed: false, conflict: 'local' });
    expect(() => app.stage(item(catalog, 'skill:mine@ottili'))).toThrow(StoreError);
    // The folder Plugin is not listed twice.
    expect(catalog.items.filter((entry) => entry.name === 'folder')).toHaveLength(1);
  });

  it('lists Plugins that are only folders or only in the Runtime, under their own origin', async () => {
    const store = writeStore(path.join(root, 's'), [{ kind: 'skill', name: 'x', files: skillFiles('x') }]);
    const runtime = fakeRuntime([
      runtimeView('handmade', { description: 'by hand' }),
      runtimeView('registry-one', { marketplace: 'official', pluginId: 'registry-one@official' }),
    ]);
    const catalog = await application(store.url, runtime).catalog();
    expect(item(catalog, 'plugin:handmade@local')).toMatchObject({ installed: true, description: 'by hand' });
    expect(item(catalog, 'plugin:handmade@local').entry).toBeUndefined();
    expect(item(catalog, 'plugin:registry-one@official').origin).toBe('official');
  });

  it('asks the Runtime registry for available Plugins only when one is configured', async () => {
    const store = writeStore(path.join(root, 's'), []);
    const runtime = fakeRuntime();
    runtime.access.listMarketplacePlugins.mockResolvedValue([
      runtimeView('remote-plugin', { marketplace: 'official', pluginId: 'remote-plugin@official', installed: false, enabled: false }),
    ]);
    expect((await application(store.url, runtime).catalog()).items).toEqual([]);
    expect(runtime.access.listMarketplacePlugins).not.toHaveBeenCalled();
    const configured = await application(store.url, runtime, { ALRAN_PLUGIN_REGISTRY_URL: 'https://registry.example' }).catalog();
    expect(item(configured, 'plugin:remote-plugin@official').installed).toBe(false);
  });

  it('keeps working when one source is unreachable and says which', async () => {
    const good = writeStore(path.join(root, 'good'), [{ kind: 'skill', name: 'x', files: skillFiles('x') }]);
    const app = application(good.url);
    await app.sources.add({ url: path.join(root, 'missing-store'), id: 'broken' });
    const catalog = await app.catalog();
    expect(catalog.items.map((entry) => entry.id)).toEqual(['skill:x@ottili']);
    const broken = catalog.sources.find((source) => source.source.id === 'broken');
    expect(broken?.index).toBeUndefined();
    expect(broken?.error).toContain('Could not read');
  });

  it('resolves names, prefers the installed copy and demands a source when ambiguous', async () => {
    const a = writeStore(path.join(root, 'a'), [{ kind: 'skill', name: 'twin', files: skillFiles('twin') }]);
    const b = writeStore(path.join(root, 'b'), [{ kind: 'skill', name: 'twin', files: skillFiles('twin') }]);
    const app = application(a.url);
    await app.sources.add({ url: path.join(root, 'b'), id: 'second' });
    void b;
    let catalog = await app.catalog();
    expect(() => app.resolve(catalog, 'skill', 'twin')).toThrowError(/twin@ottili, twin@second/u);
    expect(app.resolve(catalog, 'skill', 'twin@second').origin).toBe('second');
    expect(() => app.resolve(catalog, 'skill', 'nothing')).toThrowError(/No skill named "nothing"/u);
    await app.commit(await app.stage(app.resolve(catalog, 'skill', 'twin@second')), { consent: false });
    catalog = await app.catalog();
    expect(app.resolve(catalog, 'skill', 'twin').origin).toBe('second');
  });

  it('removes a Plugin through the Runtime and a Skill by deleting its folder', async () => {
    const store = writeStore(path.join(root, 's'), [
      { kind: 'plugin', name: 'p', files: pluginFiles({ name: 'p', skills: ['a'] }) },
      { kind: 'skill', name: 'sk', files: skillFiles('sk') },
    ]);
    const runtime = fakeRuntime();
    const app = application(store.url, runtime);
    for (const id of ['plugin:p@ottili', 'skill:sk@ottili']) {
      await app.commit(await app.stage(item(await app.catalog(), id)), { consent: false });
    }
    await app.remove(item(await app.catalog(), 'plugin:p@ottili'));
    await app.remove(item(await app.catalog(), 'skill:sk@ottili'));
    expect(runtime.access.mutatePlugin).toHaveBeenCalledWith({ action: 'remove', plugin: { name: 'p', marketplace: 'local' } });
    const after = await app.catalog();
    expect(item(after, 'plugin:p@ottili').installed).toBe(false);
    expect(item(after, 'skill:sk@ottili').installed).toBe(false);
  });

  it('switches Plugins on and off, and refuses to for a Skill', async () => {
    const store = writeStore(path.join(root, 's'), [{ kind: 'skill', name: 'sk', files: skillFiles('sk') }]);
    const runtime = fakeRuntime([runtimeView('handmade')]);
    const app = application(store.url, runtime);
    const catalog = await app.catalog();
    await app.setEnabled(item(catalog, 'plugin:handmade@local'), false);
    expect(runtime.access.mutatePlugin).toHaveBeenCalledWith({ action: 'disable', plugin: { name: 'handmade', marketplace: 'local' } });
    await expect(app.setEnabled(item(catalog, 'skill:sk@ottili'), false)).rejects.toThrow(/Only Plugins/u);
  });

  it('still lists a Skill the ledger knows when its store is unreachable', async () => {
    const dir = path.join(root, 's');
    const store = writeStore(dir, [{ kind: 'skill', name: 'kept', files: skillFiles('kept') }]);
    const app = application(store.url);
    await app.commit(await app.stage(item(await app.catalog(), 'skill:kept@ottili')), { consent: false });
    rmSync(dir, { recursive: true, force: true });
    const catalog = await app.catalog();
    expect(item(catalog, 'skill:kept@ottili')).toMatchObject({ installed: true, description: 'Use when testing kept.' });
  });
});

describe('store index format', () => {
  const base = 'https://store.example/alran/index.json';
  const archive = { url: 'a.zip', size: 100, archiveSha256: 'a'.repeat(64), contentDigest: `sha256-tree-v1:${'b'.repeat(64)}` };
  const skill = { name: 'x', title: 'X', version: '1.0.0', description: 'd', group: 'g', files: 2, archive };
  const doc = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ schema: 'alran.store/v1', name: 'S', plugins: [], skills: [skill], ...extra });
  const problem = (text: string, url = base) => {
    try {
      parseStoreIndex(text, url);
    } catch (error) {
      return error instanceof StoreError ? `${error.code}: ${error.message}` : String(error);
    }
    return 'no error';
  };

  it('resolves relative archive URLs against the index', () => {
    expect(parseStoreIndex(doc(), base).skills[0]?.archive.url).toBe('https://store.example/alran/a.zip');
    expect(
      parseStoreIndex(doc({ skills: [{ ...skill, archive: { ...archive, url: 'https://cdn.example/x.zip' } }] }), base).skills[0]?.archive.url,
    ).toBe('https://cdn.example/x.zip');
  });

  it('names the field that is wrong', () => {
    expect(problem('not json')).toContain('INDEX_INVALID');
    expect(problem(JSON.stringify({ schema: 'other' }))).toContain('field schema');
    expect(problem(doc({ skills: [{ ...skill, version: 'one' }] }))).toContain('skills[0].version');
    expect(problem(doc({ skills: [{ ...skill, name: 'Bad Name' }] }))).toContain('skills[0].name');
    expect(problem(doc({ skills: [{ ...skill, archive: { ...archive, archiveSha256: 'xyz' } }] }))).toContain('archiveSha256');
    expect(problem(doc({ skills: [{ ...skill, archive: { ...archive, contentDigest: 'sha256:1' } }] }))).toContain('contentDigest');
    expect(problem(doc({ skills: [skill, skill] }))).toContain('lists "x" twice');
    expect(problem(doc({ skills: [{ ...skill, files: 0 }] }))).toContain('skills[0].files');
    expect(problem(doc({ plugins: [{ name: 'p' }] }))).toContain('plugins[0]');
  });

  it('does not let a fetched index point at local files', () => {
    expect(problem(doc({ skills: [{ ...skill, archive: { ...archive, url: 'file:///etc/passwd' } }] }))).toContain('file URL');
    // A hostile index may use any scheme; only https and file URLs are accepted.
    // eslint-disable-next-line no-script-url
    const scriptUrl = 'javascript:alert(1)';
    expect(problem(doc({ skills: [{ ...skill, archive: { ...archive, url: scriptUrl } }] }))).toContain('INDEX_INVALID');
    expect(
      parseStoreIndex(doc({ skills: [{ ...skill, archive: { ...archive, url: 'file:///srv/a.zip' } }] }), 'file:///srv/index.json').skills[0]?.archive.url,
    ).toBe('file:///srv/a.zip');
  });

  it('defaults optional fields and caps example queries', () => {
    const plugin = {
      name: 'p',
      version: '1.0.0',
      description: 'd',
      author: 'a',
      category: 'Code',
      exampleQueries: ['1', '2', '3', '4'],
      contents: {},
      archive,
    };
    const parsed = parseStoreIndex(doc({ plugins: [plugin] }), base).plugins[0];
    expect(parsed).toMatchObject({ displayName: 'p', exampleQueries: ['1', '2', '3'], contents: { skills: [], hooks: 0 } });
    expect(problem(doc({ plugins: [{ ...plugin, category: 'Magic' }] }))).toContain('plugins[0].category');
  });
});
