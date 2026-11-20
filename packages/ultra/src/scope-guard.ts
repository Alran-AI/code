/**
 * Scope enforcement (build step 4, decision layer).
 *
 * The harness — not the worker — decides whether a packet stayed inside its
 * patch. After the worker stops, the scheduler diffs the worktree and hands the
 * changed paths here. Writable `scope` globs allow a file; `readonly` globs veto
 * it even when it is inside scope. This module is pure: it never touches git.
 *
 * Glob matching is reused from @alran/ci-fix (`isDeniedPath`) so Ultra and the
 * CI Fixer agree on what `src/**` means rather than growing two matchers.
 */

import { isDeniedPath } from '@alran/ci-fix';

// Expands a `** `/` pattern so it also matches zero directories. The shared
// ci-fix deny-path matcher (reused below) requires at least one segment for a
// double-star, so a pattern like `src/**/*.ts` would miss `src/a.ts`. That is
// correct for a deny-list but wrong for a writable scope: a planner writing the
// natural glob would get false violations. The expansion is applied here only,
// leaving the shared matcher's semantics intact.
function expandZeroDepthGlobs(patterns: readonly string[]): readonly string[] {
  const expanded: string[] = [];
  for (const pattern of patterns) {
    expanded.push(pattern);
    // `a/**/b` also allows `a/b`; add that form for every double-star-slash.
    if (pattern.includes('**/')) {
      expanded.push(pattern.replaceAll('**/', ''));
      // A leading double-star-slash already means "at any depth"; its zero-depth
      // form is the pattern with those three characters removed.
      if (pattern.startsWith('**/')) expanded.push(pattern.slice(3));
    }
  }
  return expanded;
}

export type ScopeViolationReason = 'outside-scope' | 'readonly';

/**
 * Paths no worker may change, whatever its packet scope says (spec 6, "Secrets").
 * A planner can write a broad scope like `src/**`; without a floor, a worker
 * could commit `.env` or a private key and the packet would still pass. These
 * are merged into every packet's readonly set by the scheduler.
 */
export const ULTRA_DENY_PATHS: readonly string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/secrets/**',
  '**/id_rsa*',
  '**/id_ed25519*',
];

export interface ScopeViolation {
  readonly file: string;
  readonly reason: ScopeViolationReason;
}

export interface ScopeDecision {
  readonly ok: boolean;
  readonly violations: readonly ScopeViolation[];
}

export interface CheckScopeInput {
  /** Repo-relative POSIX paths of every file the worker changed. */
  readonly changedFiles: readonly string[];
  /** Writable globs; a path must match at least one. */
  readonly scope: readonly string[];
  /** Globs the worker may read but must never change. */
  readonly readonly?: readonly string[];
}

/** Normalises a git-reported path to repo-relative POSIX form. */
function normalizePath(file: string): string {
  return file.replace(/\\/gu, '/').replace(/^\.\//u, '');
}

/**
 * Decides whether every changed file is allowed. `readonly` wins over `scope`
 * for the same file, so a broad scope (`src/**`) cannot silently permit an edit
 * to a path the plan marked off-limits.
 */
export function checkScope(input: CheckScopeInput): ScopeDecision {
  const readonly = input.readonly ?? [];
  const violations: ScopeViolation[] = [];

  for (const raw of input.changedFiles) {
    const file = normalizePath(raw);
    if (file.length === 0) continue;
    if (readonly.length > 0 && isDeniedPath(file, expandZeroDepthGlobs(readonly))) {
      violations.push({ file, reason: 'readonly' });
      continue;
    }
    if (!isDeniedPath(file, expandZeroDepthGlobs(input.scope))) {
      violations.push({ file, reason: 'outside-scope' });
    }
  }

  return { ok: violations.length === 0, violations };
}

/** Renders a violation list as the note a repair attempt starts from. */
export function describeScopeViolations(violations: readonly ScopeViolation[]): string {
  return violations
    .map((violation) =>
      violation.reason === 'readonly'
        ? `${violation.file} is read-only and must not be changed`
        : `${violation.file} is outside the packet scope`,
    )
    .join('\n');
}
