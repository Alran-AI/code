/**
 * INTEGRATE (spec §3.6, build step 5).
 *
 * Integrate is the only step allowed to call a run `succeeded`, so these tests
 * pin both halves of that claim: the state-machine guard (a run can only be
 * succeeded from `integrating`) and a static scan proving no other module writes
 * that status. They also pin the honest failure modes — a conflicted merge, a
 * failing full suite, a failed final review — each of which must end `partial`
 * or `failed` rather than quietly claiming success.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIntegrate, type IntegratePorts } from '../../src/integrate.js';
import { Ledger } from '../../src/ledger.js';
import { RunStore } from '../../src/run-state.js';
import type { GateResult, ReviewVerdict, UltraPlan } from '../../src/types.js';

const PLAN: UltraPlan = {
  goal: 'Build the widget',
  recipe: 'auto',
  packets: [
    { id: 'p1', title: 'Types', goal: 'g1', scope: ['src/a/**'], depends_on: [] },
    { id: 'p2', title: 'Calls', goal: 'g2', scope: ['src/b/**'], depends_on: ['p1'] },
    { id: 'p3', title: 'Docs', goal: 'g3', scope: ['docs/**'], depends_on: [] },
  ],
  gates: { test: ['pnpm test'], lint: [], build: [] },
};

interface Harness {
  readonly ports: IntegratePorts;
  readonly merged: string[];
  readonly aborted: string[];
  readonly tags: string[];
}

interface HarnessOptions {
  /** Which packet branches merge cleanly; anything else reports a conflict. */
  readonly conflict?: (packetId: string) => boolean;
  readonly gate?: GateResult;
  readonly review?: ReviewVerdict;
  /** Which packet ids are `done` in the store (the rest stay blocked). */
  readonly done?: readonly string[];
}

function harness(store: RunStore, options: HarnessOptions = {}): Harness {
  const merged: string[] = [];
  const aborted: string[] = [];
  const tags: string[] = [];
  const done = new Set(options.done ?? ['p1', 'p2', 'p3']);
  const gate: GateResult = options.gate ?? {
    ok: true,
    commands: [{ cmd: 'pnpm test', exitCode: 0, output: 'all green' }],
  };
  const ports: IntegratePorts = {
    git: {
      createRunBranch: async () => {},
      merge: async (input) => {
        merged.push(input.packetBranch);
        if (options.conflict?.(input.packetId) ?? false) {
          return { ok: false, conflicts: [`src/${input.packetId}/a.ts`], output: 'CONFLICT' };
        }
        return { ok: true, conflicts: [], output: 'merged' };
      },
      abortMerge: async (input) => {
        aborted.push(input.runId);
      },
      diff: async () =>
        'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
      tag: async (input) => {
        tags.push(input.tag);
      },
    },
    gates: { run: async () => gate },
    review: {
      review: async () => options.review ?? { ok: true, problems: [], costUsd: 0.01, tokensUsed: 10 },
    },
  };
  void done;
  return { ports, merged, aborted, tags };
}

function storeFor(dir: string, done: readonly string[] = ['p1', 'p2', 'p3']): RunStore {
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: 'r1',
    goal: 'Build the widget',
    budgetUsd: 10,
  });
  store.setPackets([
    { id: 'p1', title: 'Types', status: 'done' },
    { id: 'p2', title: 'Calls', status: done.includes('p2') ? 'done' : 'blocked' },
    { id: 'p3', title: 'Docs', status: 'done' },
  ]);
  store.transition('running');
  return store;
}

function integrate(store: RunStore, h: Harness, plan: UltraPlan = PLAN) {
  return runIntegrate({
    plan,
    ports: h.ports,
    store,
    ledger: Ledger.open(store.paths.ledger),
    config: { baseRef: 'HEAD', runBranch: 'ultra/r1', reviewModel: 'm' },
  });
}

