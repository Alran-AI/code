/**
 * Putting the authored spec tests where they can gate the run (spec 13.2).
 *
 * The authoring step writes the checks into the run directory, which keeps them
 * reviewable but also means nothing ever runs them: workers are judged on their
 * own tests, and the acceptance agent's opinion is the only thing standing
 * between the run and "done". The spec is explicit that the checks exist *before*
 * the first worker starts and that no worker may edit them.
 *
 * This module makes that real without touching the user's working tree: it
 * commits the authored files onto a branch of their own, `ultra/<run>-spec-tests`,
 * built from the run's base commit. Every packet worktree is then created from
 * that branch, so:
 *
 *   - the checks are present in every worktree, and the gate can run them;
 *   - the checks are part of the base, so a worker's diff cannot contain them
 *     and scope enforcement already rejects any attempt to edit them;
 *   - the integration branch descends from the same commit, so merging packets
 *     keeps the checks instead of dropping them.
 *
 * The commit is built with a private index (`GIT_INDEX_FILE`) and `commit-tree`:
 * the checkout the user is sitting in is never staged, never switched and never
 * dirtied, which is what makes this safe to run on a tree with uncommitted work.
 */

import { spawnSync } from 'node:child_process';
import { specTestBranchFor } from '@alran/ultra';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface SpecTestCommitInput {
  /** The repository the run operates on. */
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runId: string;
  /** The commit the packets would have branched from. */
  readonly baseRef: string;
  /** Authored files, with paths relative to the repository root. */
  readonly files: readonly { readonly file: string; readonly content: string }[];
}

export interface SpecTestCommitResult {
  /** The branch every packet worktree and the run branch start from. */
  readonly branch: string;
  /** The commit the branch points at; handy for the ledger and the report. */
  readonly commit: string;
}

/**
 * The branch that carries the authored checks for one run.
 *
 * Re-exported from the core so the naming rule (a sibling of the run branch, or
 * git cannot create the run branch at all) has exactly one definition.
 */
export { specTestBranchFor };

function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv | undefined,
  input?: string,
): string {
  const result = spawnSync('git', args, {
    cwd,
    env: env ?? process.env,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  if (result.status !== 0) {
    const detail = (result.stderr ?? result.stdout ?? '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail || `exit ${String(result.status)}`}`);
  }
  return (result.stdout ?? '').trim();
}

/**
 * Commits `files` on `ultra/<run>-spec-tests`, based on `baseRef`.
 *
 * Throws when git refuses, because a run whose acceptance checks were not
 * committed would silently fall back to judging itself on the workers' tests.
 */
export function commitSpecTestsAsBase(input: SpecTestCommitInput): SpecTestCommitResult {
  if (input.files.length === 0) {
    throw new Error('refusing to commit an empty spec-test set');
  }
  const env = input.env ?? process.env;
  const baseCommit = git(input.cwd, ['rev-parse', '--verify', `${input.baseRef}^{commit}`], env);

  // A private index keeps the user's staging area untouched.
  const indexDir = mkdtempSync(path.join(tmpdir(), 'alran-ultra-spec-'));
  const indexFile = path.join(indexDir, 'index');
  const indexEnv = { ...env, GIT_INDEX_FILE: indexFile };
  try {
    git(input.cwd, ['read-tree', baseCommit], indexEnv);
    for (const entry of input.files) {
      // `--path` makes git apply the repository's own clean filters, so a file
      // with CRLF or an encoding conversion is stored the way a checkout would
      // read it back.
      const blob = git(input.cwd, ['hash-object', '-w', '--path', entry.file, '--stdin'], env, entry.content);
      git(input.cwd, ['update-index', '--add', '--cacheinfo', `100644,${blob},${entry.file}`], indexEnv);
    }
    const tree = git(input.cwd, ['write-tree'], indexEnv);
    const commit = git(
      input.cwd,
      ['commit-tree', tree, '-p', baseCommit, '-m', `ultra: spec tests for run ${input.runId}`],
      env,
    );
    const branch = specTestBranchFor(input.runId);
    git(input.cwd, ['branch', '-f', branch, commit], env);
    return { branch, commit };
  } finally {
    // The blobs are already in the object database; only the scratch index goes.
    rmSync(indexDir, { recursive: true, force: true });
  }
}

/** True when git recognises `branch` as a commit-ish. */
export function specTestBranchExists(
  cwd: string,
  branch: string,
  env?: NodeJS.ProcessEnv,
): boolean {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`], env);
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit a run's packets should branch from.
 *
 * A fresh run branches from the requested ref (or `HEAD`) until the checks are
 * frozen, at which point the spec-test branch *is* the base. A resumed run has
 * no authoring step in front of it, so it has to rediscover that base from the
 * branch that is already on disk — otherwise the worktrees would come back
 * without the frozen checks and the resumed run would quietly lose them.
 */
export function baseRefForRun(input: {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly runId: string;
  /** An explicit `--base`, which always wins. */
  readonly requested?: string;
}): string {
  if (input.requested !== undefined && input.requested.trim().length > 0) {
    return input.requested;
  }
  const branch = specTestBranchFor(input.runId);
  return specTestBranchExists(input.cwd, branch, input.env) ? branch : 'HEAD';
}
