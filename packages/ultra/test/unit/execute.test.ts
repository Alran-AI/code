import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runExecute, type ExecutePorts, type ExecuteRunResult } from '../../src/execute.js';
import { createFileEvidenceWriter } from '../../src/evidence.js';
import { Ledger } from '../../src/ledger.js';
import { RunStore } from '../../src/run-state.js';
import type {
  AcceptanceCommand,
  GateResult,
  PlanPacket,
  UltraPlan,
  WorkerOutcome,
} from '../../src/types.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-exec-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function packet(over: Partial<PlanPacket> & Pick<PlanPacket, 'id'>): PlanPacket {
  return {
    id: over.id,
    title: over.title ?? over.id,
    goal: over.goal ?? `do ${over.id}`,
    scope: over.scope ?? [`src/${over.id}/**`],
    readonly: over.readonly,
    depends_on: over.depends_on ?? [],
    accept: over.accept ?? [{ cmd: `test ${over.id}` }],
    max_repairs: over.max_repairs,
    est_tokens: over.est_tokens,
  };
}

function plan(packets: readonly PlanPacket[]): UltraPlan {
  return { goal: 'the goal', recipe: 'auto', packets };
}

interface Harness {
  readonly ports: ExecutePorts;
  readonly log: string[];
  readonly created: string[];
  readonly resets: string[];
  readonly gates: string[];
  readonly diffs: string[];
  readonly verdicts: string[];
  readonly order: string[];
  /** The recipe each verifier call received, in order. */
  readonly verifierRecipes: (UltraPlan['recipe'] | undefined)[];
}

interface HarnessOptions {
  readonly worker?: (packetId: string, attempt: number) => WorkerOutcome;
  readonly gate?: (packetId: string, attempt: number) => GateResult;
  readonly changedFiles?: (packetId: string, attempt: number) => readonly string[];
  readonly diff?: (packetId: string, attempt: number) => string;
  readonly verdict?: (
    packetId: string,
  ) => { pass: boolean; reasons: readonly string[]; rateLimited?: boolean };
}

function harness(store: RunStore, options: HarnessOptions = {}): Harness {
  const log: string[] = [];
  const created: string[] = [];
  const resets: string[] = [];
  const gates: string[] = [];
  const diffs: string[] = [];
  const verdicts: string[] = [];
  const verifierRecipes: (UltraPlan['recipe'] | undefined)[] = [];
  const order: string[] = [];
  const attempts = new Map<string, number>();

  const attemptOf = (id: string): number => {
    const next = attempts.get(id) ?? 0;
    attempts.set(id, next + 1);
    return next;
  };

  const okGate: GateResult = { ok: true, commands: [{ cmd: 'ok', exitCode: 0, output: 'green' }] };

  const ports: ExecutePorts = {
    worktree: {
      create: async (input) => {
        created.push(input.packetId);
        log.push(`worktree.create:${input.packetId}:${input.branch}`);
        return { dir: `/tmp/wt/${input.packetId}` };
      },
      reset: async (input) => {
        resets.push(input.packetId);
        log.push(`worktree.reset:${input.packetId}`);
      },
      remove: async (input) => {
        log.push(`worktree.remove:${input.packetId}`);
      },
      diff: async (input) => {
        diffs.push(input.packetId);
        const attempt = Math.max(0, (attempts.get(input.packetId) ?? 1) - 1);
        return options.diff?.(input.packetId, attempt) ?? '';
      },
      changedFiles: async (input) => {
        const attempt = Math.max(0, (attempts.get(input.packetId) ?? 1) - 1);
        return options.changedFiles?.(input.packetId, attempt) ?? [`src/${input.packetId}/x.ts`];
      },
    },
    worker: {
      run: async (input) => {
        const id = input.packet.id;
        order.push(id);
        const attempt = attemptOf(id);
        log.push(`worker:${id}:${attempt}`);
        return (
          options.worker?.(id, attempt) ?? {
            ok: true,
            summary: 'done',
            costUsd: 0.01,
            tokensUsed: 100,
          }
        );
      },
    },
    gate: {
      run: async (input) => {
        const id = input.packet.id;
        gates.push(id);
        const attempt = Math.max(0, (attempts.get(id) ?? 1) - 1);
        log.push(`gate:${id}:${attempt}`);
        return options.gate?.(id, attempt) ?? okGate;
      },
    },
    verifier: {
      verify: async (input) => {
        verdicts.push(input.packet.id);
        verifierRecipes.push(input.recipe);
        log.push(`verifier:${input.packet.id}`);
        return options.verdict?.(input.packet.id) ?? { pass: true, reasons: [], costUsd: 0.02 };
      },
    },
    store,
    ledger: Ledger.open(store.paths.ledger),
    evidence: ultraEvidence(store),
  };
  return { ports, log, created, resets, gates, diffs, verdicts, verifierRecipes, order };
}

