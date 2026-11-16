import type { VerificationHostContext } from '@alran/goal';
import { describe, expect, it } from 'vitest';

import { GoalVerifierChildCoordinator } from './goal-subagent-coordinator.js';
import { renderGoalVerifierReminder } from './goal-verifier-reminder.js';

const hostContext = {
  completionProposal: { turnId: 'turn-1' },
  settlement: { durableStatusAtDispatch: 'active', transitionOnMet: 'complete' },
} as unknown as VerificationHostContext;

function coordinator() {
  const instance = new GoalVerifierChildCoordinator();
  instance.register({ runId: 'run-1', workerRouteProvider: 'worker', hostContext });
  return instance;
}

const tool = (name: string) => ({ toolCall: { id: `call-${name}`, name, arguments: {} } }) as never;

describe('Goal verifier child tool guard', () => {
  it('lets the child carry on after one blocked network call instead of ending the run', () => {
    const guard = coordinator();

    const blocked = guard.beforeTool('run-1', tool('web_fetch'));

    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain('GOAL_VERIFIER_CAPABILITY_VIOLATION');
    expect(blocked?.reason).toContain('web_fetch');
    // The result tells the model what to do instead.
    expect(blocked?.reason).toMatch(/offline/iu);
    expect(blocked?.reason).toMatch(/read|grep|bash/iu);
    expect(guard.beforeLlm('run-1', 'worker')).toBeUndefined();
    expect(guard.release('run-1')?.issue).toBeUndefined();
  });

  it('tolerates a second blocked call, whichever network tool it is', () => {
    const guard = coordinator();

    expect(guard.beforeTool('run-1', tool('web_fetch'))?.block).toBe(true);
    expect(guard.beforeTool('run-1', tool('web_search'))?.block).toBe(true);

    expect(guard.beforeLlm('run-1', 'worker')).toBeUndefined();
    expect(guard.release('run-1')?.issue).toBeUndefined();
  });

  it('ends the run when the child keeps reaching for the network after being told', () => {
    const guard = coordinator();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(guard.beforeTool('run-1', tool('web_search'))?.block).toBe(true);
    }

    const next = guard.beforeLlm('run-1', 'worker');

    expect(next?.type).toBe('abort');
    expect(next?.reason).toContain('GOAL_VERIFIER_CAPABILITY_VIOLATION');
    expect(guard.release('run-1')?.issue?.code).toBe('capability_violation');
  });

  it('does not touch the tools the verifier is meant to use', () => {
    const guard = coordinator();

    for (const name of ['read', 'grep', 'bash', 'glob']) {
      expect(guard.beforeTool('run-1', tool(name))).toBeUndefined();
    }
    expect(guard.release('run-1')?.issue).toBeUndefined();
  });

  it('still blocks everything for a run that is no longer active', () => {
    expect(coordinator().beforeTool('other', tool('read'))?.block).toBe(true);
  });
});

describe('Goal verifier reminder', () => {
  it('says the run is offline and that missing evidence is a PARTIAL verdict', () => {
    const reminder = renderGoalVerifierReminder(hostContext);

    expect(reminder).toMatch(/no network access|offline/iu);
    expect(reminder).toMatch(/web_fetch/u);
    expect(reminder).toMatch(/PARTIAL/u);
  });
});
