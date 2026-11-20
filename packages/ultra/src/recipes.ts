/**
 * Recipes (spec §8): the reusable shape of a kind of Ultra run.
 *
 * A recipe is not a script and not a model-written orchestrator. It is the
 * accumulated answer to "how is this kind of work cut into packets, and what
 * does a reviewer have to check that the packet's own tests would not?". The
 * planner still decides the actual DAG; the recipe constrains it.
 *
 * Why the checks live here rather than in the packet: a worker's tests prove the
 * worker's code works. They cannot prove an *old* API is gone (migration), that a
 * reproduction actually failed before the fix (bug hunt), or that a refactor did
 * not quietly change behaviour. Those are properties of the whole diff, so the
 * recipe states them and the verifier is asked about them per packet.
 *
 * v1 keeps the recipes in code. The spec's markdown-with-frontmatter format
 * (so recipes can later ship through the Alran Store as skills) is a later step;
 * nothing here depends on it, and `UltraRecipeDefinition` is the shape a loader
 * would have to produce.
 */

import type { UltraRecipe, UltraRecipeChoice } from './types.js';

export interface UltraRecipeDefinition {
  readonly id: UltraRecipe;
  readonly title: string;
  /** One line, shown next to the recipe name. */
  readonly summary: string;
  /** How packets are cut for this kind of work. */
  readonly decomposition: string;
  /** Ordering rules the planner has to respect. */
  readonly ordering: readonly string[];
  /**
   * Extra checks the verifier applies on top of the fixed fake-fix checklist.
   * Each entry is a question about the diff, answerable from the diff and the
   * gate output — never from the worker's own claim.
   */
  readonly verifierChecks: readonly string[];
  /** Seeds for a goal document's criteria when this recipe drives a goal run. */
  readonly criteriaSeeds: readonly string[];
  /** Paths every packet of this recipe must treat as read-only. */
  readonly readonlyPaths: readonly string[];
}

const MIGRATE: UltraRecipeDefinition = {
  id: 'migrate',
  title: 'Migration',
  summary: 'Move every call site of an old API to the new one.',
  decomposition:
    'Split by module or directory, never by file type. Land the shared types and ' +
    'the new API first so later packets can depend on them instead of re-deriving ' +
    'them, then convert call sites in dependency order.',
  ordering: [
    'The packet that introduces the new API has no dependencies; every call-site packet depends on it.',
    'A packet that touches a shared definition must finish before packets that consume it.',
  ],
  verifierChecks: [
    'Is any call of the old API left behind in the diff or in the files this packet owns? ' +
      'Name the call sites if so.',
    'Does the packet keep the old and new API working side by side where a later packet ' +
      'still needs the old one, rather than deleting something out of order?',
  ],
  criteriaSeeds: [
    'No call site of the old API remains anywhere in the repository.',
    'The new API is used by every migrated call site, not only by the ones in this diff.',
    'The project-wide test suite passes after the last call site is converted.',
  ],
  readonlyPaths: [],
};

const BUGHUNT: UltraRecipeDefinition = {
  id: 'bughunt',
  title: 'Bug hunt',
  summary: 'Reproduce each bug with a failing test, then fix it.',
  decomposition:
    'Split by suspect module, one packet per bug. A packet owns one bug: two ' +
    'independent bugs in the same module are two packets, because a fix that ' +
    'silently fixes both cannot be reviewed.',
  ordering: [
    'Packets are independent unless they touch the same files; order those with depends_on.',
  ],
  verifierChecks: [
    'Does the diff contain the reproduction first — a test that fails on the ' +
      'pre-fix code — and not only the fix?',
    'Does the new test fail for the reason the bug describes, rather than for an ' +
      'unrelated error (a typo, a missing import, an unmocked dependency)?',
  ],
  criteriaSeeds: [
    'Each reported bug has a test that reproduces it.',
    'Each reproduction test passes after the fix.',
  ],
  readonlyPaths: [],
};

