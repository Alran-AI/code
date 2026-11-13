import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlranStoreApplication, isBuiltIn } from '../../src/store/application.js';
import { locateBundledSkillsDirectory, readBundledSkills } from '../../src/store/bundled-skills.js';
import { StoreError } from '../../src/store/contract.js';
import { skillFiles, writeStore } from '../helpers/store-fixtures.js';
import type { StoreCliHost } from '../../src/cli/store-cli.js';
import { installItem, listItems, removeItem, searchStore, showItem } from '../../src/cli/store-cli.js';

let root: string;
let data: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'alran-store-bundled-'));
  data = path.join(root, 'data');
  mkdirSync(data);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bundledFolder(): string {
  const directory = path.join(root, 'bundled');
  for (const [name, description] of [
    ['pdf', 'Read, create and edit PDF files.'],
    ['code-review', 'Review the changes in a working tree.'],
  ] as const) {
    mkdirSync(path.join(directory, name), { recursive: true });
    writeFileSync(
      path.join(directory, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: "${description}"\n---\nBody.\n`,
    );
  }
  mkdirSync(path.join(directory, 'not-a-skill'), { recursive: true });
  writeFileSync(path.join(directory, 'not-a-skill', 'README.md'), 'no SKILL.md here');
  mkdirSync(path.join(directory, 'broken'), { recursive: true });
  writeFileSync(path.join(directory, 'broken', 'SKILL.md'), 'no frontmatter');
  return directory;
}

describe('bundled Skills', () => {
  it('reads the Skill folders and skips what is not one', async () => {
    expect(await readBundledSkills(bundledFolder())).toEqual([
      { name: 'code-review', description: 'Review the changes in a working tree.' },
      { name: 'pdf', description: 'Read, create and edit PDF files.' },
    ]);
    expect(await readBundledSkills(path.join(root, 'missing'))).toEqual([]);
  });

  it('finds the folder next to a built CLI and in the source tree', () => {
    const built = path.join(root, 'dist');
    mkdirSync(path.join(built, 'chunks'), { recursive: true });
    mkdirSync(path.join(built, 'assets', 'skills'), { recursive: true });
    expect(locateBundledSkillsDirectory(pathToFileURL(path.join(built, 'chunks', 'chunk.js')).toString())).toBe(
      path.join(built, 'assets', 'skills') + path.sep,
    );
    expect(locateBundledSkillsDirectory(pathToFileURL(path.join(root, 'nowhere', 'x.js')).toString())).toBeUndefined();
    // The real source tree: this module sits where packages/tui/src/store does.
    const source = locateBundledSkillsDirectory(new URL('../../src/store/bundled-skills.ts', import.meta.url).toString());
    expect(source).toMatch(/local-runtime[\\/]assets[\\/]skills[\\/]?$/u);
  });

  it('puts them in the Library as built in, never as installed or removable', async () => {
    const store = writeStore(path.join(root, 's'), [{ kind: 'skill', name: 'extra', files: skillFiles('extra') }]);
    const app = new AlranStoreApplication({
      dataDir: data,
      environment: { ALRAN_STORE_URL: store.url },
      bundledSkills: async () => readBundledSkills(bundledFolder()),
    });
    const catalog = await app.catalog();
    const pdf = catalog.items.find((item) => item.id === 'skill:pdf@built-in');
    expect(pdf).toMatchObject({ kind: 'skill', group: 'Built in', installed: true, enabled: true, updateAvailable: false });
    expect(pdf && isBuiltIn(pdf)).toBe(true);
    await expect(app.remove(pdf as never)).rejects.toThrow(/built in to Alran Code and cannot be removed/u);
    expect((await app.catalog({ offline: true })).items.map((item) => item.name).sort()).toEqual(['code-review', 'pdf']);
  });

  it('lets a store Skill of the same name win over the built-in one', async () => {
    const store = writeStore(path.join(root, 's'), [{ kind: 'skill', name: 'pdf', files: skillFiles('pdf') }]);
    const app = new AlranStoreApplication({
      dataDir: data,
      environment: { ALRAN_STORE_URL: store.url },
      bundledSkills: async () => readBundledSkills(bundledFolder()),
    });
    const pdfs = (await app.catalog()).items.filter((item) => item.name === 'pdf');
    expect(pdfs.map((item) => item.origin)).toEqual(['ottili']);
  });

  it('keeps working when reading the bundled Skills fails', async () => {
    const app = new AlranStoreApplication({
      dataDir: data,
      environment: {},
      bundledSkills: async () => {
        throw new Error('disk gone');
      },
    });
    expect((await app.catalog()).items).toEqual([]);
  });
});

describe('built-in Skills on the command line', () => {
  function host(): StoreCliHost {
    return {
      store: new AlranStoreApplication({ dataDir: data, environment: {}, bundledSkills: async () => readBundledSkills(bundledFolder()) }),
      notify: () => undefined,
      confirm: async () => undefined,
    };
  }

  it('lists them in their own group, but not as installed', async () => {
    const all = await listItems(host(), 'skill', {});
    expect(all).toMatch(/^Built in\n\[\*\] code-review\s+Review the changes in a working tree\.\s+built in\n\[\*\] pdf\s+Read, create/mu);
    expect(await listItems(host(), 'skill', { installed: true })).toBe('No skills installed. Browse with: alran skills search');
    expect(await searchStore(host(), 'skill', { query: 'pdf' })).toMatch(/\[\*\] pdf\s+Read, create and edit PDF files\.\s+built in/u);
  });

  it('says there is nothing to install or remove, and still shows information', async () => {
    expect(await installItem(host(), 'skill', 'pdf', {})).toBe('Skill pdf is built in to Alran Code; there is nothing to install.');
    await expect(removeItem(host(), 'skill', 'pdf')).rejects.toThrow(StoreError);
    await expect(removeItem(host(), 'skill', 'pdf')).rejects.toThrow(/built in to Alran Code and cannot be removed/u);
    expect(await showItem(host(), 'skill', 'pdf')).toContain('built in');
  });
});
