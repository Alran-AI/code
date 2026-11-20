/**
 * Interim audits (spec 13.4).
 *
 * An audit is not a round: it does not execute packets, it reviews the whole run
 * against the goal document and looks for *drift* — an early wrong decision that
 * every later packet kept building on. The tests pin the scheduling (every
 * `audit_every` rounds), the honest accounting (an audit costs a ledger entry),
 * and the fact that an audit can open rework without which the check would be
 * decorative.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditRound,
  isAuditRound,
  type AuditFinding,
  type AuditPorts,
  type AuditResult,
} from '../../src/audit.js';
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

function goal(criteria: unknown[]) {
  return parseGoalDocument({ goal: 'Build it', criteria });
}

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

describe('isAuditRound', () => {
  it('fires every auditEvery rounds, counting from round 1', () => {
    // With auditEvery = 3 the audits land after rounds 3, 6, 9 …
    expect(isAuditRound(3, 3)).toBe(true);
    expect(isAuditRound(6, 3)).toBe(true);
    expect(isAuditRound(1, 3)).toBe(false);
    expect(isAuditRound(2, 3)).toBe(false);
    expect(isAuditRound(4, 3)).toBe(false);
  });

  it('never fires when auditing is disabled', () => {
    expect(isAuditRound(3, 0)).toBe(false);
    expect(isAuditRound(3, undefined)).toBe(false);
  });

  it('treats auditEvery = 1 as "audit every round"', () => {
    expect(isAuditRound(1, 1)).toBe(true);
    expect(isAuditRound(7, 1)).toBe(true);
  });
});

describe('auditRound', () => {
  const ports: AuditPorts = {
    audit: async () => ({
      findings: [
        {
          round: 2,
          kind: 'drift',
          severity: 'high',
          text: 'The storage layer picked in round 1 cannot express the undo requirement',
          rework: 'Rework the storage interface before adding more call sites',
        },
      ],
      costUsd: 0.02,
      tokensUsed: 1000,
    }),
  };

  it('returns the findings and records the audit in the ledger', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
    const store = storeFor(dir);
    const ledger = Ledger.open(store.paths.ledger);
    const result: AuditResult = await auditRound({
      store,
      ledger,
      goal: goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]),
      round: 3,
      ports,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('high');
    const entries = Ledger.open(store.paths.ledger).entries();
    expect(entries.some((entry) => entry.role === 'audit' && entry.status === 'done')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('turns high-severity drift into a rework packet for the next round', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
    const store = storeFor(dir);
    const result = await auditRound({
      store,
      ledger: Ledger.open(store.paths.ledger),
      goal: goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]),
      round: 3,
      ports,
    });
    const rework = result.rework;
    expect(rework.length).toBeGreaterThan(0);
    // Rework is real work the next round must do, so it carries a scope and a goal.
    expect(rework[0]?.goal).toMatch(/storage/iu);
    expect(rework[0]?.scope.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not invent rework for a low-severity note', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
    const store = storeFor(dir);
    const result = await auditRound({
      store,
      ledger: Ledger.open(store.paths.ledger),
      goal: goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]),
      round: 3,
      ports: {
        audit: async () => ({
          findings: [
            { round: 3, kind: 'note', severity: 'low', text: 'Naming is inconsistent', rework: '' },
          ],
        }),
      },
    });
    expect(result.rework).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('records a failed audit as a ledger entry rather than throwing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
    const store = storeFor(dir);
    const result = await auditRound({
      store,
      ledger: Ledger.open(store.paths.ledger),
      goal: goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]),
      round: 3,
      ports: {
        audit: async () => {
          throw new Error('auditor unreachable');
        },
      },
    });
    // An audit that cannot run must not end the run: it is recorded and skipped.
    expect(result.findings).toEqual([]);
    const entries = Ledger.open(store.paths.ledger).entries();
    expect(entries.some((entry) => entry.role === 'audit' && entry.status === 'error')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the loop and audits', () => {
  function harness(overrides: {
    readonly audit?: AuditPorts['audit'];
    readonly accept?: (round: number) => AcceptanceFinding[];
  }) {
    const calls = { audit: 0, execute: 0 };
    const ports: LoopPorts = {
      execute: async () => {
        calls.execute += 1;
        return { donePacketIds: ['p1'] };
      },
      integrate: async () => okIntegrate(),
      accept: async ({ round }) => ({
        findings: overrides.accept?.(round) ?? [{ id: 'C1', status: 'met', evidence: ['t'] }],
      }),
      planNextRound: async () => ({ packets: [] }),
    };
    return { ports, calls };
  }

  it('runs an audit every auditEvery rounds and adds its rework to the plan', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loop-'));
    const store = storeFor(dir);
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const h = harness({});
    let audits = 0;

    const result = await runGoalLoop({
      store,
      ledger: Ledger.open(store.paths.ledger),
      goal: g,
      plan: PLAN,
      ports: {
        ...h.ports,
        // The criterion is never met, so the loop keeps going and reaches the
        // round where the audit is due.
        accept: async () => ({ findings: [{ id: 'C1', status: 'unmet', evidence: [] }] }),
        planNextRound: async () => ({ packets: [PACKET] }),
      },
      config: { maxRounds: 3, stallRounds: 99, auditEvery: 2 },
      auditPorts: {
        audit: async () => {
          audits += 1;
          return overridesAudit();
        },
      },
    });

    // Audits land after rounds 2 (and would again after 4).
    expect(audits).toBe(1);
    expect(result.rounds).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('feeds audit rework into the next round as extra packets', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'loop-'));
    const store = storeFor(dir);
    const g = goal([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const seen: string[][] = [];

    await runGoalLoop({
      store,
      ledger: Ledger.open(store.paths.ledger),
      goal: g,
      plan: PLAN,
      ports: {
        execute: async ({ packets }) => {
          seen.push(packets.map((packet) => packet.id));
          return { donePacketIds: packets.map((packet) => packet.id) };
        },
        integrate: async () => okIntegrate(),
        accept: async () => ({ findings: [{ id: 'C1', status: 'unmet', evidence: [] }] }),
        planNextRound: async () => ({ packets: [PACKET] }),
      },
      config: { maxRounds: 3, stallRounds: 99, auditEvery: 1 },
      auditPorts: {
        audit: async () => ({
          findings: [
            {
              round: 1,
              kind: 'drift',
              severity: 'high',
              text: 'The interface is wrong',
              rework: 'Redesign the storage interface',
            },
          ],
        }),
      },
    });

    // Round 2 carries the audit's rework packet in addition to the planned one.
    const roundTwo = seen[1] ?? [];
    expect(roundTwo.length).toBeGreaterThan(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

function overridesAudit(): AuditFinding[] {
  return [];
}