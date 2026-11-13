import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAlranPluginCommand } from '../../src/cli/plugin-command.js';
import { createTuiProgram } from '../../src/cli/program.js';
import { runAlranSkillCommand } from '../../src/cli/skills-command.js';
import type { StoreCliHost } from '../../src/cli/store-cli.js';
import type { AlranPluginCliRequest, AlranSkillCliRequest } from '../../src/plugin/contract.js';
import { AlranStoreApplication } from '../../src/store/application.js';
import { createFakeRuntime, pluginFiles, skillFiles, writeStore } from '../helpers/store-fixtures.js';

let root: string;
let data: string;
let storeUrl: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-cli-'));
  data = path.join(root, 'data');
  mkdirSync(data);
  storeUrl = writeStore(path.join(root, 'store'), [
    { kind: 'plugin', name: 'playbooks', files: pluginFiles({ name: 'playbooks', skills: ['one', 'two'] }), description: 'Engineering playbooks for agents.' },
    {
      kind: 'plugin',
      name: 'runner',
      files: pluginFiles({ name: 'runner', skills: ['r'], mcp: { search: { type: 'stdio', command: 'npx', args: ['-y', 'search-mcp'] } } }),
      description: 'Runs a search server.',
    },
    { kind: 'skill', name: 'honest-status', files: skillFiles('honest-status'), description: 'Write a STATUS.md that stays true.' },
    { kind: 'skill', name: 'pg-rls', files: skillFiles('pg-rls'), description: 'Postgres row level security for tenants.' },
  ]).url;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function hostFor(access?: ReturnType<typeof createFakeRuntime>['access'], answer?: boolean) {
  const notes: string[] = [];
  const questions: string[] = [];
  const store = new AlranStoreApplication({
    dataDir: data,
    bundledSkills: async () => [],
    ...(access ? { plugins: access } : {}),
    environment: { ALRAN_STORE_URL: storeUrl },
  });
  const host: StoreCliHost = {
    store,
    width: 100,
    notify: (text) => notes.push(text),
    confirm: async (question) => {
      questions.push(question);
      return answer;
    },
  };
  return { host, notes, questions };
}

const skills = (request: AlranSkillCliRequest, host: StoreCliHost) => runAlranSkillCommand({ request, host, dataDir: data });

function plugins(request: AlranPluginCliRequest, host: StoreCliHost, runtime = createFakeRuntime(data)) {
  const application = {
    catalog: vi.fn(async () => ({ installed: [], available: [] })),
    install: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
    refresh: vi.fn(async () => undefined),
  };
  return runAlranPluginCommand({
    version: 'test',
    request,
    dataDir: data,
    createHost: () => host,
    createContext: async () => ({ application, access: runtime.access, dataDir: data, shutdown: async () => undefined }),
  }).then((output) => ({ output, application }));
}

