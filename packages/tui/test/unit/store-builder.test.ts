import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The builder is a repository tool, not a package: tests reach it by path.
/* eslint-disable import/no-relative-packages */
// @ts-expect-error plain ESM JavaScript tool
import { buildStore } from '../../../../tools/store/build-store.mjs';
/* eslint-enable import/no-relative-packages */
import { parsePluginArchive } from '../../../local-runtime-v2/src/service/plugin-system/plugin/package/archive-format.js';
import { AlranStoreApplication } from '../../src/store/application.js';
import { ICON_PNG } from '../helpers/store-fixtures.js';

let root: string;
let source: string;

const skill = (name: string, extra = '', description = `Use when you need ${name}.`) =>
  `---\nname: ${name}\ndescription: "${description}"\nlicense: MIT\n${extra}---\n\n# ${name}\n`;

function write(file: string, content: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function makeRepository(): void {
  const skills = [
    ['alpha', 'one'],
    ['beta', 'one'],
    ['gamma', 'two'],
    ['ref-alpha', 'refs'],
  ];
  for (const [name, pkg] of skills) {
    write(path.join(source, 'skills', pkg, name, 'SKILL.md'), skill(name, name === 'beta' ? 'version: "2.3.0"\n' : ''));
    write(path.join(source, 'skills', pkg, name, 'references', 'notes.md'), `notes ${name}`);
    write(path.join(source, 'skills', pkg, name, 'scripts', 'run.py'), 'print(1)');
  }
  write(path.join(source, 'skills', 'one', 'alpha', 'scripts', '__pycache__', 'run.cpython.pyc'), 'junk');
  write(
    path.join(source, 'catalog.json'),
    JSON.stringify({
      skills: skills.map(([name, pkg]) => ({ name, package: pkg, path: `skills/${pkg}/${name}`, title: name })),
    }),
  );
  write(path.join(source, 'store', 'icons', 'i.png'), ICON_PNG);
  write(
    path.join(source, 'store', 'store.config.json'),
    JSON.stringify(config()),
  );
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'alran.store.build/v1',
    name: 'Test Store',
    skills: {
      exclude: [{ name: 'ref-alpha', reason: 'wrapper' }],
      groups: { one: 'Group One' },
      titles: { alpha: 'Alpha Skill' },
    },
    plugins: [
      {
        name: 'bundle-one',
        displayName: 'Bundle One',
        version: '1.0.0',
        description: 'Everything of package one.',
        author: 'Test',
        category: 'Code',
        icon: 'icons/i.png',
        packages: ['one'],
        exampleQueries: ['Do it'],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-builder-'));
  source = path.join(root, 'repo');
  makeRepository();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function build() {
  return buildStore({ source }) as { files: Map<string, Buffer>; summary: { plugins: number; skills: number } };
}

function buildError(): string {
  try {
    build();
  } catch (error) {
    return (error as Error).message;
  }
  return 'no error';
}

describe('store builder', () => {
  it('writes an index with the Skills and bundle Plugins of the repository', () => {
    const { files, summary } = build();
    expect(summary).toEqual({ plugins: 1, skills: 3, archives: 4 });
    const index = JSON.parse(files.get('index.json')?.toString('utf8') ?? '{}');
    expect(index.skills.map((entry: { name: string }) => entry.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(index.skills[0]).toMatchObject({ title: 'Alpha Skill', group: 'Group One', version: '1.0.0', license: 'MIT' });
    expect(index.skills[1].version).toBe('2.3.0');
    expect(index.plugins[0]).toMatchObject({ name: 'bundle-one', category: 'Code' });
    expect(index.plugins[0].contents.skills.map((entry: { name: string }) => entry.name)).toEqual(['alpha', 'beta']);
    expect(index.plugins[0].contents.skills[0].description).toBe('Use when you need alpha.');
  });

  it('leaves excluded Skills and build leftovers out', () => {
    const { files } = build();
    expect([...files.keys()].some((name) => name.includes('ref-alpha'))).toBe(false);
    const archive = parsePluginArchive(files.get('archives/skill-alpha-1.0.0.zip') as Buffer);
    expect(archive.entries.map((entry) => entry.path).sort()).toEqual([
      'SKILL.md',
      'references/notes.md',
      'scripts/run.py',
    ]);
  });

  it('is deterministic', () => {
    const first = build().files;
    const second = build().files;
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [name, bytes] of first) expect(second.get(name)?.equals(bytes), name).toBe(true);
  });

  it('writes archives the runtime parser accepts, with the digests the index states', () => {
    const { files } = build();
    const index = JSON.parse(files.get('index.json')?.toString('utf8') ?? '{}');
    for (const entry of [...index.plugins, ...index.skills]) {
      const bytes = files.get(entry.archive.url) as Buffer;
      expect(bytes.length).toBe(entry.archive.size);
      expect(parsePluginArchive(bytes).digest.contentDigest).toBe(entry.archive.contentDigest);
    }
  });

  it('produces a store the client can install from, end to end', async () => {
    const out = path.join(root, 'out');
    for (const [name, bytes] of build().files) {
      mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
      writeFileSync(path.join(out, name), bytes);
    }
    const data = path.join(root, 'data');
    mkdirSync(data);
    const app = new AlranStoreApplication({
      dataDir: data,
      bundledSkills: async () => [],
      environment: { ALRAN_STORE_URL: pathToFileURL(path.join(out, 'index.json')).toString() },
    });
    const catalog = await app.catalog();
    const plugin = app.resolve(catalog, 'plugin', 'bundle-one');
    const staged = await app.stage(plugin);
    expect(staged.inspection).toMatchObject({ kind: 'plugin', requiresConsent: false, files: 8 });
    await app.commit(staged, { consent: false });
    await app.commit(await app.stage(app.resolve(catalog, 'skill', 'gamma')), { consent: false });
    expect(readFileSync(path.join(data, 'plugins', 'bundle-one', 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('name: beta');
    expect(JSON.parse(readFileSync(path.join(data, 'plugins', 'bundle-one', '.alran-plugin', 'plugin.json'), 'utf8')).skills).toEqual([
      'skills/alpha/SKILL.md',
      'skills/beta/SKILL.md',
    ]);
    expect(readFileSync(path.join(data, 'skills', 'gamma', 'SKILL.md'), 'utf8')).toContain('name: gamma');
  });

  it.each([
    ['a bundle naming a missing Skill', { plugins: [{ ...config().plugins[0], packages: undefined, skills: ['nope'] }] }, /Skill "nope" is not in the library/u],
    ['a bundle naming an excluded Skill', { plugins: [{ ...config().plugins[0], packages: undefined, skills: ['ref-alpha'] }] }, /Skill "ref-alpha" is not in the library/u],
    ['an unknown package', { plugins: [{ ...config().plugins[0], packages: ['zzz'] }] }, /no Skills in package "zzz"/u],
    ['a bad category', { plugins: [{ ...config().plugins[0], category: 'Magic' }] }, /category must be one of/u],
    ['a bad version', { plugins: [{ ...config().plugins[0], version: 'one' }] }, /version must be SemVer/u],
    ['a missing icon', { plugins: [{ ...config().plugins[0], icon: 'icons/none.png' }] }, /icon "icons\/none.png" does not exist/u],
    ['a bad name', { plugins: [{ ...config().plugins[0], name: 'Bad Name' }] }, /bad name/u],
    ['too many example queries', { plugins: [{ ...config().plugins[0], exampleQueries: ['1', '2', '3', '4'] }] }, /at most 3 exampleQueries/u],
    ['a duplicate Plugin', { plugins: [config().plugins[0], config().plugins[0]] }, /defined twice/u],
  ])('refuses %s', (_label, override, message) => {
    write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config(override)));
    expect(buildError()).toMatch(message);
  });

  describe('shared files, plugin-only Skills and group versions', () => {
    const skillsConfig = (extra: Record<string, unknown>) => ({
      exclude: [{ name: 'ref-alpha', reason: 'wrapper' }],
      groups: { one: 'Group One' },
      ...extra,
    });

    it('keeps plugin-only Skills out of the Library but inside their Plugin', () => {
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ skills: skillsConfig({ pluginOnly: ['one'] }) })));
      const { files } = build();
      const index = JSON.parse(files.get('index.json')?.toString('utf8') ?? '{}');
      expect(index.skills.map((entry: { name: string }) => entry.name)).toEqual(['gamma']);
      expect([...files.keys()].some((name) => name.includes('skill-alpha'))).toBe(false);
      const plugin = parsePluginArchive(files.get('archives/plugin-bundle-one-1.0.0.zip') as Buffer);
      expect(plugin.entries.map((entry) => entry.path)).toContain('skills/alpha/SKILL.md');
      expect(plugin.entries.map((entry) => entry.path)).toContain('skills/beta/SKILL.md');
    });

    it('copies shared directories and files into the Plugin at the paths its Skills link to', () => {
      write(path.join(source, 'shared', 'checklists', 'security.md'), 'check');
      write(path.join(source, 'shared', 'LICENSE.txt'), 'licence text');
      const plugin = {
        ...config().plugins[0],
        directories: [{ from: 'shared/checklists', to: 'references' }],
        files: [{ from: 'shared/LICENSE.txt', to: 'LICENSE.txt' }],
      };
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ plugins: [plugin] })));
      const archive = parsePluginArchive(build().files.get('archives/plugin-bundle-one-1.0.0.zip') as Buffer);
      const paths = archive.entries.map((entry) => entry.path);
      expect(paths).toContain('references/security.md');
      expect(paths).toContain('LICENSE.txt');
      expect(archive.entries.find((entry) => entry.path === 'references/security.md')?.content.toString()).toBe('check');
    });

    it('refuses a missing shared directory or file and a path that collides', () => {
      const base = config().plugins[0];
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ plugins: [{ ...base, directories: [{ from: 'nope', to: 'references' }] }] })));
      expect(buildError()).toMatch(/directory "nope" does not exist/u);
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ plugins: [{ ...base, files: [{ from: 'nope.txt', to: 'x.txt' }] }] })));
      expect(buildError()).toMatch(/file "nope.txt" does not exist/u);
      write(path.join(source, 'shared', 'a.md'), 'a');
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ plugins: [{ ...base, directories: [{ from: 'shared', to: 'skills/alpha' }, { from: 'shared', to: 'skills/alpha' }] }] })));
      expect(buildError()).toMatch(/is listed twice/u);
    });

    it('lets the config set one version for every Skill of a group', () => {
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ skills: skillsConfig({ versions: { one: '2026.11.13+abc1234' } }) })));
      const index = JSON.parse(build().files.get('index.json')?.toString('utf8') ?? '{}');
      const versions = Object.fromEntries(index.skills.map((entry: { name: string; version: string }) => [entry.name, entry.version]));
      expect(versions).toEqual({ alpha: '2026.11.13+abc1234', beta: '2026.11.13+abc1234', gamma: '1.0.0' });
      // The archive file name carries the version without the "+" of its build metadata.
      expect(index.skills[0].archive.url).toBe('archives/skill-alpha-2026.11.13-abc1234.zip');
      write(path.join(source, 'store', 'store.config.json'), JSON.stringify(config({ skills: skillsConfig({ versions: { one: 'latest' } }) })));
      expect(buildError()).toMatch(/version "latest" is not SemVer/u);
    });
  });

  it('refuses a Skill whose SKILL.md names another skill or has no description', () => {
    write(path.join(source, 'skills', 'one', 'alpha', 'SKILL.md'), skill('someone-else'));
    expect(buildError()).toMatch(/alpha: SKILL.md names "someone-else"/u);
    write(path.join(source, 'skills', 'one', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nbody');
    expect(buildError()).toMatch(/alpha: SKILL.md has no description/u);
  });

  it('refuses a file name a portable archive cannot hold', () => {
    write(path.join(source, 'skills', 'one', 'alpha', 'references', 'Übersicht.md'), 'x');
    expect(buildError()).toMatch(/not a portable file name/u);
  });

  it('refuses the wrong config schema', () => {
    write(path.join(source, 'store', 'store.config.json'), JSON.stringify({ ...config(), schema: 'other' }));
    expect(buildError()).toMatch(/schema must be "alran.store.build\/v1"/u);
  });
});
