/**
 * The git adapter that carries a packet's work onto its branch.
 *
 * The rule under test: only the paths the scope guard approved may be
 * committed. A gate that writes into the worktree — a formatter with
 * `--write`, a test that leaves a fixture behind — adds files that no scope
 * check ever saw, and committing them would put unverified work on the
 * packet's branch and, through the merge, into the run's branch.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createUltraExecAdapters } from '../../src/cli/ultra-exec-adapters.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-exec-adapters-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repository with one commit, so a worktree can be branched from it. */
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

function write(dir: string, file: string, content: string): void {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

describe('the worktree commit adapter', () => {
  it('commits only the paths the scope check approved', async () => {
    const cwd = repo();
    const adapters = createUltraExecAdapters({ cwd, env: process.env });
    const { dir } = await adapters.worktree.create({
      packetId: 'p1',
      runId: 'run-1',
      branch: 'ultra/run-1/p1',
      baseRef: 'HEAD',
    });

    // The worker changed a file in scope; a gate then wrote another file that
    // the scope guard never saw.
    write(dir, 'src/p1/x.ts', 'export const x = 1;\n');
    write(dir, 'other/leak.txt', 'not checked\n');

    // The diff port stages everything so that new files show up in the diff.
    const changed = await adapters.worktree.changedFiles({
      packetId: 'p1',
      dir,
      baseRef: 'HEAD',
    });
    expect(changed).toContain('src/p1/x.ts');
    expect(changed).toContain('other/leak.txt');

    // The commit is told which paths the scope check approved. Only those may
    // reach the branch.
    const approved = changed.filter((file) => file.startsWith('src/'));
    const result = await adapters.worktree.commit({
      packetId: 'p1',
      dir,
      message: 'ultra(p1): the work',
      paths: approved,
    });
    expect(result.commit).not.toBe('');

    const tree = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(tree).toContain('src/p1/x.ts');
    expect(tree).not.toContain('other/leak.txt');
  });

  it('commits a deleted file when it was approved', async () => {
    const cwd = repo();
    write(cwd, 'b.txt', 'two\n');
    git(cwd, ['add', 'b.txt']);
    git(cwd, ['commit', '-qm', 'add b']);

    const adapters = createUltraExecAdapters({ cwd, env: process.env });
    const { dir } = await adapters.worktree.create({
      packetId: 'p1',
      runId: 'run-1',
      branch: 'ultra/run-1/p1',
      baseRef: 'HEAD',
    });
    rmSync(path.join(dir, 'b.txt'));

    const changed = await adapters.worktree.changedFiles({
      packetId: 'p1',
      dir,
      baseRef: 'HEAD',
    });
    expect(changed).toContain('b.txt');

    await adapters.worktree.commit({
      packetId: 'p1',
      dir,
      message: 'ultra(p1): remove b',
      paths: changed,
    });

    const tree = git(dir, ['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(tree).not.toContain('b.txt');
  });

  it('commits nothing when no path was approved', async () => {
    const cwd = repo();
    const adapters = createUltraExecAdapters({ cwd, env: process.env });
    const { dir } = await adapters.worktree.create({
      packetId: 'p1',
      runId: 'run-1',
      branch: 'ultra/run-1/p1',
      baseRef: 'HEAD',
    });
    write(dir, 'src/p1/x.ts', 'export const x = 1;\n');

    const result = await adapters.worktree.commit({
      packetId: 'p1',
      dir,
      message: 'ultra(p1): the work',
      paths: [],
    });

    // An empty commit would only make the merge history lie.
    expect(result.commit).toBe('');
    const head = git(dir, ['rev-parse', 'HEAD']);
    expect(head.trim()).toBe(git(cwd, ['rev-parse', 'HEAD']).trim());
  });
});