describe('alran skills', () => {
  it('lists the library by group and marks what is installed', async () => {
    const { host } = hostFor();
    const before = await skills({ action: 'list' }, host);
    expect(before).toContain('fixtures');
    expect(before).toMatch(/\[ \] honest-status\s+1\.0\.0\s+Write a STATUS\.md that stays true\./u);
    await skills({ action: 'add', selector: 'honest-status' }, host);
    expect(await skills({ action: 'list' }, host)).toMatch(/\[\*\] honest-status\s+1\.0\.0\s+Write a STATUS\.md.*installed/u);
    expect(await skills({ action: 'list', installed: true }, host)).not.toContain('pg-rls');
  });

  it('searches by words in name and description, best match first', async () => {
    const { host } = hostFor();
    expect(await skills({ action: 'search', query: 'postgres tenants' }, host)).toMatch(/^\[ \] pg-rls /u);
    expect(await skills({ action: 'search', query: 'status' }, host)).toContain('honest-status');
    expect(await skills({ action: 'search', query: 'nothing at all' }, host)).toBe('No skills match "nothing at all".');
  });

  it('prints JSON for scripts', async () => {
    const { host } = hostFor();
    const document = JSON.parse(await skills({ action: 'search', query: 'rls', json: true }, host));
    expect(document.items).toHaveLength(1);
    expect(document.items[0]).toMatchObject({ name: 'pg-rls', kind: 'skill', origin: 'ottili', installed: false });
  });

  it('shows information, installs, reports an install that is already there, and removes', async () => {
    const { host } = hostFor();
    expect(await skills({ action: 'info', selector: 'pg-rls' }, host)).toContain('Postgres row level security for tenants.');
    expect(await skills({ action: 'add', selector: 'pg-rls' }, host)).toMatch(/^Installed Skill pg-rls 1\.0\.0/u);
    expect(existsSync(path.join(data, 'skills', 'pg-rls', 'SKILL.md'))).toBe(true);
    expect(await skills({ action: 'add', selector: 'pg-rls' }, host)).toMatch(/already installed \(1\.0\.0\)/u);
    expect(await skills({ action: 'remove', selector: 'pg-rls' }, host)).toBe('Removed Skill pg-rls.');
    expect(existsSync(path.join(data, 'skills', 'pg-rls'))).toBe(false);
    await expect(skills({ action: 'remove', selector: 'pg-rls' }, host)).rejects.toThrow(/not installed/u);
  });

  it('says what it could not find', async () => {
    const { host } = hostFor();
    await expect(skills({ action: 'add', selector: 'typo-skill' }, host)).rejects.toThrow(/No skill named "typo-skill"/u);
  });

  it('updates only what changed in the store', async () => {
    const { host } = hostFor();
    await skills({ action: 'add', selector: 'honest-status' }, host);
    expect(await skills({ action: 'update' }, host)).toBe('All skills from stores are up to date.');
    writeStore(path.join(root, 'store'), [
      { kind: 'skill', name: 'honest-status', version: '1.2.0', files: skillFiles('honest-status', 'A better description.') },
    ]);
    const output = await skills({ action: 'update' }, host);
    expect(output).toBe('updated honest-status: 1.0.0 → 1.2.0');
    expect(readFileSync(path.join(data, 'skills', 'honest-status', 'SKILL.md'), 'utf8')).toContain('A better description.');
  });

  it('notes a store it cannot read while still using the others', async () => {
    const { host } = hostFor();
    await host.store.sources.add({ url: path.join(root, 'gone'), id: 'gone' });
    const output = await skills({ action: 'list' }, host);
    expect(output).toContain('honest-status');
    expect(output).toMatch(/note: store "gone" could not be read: .*Could not read/u);
  });
});

