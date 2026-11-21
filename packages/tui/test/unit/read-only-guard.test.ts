/**
 * The read-only guard for Ultra's planning roles.
 *
 * A live run showed why this exists: a scope-check call answered with a work
 * report and had rewritten two tracked files. These tests pin the guarantee the
 * guard makes — a read-only call leaves the tree exactly as it found it — and the
 * one thing it must never do, which is overwrite work the user already had.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreTree, snapshotTree } from '../../src/cli/read-only-guard.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-readonly-'));
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
  writeFileSync(path.join(dir, 'b.txt'), 'two\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('snapshotTree', () => {
  it('records tracked and untracked paths', () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    writeFileSync(path.join(dir, 'new.txt'), 'new\n');
    const snapshot = snapshotTree(dir);
    expect(snapshot?.entries.map((entry) => entry.path).sort()).toEqual(['a.txt', 'new.txt']);
  });

  it('returns undefined outside a git repository, rather than pretending', () => {
    expect(snapshotTree(tempDir())).toBeUndefined();
  });
});

describe('restoreTree', () => {
  it('undoes edits a read-only call made to tracked files', () => {
    const dir = repo();
    const before = snapshotTree(dir)!;
    // What a planning agent that decided to "help" would do.
    writeFileSync(path.join(dir, 'a.txt'), 'the model rewrote this\n');

    const { reverted } = restoreTree(dir, before);

    expect(reverted).toEqual(['a.txt']);
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('one\n');
    expect(git(dir, ['status', '--porcelain'])).toBe('');
  });

  it('deletes files a read-only call created', () => {
    const dir = repo();
    const before = snapshotTree(dir)!;
    writeFileSync(path.join(dir, 'invented.ts'), 'export const x = 1;\n');

    const { reverted } = restoreTree(dir, before);

    expect(reverted).toContain('invented.ts');
    expect(git(dir, ['status', '--porcelain'])).toBe('');
  });

  it('never touches work the user already had', () => {
    const dir = repo();
    // The user's own uncommitted change, present before the call.
    writeFileSync(path.join(dir, 'b.txt'), 'mine\n');
    const before = snapshotTree(dir)!;
    // The call edits the same file and another one.
    writeFileSync(path.join(dir, 'b.txt'), 'the model overwrote mine\n');
    writeFileSync(path.join(dir, 'a.txt'), 'and this one\n');

    const { reverted } = restoreTree(dir, before);

    // The tracked file that was clean before is restored; the user's own edit is
    // left exactly as the call found it — not reverted, not overwritten.
    expect(reverted).toContain('a.txt');
    expect(reverted).not.toContain('b.txt');
    expect(readFileSync(path.join(dir, 'b.txt'), 'utf8')).toBe('the model overwrote mine\n');
  });

  it('leaves Ultra’s own state directory alone', () => {
    const dir = repo();
    const before = snapshotTree(dir)!;
    mkdirSync(path.join(dir, '.alran', 'ultra'), { recursive: true });
    writeFileSync(path.join(dir, '.alran', 'ultra', 'run-1'), 'state\n');
    const { reverted } = restoreTree(dir, before);
    expect(reverted).not.toContain('.alran/ultra/run-1');
  });
});