/**
 * Branch and tag names (spec 3.3, 4.3, 13.5).
 *
 * The rule these tests exist for is not cosmetic: git stores a ref as a file, so
 * `ultra/<run>` and `ultra/<run>/<packet>` can never coexist. An earlier version
 * named packet branches that way and every real integrate failed with
 * "cannot lock ref 'refs/heads/ultra/<run>': 'refs/heads/ultra/<run>/p1' exists".
 * The unit tests missed it because their integrate port was a fake that never
 * touched git.
 *
 * So the naming is asserted twice: as strings, and against a real repository
 * where every ref a run creates is actually created.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkpointTagFor,
  packetBranchFor,
  runBranchFor,
  specTestBranchFor,
} from '../../src/branches.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-branches-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo(): string {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'ultra@example.invalid']);
  git(dir, ['config', 'user.name', 'Ultra Test']);
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('branch names', () => {
  it('keeps the run branch exactly as the report and the merge command say', () => {
    expect(runBranchFor('run-8f2a')).toBe('ultra/run-8f2a');
  });

  it('names packet and spec-test branches as siblings, never as children', () => {
    // A child (`ultra/run-8f2a/p1`) would make `git branch ultra/run-8f2a`
    // impossible for the rest of the repository's life.
    expect(packetBranchFor('run-8f2a', 'p1')).toBe('ultra/run-8f2a-p1');
    expect(specTestBranchFor('run-8f2a')).toBe('ultra/run-8f2a-spec-tests');
    for (const name of [packetBranchFor('run-8f2a', 'p1'), specTestBranchFor('run-8f2a')]) {
      expect(name.startsWith(`${runBranchFor('run-8f2a')}/`)).toBe(false);
    }
  });

  it('puts checkpoint tags under the run, where a tag cannot clash with a branch', () => {
    expect(checkpointTagFor('run-8f2a', 3)).toBe('ultra/run-8f2a/round-3');
  });
});

describe('against real git', () => {
  it('can create every ref a run creates, in any order', () => {
    const dir = repo();
    const run = runBranchFor('run-1');
    const packets = ['p1', 'p2'].map((id) => packetBranchFor('run-1', id));
    const spec = specTestBranchFor('run-1');

    // The order that used to break: a packet branch first, then the run branch.
    for (const branch of [...packets, spec]) git(dir, ['branch', branch, 'main']);
    expect(() => git(dir, ['branch', run, 'main'])).not.toThrow();
    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main');

    // And the run branch first, for a run whose packets come later.
    git(dir, ['branch', '-D', ...packets, spec, run]);
    git(dir, ['branch', run, 'main']);
    for (const branch of [...packets, spec]) {
      expect(() => git(dir, ['branch', branch, 'main'])).not.toThrow();
    }

    // The tag lives in refs/tags, so it never competes with any of them.
    git(dir, ['tag', checkpointTagFor('run-1', 1)]);
    expect(git(dir, ['tag', '-l'])).toContain('ultra/run-1/round-1');
  });

  it('still lets a human merge the run branch after packets were merged in', () => {
    const dir = repo();
    const run = runBranchFor('run-1');
    const packet = packetBranchFor('run-1', 'p1');

    // A packet branch with a real commit, so the merge is not a no-op.
    git(dir, ['branch', packet, 'main']);
    const worktree = path.join(tempDir(), 'wt');
    git(dir, ['worktree', 'add', '-q', worktree, packet]);
    writeFileSync(path.join(worktree, 'b.txt'), 'two\n');
    git(worktree, ['add', 'b.txt']);
    git(worktree, ['commit', '-qm', 'packet work']);

    git(dir, ['branch', run, 'main']);
    git(dir, ['checkout', '-q', run]);
    git(dir, ['merge', '-q', '--no-edit', packet]);
    expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(run);
    // The merged result is on the run branch, and main never moved.
    expect(git(dir, ['rev-parse', 'main'])).not.toBe(git(dir, ['rev-parse', run]));
    expect(git(dir, ['ls-tree', '--name-only', 'HEAD']).split('\n')).toContain('b.txt');
  });
});