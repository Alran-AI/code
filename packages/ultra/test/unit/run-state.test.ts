import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunStore } from '../../src/run-state.js';

const dirs: string[] = [];

function tempRunDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-run-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ULT-05: killing mid-run and resuming must not repeat finished work and must
// land in the same state as an uninterrupted run.
describe('run state and resume', () => {
  it('creates a run directory with state, ledger and packets', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-8f2a', goal: 'migrate', budgetUsd: 2 });
    expect(store.state.status).toBe('planning');
    expect(store.paths.state).toContain('state.json');
    expect(store.paths.ledger).toContain('ledger.jsonl');
    expect(store.state.goal).toBe('migrate');
  });

  it('persists a status transition across a reopen', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-a', goal: 'g', budgetUsd: 2 });
    store.transition('running');
    const reopened = RunStore.open(dir, 'run-a');
    expect(reopened.state.status).toBe('running');
  });

  it('records packet status so a resume knows what finished', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-b', goal: 'g', budgetUsd: 2 });
    store.setPackets([
      { id: 'p1', title: 'A', status: 'pending' },
      { id: 'p2', title: 'B', status: 'pending' },
    ]);
    // `done` requires passing through `verifying`; the guard rejects a jump.
    store.setPacketStatus('p1', 'verifying');
    store.setPacketStatus('p1', 'done');
    const reopened = RunStore.open(dir, 'run-b');
    expect(reopened.state.packets.find((packet) => packet.id === 'p1')?.status).toBe('done');
    expect(reopened.state.packets.find((packet) => packet.id === 'p2')?.status).toBe('pending');
  });

  it('plans resume from the set of not-yet-terminal packets', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-c', goal: 'g', budgetUsd: 2 });
    store.setPackets([
      { id: 'p1', title: 'A', status: 'verifying' },
      { id: 'p2', title: 'B', status: 'running' },
      { id: 'p3', title: 'C', status: 'pending' },
      { id: 'p4', title: 'D', status: 'blocked' },
    ]);
    // p1 is still verifying (non-terminal), so a resume redoes it too.
    expect(store.resumablePacketIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('never lets a packet go straight from pending to done without a gate', () => {
    expect(() => RunStore.assertTransition('running', 'done')).toThrow(/gate/iu);
    expect(() => RunStore.assertTransition('verifying', 'done')).not.toThrow();
  });

  it('refuses to set a run to succeeded from anywhere but integrating', () => {
    // ULT-10 at the state layer: only integrate may succeed a run.
    expect(() => RunStore.assertRunTransition('running', 'succeeded')).toThrow(/integr/iu);
    expect(() => RunStore.assertRunTransition('integrating', 'succeeded')).not.toThrow();
  });

  it('pauses at the budget and resumes from the persisted status', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-d', goal: 'g', budgetUsd: 2 });
    store.transition('running');
    store.transition('paused');
    expect(RunStore.open(dir, 'run-d').state.status).toBe('paused');
    store.transition('running');
    expect(RunStore.open(dir, 'run-d').state.status).toBe('running');
  });

  it('tolerates a corrupted state file by reporting it instead of guessing', () => {
    const dir = tempRunDir();
    const store = RunStore.create(dir, { runId: 'run-e', goal: 'g', budgetUsd: 2 });
    writeFileSync(store.paths.state, '{ not json');
    expect(() => RunStore.open(dir, 'run-e')).toThrow(/state\.json/iu);
  });

  it('writes a .alran/.gitignore covering state and worktrees, not ci.yml', () => {
    // Without this, the first run dirties the tree and the start guard refuses
    // the next one: Ultra would block itself. It must cover `worktrees/` too,
    // because packet worktrees are created there.
    const repo = tempRunDir();
    RunStore.create(path.join(repo, '.alran', 'ultra'), { runId: 'run-f', goal: 'g', budgetUsd: 2 });
    const ignoreFile = path.join(repo, '.alran', '.gitignore');
    const content = readFileSync(ignoreFile, 'utf8');
    expect(content).toContain('ultra/');
    expect(content).toContain('worktrees/');
    // A committed sibling config must not be ignored by these rules.
    expect(content).not.toMatch(/^\*$/mu);
    // A user-provided file is never overwritten.
    writeFileSync(ignoreFile, 'custom\n');
    RunStore.create(path.join(repo, '.alran', 'ultra'), { runId: 'run-g', goal: 'g', budgetUsd: 2 });
    expect(readFileSync(ignoreFile, 'utf8')).toBe('custom\n');
  });

  it('raises the budget cap and persists it (spec 6)', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'ultra-run-state-'));
    const store = RunStore.create(path.join(repo, '.alran', 'ultra'), {
      runId: 'run-h',
      goal: 'g',
      budgetUsd: 2,
    });
    store.setBudgetUsd(5);
    expect(store.state.budgetUsd).toBe(5);
    // Durable: a resumed process reads the raised cap, not the old one.
    const reopened = RunStore.open(path.join(repo, '.alran', 'ultra'), 'run-h');
    expect(reopened.state.budgetUsd).toBe(5);
    rmSync(repo, { recursive: true, force: true });
  });

  it('clears the cap when it is set to null', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'ultra-run-state-'));
    const store = RunStore.create(path.join(repo, '.alran', 'ultra'), {
      runId: 'run-i',
      goal: 'g',
      budgetUsd: 2,
    });
    store.setBudgetUsd(null);
    expect(store.state.budgetUsd).toBeNull();
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses an invalid cap rather than storing a broken one', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'ultra-run-state-'));
    const store = RunStore.create(path.join(repo, '.alran', 'ultra'), {
      runId: 'run-j',
      goal: 'g',
      budgetUsd: 2,
    });
    expect(() => store.setBudgetUsd(-1)).toThrow(/invalid budget cap/iu);
    expect(() => store.setBudgetUsd(Number.NaN)).toThrow(/invalid budget cap/iu);
    expect(store.state.budgetUsd).toBe(2);
    rmSync(repo, { recursive: true, force: true });
  });
});
