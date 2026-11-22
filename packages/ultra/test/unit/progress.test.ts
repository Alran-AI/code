import { describe, expect, it } from 'vitest';
import {
  firstLineOf,
  renderProgressEvent,
  type UltraProgressEvent,
} from '../../src/progress.js';

describe('firstLineOf', () => {
  it('takes the first non-empty line and drops the rest', () => {
    expect(firstLineOf('\n  gate failed\nsecond line\nthird')).toBe('gate failed');
  });

  it('returns an empty string for text with no content', () => {
    expect(firstLineOf('')).toBe('');
    expect(firstLineOf('\n\n   \n')).toBe('');
  });

  it('shortens a long line so one progress event stays one line', () => {
    const long = 'x'.repeat(500);
    const line = firstLineOf(long);
    expect(line.length).toBe(160);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('renderProgressEvent', () => {
  const event = (over: Partial<UltraProgressEvent>): UltraProgressEvent => ({
    kind: 'attempt',
    packetId: 'p1',
    ...over,
  });

  it('pads the packet id so a parallel run reads in columns', () => {
    const line = renderProgressEvent(event({ kind: 'attempt', attempt: 1, title: 'Scheduler lock' }));
    expect(line).toBe('  p1     attempt 1 · Scheduler lock');
  });

  it('names the failing command on a failed gate', () => {
    const line = renderProgressEvent(
      event({ kind: 'gate_fail', detail: '--- pnpm test (exit 1) ---\nboom' }),
    );
    expect(line).toBe('  p1     gate failed: --- pnpm test (exit 1) ---');
  });

  it('names the verifier reason on a rejected change', () => {
    const line = renderProgressEvent(
      event({ kind: 'verifier_fail', detail: 'the test was deleted\nand the assertion loosened' }),
    );
    expect(line).toBe('  p1     verifier rejected: the test was deleted');
  });

  it('shows the attempt a repair is about to make', () => {
    const line = renderProgressEvent(
      event({ kind: 'repair', attempt: 1, detail: 'gate: exit 1' }),
    );
    expect(line).toBe('  p1     repairing: gate: exit 1 (attempt 2)');
  });

  it('marks the end of a packet plainly', () => {
    expect(renderProgressEvent(event({ kind: 'packet_done' }))).toBe('  p1     done');
    expect(renderProgressEvent(event({ kind: 'packet_blocked', detail: 'gate failed' }))).toBe(
      '  p1     blocked: gate failed',
    );
    expect(renderProgressEvent(event({ kind: 'packet_skipped', detail: 'dependency p2 did not complete' }))).toBe(
      '  p1     skipped: dependency p2 did not complete',
    );
  });

  it('reports a throttle without hiding the new parallelism', () => {
    const line = renderProgressEvent(
      event({ kind: 'rate_limited', detail: 'workers=3 retry=1/5 backoff=1000ms' }),
    );
    expect(line).toBe('  p1     rate limited: workers=3 retry=1/5 backoff=1000ms');
  });

  it('gives the budget pause its own line, without a packet id', () => {
    const line = renderProgressEvent(
      event({ kind: 'budget_paused', detail: 'budget paused the run at 100 %' }),
    );
    expect(line).toBe('  --    budget paused: budget paused the run at 100 %');
  });

  it('renders every kind without throwing', () => {
    const kinds: UltraProgressEvent['kind'][] = [
      'attempt',
      'worker_done',
      'gate_ok',
      'gate_fail',
      'verifier_pass',
      'verifier_fail',
      'repair',
      'packet_done',
      'packet_blocked',
      'packet_skipped',
      'rate_limited',
      'budget_paused',
    ];
    for (const kind of kinds) {
      const line = renderProgressEvent(event({ kind }));
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain('undefined');
    }
  });
});
