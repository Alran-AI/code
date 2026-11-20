/**
 * The outer loop (spec 13.3, ULT-14, ULT-16, ULT-17, ULT-19, ULT-20).
 *
 * A single green round is not success. These tests pin the loop's stop
 * conditions and the ones that must not fire: green gates with an unmet `must`
 * criterion start another round rather than ending `succeeded` (ULT-14),
 * stagnation ends `stalled` (ULT-16), a regression is reported and reprioritised
 * (ULT-17), and an open `needs_human` `must` ends `partial` (ULT-20).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runGoalLoop, type LoopPorts } from '../../src/loop.js';
import { parseGoalDocument, type AcceptanceFinding } from '../../src/goal.js';
import { Ledger } from '../../src/ledger.js';
import { RunStore } from '../../src/run-state.js';
import type { IntegrateResult } from '../../src/integrate.js';
import type { PlanPacket, UltraPlan } from '../../src/types.js';

const PACKET: PlanPacket = {
  id: 'p1',
  title: 'P1',
  goal: 'g',
  scope: ['src/**'],
  depends_on: [],
  criteria: ['C1'],
  accept: [{ cmd: 'true' }],
};

const PLAN: UltraPlan = { goal: 'Build it', recipe: 'auto', packets: [PACKET] };

function okIntegrate(): IntegrateResult {
  return {
    runStatus: 'partial',
    packets: [{ id: 'p1', title: 'P1', status: 'merged' }],
    gate: { ok: true, commands: [{ cmd: 'true', exitCode: 0, output: '' }] },
    review: { ok: true, problems: [] },
    diff: '',
    costUsd: 0,
  };
}

function goal(criteria: unknown[]) {
  return parseGoalDocument({ goal: 'Build it', criteria });
}

function harness(overrides: {
  readonly accept?: (round: number) => AcceptanceFinding[];
  readonly planNext?: (round: number) => PlanPacket[];
  readonly integrate?: (round: number) => IntegrateResult;
} = {}) {
  const calls = { execute: 0, integrate: 0, accept: 0, planNext: 0 };
  const ports: LoopPorts = {
    execute: async () => {
      calls.execute += 1;
      return { donePacketIds: ['p1'] };
    },
    integrate: async ({ round }) => {
      calls.integrate += 1;
      return overrides.integrate?.(round) ?? okIntegrate();
    },
    accept: async ({ round }) => {
      calls.accept += 1;
      return { findings: overrides.accept?.(round) ?? [{ id: 'C1', status: 'met', evidence: ['t'] }] };
    },
    planNextRound: async ({ round }) => {
      calls.planNext += 1;
      const packets = overrides.planNext?.(round) ?? [];
      return { packets };
    },
  };
  return { ports, calls };
}

function storeFor(dir: string) {
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: 'r1',
    goal: 'Build it',
    budgetUsd: 10,
  });
  store.setPackets([{ id: 'p1', title: 'P1' }]);
  store.transition('planning');
  return store;
}

async function run(
  goalDoc: ReturnType<typeof goal>,
  h: ReturnType<typeof harness>,
  config: { maxRounds?: number; stallRounds?: number } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'loop-'));
  const store = storeFor(dir);
  const result = await runGoalLoop({
    store,
    ledger: Ledger.open(store.paths.ledger),
    goal: goalDoc,
    plan: PLAN,
    ports: h.ports,
    config: { maxRounds: 10, stallRounds: 2, ...config },
  });
  rmSync(dir, { recursive: true, force: true });
  return { result, store };
}

describe('runGoalLoop', () => {
  it('succeeds when every must criterion is met with evidence', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness();
    const { result, store } = await run(g, h);
    expect(result.runStatus).toBe('succeeded');
    expect(result.reason).toMatch(/must criterion is met/iu);
    expect(store.state.status).toBe('succeeded');
  });

  it('starts another round when the gates are green but a must is unmet (ULT-14)', async () => {
    const g = goal([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a' },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
    ]);
    // Round 1 meets C1 only; round 2 meets both.
    const h = harness({
      accept: (round) =>
        round === 1
          ? [{ id: 'C1', status: 'met', evidence: ['t'] }]
          : [
              { id: 'C1', status: 'met', evidence: ['t'] },
              { id: 'C2', status: 'met', evidence: ['t'] },
            ],
      planNext: () => [PACKET],
    });
    const { result } = await run(g, h);

    // Green gates in round 1 did not end the run.
    expect(result.runStatus).toBe('succeeded');
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.integrate.gate.ok).toBe(true);
  });

  it('ends stalled when no criterion improves for stallRounds rounds (ULT-16)', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness({
      // Never met: nothing ever improves.
      accept: () => [{ id: 'C1', status: 'unmet', evidence: [] }],
      planNext: () => [PACKET],
    });
    const { result, store } = await run(g, h, { stallRounds: 2 });

    expect(result.runStatus).toBe('stalled');
    expect(result.reason).toMatch(/no criterion improved for 2 round/iu);
    expect(store.state.status).toBe('stalled');
    expect(result.rounds).toHaveLength(2);
  });

  it('reports a regression and plans it first next round (ULT-17)', async () => {
    const g = goal([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a', status: 'met', evidence: ['t'] },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
    ]);
    const h = harness({
      // Round 1: C1 regresses, C2 gets done.
      accept: (round) =>
        round === 1
          ? [
              { id: 'C1', status: 'unmet', evidence: [] },
              { id: 'C2', status: 'met', evidence: ['t'] },
            ]
          : [
              { id: 'C1', status: 'met', evidence: ['t'] },
              { id: 'C2', status: 'met', evidence: ['t'] },
            ],
      planNext: () => [PACKET],
    });
    const { result } = await run(g, h);

    expect(result.rounds[0]?.improved).toBe(false);
    // The regression is visible in the final document.
    expect(g.criteria.find((c) => c.id === 'C1')?.status).toBe('met');
    expect(result.runStatus).toBe('succeeded');
  });

  it('ends partial when an open needs_human must criterion remains (ULT-20)', async () => {
    const g = goal([
      { id: 'C1', priority: 'must', verification: 'manual', description: 'feels right' },
    ]);
    const h = harness({
      accept: () => [{ id: 'C1', status: 'needs_human', evidence: [] }],
      planNext: () => [],
    });
    const { result, store } = await run(g, h);

    expect(result.runStatus).toBe('partial');
    expect(store.state.status).toBe('partial');
    expect(result.reason).toMatch(/needs_human/iu);
  });

  it('stops failed when integrate fails, without planning another round', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness({
      integrate: () => ({
        runStatus: 'failed',
        packets: [],
        gate: { ok: false, commands: [{ cmd: 'true', exitCode: 1, output: 'boom' }] },
        review: { ok: true, problems: [] },
        diff: '',
        costUsd: 0,
      }),
    });
    const { result } = await run(g, h);
    expect(result.runStatus).toBe('failed');
    expect(result.rounds).toHaveLength(1);
  });

  it('stops partial at the round cap with work outstanding', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness({
      accept: () => [{ id: 'C1', status: 'partial', evidence: [] }],
      planNext: () => [PACKET],
    });
    const { result } = await run(g, h, { maxRounds: 3, stallRounds: 99 });
    expect(result.runStatus).toBe('partial');
    expect(result.reason).toMatch(/round cap of 3/iu);
    expect(result.rounds).toHaveLength(3);
  });

  it('stops partial when the planner cannot turn the open criteria into packets', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness({
      accept: () => [{ id: 'C1', status: 'unmet', evidence: [] }],
      planNext: () => [],
    });
    const { result } = await run(g, h, { stallRounds: 99 });
    expect(result.runStatus).toBe('partial');
    expect(result.reason).toMatch(/no further packets/iu);
  });

  it('round 1 is resumable: a crash at any phase boundary replays the ledger (ULT-19)', async () => {
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const dir = mkdtempSync(path.join(tmpdir(), 'loop-'));
    const store = storeFor(dir);
    const ledger = Ledger.open(store.paths.ledger);

    // Simulate a crash mid-round: execute ran, integrate did not.
    const ports: LoopPorts = {
      execute: async () => {
        ledger.append({ kind: 'packet', packetId: 'p1', status: 'done', role: 'scheduler' });
        return { donePacketIds: ['p1'] };
      },
      integrate: async () => {
        throw new Error('process died here');
      },
      accept: async () => ({ findings: [] }),
      planNextRound: async () => ({ packets: [] }),
    };

    await expect(
      runGoalLoop({ store, ledger, goal: g, plan: PLAN, ports, config: { maxRounds: 3, stallRounds: 2 } }),
    ).rejects.toThrow(/process died/iu);

    // The ledger survived the crash and still records the finished packet.
    const replayed = Ledger.open(store.paths.ledger);
    expect(replayed.finishedPacketIds().has('p1')).toBe(true);
    // The run is still resumable: execute is not terminal.
    expect(store.resumablePacketIds()).toContain('p1');
    rmSync(dir, { recursive: true, force: true });
  });
});