function storeFor(packets: readonly PlanPacket[]): RunStore {
  const store = RunStore.create(path.join(tempDir(), '.alran', 'ultra'), {
    runId: 'run-x',
    goal: 'the goal',
    budgetUsd: 10,
  });
  store.setPackets(packets.map((entry) => ({ id: entry.id, title: entry.title })));
  store.transition('running');
  return store;
}

const config = {
  workers: 4,
  maxRepairs: 2,
  workerModel: 'alran/Alran-Werk',
  verifierModel: 'alran/Alran-Werk',
};

function statusOf(store: RunStore, id: string): string {
  return store.state.packets.find((entry) => entry.id === id)?.status ?? 'missing';
}

/** Real evidence writer on a temp dir, so the evidence assertions read real files. */
function ultraEvidence(store: RunStore): ExecutePorts['evidence'] {
  return createFileEvidenceWriter(store.paths.packets);
}

// ULT-01: the worker's own claim counts for nothing; only the gate decides.
describe('ULT-01 gate decides, not the worker', () => {
  it('never marks a packet done when the worker claims success but the gate fails', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store, {
      worker: () => ({ ok: true, summary: 'all tests pass, trust me' }),
      gate: () => ({
        ok: false,
        commands: [{ cmd: 'test p1', exitCode: 1, output: '1 failing test' }],
      }),
      // Even a passing verifier cannot rescue a failing gate.
      verdict: () => ({ pass: true, reasons: [] }),
    });
    const result = await runExecute({ plan: plan([packet({ id: 'p1' })]), ports: h.ports, config });

    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('blocked');
    // The verifier must never run on a packet whose gate failed.
    expect(h.verdicts).toEqual([]);
  });

  it('exhausts max-repairs and then blocks, all while the worker keeps claiming success', async () => {
    const store = storeFor([packet({ id: 'p1', max_repairs: 2 })]);
    const h = harness(store, {
      worker: () => ({ ok: true, summary: 'done!' }),
      gate: () => ({ ok: false, commands: [{ cmd: 'test p1', exitCode: 1, output: 'red' }] }),
    });
    await runExecute({ plan: plan([packet({ id: 'p1' })]), ports: h.ports, config });

    // 1 initial attempt + 2 repairs.
    expect(h.log.filter((line) => line.startsWith('worker:p1'))).toHaveLength(3);
    expect(statusOf(store, 'p1')).toBe('blocked');
  });
});