describe('alran plugin (store)', () => {
  it('searches without starting a Runtime and shows installed state', async () => {
    const { host } = hostFor();
    const output = await runAlranPluginCommand({
      version: 'test',
      request: { action: 'search', query: 'playbooks' },
      dataDir: data,
      createHost: () => host,
      createContext: async () => {
        throw new Error('a search must not start a Runtime');
      },
    });
    expect(output).toMatch(/^\[ \] playbooks\s+1\.0\.0\s+Engineering playbooks for agents\./u);
  });

  it('installs a skill-only Plugin and lists it as enabled under its store', async () => {
    const runtime = createFakeRuntime(data);
    const { host } = hostFor(runtime.access);
    const installed = await plugins({ action: 'add', selector: 'playbooks' }, host, runtime);
    expect(installed.output).toMatch(/^Installed Plugin playbooks 1\.0\.0 — 2 skills\./u);
    expect(installed.application.catalog).not.toHaveBeenCalled();
    expect(runtime.access.refreshPlugins).toHaveBeenCalled();
    expect((await plugins({ action: 'list' }, host, runtime)).output).toBe('[*] playbooks@ottili\tenabled');
    const json = JSON.parse((await plugins({ action: 'list', available: true, json: true }, host, runtime)).output);
    expect(json.installed.map((plugin: { pluginId: string }) => plugin.pluginId)).toEqual(['playbooks@ottili']);
    expect(json.available.map((plugin: { pluginId: string }) => plugin.pluginId)).toEqual(['runner@ottili']);
    expect(json.installed[0].capabilities.skillCount).toBe(1);
  });

  it('shows what a Plugin that runs commands does, and will not install it unasked', async () => {
    const runtime = createFakeRuntime(data);
    const silent = hostFor(runtime.access);
    await expect(plugins({ action: 'add', selector: 'runner' }, silent.host, runtime)).rejects.toThrow(/run again with --yes/u);
    expect(silent.notes.join('\n')).toContain('MCP server "search" runs: npx -y search-mcp');
    expect(existsSync(path.join(data, 'plugins', 'runner'))).toBe(false);

    const declined = hostFor(runtime.access, false);
    await expect(plugins({ action: 'add', selector: 'runner' }, declined.host, runtime)).rejects.toThrow(/was not approved/u);
    expect(declined.questions).toEqual(['Install runner? [y/N] ']);
    expect(existsSync(path.join(data, 'plugins', 'runner'))).toBe(false);

    const accepted = hostFor(runtime.access, true);
    expect((await plugins({ action: 'add', selector: 'runner' }, accepted.host, runtime)).output).toContain('Installed Plugin runner');
    expect(existsSync(path.join(data, 'plugins', 'runner', '.alran-plugin', 'plugin.json'))).toBe(true);
  });

  it('approves with --yes but still prints the list for the record', async () => {
    const runtime = createFakeRuntime(data);
    const { host, notes, questions } = hostFor(runtime.access);
    await plugins({ action: 'add', selector: 'runner', yes: true }, host, runtime);
    expect(questions).toEqual([]);
    expect(notes.join('\n')).toContain('search-mcp');
  });

  it('disables, enables and removes a Plugin it installed', async () => {
    const runtime = createFakeRuntime(data);
    const { host } = hostFor(runtime.access);
    await plugins({ action: 'add', selector: 'playbooks' }, host, runtime);
    expect((await plugins({ action: 'disable', selector: 'playbooks@ottili' }, host, runtime)).output).toBe('[-] playbooks@ottili\tdisabled');
    expect((await plugins({ action: 'enable', selector: 'playbooks' }, host, runtime)).output).toBe('[*] playbooks@ottili\tenabled');
    expect((await plugins({ action: 'remove', selector: 'playbooks' }, host, runtime)).output).toBe('Removed Plugin playbooks.');
    expect(existsSync(path.join(data, 'plugins', 'playbooks'))).toBe(false);
    expect((await plugins({ action: 'list' }, host, runtime)).output).toBe('');
  });

  it('leaves names the Store does not know to the Runtime sources', async () => {
    const runtime = createFakeRuntime(data);
    const { host } = hostFor(runtime.access);
    await expect(plugins({ action: 'add', selector: 'unknown-plugin' }, host, runtime)).rejects.toThrow(/Plugin not found: unknown-plugin/u);
    await expect(plugins({ action: 'add', selector: 'playbooks', marketplace: 'official' }, host, runtime)).rejects.toThrow(/Plugin not found: playbooks@official/u);
  });

  it('shows information and updates', async () => {
    const runtime = createFakeRuntime(data);
    const { host } = hostFor(runtime.access);
    const info = (await plugins({ action: 'info', selector: 'playbooks' }, host, runtime)).output;
    expect(info).toContain('Playbooks (playbooks)');
    expect(info).toContain('Try:');
    expect((await plugins({ action: 'update' }, host, runtime)).output).toBe('All plugins from stores are up to date.');
  });

  it('manages stores: add reads it at once, list shows it, remove forgets it', async () => {
    const { host } = hostFor();
    const added = await runAlranPluginCommand({
      version: 'test',
      request: { action: 'marketplace-add', url: path.join(root, 'store'), name: 'second' },
      dataDir: data,
      createHost: () => host,
    });
    expect(added).toBe(
      `Added store "second" (file://${path.join(root, 'store', 'index.json')}): 2 plugins, 2 skills.`,
    );
    const listed = await runAlranPluginCommand({ version: 'test', request: { action: 'marketplace-list' }, dataDir: data, createHost: () => host });
    expect(listed).toContain('ottili\tstore\t');
    expect(listed).toContain('second\tstore\tfile://');
    expect(listed).toContain(`local\tdirectory\t${data}/plugins`);
    const removed = await runAlranPluginCommand({ version: 'test', request: { action: 'marketplace-remove', name: 'second' }, dataDir: data, createHost: () => host });
    expect(removed).toMatch(/^Removed store "second"/u);
    await expect(
      runAlranPluginCommand({ version: 'test', request: { action: 'marketplace-remove', name: 'ottili' }, dataDir: data, createHost: () => host }),
    ).rejects.toThrow(/is the default store/u);
  });

  it('reports a store that cannot be read at the moment it is added', async () => {
    const { host } = hostFor();
    const output = await runAlranPluginCommand({
      version: 'test',
      request: { action: 'marketplace-add', url: path.join(root, 'nowhere') },
      dataDir: data,
      createHost: () => host,
    });
    expect(output).toMatch(/not readable yet: .*Could not read/u);
  });
});