const REFACTOR: UltraRecipeDefinition = {
  id: 'refactor',
  title: 'Refactor',
  summary: 'Restructure without changing behaviour.',
  decomposition:
    'Order strictly extract → move → rewire, one step per packet. A packet that ' +
    'extracts and rewires at once cannot be reviewed as a behaviour-preserving ' +
    'change.',
  ordering: [
    'Extraction precedes the moves that depend on it; rewiring is always last.',
  ],
  verifierChecks: [
    'Is behaviour unchanged? Point at the evidence — the same tests passing, not ' +
      'tests that were edited to match the new shape.',
    'Were existing tests modified? If so, is the change a pure relocation, or ' +
      'did the assertions change with it?',
  ],
  criteriaSeeds: [
    'The project-wide test suite passes without any assertion being weakened.',
    'Public interfaces behave exactly as before the refactor.',
  ],
  readonlyPaths: ['tests/spec/**'],
};

const TESTGEN: UltraRecipeDefinition = {
  id: 'testgen',
  title: 'Test generation',
  summary: 'Add real tests to untested modules.',
  decomposition:
    'Split by untested module. A packet that adds tests to several modules hides ' +
    'which of them the tests actually exercise.',
  ordering: ['Packets are independent; order only where modules share a fixture.'],
  verifierChecks: [
    'Do the tests assert real behaviour, or do they restate the implementation ' +
      '(a tautology, a mock asserting itself, a snapshot with no expectation)?',
    'Would each test still fail if the behaviour it covers were removed?',
  ],
  criteriaSeeds: [
    'Each targeted module has tests that fail when its behaviour is broken.',
    'The new tests pass against the current code and are not skipped.',
  ],
  readonlyPaths: ['tests/spec/**'],
};

const AUDIT: UltraRecipeDefinition = {
  id: 'audit',
  title: 'Audit',
  summary: 'Review an area and report; change nothing.',
  decomposition:
    'Split by area (authentication, input handling, dependencies, secret ' +
    'handling, error paths). One area per packet, because an audit finding has ' +
    'to be traceable to the scope that was reviewed.',
  ordering: ['Packets are independent.'],
  verifierChecks: [
    'Is every finding backed by a file and line reference the reader can check?',
    'Does the packet report severity and an owner for each finding, or only ' +
      'describe code?',
  ],
  criteriaSeeds: [
    'Each area has a written finding list with references.',
    'No finding is reported without a concrete location.',
  ],
  // An audit reports; it does not change code. `**` vetoes every path,
  // including one inside the packet's own declared scope, so an audit packet
  // cannot edit anything even if the planner gave it a writable scope.
  readonlyPaths: ['**'],
};

export const ULTRA_RECIPES: Readonly<Record<UltraRecipe, UltraRecipeDefinition>> = Object.freeze({
  migrate: MIGRATE,
  bughunt: BUGHUNT,
  refactor: REFACTOR,
  testgen: TESTGEN,
  audit: AUDIT,
});

export const ULTRA_RECIPE_IDS: readonly UltraRecipe[] = Object.freeze([
  'migrate',
  'bughunt',
  'refactor',
  'testgen',
  'audit',
]);

export function isUltraRecipe(value: string): value is UltraRecipe {
  return (ULTRA_RECIPE_IDS as readonly string[]).includes(value);
}

/**
 * A recipe choice as it comes off the command line. `auto` means "let the
 * planner decide the shape"; anything else has to be a known recipe, because a
 * typo that silently became a label would put `Recipe: migrat` in the prompt and
 * quietly drop the recipe's checks.
 */
export function parseRecipeChoice(raw: string): UltraRecipeChoice {
  const value = raw.trim().toLowerCase();
  if (value === 'auto') return 'auto';
  if (isUltraRecipe(value)) return value;
  throw new Error(`unknown recipe "${raw}": expected one of ${ULTRA_RECIPE_IDS.join(', ')} or auto`);
}

/**
 * A keyword guess at the recipe for `auto`.
 *
 * This is a hint, not a decision: the prompt offers it to the planner and the
 * planner may ignore it. Guessing is only safe when it is clearly labelled as a
 * guess, and it is only offered when some signal actually matched.
 */
