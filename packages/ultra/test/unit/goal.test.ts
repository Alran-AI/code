/**
 * Goal document and acceptance (spec 13.1, 13.2).
 *
 * These tests pin the three rules that stop a long run from lying to itself:
 * a criterion cannot be `met` without evidence (ULT-15), a criterion that was
 * `met` and is observed unmet again is flagged `regressed` and prioritised
 * (ULT-17), and an open `needs_human` `must` keeps a run out of `succeeded`
 * (ULT-20).
 */

import { describe, expect, it } from 'vitest';
import {
  applyAcceptance,
  goalCounts,
  hasOpenNeedsHumanMust,
  mustCriteriaSatisfied,
  openCriteria,
  parseGoalDocument,
  type GoalDocument,
} from '../../src/goal.js';

function doc(criteria: unknown[]): GoalDocument {
  return parseGoalDocument({ goal: 'Build the app', criteria });
}

describe('goal document', () => {
  it('parses a criteria list and defaults a missing status to unmet', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'scenario', description: 'Layers work' },
    ]);
    expect(goal.criteria).toHaveLength(1);
    expect(goal.criteria[0]?.status).toBe('unmet');
    expect(goal.criteria[0]?.evidence).toEqual([]);
  });

  it('refuses a criterion with an unknown priority or verification', () => {
    expect(() =>
      doc([{ id: 'C1', priority: 'nice', verification: 'test', description: 'x' }]),
    ).toThrow(/unknown priority/iu);
    expect(() =>
      doc([{ id: 'C1', priority: 'must', verification: 'vibes', description: 'x' }]),
    ).toThrow(/unknown verification/iu);
  });

  it('rejects a stored criterion that is met with no evidence (ULT-15)', () => {
    expect(() =>
      doc([{ id: 'C1', priority: 'must', verification: 'test', description: 'x', status: 'met' }]),
    ).toThrow(/cannot be met without an evidence reference/iu);
  });

  it('counts criteria by status and priority', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a', status: 'met', evidence: ['t1'] },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
      { id: 'C3', priority: 'should', verification: 'scenario', description: 'c', status: 'needs_human' },
    ]);
    const counts = goalCounts(goal);
    expect(counts.total).toBe(3);
    expect(counts.met).toBe(1);
    expect(counts.must).toBe(2);
    expect(counts.needsHuman).toBe(1);
  });
});

describe('applyAcceptance', () => {
  it('accepts a met criterion that carries evidence', () => {
    const goal = doc([{ id: 'C1', priority: 'must', verification: 'scenario', description: 'a' }]);
    const { accepted, rejected } = applyAcceptance(goal, {
      findings: [{ id: 'C1', status: 'met', evidence: ['./shots/layers.png'] }],
    });
    expect(rejected).toEqual([]);
    expect(accepted[0]?.status).toBe('met');
    expect(goal.criteria[0]?.evidence).toEqual(['./shots/layers.png']);
  });

  it('rejects a met claim with no evidence and leaves the criterion unmet (ULT-15)', () => {
    const goal = doc([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const { accepted, rejected } = applyAcceptance(goal, {
      findings: [{ id: 'C1', status: 'met', evidence: [] }],
    });
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.note).toMatch(/no evidence/iu);
    expect(goal.criteria[0]?.status).toBe('unmet');
  });

  it('flags a criterion that regressed and prioritises it next round (ULT-17)', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a', status: 'met', evidence: ['t'] },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
    ]);
    applyAcceptance(goal, { findings: [{ id: 'C1', status: 'unmet', evidence: ['failing'] }] });
    expect(goal.criteria[0]?.status).toBe('regressed');
    expect(goal.criteria[0]?.regressedFrom).toBe('met');
    // The regression is first even though C2 is also a must.
    expect(openCriteria(goal).map((criterion) => criterion.id)).toEqual(['C1', 'C2']);
  });

  it('rejects an unknown criterion id instead of inventing a criterion', () => {
    const goal = doc([{ id: 'C1', priority: 'must', verification: 'test', description: 'a' }]);
    const { rejected } = applyAcceptance(goal, {
      findings: [{ id: 'C9', status: 'met', evidence: ['x'] }],
    });
    expect(rejected[0]?.note).toMatch(/unknown criterion/iu);
    expect(goal.criteria).toHaveLength(1);
  });

  it('sorts open criteria must → should → could', () => {
    const goal = doc([
      { id: 'C3', priority: 'could', verification: 'test', description: 'c' },
      { id: 'C2', priority: 'should', verification: 'test', description: 'b' },
      { id: 'C1', priority: 'must', verification: 'test', description: 'a' },
    ]);
    expect(openCriteria(goal).map((criterion) => criterion.id)).toEqual(['C1', 'C2', 'C3']);
  });
});

describe('stop conditions', () => {
  it('is satisfied only when every must criterion is met', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a', status: 'met', evidence: ['t'] },
      { id: 'C2', priority: 'must', verification: 'test', description: 'b' },
    ]);
    expect(mustCriteriaSatisfied(goal)).toBe(false);
    goal.criteria[1]!.status = 'met';
    goal.criteria[1]!.evidence.push('t');
    expect(mustCriteriaSatisfied(goal)).toBe(true);
  });

  it('treats an open needs_human must as not succeeded (ULT-20)', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'manual', description: 'feels right', status: 'needs_human' },
    ]);
    expect(hasOpenNeedsHumanMust(goal)).toBe(true);
    expect(mustCriteriaSatisfied(goal)).toBe(false);
  });

  it('does not treat a needs_human should as blocking success', () => {
    const goal = doc([
      { id: 'C1', priority: 'must', verification: 'test', description: 'a', status: 'met', evidence: ['t'] },
      { id: 'C2', priority: 'should', verification: 'manual', description: 'nice', status: 'needs_human' },
    ]);
    expect(hasOpenNeedsHumanMust(goal)).toBe(false);
    expect(mustCriteriaSatisfied(goal)).toBe(true);
  });
});