describe('commands about what is installed stay off the network', () => {
  function offlineHost() {
    const runtime = createFakeRuntime(data);
    const requests: string[] = [];
    const store = new AlranStoreApplication({
      dataDir: data,
      bundledSkills: async () => [],
      plugins: runtime.access,
      environment: { ALRAN_STORE_URL: 'https://store.example/alran' },
      transport: {
        readText: async (url) => {
          requests.push(url);
          throw new Error('no network in this test');
        },
        readBytes: async (url) => {
          requests.push(url);
          throw new Error('no network in this test');
        },
      },
    });
    const host: StoreCliHost = { store, notify: () => undefined, confirm: async () => undefined };
    return { host, runtime, requests };
  }

  it('lists installed Plugins and Skills, switches and removes them without asking a store', async () => {
    // Put something in place with the real store first, then work with it "offline".
    const first = hostFor(createFakeRuntime(data).access);
    await skills({ action: 'add', selector: 'honest-status' }, first.host);
    const runtime = createFakeRuntime(data);
    await plugins({ action: 'add', selector: 'playbooks' }, hostFor(runtime.access).host, runtime);

    const { host, requests, runtime: offline } = offlineHost();
    await offline.access.refreshPlugins();
    expect((await plugins({ action: 'list' }, host, offline)).output).toBe('[*] playbooks@ottili\tenabled');
    expect((await plugins({ action: 'list', available: true, marketplace: 'local' }, host, offline)).output).toBe(
      '[*] playbooks@ottili\tenabled',
    );
    expect(await skills({ action: 'list', installed: true }, host)).toMatch(/honest-status/u);
    expect((await plugins({ action: 'disable', selector: 'playbooks' }, host, offline)).output).toBe('[-] playbooks@ottili\tdisabled');
    expect(await skills({ action: 'remove', selector: 'honest-status' }, host)).toBe('Removed Skill honest-status.');
    await expect(skills({ action: 'remove', selector: 'honest-status' }, host)).rejects.toThrow(/Skill honest-status is not installed/u);
    expect((await plugins({ action: 'remove', selector: 'playbooks' }, host, offline)).output).toBe('Removed Plugin playbooks.');
    expect(requests).toEqual([]);
  });

  it('does ask the stores when something is on offer to be found', async () => {
    const { host, requests } = offlineHost();
    const output = await skills({ action: 'search', query: 'x' }, host);
    expect(requests).toEqual(['https://store.example/alran/index.json']);
    expect(output).toContain('note: store "ottili" could not be read');
  });
});

