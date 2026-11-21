/**
 * Recipe files (spec §8): a recipe as a markdown file with YAML frontmatter.
 *
 * The five built-in recipes are code, which is right for the ones Ultra ships.
 * A team's own conventions are not Ultra's to encode: how *this* repository
 * cuts a migration, and what a reviewer here must check that the packet's own
 * tests would not, differ per project. Those belong in the repository, reviewable
 * like any other file, and that is what this module reads.
 *
 * v1 overrides the built-in recipes; it does not add new kinds. `UltraRecipe` is
 * a closed union, and widening it would ripple through the planner prompt, the
 * verifier and the report for a feature whose value is in tuning the five shapes
 * a project already has. A file whose name is not one of the five is therefore
 * an error, not a silently ignored file: a typo that did nothing would be
 * invisible.
 *
 * The format is deliberately a *subset* of YAML — `key: value` pairs and `- item`
 * lists, plus `#` comments — and anything outside that subset is refused with the
 * file and line. A recipe file that half-parses is worse than one that fails:
 * the planner would follow rules the author did not write.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isUltraRecipe,
  ULTRA_RECIPE_IDS,
  ULTRA_RECIPES,
  type RecipeOverrides,
  type UltraRecipeDefinition,
} from './recipes.js';
import type { UltraRecipe } from './types.js';

/** Re-exported so callers can load and apply overrides from one module. */
export type { RecipeOverrides };

export interface RecipeFile {
  readonly id: UltraRecipe;
  readonly file: string;
  readonly definition: UltraRecipeDefinition;
}

const FRONTMATTER_KEYS = [
  'title',
  'summary',
  'decomposition',
  'ordering',
  'verifier_checks',
  'criteria_seeds',
  'readonly_paths',
] as const;

type FrontmatterKey = (typeof FRONTMATTER_KEYS)[number];

const LIST_KEYS: ReadonlySet<FrontmatterKey> = new Set<FrontmatterKey>([
  'ordering',
  'verifier_checks',
  'criteria_seeds',
  'readonly_paths',
]);

class RecipeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeFileError';
  }
}

/** Splits `---`-fenced frontmatter from the markdown body. */
function splitFrontmatter(text: string, source: string): { frontmatter: string[]; body: string } {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new RecipeFileError(`${source}: a recipe file must start with a \`---\` frontmatter block`);
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) {
    throw new RecipeFileError(`${source}: the frontmatter block is never closed with \`---\``);
  }
  return { frontmatter: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

/** Removes one layer of matching quotes; recipe authors write both styles. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0]!;
    const last = trimmed[trimmed.length - 1]!;
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Parses the frontmatter subset into scalars and lists.
 *
 * Unsupported syntax throws rather than being guessed at: a nested mapping or a
 * block scalar would silently drop the rules under it.
 */
function parseFrontmatter(lines: readonly string[], source: string): Map<FrontmatterKey, string | string[]> {
  const values = new Map<FrontmatterKey, string | string[]>();
  let current: FrontmatterKey | null = null;

  lines.forEach((raw, index) => {
    const lineNumber = index + 2; // 1-based, and line 1 is the opening `---`
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) return;

    if (line.startsWith('- ')) {
      if (current === null) {
        throw new RecipeFileError(`${source}:${lineNumber}: a list item without a key above it`);
      }
      const existing = values.get(current);
      const list = Array.isArray(existing) ? existing : typeof existing === 'string' && existing.length > 0 ? [existing] : [];
      list.push(unquote(line.slice(2)));
      values.set(current, list);
      return;
    }

    const match = /^([a-z_]+):\s*(.*)$/u.exec(line);
    if (!match) {
      throw new RecipeFileError(
        `${source}:${lineNumber}: cannot read \`${line}\`; expected \`key: value\` or \`- item\``,
      );
    }
    const key = match[1] as FrontmatterKey;
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new RecipeFileError(
        `${source}:${lineNumber}: unknown key \`${key}\`; expected one of ${FRONTMATTER_KEYS.join(', ')}`,
      );
    }
    if (LIST_KEYS.has(key)) {
      const value = match[2]!.trim();
      if (value.length === 0) {
        values.set(key, []);
      } else if (value.startsWith('[') && value.endsWith(']')) {
        values.set(
          key,
          value
            .slice(1, -1)
            .split(',')
            .map((entry) => unquote(entry))
            .filter((entry) => entry.length > 0),
        );
      } else {
        throw new RecipeFileError(
          `${source}:${lineNumber}: \`${key}\` is a list; write one \`- item\` per line, or [a, b]`,
        );
      }
    } else {
      values.set(key, unquote(match[2]!));
    }
    current = key;
  });

  return values;
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(' ') : value;
}

