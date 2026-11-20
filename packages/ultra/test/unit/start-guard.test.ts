import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateStartGuard, probeWorkingTree } from '../../src/start-guard.js';

// ULT-11: a dirty working tree is refused without --stash.
describe('start guard', () => {
  it('refuses a dirty tree when --stash is not given', () => {
    const result = evaluateStartGuard({ isGitRepo: true, dirty: true, stash: false });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('uncommitted changes');
  });

  it('allows a dirty tree when --stash is given', () => {
    const result = evaluateStartGuard({ isGitRepo: true, dirty: true, stash: true });
    expect(result.ok).toBe(true);
    expect(result.snapshotBeforeStart).toBe(true);
  });

  it('allows a clean tree', () => {
    expect(evaluateStartGuard({ isGitRepo: true, dirty: false, stash: false }).ok).toBe(true);
  });

  it('does not claim a snapshot when the tree is clean even with --stash', () => {
    const result = evaluateStartGuard({ isGitRepo: true, dirty: false, stash: true });
    expect(result.ok).toBe(true);
    expect(result.snapshotBeforeStart).toBe(false);
  });

  it('allows a non-git directory, which has no tracked state to protect', () => {
    expect(evaluateStartGuard({ isGitRepo: false, dirty: false, stash: false }).ok).toBe(true);
  });
});

describe('working tree probe', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function gitRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ultra-guard-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'ultra@example.invalid'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Ultra Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
    return dir;
  }

  it('reports a clean committed repository', () => {
    const probe = probeWorkingTree(gitRepo());
    expect(probe.isGitRepo).toBe(true);
    expect(probe.dirty).toBe(false);
    expect(probe.headSha).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('reports a modified tracked file as dirty', () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    expect(probeWorkingTree(dir).dirty).toBe(true);
  });

  it('reports an untracked file as dirty', () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'b.txt'), 'new\n');
    expect(probeWorkingTree(dir).dirty).toBe(true);
  });

  it('reports a non-git directory instead of throwing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ultra-nogit-'));
    dirs.push(dir);
    expect(probeWorkingTree(dir)).toMatchObject({ isGitRepo: false, dirty: false });
  });
});

describe('own output is not user dirt', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('ignores .alran/ultra and .alran/worktrees when deciding dirtiness', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ultra-own-'));
    dirs.push(dir);
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'ultra@example.invalid'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Ultra Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'a.txt'), 'one\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

    // Ultra's own output must not make the tree look dirty (otherwise the first
    // run blocks the second).
    mkdirSync(path.join(dir, '.alran', 'ultra'), { recursive: true });
    mkdirSync(path.join(dir, '.alran', 'worktrees'), { recursive: true });
    writeFileSync(path.join(dir, '.alran', '.gitignore'), 'ultra/\nworktrees/\n');
    expect(probeWorkingTree(dir).dirty).toBe(false);

    // A real user change still counts.
    writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    expect(probeWorkingTree(dir).dirty).toBe(true);
  });
});