describe('without any store', () => {
  function bareHost() {
    const store = new AlranStoreApplication({ dataDir: data, bundledSkills: async () => [], environment: {} });
    const host: StoreCliHost = { store, notify: () => undefined, confirm: async () => undefined };
    return host;
  }

  it('says how to add one instead of listing nothing', async () => {
    const message = 'No store is configured yet. Add one with: alran plugin marketplace add <url>';
    expect(await skills({ action: 'list' }, bareHost())).toBe(message);
    expect(await skills({ action: 'search', query: 'anything' }, bareHost())).toBe(message);
    const search = await runAlranPluginCommand({
      version: 'test',
      request: { action: 'search', query: 'anything' },
      dataDir: data,
      createHost: () => bareHost(),
    });
    expect(search).toBe(message);
    expect(await skills({ action: 'list', installed: true }, bareHost())).toBe(
      'No skills installed. Browse with: alran skills search',
    );
  });

  it('lists no stores, and a store added afterwards is the only one', async () => {
    const host = bareHost();
    const none = await runAlranPluginCommand({ version: 'test', request: { action: 'marketplace-list' }, dataDir: data, createHost: () => host });
    expect(none.split('\n')).toEqual([`local\tdirectory\t${data}/plugins`]);
    await host.store.sources.add({ url: path.join(root, 'store'), id: 'mine' });
    expect(await skills({ action: 'list' }, host)).toContain('honest-status');
  });
});

describe('command line arguments', () => {
  function program() {
    const runPlugin = vi.fn(async () => undefined);
    const runSkills = vi.fn(async () => undefined);
    const launchTui = vi.fn(async () => undefined);
    const command = createTuiProgram({
      version: '0.0.0',
      launchTui,
      runExec: vi.fn(async () => undefined),
      runLogin: vi.fn(async () => undefined),
      runLogout: vi.fn(async () => undefined),
      runUpdate: vi.fn(async () => undefined),
      runPlugin,
      runSkills,
    });
    const run = (...args: string[]) => command.parseAsync(['node', 'alran', ...args]);
    return { run, runPlugin, runSkills, launchTui };
  }

  it.each([
    [['plugin', 'search', 'review', 'tests', '--json'], { action: 'search', query: 'review tests', json: true }],
    [['plugin', 'search'], { action: 'search', refresh: undefined, json: undefined }],
    [['plugin', 'info', 'playbooks@acme'], { action: 'info', selector: 'playbooks@acme', json: undefined }],
    [['plugin', 'install', 'runner', '--yes'], { action: 'add', selector: 'runner', yes: true }],
    [['plugins', 'update', 'runner', '-y'], { action: 'update', selector: 'runner', yes: true }],
    [['plugin', 'marketplace', 'add', 'https://x.example/s', '--name', 'acme'], { action: 'marketplace-add', url: 'https://x.example/s', name: 'acme' }],
    [['plugin', 'marketplace', 'remove', 'acme'], { action: 'marketplace-remove', name: 'acme' }],
  ])('parses %j', async (args, expected) => {
    const { run, runPlugin } = program();
    await run(...args);
    expect(runPlugin).toHaveBeenCalledTimes(1);
    expect((runPlugin.mock.calls[0] as unknown[])[0]).toMatchObject(expected);
  });

  it.each([
    [['skills', 'list', '--installed'], { action: 'list', installed: true }],
    [['skill', 'search', 'rls', 'tenant'], { action: 'search', query: 'rls tenant' }],
    [['skills', 'info', 'pg-rls'], { action: 'info', selector: 'pg-rls' }],
    [['skills', 'add', 'pg-rls'], { action: 'add', selector: 'pg-rls' }],
    [['skills', 'install', 'pg-rls@acme'], { action: 'add', selector: 'pg-rls@acme' }],
    [['skills', 'update'], { action: 'update' }],
    [['skills', 'uninstall', 'pg-rls'], { action: 'remove', selector: 'pg-rls' }],
  ])('parses %j', async (args, expected) => {
    const { run, runSkills } = program();
    await run(...args);
    expect((runSkills.mock.calls[0] as unknown[])[0]).toMatchObject(expected);
  });

  it('opens the TUI for the bare commands', async () => {
    const first = program();
    await first.run('plugin');
    expect(first.launchTui).toHaveBeenCalledWith(expect.objectContaining({ initialPrompt: '/plugin' }));
    const second = program();
    await second.run('skills');
    expect(second.launchTui).toHaveBeenCalledWith(expect.objectContaining({ initialPrompt: '/skills library' }));
  });
});
