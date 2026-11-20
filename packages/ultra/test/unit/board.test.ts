/**
 * The Ultra board (spec §7).
 *
 * The board is the answer to "what is going on?" without reading the ledger, so
 * the tests are about the questions a human actually asks: which packets are
 * done, which are waiting and for what, what the run has cost, and whether a
 * failure is visible with its reason. Every row must also fit the width, because
 * a wrapped board in a fixed-width terminal is unreadable.
 */

import { describe, expect, it } from 'vitest';
import {
  boardPhase,
  DEFAULT_BOARD_WIDTH,
  formatElapsed,
  renderUltraBoard,
  ULTRA_BOARD_GLYPHS,
  type UltraBoardInput,
} from '../../src/board.js';
import type { Criterion, CriterionStatus } from '../../src/goal.js';
import type { PacketState, PacketStatus, PlanPacket, RunState, RunStatus } from '../../src/types.js';

function packetState(id: string, status: PacketStatus, extra: Partial<PacketState> = {}): PacketState {
  return { id, title: id === 'p1' ? 'Extract types' : id, status, ...extra };
}

function state(over: Partial<RunState> = {}): RunState {
  return {
    runId: 'run-8f2a',
    goal: 'Build the widget',
    budgetUsd: 2,
    createdAt: '2026-11-19T12:00:00.000Z',
    status: 'running',
    packets: [packetState('p1', 'done')],
    ...over,
  };
}

function planPacket(over: Partial<PlanPacket> & Pick<PlanPacket, 'id'>): PlanPacket {
  return {
    id: over.id,
    title: over.title ?? over.id,
    goal: over.goal ?? `do ${over.id}`,
    scope: over.scope ?? [`src/${over.id}/**`],
    depends_on: over.depends_on ?? [],
    max_repairs: over.max_repairs,
  };
}

function criterion(id: string, status: CriterionStatus, priority: Criterion['priority']): Criterion {
  return { id, priority, verification: 'scenario', description: `${id} description`, status, evidence: [] };
}

function board(over: Partial<UltraBoardInput> = {}): string[] {
  const input: UltraBoardInput = {
    runId: 'run-8f2a',
    goal: 'Build the widget',
    state: state(),
    costUsd: 0.84,
    budgetUsd: 2,
    ...over,
  };
  return renderUltraBoard(input).split('\n');
}

describe('renderUltraBoard header', () => {
  it('shows the run, the round, the cost against the cap and the elapsed time', () => {
    const lines = board({ round: 2, phase: 'Execute', elapsedMs: 372_000 });
    expect(lines[0]).toContain('ULTRA run-8f2a');
    expect(lines[0]).toContain('Round 2');
    expect(lines[0]).toContain('Execute');
    expect(lines[0]).toContain('$0.84 / $2.00');
    // 372 s is 6 m 12 s.
    expect(lines[0]).toContain('06:12');
  });

  it('says there is no cap instead of printing $0.00 or $NaN', () => {
    const lines = board({ budgetUsd: null });
    expect(lines[0]).toContain('no cap');
    expect(lines[0]).not.toContain('$NaN');
  });

  it('does not print a round for a single-round run', () => {
    expect(board()[0]).not.toContain('Round');
  });

  it('still shows the phase when there is no round, so a finished run is visible', () => {
    // The phase is the only place the board says a run finished; dropping it
    // would make a succeeded single-round run look like it never started.
    expect(board({ phase: 'succeeded' })[0]).toContain('succeeded');
  });
});

describe('renderUltraBoard goal', () => {
  it('shows the goal and the criteria progress', () => {
    const criteria = [
      criterion('C1', 'met', 'must'),
      criterion('C2', 'met', 'must'),
      criterion('C3', 'unmet', 'must'),
      criterion('C4', 'partial', 'should'),
      criterion('C5', 'needs_human', 'must'),
      criterion('C6', 'regressed', 'should'),
    ];
    const lines = board({ criteria });
    expect(lines.join('\n')).toContain('Goal: Build the widget');
    const summary = lines.find((line) => line.startsWith('Criteria:'))!;
    expect(summary).toContain('2/6 met');
    expect(summary).toContain('2 must open');
    expect(summary).toContain('2 should open');
    expect(summary).toContain('1 needs_human');
    expect(summary).toContain('1 regressed');
  });

  it('omits the criteria line for a run without a goal document', () => {
    expect(board().join('\n')).not.toContain('Criteria:');
  });
});

describe('renderUltraBoard packets', () => {
  it('says a done packet passed its gate and its verifier', () => {
    const lines = board();
    expect(lines.join('\n')).toContain('Extract types');
    expect(lines.join('\n')).toContain('gate ok, verified');
  });

  it('shows the repair counter, the block reason and the skipped reason', () => {
    const lines = board({
      state: state({
        packets: [
          packetState('p1', 'done'),
          packetState('p2', 'repairing', { repairs: 1 }),
          packetState('p3', 'blocked', { reason: 'tsc errors' }),
          packetState('p4', 'skipped', { reason: 'p3 is blocked' }),
        ],
      }),
      packets: [
        planPacket({ id: 'p1' }),
        planPacket({ id: 'p2', max_repairs: 2 }),
        planPacket({ id: 'p3' }),
        planPacket({ id: 'p4' }),
      ],
    });
    const text = lines.join('\n');
    expect(text).toContain('repair 1/2');
    expect(text).toContain('blocked: tsc errors');
    expect(text).toContain('skipped: p3 is blocked');
  });

  it('names the unfinished dependency a waiting packet is stuck on', () => {
    const lines = board({
      state: state({ packets: [packetState('p1', 'done'), packetState('p2', 'pending')] }),
      packets: [planPacket({ id: 'p1' }), planPacket({ id: 'p2', depends_on: ['p1', 'p3'] })],
    });
    const row = lines.find((line) => line.includes('p2'))!;
    expect(row).toContain('waits for p3');
    // p1 is done, so it must not be named as a blocker.
    expect(row).not.toContain('waits for p1');
  });

  it('says so when there is nothing to show yet', () => {
    const lines = board({ state: state({ packets: [] }) });
    expect(lines.join('\n')).toContain('(no packets yet)');
  });

  it('gives every status its own glyph', () => {
    const lines = board({
      state: state({
        packets: [
          packetState('p1', 'done'),
          packetState('p2', 'running'),
          packetState('p3', 'repairing', { repairs: 1 }),
          packetState('p4', 'blocked'),
          packetState('p5', 'skipped'),
          packetState('p6', 'pending'),
        ],
      }),
    });
    const text = lines.join('\n');
    for (const glyph of Object.values(ULTRA_BOARD_GLYPHS)) expect(text).toContain(glyph);
  });

  it('lets a caller replace the glyphs', () => {
    const lines = board({ glyphs: { done: 'DONE' } });
    const row = lines.find((line) => line.includes('Extract types'))!;
    expect(row.startsWith('DONE')).toBe(true);
    expect(row).not.toContain(ULTRA_BOARD_GLYPHS.done);
  });
});

