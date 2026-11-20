/**
 * Detached launching (`--detach`, and the TUI's start button).
 *
 * A background run must (a) return immediately instead of blocking the shell,
 * (b) record who is driving it so a surface can say whether it is still alive,
 * and (c) hand the child a command line that continues the same run instead of
 * starting a second one. These tests cover all three without depending on a real
 * model call.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchUltraRun, ultraChildArgs, alranCommandFor } from '../../src/cli/ultra-launch.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-launch-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ultraChildArgs', () => {
  it('tells the child to adopt the run instead of creating a new one', () => {
    const args = ultraChildArgs({
      mode: 'run',
      task: 'Build the widget',
      runId: 'run-1',
      budgetUsd: 2,
      recipe: 'auto',
      workers: 4,
      maxRepairs: 2,
    });
    expect(args[0]).toBe('run');
    // The task must survive as one argument, spaces included.
    expect(args).toContain('Build the widget');
    expect(args).toEqual(expect.arrayContaining(['--adopt', 'run-1']));
    expect(args).toContain('none'.replace('none', '2')); // --budget 2
  });

  it('passes an unlimited budget as none, never as NaN', () => {
    const args = ultraChildArgs({
      mode: 'run',
      task: 't',
      runId: 'run-1',
      budgetUsd: null,
      recipe: 'auto',
      workers: 4,
      maxRepairs: 2,
    });
    const budget = args[args.indexOf('--budget') + 1];
    expect(budget).toBe('none');
    expect(args.join(' ')).not.toContain('NaN');
  });

  it('only passes goal-only flags to a goal run', () => {
    const goal = ultraChildArgs({
      mode: 'goal',
      task: 't',
      runId: 'run-1',
      budgetUsd: 2,
      recipe: 'auto',
      workers: 4,
      maxRepairs: 2,
      maxRounds: 5,
      stallRounds: 3,
    });
    expect(goal).toContain('goal');
    expect(goal).toEqual(expect.arrayContaining(['--max-rounds', '5']));
    expect(goal).toEqual(expect.arrayContaining(['--stall-rounds', '3']));

    const run = ultraChildArgs({
      mode: 'run',
      task: 't',
      runId: 'run-1',
      budgetUsd: 2,
      recipe: 'auto',
      workers: 4,
      maxRepairs: 2,
      maxRounds: 5,
    });
    expect(run).not.toContain('--max-rounds');
  });

  it('leaves out flags the caller did not set', () => {
    const args = ultraChildArgs({
      mode: 'run',
      task: 't',
      runId: 'run-1',
      budgetUsd: 2,
      recipe: 'auto',
      workers: 4,
      maxRepairs: 2,
    });
    expect(args).not.toContain('--base');
    expect(args).not.toContain('--stash');
  });

  it('forwards base and stash when they are set', () => {
    const args = ultraChildArgs({
      mode: 'run',
      task: 't',
      runId: 'run-1',
      budgetUsd: 2,
      recipe: 'migrate',
      workers: 2,
      maxRepairs: 1,
      baseRef: 'origin/main',
      stash: true,
    });
    expect(args).toEqual(expect.arrayContaining(['--base', 'origin/main']));
    expect(args).toContain('--stash');
    expect(args).toEqual(expect.arrayContaining(['--recipe', 'migrate']));
  });
});

describe('alranCommandFor', () => {
  it('prefers the running entry point over whatever is on PATH', () => {
    expect(alranCommandFor('/opt/alran/dist/cli.js')).toEqual([process.execPath, '/opt/alran/dist/cli.js']);
  });

  it('falls back to the installed command', () => {
    expect(alranCommandFor(undefined)).toEqual(['alran']);
    expect(alranCommandFor('/usr/bin/node')).toEqual(['alran']);
  });
});

describe('launchUltraRun', () => {
  it('returns before the child finishes, and records who is driving', async () => {
    const dir = tempDir();
    const runDir = path.join(dir, '.alran', 'ultra', 'run-1');
    // The child outlives the call: that is the whole point of detaching.
    const child = [
      '-e',
      'setTimeout(() => process.exit(0), 4000)',
    ];
    const started = Date.now();
    const result = launchUltraRun(
      {
        mode: 'run',
        task: 't',
        runId: 'run-1',
        budgetUsd: 2,
        recipe: 'auto',
        workers: 4,
        maxRepairs: 2,
      },
      { cwd: dir, env: { ...process.env }, alranCommand: [process.execPath, ...child] },
    );
    const elapsed = Date.now() - started;

    // It did not wait for the 4 s child.
    expect(elapsed).toBeLessThan(3000);
    expect(result.pid).toBeGreaterThan(0);
    expect(result.runId).toBe('run-1');

    const record = JSON.parse(readFileSync(path.join(runDir, 'runner.json'), 'utf8'));
    expect(record.runId).toBe('run-1');
    expect(record.pid).toBe(result.pid);
    expect(record.mode).toBe('run');

    // Give the detached child a moment, then make sure it really ran.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(path.join(runDir, 'runner.log'))).toBe(true);
  });

  it('records the log path relative to the run directory', () => {
    const dir = tempDir();
    const result = launchUltraRun(
      {
        mode: 'goal',
        task: 't',
        runId: 'run-2',
        budgetUsd: null,
        recipe: 'audit',
        workers: 1,
        maxRepairs: 0,
      },
      {
        cwd: dir,
        env: { ...process.env },
        alranCommand: [process.execPath, '-e', 'process.exit(0)'],
      },
    );
    expect(result.logPath).toBe(path.join(dir, '.alran', 'ultra', 'run-2', 'runner.log'));
    const record = JSON.parse(
      readFileSync(path.join(dir, '.alran', 'ultra', 'run-2', 'runner.json'), 'utf8'),
    );
    expect(record.logPath).toBe('runner.log');
    expect(record.mode).toBe('goal');
  });

  it('appends to the log instead of truncating a previous attempt', () => {
    const dir = tempDir();
    const runDir = path.join(dir, '.alran', 'ultra', 'run-3');
    execFileSync('mkdir', ['-p', runDir]);
    writeFileSync(path.join(runDir, 'runner.log'), 'first attempt\n');
    launchUltraRun(
      { mode: 'run', task: 't', runId: 'run-3', budgetUsd: 2, recipe: 'auto', workers: 1, maxRepairs: 1 },
      { cwd: dir, env: { ...process.env }, alranCommand: [process.execPath, '-e', 'process.exit(0)'] },
    );
    expect(readFileSync(path.join(runDir, 'runner.log'), 'utf8')).toContain('first attempt');
  });
});