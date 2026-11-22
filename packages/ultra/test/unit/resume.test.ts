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

  it('refuses a running run while something is still driving it', () => {
    // A live driver and a second execute pass would fight over the same
    // worktrees, so the resume waits.
    expect(resumeRefusal(state('running'), 'live')).toMatch(/already running/iu);
    // A foreground run has no runner record, so nobody can prove it is gone.
    expect(resumeRefusal(state('running'), 'unknown')).toMatch(/already running/iu);
  });

  it('lets a running run whose driver is gone be continued', () => {
    // The process that was driving the run died and left it behind. `status`
    // tells the reader to resume such a run, so the resume must not refuse it.
    expect(resumeRefusal(state('running'), 'dead')).toBeUndefined();
  });

  it('lets a run that was interrupted while merging be continued', () => {
    // The interrupt handler is released before INTEGRATE, so a crash in the
    // merge leaves the run `integrating` — and `status` tells the reader to
    // resume exactly that run. A resume that refuses it contradicts the run's
    // own advice, and the merged branch never arrives.
    expect(resumeRefusal(state('integrating'), 'dead')).toBeUndefined();
    expect(resumeRefusal(state('accepting'), 'dead')).toBeUndefined();
  });

  it('refuses a run that is merging or checking the goal right now', () => {
    expect(resumeRefusal(state('integrating'), 'live')).toMatch(/merging the packets/iu);
    expect(resumeRefusal(state('integrating'), 'unknown')).toMatch(/merging the packets/iu);
    expect(resumeRefusal(state('accepting'), 'live')).toMatch(/checking the goal/iu);
  });

  it('refuses a successful run, so its verdict is not thrown away', () => {
    const refusal = resumeRefusal(state('succeeded'));
    expect(refusal).toMatch(/already finished as succeeded/iu);
  });

  it('refuses a run that is still planning, because it has no plan yet', () => {
    expect(resumeRefusal(state('planning'))).toMatch(/still planning/iu);
  });
});