describe('renderUltraBoard layout', () => {
  it('never exceeds the requested width', () => {
    const criteria = [criterion('C1', 'unmet', 'must'), criterion('C2', 'needs_human', 'must')];
    const lines = board({
      width: 60,
      round: 7,
      phase: 'Integrate',
      elapsedMs: 3_725_000,
      criteria,
      state: state({
        packets: [
          packetState('p1', 'done'),
          packetState('p2', 'blocked', {
            reason: 'the worker changed a file outside its scope and the worktree was reset',
          }),
        ],
      }),
      packets: [planPacket({ id: 'p1' }), planPacket({ id: 'p2' })],
    });
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
  });

  it('fits a narrow board without losing the packet ids', () => {
    const lines = board({ width: 30, state: state({ packets: [packetState('p1', 'done')] }) });
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(30);
    expect(lines.join('\n')).toContain('p1');
  });

  it('keeps the cost visible when the header does not fit', () => {
    // The right side carries the numbers a monitor reads. Truncating from the
    // right would cut the price and leave a run id with no cost beside it.
    const line = board({
      width: 44,
      round: 12,
      phase: 'Integrate',
      elapsedMs: 3_725_000,
      costUsd: 12.5,
      budgetUsd: 20,
      workers: 8,
    })[0];
    expect(line).toContain('$12.50');
    expect(line.length).toBeLessThanOrEqual(44);
  });

  it('still shows a price on a board narrower than the whole header', () => {
    const line = board({ width: 20, costUsd: 12.5, budgetUsd: 20 })[0];
    expect(line.length).toBeLessThanOrEqual(20);
    expect(line).toContain('$12.50');
  });

  it('defaults to a 100-column board', () => {
    expect(DEFAULT_BOARD_WIDTH).toBe(100);
    const line = board({ round: 1, elapsedMs: 1000 })[0];
    expect(line.length).toBeLessThanOrEqual(100);
  });

  it('leaves no trailing whitespace on a row with no detail', () => {
    const lines = board({
      state: state({ packets: [packetState('p1', 'done'), packetState('p2', 'running')] }),
      packets: [planPacket({ id: 'p1' }), planPacket({ id: 'p2' })],
    });
    for (const line of lines) expect(line).toBe(line.trimEnd());
  });

  it('ends with the key hints', () => {
    const last = board().at(-1)!;
    expect(last).toContain('[p]ause');
    expect(last).toContain('[r]eport');
  });

  it('omits the key hints when the caller offers none', () => {
    expect(board({ keys: [] }).join('\n')).not.toContain('[p]ause');
  });
});

describe('formatElapsed', () => {
  it('renders minutes and seconds under an hour', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(372_000)).toBe('06:12');
    expect(formatElapsed(59_999)).toBe('00:59');
  });

  it('adds an hours field once the run passes an hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });

  it('never shows a negative elapsed time', () => {
    expect(formatElapsed(-5_000)).toBe('00:00');
  });
});

describe('boardPhase', () => {
  it('names the phase each run status is in', () => {
    const expected: readonly [RunStatus, string][] = [
      ['planning', 'Plan'],
      ['awaiting_confirm', 'Confirm'],
      ['running', 'Execute'],
      ['integrating', 'Integrate'],
      ['accepting', 'Accept'],
      ['paused', 'Paused'],
      ['succeeded', 'succeeded'],
      ['stalled', 'stalled'],
    ];
    for (const [status, phase] of expected) expect(boardPhase(status)).toBe(phase);
  });
});
describe('renderUltraBoard log tail', () => {
  it('shows the newest log lines between the packets and the keys', () => {
    const lines = board({
      state: state({ packets: [packetState('p1', 'done')] }),
      logTail: ['12:26:11 planning: 3 explorers', '12:26:14 plan written'],
    });
    const logIndex = lines.findIndex((line) => line.includes('[log]'));
    // The default key hints are compact: `[p]ause`, `[k]ill`, …
    const keyIndex = lines.findIndex((line) => line.includes('[p]ause'));
    expect(logIndex).toBeGreaterThan(-1);
    // The keys stay last, however long the board is.
    expect(keyIndex).toBeGreaterThan(logIndex);
  });

  it('says nothing about a log when there is none', () => {
    expect(board().join('\n')).not.toContain('[log]');
  });

  it('keeps a long log line inside the board', () => {
    const long = 'x'.repeat(400);
    const lines = board({ logTail: [long] });
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
  });
});
