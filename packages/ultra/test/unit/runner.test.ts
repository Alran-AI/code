/**
 * Background runs (spec: no open shell required).
 *
 * The rule these tests hold is the one that decides whether a user trusts the
 * feature: a dead process is not automatically a failure. The run's own state
 * says whether it finished; the runner record only says who was driving.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  claimRunner,
  classifyRunner,
  processAlive,
  readRunner,
  writeRunner,
  type UltraRunnerRecord,
} from '../../src/runner.js';
import type { RunPaths } from '../../src/run-state.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-runner-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function paths(root: string): RunPaths {
  return {
    root,
    state: path.join(root, 'state.json'),
    ledger: path.join(root, 'ledger.jsonl'),
    plan: path.join(root, 'plan.json'),
    goal: path.join(root, 'goal.json'),
    packets: path.join(root, 'packets'),
    notes: path.join(root, 'notes.md'),
    rounds: path.join(root, 'rounds'),
    report: path.join(root, 'report.md'),
    runner: path.join(root, 'runner.json'),
    runnerLog: path.join(root, 'runner.log'),
  };
}

function record(over: Partial<UltraRunnerRecord> = {}): UltraRunnerRecord {
  return {
    runId: 'run-1',
    mode: 'run',
    pid: 4242,
    startedAt: '2026-11-20T09:00:00.000Z',
    logPath: 'runner.log',
    task: 'Build the widget',
    budgetUsd: 2,
    recipe: 'auto',
    workers: 4,
    ...over,
  };
}

describe('runner record on disk', () => {
  it('round-trips a record', () => {
    const root = tempDir();
    writeRunner(paths(root), record({ pid: 99 }));
    expect(readRunner(paths(root))).toEqual(record({ pid: 99 }));
  });

  it('reports no record when the run was started in the foreground', () => {
    expect(readRunner(paths(tempDir()))).toBeUndefined();
  });

  it('ignores a corrupt record rather than guessing at it', () => {
    const root = tempDir();
    writeFileSync(paths(root).runner, '{ not json');
    expect(readRunner(paths(root))).toBeUndefined();
  });

  it('ignores a record that is missing the fields it would act on', () => {
    const root = tempDir();
    writeFileSync(paths(root).runner, `${JSON.stringify({ runId: 'run-1' })}\n`);
    expect(readRunner(paths(root))).toBeUndefined();
  });
});

describe('claimRunner', () => {
  it('refuses the claim while another live process is driving the run', () => {
    // Two passes over the same worktrees fight each other. The second one has
    // to know that it lost the claim.
    const root = tempDir();
    writeRunner(paths(root), record({ pid: 4242 }));
    const claimed = claimRunner(paths(root), record({ pid: 5151 }), () => true);
    expect(claimed).toBe(false);
    // The record still names the process that is driving the run.
    expect(readRunner(paths(root))?.pid).toBe(4242);
  });

  it('lets the process that is already driving the run claim it again', () => {
    // The detached child picks up the record its parent wrote for it. The
    // claim has to succeed, and the record has to stay as it is: a child that
    // rewrote it would make a background run look like a foreground one.
    const root = tempDir();
    writeRunner(paths(root), record({ pid: 4242 }));
    const claimed = claimRunner(paths(root), record({ pid: 4242, foreground: true }), () => true);
    expect(claimed).toBe(true);
    expect(readRunner(paths(root))?.foreground).toBeUndefined();
  });

  it('takes over a run whose driver is gone', () => {
    const root = tempDir();
    writeRunner(paths(root), record({ pid: 4242 }));
    const claimed = claimRunner(paths(root), record({ pid: 5151 }), () => false);
    expect(claimed).toBe(true);
    expect(readRunner(paths(root))?.pid).toBe(5151);
  });
});

describe('classifyRunner', () => {
  it('says foreground when no record exists', () => {
    const result = classifyRunner({ record: undefined, runStatus: 'running' });
    expect(result.status).toBe('foreground');
    expect(result.detail).toContain('running');
  });

  it('says running while the process is alive', () => {
    const result = classifyRunner({
      record: record(),
      runStatus: 'running',
      isAlive: () => true,
    });
    expect(result.status).toBe('running');
    expect(result.detail).toContain('pid 4242');
  });

  it('treats a dead process with a finished run as a success', () => {
    // The whole point: the shell closed, the run did not.
    const result = classifyRunner({
      record: record(),
      runStatus: 'succeeded',
      isAlive: () => false,
    });
    expect(result.status).toBe('finished');
    expect(result.detail).toContain('succeeded');
  });

  it('reports a failed run as failed, not as interrupted', () => {
    const result = classifyRunner({
      record: record(),
      runStatus: 'failed',
      isAlive: () => false,
    });
    expect(result.status).toBe('failed');
  });

  it('calls a dead process with an unfinished run interrupted and resumable', () => {
    const result = classifyRunner({
      record: record({ runId: 'run-9' }),
      runStatus: 'running',
      isAlive: () => false,
    });
    expect(result.status).toBe('interrupted');
    expect(result.detail).toContain('resume');
    expect(result.detail).toContain('run-9');
  });

  it('does not call a paused run interrupted', () => {
    // A pause is deliberate and resumable, not a crash.
    const result = classifyRunner({
      record: record(),
      runStatus: 'paused',
      isAlive: () => false,
    });
    expect(result.status).toBe('interrupted');
    expect(result.detail).toMatch(/resume/iu);
  });
});

describe('processAlive', () => {
  it('accepts the current process', () => {
    expect(processAlive(process.pid)).toBe(true);
  });

  it('rejects a pid that cannot exist', () => {
    expect(processAlive(0)).toBe(false);
    expect(processAlive(-1)).toBe(false);
    expect(processAlive(Number.NaN)).toBe(false);
  });

  it('rejects a pid that is certainly gone', () => {
    // PIDs are recycled, so this can only be *probably* gone; the assertion is
    // that an absurd pid is refused rather than throwing.
    expect(processAlive(4_000_000)).toBe(false);
  });
});