describe('integrate', () => {
  it('merges done packets in dependency order and sets succeeded only from integrating', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store);
    const result = await integrate(store, h);

    // A dependency must land before the packet that builds on it. Independent
    // packets (p1 and p3) may come in either order, so only the edge is pinned.
    expect(h.merged.indexOf('ultra/r1/p1')).toBeLessThan(h.merged.indexOf('ultra/r1/p2'));
    expect(h.merged).toHaveLength(3);
    expect(result.runStatus).toBe('succeeded');
    expect(store.state.status).toBe('succeeded');
  });

  it('never merges a packet that is not done', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir, ['p1', 'p3']);
    const h = harness(store);
    const result = await integrate(store, h);

    expect(h.merged).not.toContain('ultra/r1/p2');
    expect(result.runStatus).toBe('partial');
    expect(result.packets.find((entry) => entry.id === 'p2')?.status).toBe('skipped');
    // The report names the scheduler's reason, not a generic placeholder.
    expect(result.packets.find((entry) => entry.id === 'p2')?.reason).toMatch(/blocked/iu);
  });

  it('aborts the merge and ends partial when a packet branch conflicts', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store, { conflict: (id) => id === 'p2' });
    const result = await integrate(store, h);

    expect(h.aborted).toEqual(['r1']);
    expect(result.runStatus).toBe('partial');
    expect(result.packets.find((entry) => entry.id === 'p2')?.status).toBe('unmerged');
    expect(store.state.status).toBe('partial');
  });

  it('fails the run when the full suite fails, and keeps the gate evidence', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store, {
      gate: { ok: false, commands: [{ cmd: 'pnpm test', exitCode: 1, output: '3 failing' }] },
    });
    const result = await integrate(store, h);

    expect(result.runStatus).toBe('failed');
    expect(result.gate.ok).toBe(false);
    expect(result.gate.commands[0]?.output).toMatch(/3 failing/u);
    expect(store.state.status).toBe('failed');
  });

  it('fails closed when the project has no full-suite gate commands', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store);
    const plan: UltraPlan = { goal: 'g', recipe: 'auto', packets: PLAN.packets, gates: { test: [], lint: [], build: [] } };
    const result = await integrate(store, h, plan);

    expect(result.runStatus).toBe('failed');
    expect(result.gate.ok).toBe(false);
  });

  it('ends partial, not succeeded, when the final review rejects the combined diff', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store, { review: { ok: false, problems: ['p1 and p3 disagree on the type'] } });
    const result = await integrate(store, h);

    expect(result.runStatus).toBe('partial');
    expect(result.review.problems).toContain('p1 and p3 disagree on the type');
    expect(store.state.status).toBe('partial');
  });

  it('records the merge order and the review in the ledger', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store);
    await integrate(store, h);

    const entries = Ledger.open(store.paths.ledger).entries();
    const merges = entries.filter((entry) => entry.status === 'merged').map((entry) => entry.packetId);
    expect(merges).toHaveLength(3);
    expect(merges.indexOf('p1')).toBeLessThan(merges.indexOf('p2'));
    expect(entries.some((entry) => entry.role === 'review')).toBe(true);
  });

  it('tags the round checkpoint after a successful integrate', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = storeFor(dir);
    const h = harness(store);
    await integrate(store, h);
    expect(h.tags.some((tag) => tag.includes('r1'))).toBe(true);
  });
});

describe('only integrate may set succeeded', () => {
  it('has no transition to succeeded outside integrate.ts (static scan)', () => {
    const srcDir = path.join(process.cwd(), 'packages', 'ultra', 'src');
    // Enumerated, not hardcoded: a new module that sets `succeeded` must be
    // caught, and a module added later must not silently escape the scan.
    const files = readdirSync(srcDir)
      .filter((file) => file.endsWith('.ts'))
      .sort();
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(srcDir, file), 'utf8');
      if (/transition\(\s*['"]succeeded['"]/u.test(source) && file !== 'integrate.ts') {
        offenders.push(file);
      }
    }
    expect(files).toContain('integrate.ts');
    expect(offenders).toEqual([]);
  });

  it('refuses running -> succeeded at the state layer (runtime assertion)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'int-'));
    const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
      runId: 'r2',
      goal: 'g',
      budgetUsd: 1,
    });
    store.transition('planning');
    expect(() => store.transition('succeeded')).toThrow(/only by INTEGRATE\/ACCEPT/iu);
    rmSync(dir, { recursive: true, force: true });
  });
});