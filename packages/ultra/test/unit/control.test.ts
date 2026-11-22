import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearControl,
  decideControl,
  driverFromRunnerStatus,
  readControl,
  takeControl,
  writeControl,
} from '../../src/control.js';
import { RunStore } from '../../src/run-state.js';

const dirs: string[] = [];

function storeFor(): RunStore {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-control-'));
  dirs.push(dir);
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: 'run-c',
    goal: 'the goal',
    budgetUsd: 5,
  });
  store.setPackets([{ id: 'p1', title: 'one' }]);
  return store;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the control request', () => {
  it('round-trips a request through the run directory', () => {
    const store = storeFor();
    expect(readControl(store.paths)).toBeUndefined();

    const written = writeControl(store.paths, 'pause', { now: new Date('2026-11-21T10:00:00Z'), by: 4242 });
    expect(written.request).toBe('pause');
    expect(written.by).toBe(4242);
    expect(written.at).toBe('2026-11-21T10:00:00.000Z');

    const read = readControl(store.paths);
    expect(read?.request).toBe('pause');
    expect(read?.by).toBe(4242);
  });

  it('is gone after it has been read, so a resume does not pause itself', () => {
    const store = storeFor();
    writeControl(store.paths, 'pause');
    clearControl(store.paths);
    expect(readControl(store.paths)).toBeUndefined();
  });

  it('is consumed by the driver that read it', () => {
    const store = storeFor();
    writeControl(store.paths, 'pause');

    // The driver reads the request at its next safe point. It must not see it
    // again: a request that survived would stop the *next* pass before it
    // began, which is how a paused run could never be continued.
    expect(takeControl(store.paths)).toBe('pause');
    expect(readControl(store.paths)).toBeUndefined();
    expect(takeControl(store.paths)).toBeUndefined();
  });

  it('ignores a file that is not a request, so a corrupt file cannot stop a run', () => {
    const store = storeFor();
    // A request that is not one of the two known words, and one that is not a
    // record at all, must both read as "no request".
    writeControl(store.paths, 'stop' as never);
    expect(readControl(store.paths)).toBeUndefined();
  });
});

describe('deciding what a stop request means', () => {
  it('refuses to stop a run that already has a verdict', () => {
    // Stopping a finished run would rewrite its result: a report that says
    // `killed` about work that succeeded is a lie.
    for (const status of ['succeeded', 'partial', 'failed', 'stalled'] as const) {
      const decision = decideControl({ request: 'kill', runStatus: status, driver: 'dead' });
      expect(decision.apply).toBe(false);
      expect(decision.request).toBe(false);
      expect(decision.refusal).toContain(status);
    }
  });

  it('leaves the state to a live driver and only asks it to stop', () => {
    // The driver owns the run's state file. A second process writing that file
    // would have its change overwritten by the driver's next save.
    const decision = decideControl({ request: 'pause', runStatus: 'running', driver: 'live' });
    expect(decision.request).toBe(true);
    expect(decision.apply).toBe(false);
    expect(decision.refusal).toBeUndefined();
  });

  it('applies the change itself when nothing is driving the run', () => {
    // Nobody will read the request, and a leftover request would pause the
    // next resume before it started.
    const decision = decideControl({ request: 'pause', runStatus: 'running', driver: 'dead' });
    expect(decision.request).toBe(false);
    expect(decision.apply).toBe(true);
  });

  it('does both for a foreground run, whose driver may or may not be alive', () => {
    const decision = decideControl({ request: 'pause', runStatus: 'running', driver: 'unknown' });
    expect(decision.request).toBe(true);
    expect(decision.apply).toBe(true);
  });

  it('refuses a request the run already satisfies', () => {
    // A run that is already paused has nothing to pause, and a run that is
    // already killed has nothing to kill.
    const paused = decideControl({ request: 'pause', runStatus: 'paused', driver: 'dead' });
    expect(paused.refusal).toBe('run is already paused');
    expect(paused.apply).toBe(false);

    const killed = decideControl({ request: 'kill', runStatus: 'killed', driver: 'dead' });
    expect(killed.refusal).toBe('run is already killed');
    expect(killed.apply).toBe(false);
  });

  it('refuses to pause a run that was already stopped', () => {
    // A killed run stays killed. Relabelling it `paused` would make the state
    // disagree with the report that was written from it, and would make a
    // stopped run look like it was waiting to be continued.
    const decision = decideControl({ request: 'pause', runStatus: 'killed', driver: 'dead' });
    expect(decision.apply).toBe(false);
    expect(decision.request).toBe(false);
    expect(decision.refusal).toMatch(/already stopped/iu);
  });
});

describe('reading the driver from a runner classification', () => {
  it('maps a live runner to a live driver and a finished one to a dead one', () => {
    expect(driverFromRunnerStatus('running')).toBe('live');
    expect(driverFromRunnerStatus('finished')).toBe('dead');
    expect(driverFromRunnerStatus('failed')).toBe('dead');
    expect(driverFromRunnerStatus('interrupted')).toBe('dead');
    // No runner record means the run was started in the foreground.
    expect(driverFromRunnerStatus('foreground')).toBe('unknown');
  });
});