/**
 * Parses one recipe file into a definition.
 *
 * `id` comes from the filename, not the file: the name is what `--recipe`
 * matches, and a file that disagrees with its own name is a mistake the author
 * would never see.
 */
export function parseRecipeFile(text: string, id: UltraRecipe, source = `${id}.md`): UltraRecipeDefinition {
  const { frontmatter, body } = splitFrontmatter(text, source);
  const values = parseFrontmatter(frontmatter, source);
  const builtIn = ULTRA_RECIPES[id];

  const title = asText(values.get('title'));
  const summary = asText(values.get('summary'));
  if (!title || title.length === 0) {
    throw new RecipeFileError(`${source}: \`title\` is required`);
  }
  if (!summary || summary.length === 0) {
    throw new RecipeFileError(`${source}: \`summary\` is required`);
  }

  // The body is the natural place to write the decomposition in prose, so it is
  // the default; an explicit key wins for authors who prefer frontmatter. A file
  // that sets neither keeps the built-in rule, so a small override (an extra
  // check, say) does not have to restate the whole decomposition.
  const bodyText = body.trim();
  const decomposition =
    asText(values.get('decomposition')) ??
    (bodyText.length > 0 ? bodyText : undefined) ??
    builtIn.decomposition;

  return {
    id,
    title,
    summary,
    decomposition,
    ordering: asList(values.get('ordering')).length > 0 ? asList(values.get('ordering')) : builtIn.ordering,
    verifierChecks:
      asList(values.get('verifier_checks')).length > 0
        ? asList(values.get('verifier_checks'))
        : builtIn.verifierChecks,
    criteriaSeeds:
      asList(values.get('criteria_seeds')).length > 0
        ? asList(values.get('criteria_seeds'))
        : builtIn.criteriaSeeds,
    // An override cannot make a read-only recipe writable: `audit` must never
    // edit code, and that is a property of the recipe, not of its prose.
    readonlyPaths: id === 'audit' ? ['**'] : asList(values.get('readonly_paths')),
  };
}

/**
 * Loads every `*.md` override in a directory.
 *
 * A file that is not one of the five recipe ids is an error, because it can only
 * be a typo and a typo that loads nothing would look like it worked.
 */
export function loadRecipeOverrides(dir: string): { readonly overrides: RecipeOverrides; readonly files: readonly RecipeFile[] } {
  if (!existsSync(dir)) return { overrides: {}, files: [] };
  const overrides: Record<string, UltraRecipeDefinition> = {};
  const files: RecipeFile[] = [];

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

  for (const name of entries) {
    const id = name.replace(/\.md$/u, '');
    if (!isUltraRecipe(id)) {
      throw new RecipeFileError(
        `${path.join(dir, name)}: "${id}" is not a recipe; expected one of ${ULTRA_RECIPE_IDS.join(', ')}`,
      );
    }
    const source = path.join(dir, name);
    const definition = parseRecipeFile(readFileSync(source, 'utf8'), id, source);
    overrides[id] = definition;
    files.push({ id, file: source, definition });
  }

  return { overrides: overrides as RecipeOverrides, files };
}

/** The definition for an id, honouring overrides. */
export function recipeFor(id: UltraRecipe, overrides: RecipeOverrides = {}): UltraRecipeDefinition {
  return overrides[id] ?? ULTRA_RECIPES[id];
}