/**
 * Recipes (spec §8).
 *
 * A recipe is the reusable answer to "how is this kind of work cut into packets,
 * and what must a reviewer check that the packet's own tests would not?". These
 * tests hold three things: a recipe is a real constraint rather than a label, an
 * unknown name is refused instead of silently becoming one, and the extra checks
 * reach the two places that need them — the planner's prompt and the verifier's.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRecipePromptBlock,
  isUltraRecipe,
  parseRecipeChoice,
  recipeCriteriaSeeds,
  recipeReadonlyPaths,
  recipeVerifierChecks,
  selectRecipe,
  suggestRecipe,
  ULTRA_RECIPE_IDS,
  ULTRA_RECIPES,
} from '../../src/recipes.js';
import { checkScope } from '../../src/scope-guard.js';

describe('parseRecipeChoice', () => {
  it('accepts every known recipe and auto, case-insensitively', () => {
    for (const id of ULTRA_RECIPE_IDS) expect(parseRecipeChoice(id)).toBe(id);
    expect(parseRecipeChoice('AUTO')).toBe('auto');
    expect(parseRecipeChoice('  Migrate ')).toBe('migrate');
  });

  it('refuses an unknown name and lists the valid ones', () => {
    // A typo that silently became a label would drop the recipe's checks while
    // the plan still claimed to be a migration.
    expect(() => parseRecipeChoice('migrat')).toThrow(/unknown recipe "migrat"/u);
    expect(() => parseRecipeChoice('migrat')).toThrow(/bughunt/u);
  });

  it('reports which ids are recipes', () => {
    expect(isUltraRecipe('audit')).toBe(true);
    expect(isUltraRecipe('auto')).toBe(false);
    expect(isUltraRecipe('nope')).toBe(false);
  });
});

describe('selectRecipe', () => {
  it('resolves a fixed choice to its definition', () => {
    const selection = selectRecipe('bughunt', 'fix the crash');
    expect(selection.recipe?.id).toBe('bughunt');
    expect(selection.suggestion).toBeNull();
  });

  it('leaves auto unresolved and offers a labelled guess', () => {
    const selection = selectRecipe('auto', 'migrate the old client to the new one');
    expect(selection.recipe).toBeNull();
    expect(selection.suggestion).toBe('migrate');
  });

  it('offers no guess when the goal matches nothing', () => {
    expect(selectRecipe('auto', 'build a drawing app').suggestion).toBeNull();
    expect(selectRecipe('auto').suggestion).toBeNull();
  });
});

describe('suggestRecipe', () => {
  it('recognises the shape of each recipe', () => {
    expect(suggestRecipe('port every call site to the new API')).toBe('migrate');
    expect(suggestRecipe('fix the crash when saving')).toBe('bughunt');
    expect(suggestRecipe('extract the parser without changing behaviour')).toBe('refactor');
    expect(suggestRecipe('add coverage to the untested module')).toBe('testgen');
    expect(suggestRecipe('audit input handling for vulnerabilities')).toBe('audit');
  });

  it('is a guess, not an override: a fixed choice never consults it', () => {
    const selection = selectRecipe('audit', 'fix the crash');
    expect(selection.recipe?.id).toBe('audit');
  });
});

describe('buildRecipePromptBlock', () => {
  it('states the decomposition, ordering and extra checks of a fixed recipe', () => {
    const block = buildRecipePromptBlock(selectRecipe('bughunt', 'x'));
    expect(block).toContain('Recipe: bughunt');
    expect(block).toContain('How to cut the packets:');
    expect(block).toContain('Ordering:');
    // The reproduction rule is the whole point of the recipe.
    expect(block).toMatch(/reproduction/iu);
    expect(block).toContain('verifier');
  });

  it('names the available shapes for auto and hedges the guess', () => {
    const block = buildRecipePromptBlock(selectRecipe('auto', 'migrate the old client'));
    expect(block).toContain('Recipe: auto');
    for (const id of ULTRA_RECIPE_IDS) expect(block).toContain(id);
    expect(block).toMatch(/only if it really matches/iu);
  });

  it('offers no guess in the auto block when nothing matched', () => {
    const block = buildRecipePromptBlock(selectRecipe('auto', 'build a drawing app'));
    expect(block).not.toMatch(/looks like/iu);
  });
});

describe('recipeVerifierChecks', () => {
  it('adds no checks for auto', () => {
    expect(recipeVerifierChecks('auto')).toEqual([]);
  });

  it('adds the migration leftovers check and the bug-hunt reproduction check', () => {
    const migration = recipeVerifierChecks('migrate').join(' ');
    expect(migration).toMatch(/old API/iu);
    const bughunt = recipeVerifierChecks('bughunt').join(' ');
    expect(bughunt).toMatch(/fails on the pre-fix code|reproduction/iu);
  });

  it('gives every recipe at least one check', () => {
    for (const id of ULTRA_RECIPE_IDS) expect(recipeVerifierChecks(id).length).toBeGreaterThan(0);
  });
});

describe('recipeReadonlyPaths', () => {
  it('makes an audit packet unable to change anything', () => {
    // An audit that edits code is not an audit: the scope guard must reject any
    // changed file, even one inside the packet's declared scope.
    const readonly = recipeReadonlyPaths('audit');
    const changed = ['src/auth/login.ts', 'docs/notes.md'];
    for (const scope of [['src/**'], ['**']]) {
      const decision = checkScope({ changedFiles: changed, scope, readonly });
      expect(decision.ok).toBe(false);
      expect(decision.violations.every((v) => v.reason === 'readonly')).toBe(true);
    }
  });

  it('leaves the other recipes writable', () => {
    expect(recipeReadonlyPaths('migrate')).toEqual([]);
    expect(recipeReadonlyPaths('auto')).toEqual([]);
  });
});

describe('recipeCriteriaSeeds', () => {
  it('gives every recipe goal criteria, and none for auto', () => {
    for (const id of ULTRA_RECIPE_IDS) expect(recipeCriteriaSeeds(id).length).toBeGreaterThan(0);
    expect(recipeCriteriaSeeds('auto')).toEqual([]);
  });

  it('makes the migration seed about leftovers, not about the diff', () => {
    expect(recipeCriteriaSeeds('migrate').join(' ')).toMatch(/no call site of the old api remains/iu);
  });
});
