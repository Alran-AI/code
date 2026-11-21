/**
 * Recipe files (spec §8).
 *
 * These tests pin the three things that make a file-based recipe safe to load:
 * it parses the documented subset and nothing else, an override really changes
 * what the planner and the verifier see, and a mistake is loud — a recipe file
 * that silently half-loaded would have the planner follow rules nobody wrote.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadRecipeOverrides,
  parseRecipeFile,
  recipeFor,
  type RecipeOverrides,
} from '../../src/recipe-files.js';
import {
  recipeCriteriaSeeds,
  recipeReadonlyPaths,
  recipeVerifierChecks,
  ULTRA_RECIPES,
} from '../../src/recipes.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-recipe-'));
  dirs.push(dir);
  return dir;
}

function write(dir: string, name: string, text: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MIGRATE_MD = `---
title: Team migration
summary: How we move call sites here.
verifier_checks:
  - No import of the old path remains.
  - The changelog names the new API.
---

Split by package, not by directory. Shared types land first.
`;

describe('parseRecipeFile', () => {
  it('reads the subset: scalars, lists, and the body as the decomposition', () => {
    const recipe = parseRecipeFile(MIGRATE_MD, 'migrate');
    expect(recipe.title).toBe('Team migration');
    expect(recipe.summary).toBe('How we move call sites here.');
    expect(recipe.verifierChecks).toEqual([
      'No import of the old path remains.',
      'The changelog names the new API.',
    ]);
    // The prose body becomes the decomposition when no key overrides it.
    expect(recipe.decomposition).toBe('Split by package, not by directory. Shared types land first.');
    // Keys the file does not set keep the built-in rules.
    expect(recipe.ordering).toEqual(ULTRA_RECIPES.migrate.ordering);
    expect(recipe.criteriaSeeds).toEqual(ULTRA_RECIPES.migrate.criteriaSeeds);
  });

  it('accepts inline lists and quoted values', () => {
    const recipe = parseRecipeFile(
      ['---', 'title: "Quoted title"', 'summary: It migrates.', 'ordering: [types first, call sites last]', '---', ''].join('\n'),
      'migrate',
    );
    expect(recipe.title).toBe('Quoted title');
    expect(recipe.ordering).toEqual(['types first', 'call sites last']);
    // Neither a body nor a decomposition key: the built-in rule stands, so a
    // small override does not have to restate it.
    expect(recipe.decomposition).toBe(ULTRA_RECIPES.migrate.decomposition);
  });

  it('never lets an override make the audit recipe writable', () => {
    // `audit` reports; it does not change code. That is a property of the
    // recipe, not of its prose, so no file can edit it away.
    const recipe = parseRecipeFile(
      ['---', 'title: Audit', 'summary: Look only.', 'readonly_paths: []', '---', ''].join('\n'),
      'audit',
    );
    expect(recipe.readonlyPaths).toEqual(['**']);
  });

  it('refuses a file that is not frontmatter, or whose frontmatter never closes', () => {
    expect(() => parseRecipeFile('# just markdown\n', 'migrate')).toThrow(/frontmatter/u);
    expect(() => parseRecipeFile(['---', 'title: X', ''].join('\n'), 'migrate')).toThrow(/never closed/u);
  });

  it('refuses unknown keys, list syntax errors and missing required fields', () => {
    expect(() =>
      parseRecipeFile(['---', 'titel: X', 'summary: Y', '---', ''].join('\n'), 'migrate'),
    ).toThrow(/unknown key `titel`/u);
    expect(() =>
      parseRecipeFile(['---', 'title: X', 'summary: Y', 'ordering: not a list', '---', ''].join('\n'), 'migrate'),
    ).toThrow(/is a list/u);
    expect(() => parseRecipeFile(['---', 'summary: Y', '---', 'body'].join('\n'), 'migrate')).toThrow(
      /title.*required/u,
    );
    expect(() => parseRecipeFile(['---', 'title: X', '---', 'body'].join('\n'), 'migrate')).toThrow(
      /summary.*required/u,
    );
  });

  it('names the file and line in the error, so an author can find the mistake', () => {
    expect(() =>
      parseRecipeFile(['---', 'title: X', '', 'nonsense line', '---', ''].join('\n'), 'migrate', 'docs/r.md'),
    ).toThrow(/docs\/r\.md:4/u);
  });
});

describe('loadRecipeOverrides', () => {
  it('loads every recipe file in the directory, sorted by name', () => {
    const dir = tempDir();
    write(dir, 'migrate.md', MIGRATE_MD);
    write(dir, 'refactor.md', ['---', 'title: Refactor', 'summary: Tidy.', '---', 'Extract, then move.'].join('\n'));

    const { overrides, files } = loadRecipeOverrides(dir);
    expect(Object.keys(overrides).sort()).toEqual(['migrate', 'refactor']);
    expect(files.map((file) => file.id)).toEqual(['migrate', 'refactor']);
    expect(overrides.migrate?.title).toBe('Team migration');
    expect(overrides.refactor?.decomposition).toBe('Extract, then move.');
  });

  it('treats a missing directory as no overrides, not an error', () => {
    expect(loadRecipeOverrides(path.join(tempDir(), 'nope'))).toEqual({ overrides: {}, files: [] });
  });

  it('refuses a file that is not one of the five recipes', () => {
    // A typo that loaded nothing would look exactly like a working override.
    const dir = tempDir();
    write(dir, 'migrat.md', MIGRATE_MD);
    expect(() => loadRecipeOverrides(dir)).toThrow(/"migrat" is not a recipe/u);
  });
});

describe('overrides at the point of use', () => {
  const overrides: RecipeOverrides = {
    migrate: {
      ...ULTRA_RECIPES.migrate,
      verifierChecks: ['No old import remains.'],
      readonlyPaths: ['legacy/**'],
      criteriaSeeds: ['Every call site is migrated.'],
    },
  };

  it('reaches the verifier and the readonly paths a packet inherits', () => {
    expect(recipeFor('migrate', overrides).verifierChecks).toEqual(['No old import remains.']);
    expect(recipeVerifierChecks('migrate', overrides)).toEqual(['No old import remains.']);
    expect(recipeReadonlyPaths('migrate', overrides)).toEqual(['legacy/**']);
    expect(recipeCriteriaSeeds('migrate', overrides)).toEqual(['Every call site is migrated.']);
  });

  it('leaves recipes without an override untouched', () => {
    expect(recipeFor('bughunt', overrides)).toBe(ULTRA_RECIPES.bughunt);
    expect(recipeVerifierChecks('bughunt', overrides)).toEqual(ULTRA_RECIPES.bughunt.verifierChecks);
  });
});