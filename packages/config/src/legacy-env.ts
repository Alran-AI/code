// legacy-brand-compat:begin
//
// Environment variables from releases before the rename.
//
// Alran Code reads `ALRAN_*` variables. Scripts and shells written for the code base Alran Code was
// derived from may still export the same settings under the old prefixes. For one transition period
// a set old variable is read as its `ALRAN_*` counterpart — only when the new one is not set, so a
// user who already renamed is never overridden — and the CLI says once, on stderr, which names it
// translated.
//
// TODO: remove after 2027-Q1 — see docs/MIGRATION_FROM_MINIMAX.md. Removing it is deleting this file,
// its export and the one call in `packages/tui/src/index.ts`.

/** The prefixes of the old names, in the order they are tried. */
export const LEGACY_ENV_PREFIXES = Object.freeze(['MAVIS_', 'MCODE_'] as const);

/** The prefix every current variable carries. */
export const CURRENT_ENV_PREFIX = 'ALRAN_';

/** When the translation is switched off for good. */
export const LEGACY_ENV_SUPPORT_ENDS = '2027-Q1';

export interface LegacyEnvironmentAlias {
  readonly from: string;
  readonly to: string;
}

/**
 * Copy every set legacy variable to its `ALRAN_*` name when that name is unset.
 *
 * Returns what was translated, so the caller can warn once. Nothing is removed from the environment:
 * a child process that still reads the old name keeps working for the same period.
 */
export function applyLegacyEnvironmentAliases(
  env: NodeJS.ProcessEnv = process.env,
): readonly LegacyEnvironmentAlias[] {
  const applied: LegacyEnvironmentAlias[] = [];
  for (const name of Object.keys(env).sort()) {
    const prefix = LEGACY_ENV_PREFIXES.find((candidate) => name.startsWith(candidate));
    if (!prefix) continue;
    const suffix = name.slice(prefix.length);
    if (!/^[A-Z0-9_]+$/u.test(suffix)) continue;
    const value = env[name];
    if (value === undefined) continue;
    const target = `${CURRENT_ENV_PREFIX}${suffix}`;
    if (env[target] !== undefined) continue;
    env[target] = value;
    applied.push({ from: name, to: target });
  }
  return applied;
}

/** The one-line deprecation notice for the translated names, or null when nothing was translated. */
export function formatLegacyEnvironmentWarning(applied: readonly LegacyEnvironmentAlias[]): string | null {
  if (applied.length === 0) return null;
  const pairs = applied.map((alias) => `${alias.from} → ${alias.to}`).join(', ');
  return `Deprecated environment variables were read under their new names (${pairs}). Rename them; the old names stop working after ${LEGACY_ENV_SUPPORT_ENDS}.`;
}
// legacy-brand-compat:end
