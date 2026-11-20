/**
 * Report generation (spec 3.7, ULT-12).
 *
 * The report is the artifact the human reads, so the tests pin the two things
 * that must not drift: the cost is the arithmetic sum of the ledger entries, and
 * every unfinished item is named with its reason. They also pin that the merge
 * instruction names the run branch, never `main`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report.js';
import { Ledger } from '../../src/ledger.js';
import { RunStore } from '../../src/run-state.js';
import { parseGoalDocument } from '../../src/goal.js';
import type { IntegrateResult } from '../../src/integrate.js';

function storeWithLedger(dir: string): { store: RunStore; ledger: Ledger } {
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: 'run-1',
    goal: 'Build the widget',
    budgetUsd: 2,
  });
  store.setPackets([
    { id: 'p1', title: 'Types' },
    { id: 'p2', title: 'Calls' },
  ]);
  const ledger = Ledger.open(store.paths.ledger);
  return { store, ledger };
}

describe('buildReport', () => {
  it('reports the cost as the arithmetic sum of the ledger entries (ULT-12)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    ledger.append({ kind: 'step', role: 'worker', packetId: 'p1', costUsd: 0.25, tokensUsed: 1000 });
    ledger.append({ kind: 'step', role: 'verifier', packetId: 'p1', costUsd: 0.1, tokensUsed: 500 });
    ledger.append({ kind: 'step', role: 'worker', packetId: 'p2', costUsd: 0.4, tokensUsed: 2000 });

    const text = buildReport({ state: store.state, ledger });

    // The number in the report is the same arithmetic the budget enforced.
    const expected = ledger.totalCostUsd();
    expect(expected).toBeCloseTo(0.75, 10);
    expect(text).toContain(`Spent: $${expected.toFixed(2)}`);
    expect(text).toContain(`Total: $${expected.toFixed(2)}`);
    expect(text).toContain('worker');
    expect(text).toContain('verifier');
    rmSync(dir, { recursive: true, force: true });
  });

  it('says the cost is estimated from tokens unless a price was reported (ULT-12)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    ledger.append({ kind: 'step', role: 'worker', packetId: 'p1', costUsd: 0.25, tokensUsed: 25_000 });

    const text = buildReport({ state: store.state, ledger });

    // `alran exec` reports tokens, not dollars, so every figure here is derived
    // from the declared token→USD constant. A report that presented it as a
    // billed amount would be claiming a precision it does not have.
    expect(text).toContain('estimated from token counts');
    expect(text).toContain('100000 tokens per USD');
    rmSync(dir, { recursive: true, force: true });
  });

  it('names every blocked and skipped packet with its reason', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    store.setPackets([
      { id: 'p1', title: 'Types', status: 'done' },
      { id: 'p2', title: 'Calls', status: 'blocked' },
    ]);
    store.state.packets.find((entry) => entry.id === 'p2')!.reason = 'gate failed after 2 repair(s): 3 failing';

    const text = buildReport({ state: store.state, ledger });

    expect(text).toContain('## Not finished');
    expect(text).toContain('p2');
    expect(text).toContain('gate failed after 2 repair(s)');
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the merge command for the run branch and never for main', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    const text = buildReport({ state: store.state, ledger });
    expect(text).toContain('git merge ultra/run-1');
    expect(text).not.toMatch(/git merge main/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows the criteria table and gate evidence for a goal-driven run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    const goal = parseGoalDocument({
      goal: 'Build the widget',
      criteria: [
        { id: 'C1', priority: 'must', verification: 'scenario', description: 'Layers work', status: 'met', evidence: ['shot.png'] },
        { id: 'C2', priority: 'should', verification: 'command', description: 'Export works', status: 'unmet' },
      ],
    });
    const integrate: IntegrateResult = {
      runStatus: 'partial',
      packets: [
        { id: 'p1', title: 'Types', status: 'merged' },
        { id: 'p2', title: 'Calls', status: 'unmerged', reason: 'merge conflict in src/b.ts' },
      ],
      gate: { ok: false, commands: [{ cmd: 'pnpm test', exitCode: 1, output: '2 failing\nexpected true' }] },
      review: { ok: false, problems: ['p1 and p2 disagree'] },
      diff: '',
      costUsd: 0,
    };

    const text = buildReport({ state: store.state, ledger, goal, integrate });

    expect(text).toContain('## Criteria');
    expect(text).toContain('1/2 met');
    expect(text).toContain('## Full-suite gate');
    expect(text).toContain('pnpm test');
    expect(text).toContain('2 failing');
    expect(text).toContain('## Final review');
    expect(text).toContain('p1 and p2 disagree');
    expect(text).toContain('merge conflict in src/b.ts');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a killed run as killed, not as its last internal status', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    const text = buildReport({ state: store.state, ledger, killed: true });
    expect(text).toContain('Result: **killed**');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports per-round cost when the run looped', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rep-'));
    const { store, ledger } = storeWithLedger(dir);
    const text = buildReport({
      state: store.state,
      ledger,
      rounds: [
        { round: 1, costUsd: 0.5, result: 'partial' },
        { round: 2, costUsd: 0.25, result: 'partial' },
      ],
    });
    expect(text).toContain('## Cost by round');
    expect(text).toContain('$0.50');
    expect(text).toContain('$0.25');
    rmSync(dir, { recursive: true, force: true });
  });
});