// ULT-02: scope enforcement resets the worktree and restarts with a violation note.
describe('ULT-02 scope enforcement', () => {
  it('rejects an out-of-scope change, resets the worktree and restarts', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/p1/**'] })]);
    const h = harness(store, {
      changedFiles: (_id, attempt) =>
        attempt === 0 ? ['src/p1/a.ts', 'src/other/b.ts'] : ['src/p1/a.ts'],
    });
    await runExecute({ plan: plan([packet({ id: 'p1', scope: ['src/p1/**'] })]), ports: h.ports, config });

    expect(h.resets).toEqual(['p1']);
    const secondWorker = h.log.filter((line) => line.startsWith('worker:p1:'));
    expect(secondWorker).toHaveLength(2);
    expect(statusOf(store, 'p1')).toBe('done');
  });

  it('blocks when the violation repeats past max-repairs and names the reason', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/p1/**'], max_repairs: 1 })]);
    const h = harness(store, {
      changedFiles: () => ['src/other/b.ts'],
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['src/p1/**'], max_repairs: 1 })]),
      ports: h.ports,
      config,
    });
    expect(statusOf(store, 'p1')).toBe('blocked');
    const entry = result.packets.find((item) => item.id === 'p1');
    expect(entry?.reason).toMatch(/scope/iu);
  });

  it('never runs the gate after a scope violation', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/p1/**'] })]);
    const h = harness(store, { changedFiles: () => ['src/escape.ts'] });
    await runExecute({ plan: plan([packet({ id: 'p1', scope: ['src/p1/**'] })]), ports: h.ports, config });
    expect(h.gates).toEqual([]);
  });
});

// ULT-03: the verifier (and the cheap diff-guard pre-check) catch fake fixes.
describe('ULT-03 verifier catches a deleted or skipped test', () => {
  const deletedTestDiff = [
    'diff --git a/src/p1/a.test.ts b/src/p1/a.test.ts',
    'deleted file mode 100644',
    '--- a/src/p1/a.test.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    '-it("works", () => {',
    '-  expect(add(1, 2)).toBe(3);',
    '-});',
  ].join('\n');

  it('blocks a packet whose diff deletes a test, without asking the LLM', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store, { diff: () => deletedTestDiff });
    const result = await runExecute({ plan: plan([packet({ id: 'p1' })]), ports: h.ports, config });

    expect(statusOf(store, 'p1')).toBe('blocked');
    // The cheap diff-guard pre-check must reject before the LLM verifier runs.
    expect(h.verdicts).toEqual([]);
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toMatch(/test/iu);
  });

  it('blocks when the LLM verifier reports a fake fix even if the gate is green', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store, {
      diff: () =>
        [
          'diff --git a/src/p1/a.ts b/src/p1/a.ts',
          '--- a/src/p1/a.ts',
          '+++ b/src/p1/a.ts',
          '@@ -1 +1 @@',
          '-export const add = (a: number, b: number) => a + b;',
          '+export const add = (_a: number, _b: number) => 3;',
        ].join('\n'),
      verdict: () => ({
        pass: false,
        reasons: ['hard-codes the expected value 3 instead of computing the sum'],
      }),
    });
    const result = await runExecute({ plan: plan([packet({ id: 'p1' })]), ports: h.ports, config });

    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toMatch(/hard-codes/iu);
  });
});

// ULT-06: an upstream 429 lowers parallelism, backs off, and the run still completes.
describe('ULT-06 rate limit lowers parallelism and the run completes', () => {
  it('backs off after a 429 and finishes every packet', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2' }), packet({ id: 'p3' })];
    const store = storeFor(packets);
    const sleeps: number[] = [];
    let limited = 0;
    const h = harness(store, {
      worker: () => {
        // The first two worker starts hit the upstream limit.
        if (limited < 2) {
          limited += 1;
          return { ok: false, summary: 'rate limited', rateLimited: true };
        }
        return { ok: true, summary: 'done', costUsd: 0.01 };
      },
    });

    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config: { ...config, workers: 3 },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(sleeps.length).toBeGreaterThanOrEqual(2);
    // Backoff must be real (positive) and monotonic-ish, never zero.
    expect(Math.min(...sleeps)).toBeGreaterThan(0);
    expect(result.runStatus).toBe('partial');
    for (const id of ['p1', 'p2', 'p3']) expect(statusOf(store, id)).toBe('done');
    expect(result.rateLimitEvents).toBeGreaterThanOrEqual(2);
  });

  it('reports the parallelism it reduced to, never below one', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2' })];
    const store = storeFor(packets);
    const h = harness(store, {
      worker: () => ({ ok: false, summary: 'slow down', rateLimited: true }),
    });
    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config: { ...config, workers: 4, maxRepairs: 0 },
      sleep: async () => {},
    });
    expect(result.effectiveWorkers).toBeGreaterThanOrEqual(1);
    expect(result.effectiveWorkers).toBeLessThanOrEqual(4);
  });
});

// ULT-09: a blocked packet skips its dependents; independent packets continue.
describe('ULT-09 blocked packet skips dependents and the run is partial', () => {
  it('skips dependents, finishes independents, and names the cause', async () => {
    const packets = [
      packet({ id: 'p1' }),
      packet({ id: 'p2', depends_on: ['p1'] }),
      packet({ id: 'p3' }),
    ];
    const store = storeFor(packets);
    const h = harness(store, {
      gate: (id) => ({
        ok: id !== 'p1',
        commands: [{ cmd: `test ${id}`, exitCode: id === 'p1' ? 1 : 0, output: id === 'p1' ? 'boom' : 'ok' }],
      }),
    });

    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config: { ...config, maxRepairs: 0 },
    });

    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(statusOf(store, 'p2')).toBe('skipped');
    expect(statusOf(store, 'p3')).toBe('done');
    expect(result.runStatus).toBe('partial');
    const skipped = result.packets.find((entry) => entry.id === 'p2');
    expect(skipped?.reason).toMatch(/dependenc/iu);
  });

  it('never starts a worker for a skipped packet', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2', depends_on: ['p1'] })];
    const store = storeFor(packets);
    const h = harness(store, {
      gate: () => ({ ok: false, commands: [{ cmd: 'test p1', exitCode: 1, output: 'red' }] }),
    });
    await runExecute({ plan: plan(packets), ports: h.ports, config: { ...config, maxRepairs: 0 } });
    expect(h.log.filter((line) => line.startsWith('worker:p2'))).toEqual([]);
  });
});

export type { ExecuteRunResult };

// Regressions found by an independent review of the scheduler.
describe('review regressions', () => {
  it('does not loop forever when maxRepairs is NaN (a bad --max-repairs value)', async () => {
    const store = storeFor([packet({ id: 'p1', max_repairs: undefined })]);
    const h = harness(store, {
      gate: () => ({ ok: false, commands: [{ cmd: 'test p1', exitCode: 1, output: 'red' }] }),
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1' })]),
      ports: h.ports,
      // NaN reaches the core from `Number('abc')` at the CLI boundary.
      config: { ...config, maxRepairs: Number('abc') },
    });
    expect(statusOf(store, 'p1')).toBe('blocked');
    // A NaN repair budget is treated as 0, so the worker runs exactly once.
    expect(h.log.filter((line) => line.startsWith('worker:p1'))).toHaveLength(1);
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('blocked');
  });

  it('fails a packet whose gate has no acceptance command instead of passing vacuously', async () => {
    const bare: PlanPacket = { id: 'p1', title: 'P1', goal: 'g', scope: ['src/p1/**'], depends_on: [] };
    const store = storeFor([bare]);
    const h = harness(store, {
      gate: () => ({ ok: true, commands: [] }),
      verdict: () => ({ pass: true, reasons: [] }),
    });
    const result = await runExecute({
      plan: plan([bare]),
      ports: h.ports,
      config: { ...config, maxRepairs: 0 },
    });
    // Nothing ran, so nothing can be declared done; the verifier is never asked.
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('blocked');
    expect(h.verdicts).toEqual([]);
  });

  it('leaves a budget-paused packet resumable instead of blocking it', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2' })];
    const store = storeFor(packets);
    // First worker costs more than the whole cap, so the next packet pauses.
    let calls = 0;
    const h = harness(store, {
      worker: () => {
        calls += 1;
        return { ok: true, summary: 'done', costUsd: 5 };
      },
    });
    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config: { ...config, workers: 1, budgetUsd: 1 },
    });
    expect(result.runStatus).toBe('paused');
    // The packet that never ran is still resumable; nothing was marked blocked.
    expect(store.resumablePacketIds()).toEqual(['p2']);
    expect(result.packets.find((entry) => entry.id === 'p2')?.status).toBe('pending');
    expect(calls).toBe(1);
  });

  it('reports packets skipped before this pass as done, not pending', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2' })];
    const store = storeFor(packets);
    store.setPacketStatus('p1', 'verifying');
    store.setPacketStatus('p1', 'done');
    const h = harness(store);
    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config,
      skipPacketIds: ['p1'],
    });
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('done');
    expect(result.runStatus).toBe('partial');
    // A finished packet is never run again.
    expect(h.log.filter((line) => line.startsWith('worker:p1'))).toEqual([]);
  });

  it('blocks instead of silently passing when changedFiles cannot be read', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store);
    const broken: ExecutePorts = {
      ...h.ports,
      worktree: {
        ...h.ports.worktree,
        changedFiles: async () => {
          throw new Error('index.lock exists');
        },
      },
    };
    const result = await runExecute({
      plan: plan([packet({ id: 'p1' })]),
      ports: broken,
      config: { ...config, maxRepairs: 0 },
    });
    // Failing open would let out-of-scope edits through; failing closed blocks.
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('blocked');
  });

  it('blocks instead of crashing when the worktree reset throws', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/p1/**'] })]);
    const h = harness(store, { changedFiles: () => ['src/escape.ts'] });
    const broken: ExecutePorts = {
      ...h.ports,
      worktree: {
        ...h.ports.worktree,
        reset: async () => {
          throw new Error('cannot reset');
        },
      },
    };
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['src/p1/**'] })]),
      ports: broken,
      config: { ...config, maxRepairs: 2 },
    });
    // The run returns a result and the packet is accounted for.
    expect(result.packets.find((entry) => entry.id === 'p1')?.status).toBe('blocked');
  });
});

// Regressions found while reviewing the execute pipeline against spec 3.3-3.5.
describe('execute hardening', () => {
  it('clears the repair reason when a repaired packet finally reaches done', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/p1/**'] })]);
    let attempt = 0;
    const h = harness(store, {
      // First attempt escapes its scope; the repair stays inside it.
      changedFiles: () => (++attempt === 1 ? ['src/escape.ts'] : ['src/p1/a.ts']),
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['src/p1/**'] })]),
      ports: h.ports,
      config,
    });

    expect(statusOf(store, 'p1')).toBe('done');
    // A stale "repairing after scope failure" reason on a done packet makes the
    // report claim the packet is still broken.
    expect(store.state.packets.find((entry) => entry.id === 'p1')?.reason).toBeUndefined();
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toBeUndefined();
  });

  it('resets the worktree and counts a repair when the diff guard rejects a test deletion', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    let attempt = 0;
    const h = harness(store, {
      diff: () =>
        attempt++ === 0
          ? [
              'diff --git a/src/p1/a.test.ts b/src/p1/a.test.ts',
              'deleted file mode 100644',
              '--- a/src/p1/a.test.ts',
              '+++ /dev/null',
              '@@ -1 +0,0 @@',
              '-it("works", () => {});',
            ].join('\n')
          : 'diff --git a/src/p1/a.ts b/src/p1/a.ts\n--- a/src/p1/a.ts\n+++ b/src/p1/a.ts\n@@ -1 +1 @@\n-a\n+b\n',
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', max_repairs: 1 })]),
      ports: h.ports,
      config,
    });

    expect(h.resets).toEqual(['p1']);
    expect(statusOf(store, 'p1')).toBe('done');
    expect(result.packets.find((entry) => entry.id === 'p1')?.repairs).toBe(1);
  });

  it('refuses a packet that would edit a secret file even when its scope is wide open', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['**'] })]);
    const h = harness(store, { changedFiles: () => ['.env'] });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['**'] })]),
      ports: h.ports,
      config: { ...config, maxRepairs: 0 },
    });

    // Spec 6: `.env*` and key files are read-only by default, whatever the scope.
    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toMatch(/read-only|denied|secret/iu);
    expect(h.gates).toEqual([]);
  });

  it('writes the packet prompt, diff, gate output and verdict as evidence', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store);
    await runExecute({ plan: plan([packet({ id: 'p1' })]), ports: h.ports, config });

    const dir = path.join(store.paths.packets, 'p1');
    expect(existsSync(path.join(dir, 'prompt.md'))).toBe(true);
    expect(readFileSync(path.join(dir, 'prompt.md'), 'utf8')).toMatch(/p1/u);
    expect(existsSync(path.join(dir, 'diff.patch'))).toBe(true);
    expect(readFileSync(path.join(dir, 'gate.txt'), 'utf8')).toMatch(/ok/u);
    expect(existsSync(path.join(dir, 'verdict.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, 'verdict.json'), 'utf8'))).toMatchObject({ pass: true });
  });

  it('reverts a worker that edits a spec test and counts it as a repair (ULT-13)', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['**'] })]);
    let attempt = 0;
    const h = harness(store, {
      // First attempt touches the frozen spec tests; the repair stays in src.
      changedFiles: () =>
        ++attempt === 1 ? ['tests/spec/layers.spec.ts'] : ['src/p1/a.ts'],
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['**'] })]),
      ports: h.ports,
      config,
    });

    expect(h.resets).toEqual(['p1']);
    expect(statusOf(store, 'p1')).toBe('done');
    expect(result.packets.find((entry) => entry.id === 'p1')?.repairs).toBe(1);
  });

  it('blocks a worker that keeps editing a spec test after its repairs', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['**'] })]);
    const h = harness(store, { changedFiles: () => ['tests/spec/a.spec.ts'] });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', scope: ['**'] })]),
      ports: h.ports,
      config: { ...config, maxRepairs: 1 },
    });

    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toMatch(/spec test/iu);
    expect(h.gates).toEqual([]);
  });

  it('does not re-run a packet that is already blocked when the run resumes', async () => {
    const packets = [packet({ id: 'p1' }), packet({ id: 'p2' })];
    const store = storeFor(packets);
    store.setPacketStatus('p1', 'verifying');
    store.setPacketStatus('p1', 'done');
    store.setPacketStatus('p2', 'verifying');
    store.setPacketStatus('p2', 'blocked', 'gate failed after 2 repair(s)');

    const h = harness(store);
    const result = await runExecute({
      plan: plan(packets),
      ports: h.ports,
      config,
      skipPacketIds: ['p1', 'p2'],
    });

    // A terminal packet is history: resume reports it, it never runs again.
    expect(h.created).toEqual([]);
    expect(statusOf(store, 'p2')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p2')?.status).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p2')?.reason).toMatch(/gate/iu);
  });
});

describe('verifier rate limits', () => {
  it('retries a throttled verifier instead of spending a repair', async () => {
    const store = storeFor([packet({ id: 'p1', max_repairs: 1 })]);
    let verifierCalls = 0;
    const h = harness(store, {
      verdict: () => {
        verifierCalls += 1;
        return verifierCalls === 1
          ? { pass: false, reasons: ['429 rate limited'], rateLimited: true }
          : { pass: true, reasons: [] };
      },
    });
    const result = await runExecute({
      plan: plan([packet({ id: 'p1', max_repairs: 1 })]),
      ports: h.ports,
      config: { ...config, maxRepairs: 1 },
      sleep: async () => {},
    });
    expect(statusOf(store, 'p1')).toBe('done');
    expect(result.rateLimitEvents).toBeGreaterThanOrEqual(1);
    // The worker ran once: a 429 on the verifier is not a repair.
    expect(h.log.filter((line) => line.startsWith('worker:p1'))).toHaveLength(1);
  });
});

describe('recipe enforcement', () => {
  it('tells the verifier which recipe the run follows (spec 8)', async () => {
    const store = storeFor([packet({ id: 'p1' })]);
    const h = harness(store);
    await runExecute({
      plan: { goal: 'the goal', recipe: 'bughunt', packets: [packet({ id: 'p1' })] },
      ports: h.ports,
      config,
      sleep: async () => {},
    });
    // A verifier that does not know the recipe cannot check for leftover old-API
    // calls or a missing reproduction, which is the recipe's whole contribution.
    expect(h.verifierRecipes).toEqual(['bughunt']);
  });

  it('rejects an audit packet that changes any file, even inside its scope', async () => {
    const store = storeFor([packet({ id: 'p1', scope: ['src/**'] })]);
    const h = harness(store, { changedFiles: () => ['src/auth/login.ts'] });
    const result = await runExecute({
      // An audit reviews and reports; a packet that edits code is not an audit.
      plan: { goal: 'audit the auth area', recipe: 'audit', packets: [packet({ id: 'p1', scope: ['src/**'] })] },
      ports: h.ports,
      config,
      sleep: async () => {},
    });
    expect(statusOf(store, 'p1')).toBe('blocked');
    expect(result.packets.find((entry) => entry.id === 'p1')?.reason).toMatch(/read-only/iu);
  });
});