export function suggestRecipe(goal: string): UltraRecipe | null {
  const text = goal.toLowerCase();
  const signals: readonly [UltraRecipe, RegExp][] = [
    ['migrate', /\b(migrat\w*|port\w*|upgrade\w*|rename\w*|deprecat\w*|old api|new api)\b/u],
    ['bughunt', /\b(bug\w*|fix\w*|broken|crash\w*|regress\w*|fails? when|incorrect\w*)\b/u],
    ['refactor', /\b(refactor\w*|clean\s?up|extract\w*|restructur\w*|reorganiz\w*)\b/u],
    ['testgen', /\b(test\w*|coverage|untested|spec\w*)\b/u],
    ['audit', /\b(audit\w*|review\w*|secur\w*|vulnerab\w*|inspect\w*)\b/u],
  ];
  for (const [recipe, pattern] of signals) {
    if (pattern.test(text)) return recipe;
  }
  return null;
}

/** What the planner should be told about the chosen recipe. */
export interface RecipePrompt {
  readonly choice: UltraRecipeChoice;
  /** The resolved recipe, or `null` for `auto`. */
  readonly recipe: UltraRecipeDefinition | null;
  /** A keyword guess, when the choice is `auto` and something matched. */
  readonly suggestion: UltraRecipe | null;
}

export function selectRecipe(choice: UltraRecipeChoice, goal?: string): RecipePrompt {
  if (choice === 'auto') {
    return { choice, recipe: null, suggestion: goal === undefined ? null : suggestRecipe(goal) };
  }
  return { choice, recipe: ULTRA_RECIPES[choice], suggestion: null };
}

/**
 * The block the planner prompt includes. For a fixed recipe it states the rules;
 * for `auto` it names the recipes that exist so the planner can choose one
 * deliberately instead of inventing a shape per run.
 */
export function buildRecipePromptBlock(selection: RecipePrompt): string {
  const { recipe, suggestion } = selection;
  if (!recipe) {
    const lines = [
      'Recipe: auto — no fixed recipe. Choose the decomposition that fits the task.',
      'The known shapes are:',
      ...ULTRA_RECIPE_IDS.map((id) => `  - ${id}: ${ULTRA_RECIPES[id].summary}`),
    ];
    if (suggestion) {
      lines.push(
        '',
        `This task looks like a ${suggestion} job (${ULTRA_RECIPES[suggestion].summary}) —`,
        'follow that recipe only if it really matches; otherwise pick another shape.',
      );
    }
    return lines.join('\n');
  }
  const lines = [
    `Recipe: ${recipe.id} — ${recipe.title}. ${recipe.summary}`,
    '',
    'How to cut the packets:',
    recipe.decomposition,
    '',
    'Ordering:',
    ...recipe.ordering.map((rule) => `- ${rule}`),
  ];
  if (recipe.readonlyPaths.length > 0) {
    lines.push('', `Treat these as read-only for every packet: ${recipe.readonlyPaths.join(', ')}`);
  }
  lines.push(
    '',
    'These checks are made by a separate verifier after each packet, so the',
    'packet has to make them true, not merely claim them:',
    ...recipe.verifierChecks.map((check) => `- ${check}`),
  );
  return lines.join('\n');
}

/** The extra checklist the verifier prompt appends for the chosen recipe. */
export function recipeVerifierChecks(choice: UltraRecipeChoice): readonly string[] {
  return choice === 'auto' ? [] : ULTRA_RECIPES[choice].verifierChecks;
}

/** Paths a packet of this recipe must not change, on top of its own readonly list. */
export function recipeReadonlyPaths(choice: UltraRecipeChoice): readonly string[] {
  return choice === 'auto' ? [] : ULTRA_RECIPES[choice].readonlyPaths;
}

/** Seed criteria for a goal document driven by this recipe. */
export function recipeCriteriaSeeds(choice: UltraRecipeChoice): readonly string[] {
  return choice === 'auto' ? [] : ULTRA_RECIPES[choice].criteriaSeeds;
}
