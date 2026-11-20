import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Ledger } from '../../src/ledger.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-ledger-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ULT-05 / ULT-12: the ledger is the durable record; cost is the sum of its
// entries and a resumed run replays finished work instead of repeating it.
describe('ledger', () => {
  it('appends entries and sums their cost', () => {
    const ledger = Ledger.open(path.join(tempDir(), 'ledger.jsonl'));
    ledger.append({ kind: 'step', role: 'planner', status: 'ok', costUsd: 0.3 });
    ledger.append({ kind: 'step', role: 'worker', status: 'ok', costUsd: 0.45 });
    expect(ledger.entries()).toHaveLength(2);
    expect(ledger.totalCostUsd()).toBeCloseTo(0.75, 10);
  });

  it('reloads every entry after a simulated crash', () => {
    const file = path.join(tempDir(), 'ledger.jsonl');
    const first = Ledger.open(file);
    first.append({ kind: 'step', role: 'planner', status: 'ok', costUsd: 0.2 });
    first.append({ kind: 'packet', packetId: 'p1', status: 'done', costUsd: 0.5 });
    // Reopening is what `resume` does after a kill.
    const second = Ledger.open(file);
    expect(second.entries().map((entry) => entry.kind)).toEqual(['step', 'packet']);
    expect(second.totalCostUsd()).toBeCloseTo(0.7, 10);
  });

  it('ignores a torn final line left by a hard kill', () => {
    const file = path.join(tempDir(), 'ledger.jsonl');
    const ledger = Ledger.open(file);
    ledger.append({ kind: 'step', role: 'worker', status: 'ok', costUsd: 0.1 });
    writeFileSync(file, `${String(ledger.entries().length)}\n`);
    // Simulate a process that died mid-write, leaving a partial JSON object.
    writeFileSync(file, `${JSON.stringify({ kind: 'step', role: 'worker', status: 'ok', costUsd: 0.1 })}\n{"kind":"step"`);
    const reopened = Ledger.open(file);
    expect(reopened.entries()).toHaveLength(1);
    expect(reopened.totalCostUsd()).toBeCloseTo(0.1, 10);
  });

  it('sums cost per role for the report', () => {
    const ledger = Ledger.open(path.join(tempDir(), 'ledger.jsonl'));
    ledger.append({ kind: 'step', role: 'planner', status: 'ok', costUsd: 0.3 });
    ledger.append({ kind: 'step', role: 'worker', status: 'ok', costUsd: 0.2 });
    ledger.append({ kind: 'step', role: 'worker', status: 'ok', costUsd: 0.2 });
    expect(ledger.costByRole()).toEqual({ planner: 0.3, worker: 0.4 });
  });

  it('redacts secret-looking strings before they reach the file', () => {
    const file = path.join(tempDir(), 'ledger.jsonl');
    const ledger = Ledger.open(file);
    ledger.append({
      kind: 'step',
      role: 'worker',
      status: 'error',
      note: 'failed with ALRAN_API_KEY=sk-live-abc123secret',
    });
    const entries = Ledger.open(file).entries();
    expect(entries[0].note).not.toContain('sk-live-abc123secret');
    // The CI Fixer's masker marks masked spans with `***`.
    expect(entries[0].note).toContain('***');
    expect(entries[0].note).toContain('ALRAN_API_KEY');
  });

  it('replays finished packet ids so resume does not repeat them', () => {
    const ledger = Ledger.open(path.join(tempDir(), 'ledger.jsonl'));
    ledger.append({ kind: 'packet', packetId: 'p1', status: 'done', costUsd: 0.1 });
    ledger.append({ kind: 'packet', packetId: 'p2', status: 'blocked', costUsd: 0.1 });
    expect([...ledger.finishedPacketIds()].sort()).toEqual(['p1', 'p2']);
  });
});
