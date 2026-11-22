import { describe, expect, it } from 'vitest';
import { resumeRefusal } from '../../src/resume.js';
import type { RunState, RunStatus } from '../../src/types.js';

function state(status: RunStatus): RunState {
  return {
    runId: 'run-1',
    goal: 'the goal',
    budgetUsd: 2,
    createdAt: '2026-11-19T12:00:00.000Z',
    status,
    packets: [],
  };
}

describe('resumeRefusal', () => {
  it('lets a paused, a killed and a planned run be continued', () => {
    expect(resumeRefusal(state('paused'))).toBeUndefined();
    expect(resumeRefusal(state('killed'))).toBeUndefined();
    // `alran ultra plan` leaves a run waiting for a yes, with a plan on disk.
    expect(resumeRefusal(state('awaiting_confirm'))).toBeUndefined();
  });

  it('lets a partial, a failed and a stalled run be continued', () => {
    // These are not verdicts. A run that paused at its budget cap ends up
    // `partial` with work still to do, and `resume` is how it continues.
    expect(resumeRefusal(state('partial'))).toBeUndefined();
    expect(resumeRefusal(state('failed'))).toBeUndefined();
    expect(resumeRefusal(state('stalled'))).toBeUndefined();
  });

  it('refuses a running run, so a second execute pass cannot start', () => {
    const refusal = resumeRefusal(state('running'));
    expect(refusal).toMatch(/already running/iu);
    expect(refusal).toMatch(/pause it first/iu);
  });

  it('refuses a successful run, so its verdict is not thrown away', () => {
    const refusal = resumeRefusal(state('succeeded'));
    expect(refusal).toMatch(/already finished as succeeded/iu);
  });

  it('refuses a run that is still planning, because it has no plan yet', () => {
    expect(resumeRefusal(state('planning'))).toMatch(/still planning/iu);
  });
});
