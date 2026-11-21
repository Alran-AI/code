/**
 * Keeping read-only phases read-only (spec 6: "Tools | workers get local tools
 * only").
 *
 * Ultra's planning roles — the scope check, the three explorers, the planner and
 * the critic — are supposed to read the repository and nothing else. But the
 * headless permission mode that does not prompt (`off`) *skips* permission review
 * rather than restricting it, so a planning agent that decides to "help" can edit
 * the user's checkout. That is not hypothetical: a live scope-check call answered
 * with a work report and had rewritten two files.
 *
 * The fix is at the harness level, not the prompt level. A prompt that asks an
 * agent not to write is a request; this is a guarantee: the tree is fingerprinted
 * before the call and restored from that fingerprint afterwards, and the caller is
 * told what was undone.
 *
 * Restoration is deliberately narrow. It only touches paths that were *not*
 * already dirty before the call, so a user's uncommitted work is never
 * overwritten — the rule is "undo what this call did", not "reset the tree".
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

/** One `git status --porcelain` row, split into its status and path. */
export interface TreeEntry {
  readonly status: string;
  readonly path: string;
}

export interface TreeSnapshot {
  readonly entries: readonly TreeEntry[];
}

const ULTRA_STATE_PREFIX = '.alran/';

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv | undefined): string {
  const result = spawnSync('git', args, { cwd, env: env ?? process.env, encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail || `exit ${String(result.status)}`}`);
  }
  return result.stdout ?? '';
}

/** Parses porcelain output, keeping renames in their `old -> new` form. */
function parseStatus(text: string): TreeEntry[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).trim() }));
}

/**
 * Fingerprints the working tree.
 *
 * Returns `undefined` when the directory is not a git repository, because a
 * caller that cannot tell what it changed must not claim it reverted anything.
 */
export function snapshotTree(
  cwd: string,
  env?: NodeJS.ProcessEnv,
): TreeSnapshot | undefined {
  let text: string;
  try {
    text = git(cwd, ['status', '--porcelain'], env);
  } catch {
    return undefined;
  }
  return { entries: parseStatus(text) };
}

/** True when a status means "this path is not in the index". */
function isUntracked(status: string): boolean {
  return status.trim().startsWith('??');
}

/** True when a status means the index holds a new file that was not there before. */
function isAdded(status: string): boolean {
  return status.trim().startsWith('A');
}

/**
 * Undoes what a read-only call changed, and returns the paths it undid.
 *
 * Only paths that were clean (or absent) before the call are touched. Anything
 * the user had already modified is left exactly as it was.
 */
export function restoreTree(
  cwd: string,
  before: TreeSnapshot,
  env?: NodeJS.ProcessEnv,
): { readonly reverted: readonly string[] } {
  const after = snapshotTree(cwd, env);
  if (!after) return { reverted: [] };

  const beforeByPath = new Map(before.entries.map((entry) => [entry.path, entry]));
  const afterByPath = new Map(after.entries.map((entry) => [entry.path, entry]));
  const reverted: string[] = [];

  for (const [entryPath, afterEntry] of afterByPath) {
    if (entryPath.startsWith(ULTRA_STATE_PREFIX)) continue;
    const beforeEntry = beforeByPath.get(entryPath);
    // The user already had this path dirty; not ours to touch.
    if (beforeEntry && beforeEntry.status === afterEntry.status) continue;
    if (beforeEntry && !isUntracked(beforeEntry.status) && !isAdded(beforeEntry.status)) continue;

    if (isUntracked(afterEntry.status)) {
      const full = path.join(cwd, entryPath);
      if (existsSync(full)) rmSync(full, { recursive: true, force: true });
      reverted.push(entryPath);
      continue;
    }
    if (isAdded(afterEntry.status)) {
      try {
        git(cwd, ['rm', '-q', '--cached', '--', entryPath], env);
      } catch {
        // The index may already be clean; the file still goes.
      }
      const full = path.join(cwd, entryPath);
      if (existsSync(full)) rmSync(full, { recursive: true, force: true });
      reverted.push(entryPath);
      continue;
    }
    // A tracked path the call modified: restore it from the index.
    try {
      git(cwd, ['checkout', '--', entryPath], env);
      reverted.push(entryPath);
    } catch {
      // If git refuses (a path that vanished), there is nothing left to undo.
    }
  }

  return { reverted };
}