import { describe, expect, it } from 'vitest';
import { buildWorkerPrompt, buildWorkerSystemPrompt } from '../../src/worker-prompt.js';
import type { PlanPacket } from '../../src/types.js';

const packet: PlanPacket = {
  id: 'p3',
  title: 'Scheduler: lock around queue access',
  goal: 'Serialise access to the run queue so two workers cannot dequeue the same entry.',
  scope: ['src/scheduler/**'],
  readonly: ['src/types/**'],
  depends_on: ['p1'],
  accept: [
    { cmd: 'pnpm test src/scheduler', must: 'exit0' },
    { cmd: 'pnpm tsc --noEmit', must: 'exit0' },
  ],
  max_repairs: 2,
};

describe('worker prompt', () => {
  it('carries the goal, scope, readonly paths and acceptance commands', () => {
    const prompt = buildWorkerPrompt({ packet, worktreeDir: '/tmp/wt/p3', attempt: 0 });
    expect(prompt).toContain(packet.goal);
    expect(prompt).toContain('src/scheduler/**');
    expect(prompt).toContain('src/types/**');
    expect(prompt).toContain('pnpm test src/scheduler');
    expect(prompt).toContain('pnpm tsc --noEmit');
    expect(prompt).toContain('/tmp/wt/p3');
  });

  it('states the scope and readonly rules as hard constraints', () => {
    const prompt = buildWorkerPrompt({ packet, worktreeDir: '/tmp/wt/p3', attempt: 0 });
    // ULT-02 depends on this instruction being unambiguous.
    expect(prompt).toMatch(/only (change|modify|edit)/iu);
    expect(prompt).toMatch(/read-?only/iu);
    expect(prompt).toMatch(/reject/iu);
  });

  it('forbids git push and network access in the stable system prompt', () => {
    // These are boundary rules, not packet facts, so they live in the system prompt.
    const system = buildWorkerSystemPrompt();
    expect(system).toMatch(/never run `?git push/iu);
    expect(system).toMatch(/no network access/iu);
  });

  it('does not leak the run goal, other packets, or plan internals', () => {
    const prompt = buildWorkerPrompt({ packet, worktreeDir: '/tmp/wt/p3', attempt: 0 });
    // Self-contained: nothing about the wider plan or siblings.
    expect(prompt).not.toMatch(/p1\b/u);
    expect(prompt).not.toContain('Parallel waves');
    expect(prompt).not.toContain('plan.json');
  });

  it('includes the failure output and a violation note on a repair attempt', () => {
    const prompt = buildWorkerPrompt({
      packet,
      worktreeDir: '/tmp/wt/p3',
      attempt: 1,
      failure: {
        kind: 'gate',
        output: 'FAIL src/scheduler/queue.test.ts > serialises dequeue\n  AssertionError: expected 2 to be 1',
      },
    });
    expect(prompt).toContain('AssertionError: expected 2 to be 1');
    expect(prompt).toMatch(/previous attempt/iu);
  });

  it('includes the scope violation on a scope repair', () => {
    const prompt = buildWorkerPrompt({
      packet,
      worktreeDir: '/tmp/wt/p3',
      attempt: 1,
      failure: {
        kind: 'scope',
        output: 'changed src/billing/invoice.ts which is outside src/scheduler/**',
      },
    });
    expect(prompt).toContain('src/billing/invoice.ts');
    // The scope heading states the rule the worker must re-read.
    expect(prompt).toMatch(/not allowed to touch/iu);
  });

  it('names the attempt number so a repair is visibly a repair', () => {
    expect(buildWorkerPrompt({ packet, worktreeDir: '/w', attempt: 2 })).toMatch(/attempt 3/iu);
  });

  it('keeps the system prompt free of packet specifics and states the tool boundary', () => {
    const system = buildWorkerSystemPrompt();
    expect(system).toMatch(/local tools only|files and shell/iu);
    expect(system).toMatch(/no network/iu);
    expect(system).not.toContain('src/scheduler/**');
  });
});
