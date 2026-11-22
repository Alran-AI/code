import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger.js';
import { listUltraRuns, renderRunList } from '../../src/runs.js';
import { RunStore } from '../../src/run-state.js';

const dirs: string[] = [];

function stateDir(): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'ultra-runs-')), '.alran', 'ultra');
  mkdirSync(dir, { recursive: true });
  dirs.push(path.dirname(dir));
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Creates a run with a couple of packets, some of them done. */
function makeRun(
  dir: string,
  runId: string,
  options: { readonly goal?: string; readonly at?: string; readonly budgetUsd?: number | null } = {},
): RunStore {
  const store = RunStore.create(dir, {
    runId,
    goal: options.goal ?? 'a task',
    budgetUsd: options.budgetUsd === undefined ? 2 : options.budgetUsd,
    now: new Date(options.at ?? '2026-11-19T10:00:00Z'),
  });
  store.setPackets([
    { id: 'p1', title: 'One', status: 'done' },
    { id: 'p2', title: 'Two', status: 'running' },
  ]);
  return store;
}

describe('listUltraRuns', () => {
  it('lists the runs on disk, newest first', () => {
    const dir = stateDir();
    makeRun(dir, 'run-old', { at: '2026-11-19T09:00:00Z', goal: 'the older one' });
    makeRun(dir, 'run-new', { at: '2026-11-19T11:00:00Z', goal: 'the newer one' });

    const listing = listUltraRuns(dir);
    expect(listing.runs.map((run) => run.runId)).toEqual(['run-new', 'run-old']);
    expect(listing.runs[0]!.goal).toBe('the newer one');
  });

  it('counts the finished packets and the spend of each run', () => {
    const dir = stateDir();
    const store = makeRun(dir, 'run-1');
    Ledger.open(store.paths.ledger).append({ kind: 'step', role: 'worker', costUsd: 0.25 });

    const listing = listUltraRuns(dir);
    const run = listing.runs[0]!;
    expect(run.packetsDone).toBe(1);
    expect(run.packetsTotal).toBe(2);
    expect(run.costUsd).toBeCloseTo(0.25, 10);
    expect(run.budgetUsd).toBe(2);
  });

  it('shows criteria progress for a goal-driven run', () => {
    const dir = stateDir();
    const store = makeRun(dir, 'run-1');
    writeFileSync(
      store.paths.goal,
      JSON.stringify({
        goal: 'build it',
        criteria: [
          { id: 'C1', priority: 'must', verification: 'scenario', description: 'it works', status: 'met', evidence: ['e'] },
          { id: 'C2', priority: 'should', verification: 'scenario', description: 'it is pretty', status: 'needs_human', evidence: [] },
        ],
      }),
    );

    const run = listUltraRuns(dir).runs[0]!;
    expect(run.criteria?.total).toBe(2);
    expect(run.criteria?.met).toBe(1);
    expect(run.criteria?.needsHuman).toBe(1);
  });

  it('lists a run whose state cannot be read instead of hiding it', () => {
    const dir = stateDir();
    makeRun(dir, 'run-ok');
    mkdirSync(path.join(dir, 'run-broken'), { recursive: true });
    writeFileSync(path.join(dir, 'run-broken', 'state.json'), '{ not json');

    const listing = listUltraRuns(dir);
    expect(listing.runs.map((run) => run.runId)).toEqual(['run-ok']);
    expect(listing.unreadable.map((run) => run.runId)).toEqual(['run-broken']);
    expect(listing.unreadable[0]!.reason).toBeTruthy();
  });

  it('returns nothing for a directory that does not exist', () => {
    const listing = listUltraRuns(path.join(tmpdir(), 'ultra-runs-missing-xyz'));
    expect(listing.runs).toEqual([]);
    expect(listing.unreadable).toEqual([]);
  });
});

describe('renderRunList', () => {
  it('says so when there is no run at all', () => {
    expect(renderRunList({ runs: [], unreadable: [] })).toBe('No Ultra runs yet.');
  });

  it('shows the id, the status, the packets and the money', () => {
    const dir = stateDir();
    const store = makeRun(dir, 'run-1', { goal: 'migrate the auth layer' });
    Ledger.open(store.paths.ledger).append({ kind: 'step', role: 'worker', costUsd: 0.5 });

    const line = renderRunList(listUltraRuns(dir));
    expect(line).toMatch(/run-1/u);
    expect(line).toMatch(/1\/2 packets/u);
    expect(line).toMatch(/\$0\.50\/\$2\.00/u);
    expect(line).toMatch(/migrate the auth layer/u);
  });

  it('shows an unlimited budget as unlimited rather than as $0', () => {
    const dir = stateDir();
    makeRun(dir, 'run-1', { budgetUsd: null });
    expect(renderRunList(listUltraRuns(dir))).toMatch(/\$0\.00\/none/u);
  });

  it('keeps every row inside the width it was given', () => {
    const dir = stateDir();
    makeRun(dir, 'run-1', { goal: 'x'.repeat(300) });
    const lines = renderRunList(listUltraRuns(dir), 80).split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it('keeps every row inside a narrow width too', () => {
    const dir = stateDir();
    makeRun(dir, 'run-1', { goal: 'a goal' });
    const lines = renderRunList(listUltraRuns(dir), 40).split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
    // The id is the handle the reader needs to act, so it is never dropped.
    expect(lines[0]).toMatch(/run-1/u);
  });

  it('names an unreadable run rather than dropping it from the list', () => {
    const dir = stateDir();
    mkdirSync(path.join(dir, 'run-broken'), { recursive: true });
    writeFileSync(path.join(dir, 'run-broken', 'state.json'), '{ not json');
    const listing = renderRunList(listUltraRuns(dir));
    expect(listing).toMatch(/run-broken/u);
    expect(listing).toMatch(/unreadable/u);
  });
});
