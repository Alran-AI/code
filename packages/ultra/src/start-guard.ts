/**
 * Start guard: the two cheap checks before any Ultra work begins.
 *
 * Ultra must never start on top of uncommitted changes unless the human opts in
 * with `--stash`, because every packet works in its own worktree branched from
 * a known commit. The probe reads git; the decision is pure and testable.
 */

import { execFileSync } from 'node:child_process';

export interface WorkingTreeProbe {
  readonly isGitRepo: boolean;
  /** True when tracked files are modified or untracked files exist. */
  readonly dirty: boolean;
  readonly headSha?: string;
}

export interface StartGuardInput {
  readonly isGitRepo: boolean;
  readonly dirty: boolean;
  readonly stash: boolean;
}

export interface StartGuardDecision {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** True when a dirty tree was allowed and must be snapshotted before start. */
  readonly snapshotBeforeStart: boolean;
}

/** Runs `git` in `cwd` and returns trimmed stdout, or undefined when it fails. */
function gitText(cwd: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Ultra's own output directories. They are created by Ultra, never by the user,
 * and `.alran/.gitignore` itself is untracked, so `git status` still reports
 * `.alran/`. Excluding these paths keeps a run from refusing the next run.
 */
const OWN_OUTPUT_PREFIXES = ['.alran/ultra/', '.alran/worktrees/', '.alran/.gitignore'];

function isOwnOutput(porcelainLine: string): boolean {
  // Format: `XY <path>` or `XY <old> -> <new>`; take the last path token.
  const path = porcelainLine.slice(3).split(' -> ').pop()?.trim() ?? '';
  return isOwnPath(path);
}

function isOwnPath(path: string): boolean {
  const normalized = path.length > 1 ? path.replace(/\/$/u, '') : path;
  return OWN_OUTPUT_PREFIXES.some(
    (prefix) => normalized === prefix.replace(/\/$/u, '') || normalized.startsWith(prefix),
  );
}

/** Inspects the working tree without throwing: a non-git directory is valid input. */
export function probeWorkingTree(cwd: string): WorkingTreeProbe {
  const inside = gitText(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') return { isGitRepo: false, dirty: false };
  // `--untracked-files=all` lists every untracked file (never a collapsed
  // `?? .alran/`), so Ultra's own output can be excluded precisely rather than
  // by guessing at a collapsed directory entry.
  const status = gitText(cwd, ['status', '--porcelain', '--untracked-files=all']) ?? '';
  const relevant = status.split('\n').filter((line) => line.trim().length > 0 && !isOwnOutput(line));
  const headSha = gitText(cwd, ['rev-parse', 'HEAD']);
  return {
    isGitRepo: true,
    dirty: relevant.length > 0,
    ...(headSha ? { headSha } : {}),
  };
}

/**
 * Decides whether a run may start. A dirty tree is refused unless `--stash` is
 * given, in which case the caller must snapshot it first. A clean tree never
 * needs a snapshot even when `--stash` is passed.
 */
export function evaluateStartGuard(input: StartGuardInput): StartGuardDecision {
  if (!input.isGitRepo) {
    return { ok: true, problems: [], snapshotBeforeStart: false };
  }
  if (!input.dirty) {
    return { ok: true, problems: [], snapshotBeforeStart: false };
  }
  if (input.stash) {
    return { ok: true, problems: [], snapshotBeforeStart: true };
  }
  return {
    ok: false,
    problems: [
      'the working tree has uncommitted changes; commit or stash them first, or pass --stash to snapshot the tree before starting',
    ],
    snapshotBeforeStart: false,
  };
}
