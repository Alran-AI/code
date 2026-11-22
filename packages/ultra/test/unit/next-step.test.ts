/**
 * What to do next with a run.
 *
 * A status that names the state and stops leaves the reader guessing what to
 * do about it. The rule lives in the core so the CLI and the TUI cannot
 * disagree about it.
 */

import { describe, expect, it } from 'vitest';
import { nextStepFor } from '../../src/next-step.js';
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

describe('nextStepFor', () => {
  it('names the merge for a successful run', () => {
    // The run is over and the branch is ready. The merge is the only thing
    // left to do with it, and the status is where the reader looks.
    const step = nextStepFor(state('succeeded'));
    expect(step.kind).toBe('merge');
    expect(step.kind === 'merge' ? step.branch : '').toBe('ultra/run-1');
  });

  it('names the resume for a run that still has work', () => {
    for (const status of ['paused', 'killed', 'partial', 'failed', 'stalled', 'awaiting_confirm'] as const) {
      expect(nextStepFor(state(status)).kind).toBe('resume');
    }
  });

  it('names the resume for a run whose driver died while merging', () => {
    // The run is stuck in the merge because the process died there. The
    // status has to say what to do about it, and the answer is the resume.
    expect(nextStepFor(state('integrating'), 'dead').kind).toBe('resume');
    expect(nextStepFor(state('accepting'), 'dead').kind).toBe('resume');
  });

  it('says nothing for a run that is going, or that never got a plan', () => {
    // A running run needs no instruction, and a run that is still planning has
    // nothing to resume yet.
    expect(nextStepFor(state('running')).kind).toBe('none');
    expect(nextStepFor(state('planning')).kind).toBe('none');
  });
});
