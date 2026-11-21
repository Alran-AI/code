/**
 * The spec-test base commit (spec 13.2, ULT-13).
 *
 * Authored checks only gate a run if every worktree contains them and no worker
 * can edit them. These tests pin the three properties that make that true, and
 * the one that makes it safe: the user's checkout and staging area are untouched.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  baseRefForRun,
  commitSpecTestsAsBase,
  specTestBranchFor,
} from '../../src/cli/ultra-spec-base.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-spec-base-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A repository with one commit, a clean tree and nothing staged. */
function gitRepo(): string {
  const dir = tempDir();
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'ultra@example.invalid']);
  git(dir, ['config', 'user.name', 'Ultra Test']);
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

const FILES = [
  { file: 'tests/spec/c1.spec.ts', content: '// generated\nexport const x = 1;\n' },
  { file: 'tests/spec/c2.spec.ts', content: '// generated\nexport const y = 2;\n' },
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('commitSpecTestsAsBase', () => {
  it('puts the checks on a branch of their own, based on the run base', () => {
    const dir = gitRepo();
    const base = git(dir, ['rev-parse', 'HEAD']);

    const result = commitSpecTestsAsBase({
      cwd: dir,
      runId: 'run-1',
      baseRef: 'HEAD',
      files: FILES,
    });

    expect(result.branch).toBe('ultra/run-1-spec-tests');
    // The branch is one commit ahead of the base and adds both files.
    expect(git(dir, ['rev-parse', `${result.branch}^`])).toBe(base);
    const listed = git(dir, ['ls-tree', '-r', '--name-only', result.branch]);
    expect(listed.split('\n').sort()).toEqual([
      'a.txt',
      'tests/spec/c1.spec.ts',
      'tests/spec/c2.spec.ts',
    ]);
    expect(git(dir, ['show', `${result.branch}:tests/spec/c1.spec.ts`])).toContain('generated');
  });

  it('leaves the working tree and the staging area exactly as they were', () => {
    const dir = gitRepo();
    // Uncommitted work belongs to the user; a run must not stage, stash or switch it.
    writeFileSync(path.join(dir, 'a.txt'), 'one\ndirty\n');
    writeFileSync(path.join(dir, 'notes.md'), 'mine\n');
    const before = readFileSync(path.join(dir, 'a.txt'), 'utf8');

    commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: FILES });

    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe(before);
    // The same two entries, in git's own order: nothing staged, nothing stashed.
    // Raw output, because porcelain marks an unstaged edit with a leading space.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    expect(status.split('\n').filter((line) => line.length > 0).sort()).toEqual(
      [' M a.txt', '?? notes.md'].sort(),
    );
    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toMatch(/^(master|main)$/u);
  });

  it('lets two runs carry different checks without fighting over one branch', () => {
    const dir = gitRepo();
    const first = commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: FILES });
    const second = commitSpecTestsAsBase({
      cwd: dir,
      runId: 'run-2',
      baseRef: 'HEAD',
      files: [{ file: 'tests/spec/c1.spec.ts', content: '// other\n' }],
    });

    expect(first.branch).not.toBe(second.branch);
    expect(git(dir, ['show', `${second.branch}:tests/spec/c1.spec.ts`])).toBe('// other');
  });

  it('can be rebuilt: committing again replaces the branch instead of failing', () => {
    const dir = gitRepo();
    const first = commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: FILES });
    const second = commitSpecTestsAsBase({
      cwd: dir,
      runId: 'run-1',
      baseRef: 'HEAD',
      files: [{ file: 'tests/spec/c1.spec.ts', content: '// rewritten\n' }],
    });

    // A resumed run re-authors its checks; that must not need a manual branch delete.
    expect(second.branch).toBe(first.branch);
    expect(git(dir, ['show', `${second.branch}:tests/spec/c1.spec.ts`])).toBe('// rewritten');
  });

  it('refuses an empty set and an unknown base', () => {
    const dir = gitRepo();
    expect(() =>
      commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: [] }),
    ).toThrow(/empty/iu);
    expect(() =>
      commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'no-such-ref', files: FILES }),
    ).toThrow(/git/iu);
  });

  it('names the branch after the run so a human can find it', () => {
    expect(specTestBranchFor('run-8f2a')).toBe('ultra/run-8f2a-spec-tests');
  });
});

describe('baseRefForRun', () => {
  it('branches from HEAD until the checks are frozen', () => {
    const dir = gitRepo();
    expect(baseRefForRun({ cwd: dir, runId: 'run-1' })).toBe('HEAD');
  });

  it('branches from the frozen checks once they exist (ULT-19)', () => {
    const dir = gitRepo();
    const frozen = commitSpecTestsAsBase({
      cwd: dir,
      runId: 'run-1',
      baseRef: 'HEAD',
      files: FILES,
    });
    // This is what a resumed run relies on: it has no authoring step to redo, so
    // it has to find the base that already carries the checks.
    expect(baseRefForRun({ cwd: dir, runId: 'run-1' })).toBe(frozen.branch);
  });

  it('lets an explicit --base win over the frozen branch', () => {
    const dir = gitRepo();
    commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: FILES });
    expect(baseRefForRun({ cwd: dir, runId: 'run-1', requested: 'HEAD~0' })).toBe('HEAD~0');
    // A blank --base is the same as not passing one.
    expect(baseRefForRun({ cwd: dir, runId: 'run-1', requested: '   ' })).toBe(
      'ultra/run-1-spec-tests',
    );
  });

  it('does not pick up another run’s checks', () => {
    const dir = gitRepo();
    commitSpecTestsAsBase({ cwd: dir, runId: 'run-1', baseRef: 'HEAD', files: FILES });
    expect(baseRefForRun({ cwd: dir, runId: 'run-2' })).toBe('HEAD');
  });
});