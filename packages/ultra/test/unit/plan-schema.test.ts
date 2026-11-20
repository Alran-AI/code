import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/plan-schema.js';
import type { UltraPlan } from '../../src/types.js';

function plan(packets: UltraPlan['packets']): UltraPlan {
  return {
    goal: 'Migrate the client to the new API',
    recipe: 'migrate',
    packets,
  };
}

// ULT-07: two parallel packets with overlapping scope are rejected, as is any
// packet that references a dependency the plan does not contain or a cycle.
describe('plan validation', () => {
  it('accepts a plan whose packets have disjoint scope', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'Types', goal: 'Extract shared types', scope: ['src/types/**'], depends_on: [] },
        { id: 'p2', title: 'Client', goal: 'Wrap the client', scope: ['src/client/**'], depends_on: ['p1'] },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('rejects two independent packets with overlapping scope', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'Touch the scheduler', scope: ['src/scheduler/**'], depends_on: [] },
        { id: 'p2', title: 'B', goal: 'Touch the scheduler too', scope: ['src/scheduler/queue.ts'], depends_on: [] },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/overlap/iu);
  });

  it('allows overlapping scope when one packet depends on the other', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'First pass', scope: ['src/scheduler/**'], depends_on: [] },
        { id: 'p2', title: 'B', goal: 'Second pass', scope: ['src/scheduler/queue.ts'], depends_on: ['p1'] },
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it('allows a read-only path shared by parallel packets', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], readonly: ['src/types/**'], depends_on: [] },
        { id: 'p2', title: 'B', goal: 'B', scope: ['src/b/**'], readonly: ['src/types/**'], depends_on: [] },
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a dependency on a packet that does not exist', () => {
    const result = validatePlan(
      plan([{ id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], depends_on: ['p9'] }]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/unknown dependenc/iu);
  });

  it('rejects a dependency cycle', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], depends_on: ['p2'] },
        { id: 'p2', title: 'B', goal: 'B', scope: ['src/b/**'], depends_on: ['p1'] },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/cycle/iu);
  });

  it('rejects duplicate packet ids', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], depends_on: [] },
        { id: 'p1', title: 'B', goal: 'B', scope: ['src/b/**'], depends_on: [] },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/duplicate/iu);
  });

  it('rejects a packet with an empty scope or no goal', () => {
    const result = validatePlan(
      plan([{ id: 'p1', title: 'A', goal: '', scope: [], depends_on: [] }]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/goal|scope/iu);
  });

  it('returns the deterministic parallel waves for a valid plan', () => {
    const result = validatePlan(
      plan([
        { id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], depends_on: [] },
        { id: 'p2', title: 'B', goal: 'B', scope: ['src/b/**'], depends_on: [] },
        { id: 'p3', title: 'C', goal: 'C', scope: ['src/c/**'], depends_on: ['p1', 'p2'] },
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.waves).toEqual([['p1', 'p2'], ['p3']]);
  });

  // ULT-13: a plan whose packet could edit the frozen spec tests is rejected
  // before any worktree exists, so a run cannot weaken its own acceptance checks.
  it('rejects a packet whose scope reaches the spec tests', () => {
    const result = validatePlan(
      plan([{ id: 'p1', title: 'Everything', goal: 'g', scope: ['**'], depends_on: [] }]),
    );
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/spec test/iu);
  });

  it('accepts a plan that leaves the spec tests alone', () => {
    const result = validatePlan(
      plan([{ id: 'p1', title: 'Widget', goal: 'g', scope: ['src/widget/**'], depends_on: [] }]),
    );
    expect(result.ok).toBe(true);
  });
});
