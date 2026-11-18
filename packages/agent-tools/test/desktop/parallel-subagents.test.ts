/**
 * The native fan-out surface: parallel delegation, one-call spawn, and park.
 * These tests pin the tool contract without starting real child Agents.
 */
import type { RuntimeTool } from '@alran/agent-core/tools';
import { describe, expect, it, vi } from 'vitest';

import {
  LocalTaskSpawnToolDef,
  LocalTaskToolDef,
  LocalTaskWaitToolDef,
} from '../../src/desktop/builtin-defs.js';
import { filterCanonicalNativeToolCeiling } from '../../src/desktop/canonical-tool-policy.js';
import { LocalTaskSpawnTool } from '../../src/desktop/local-task-spawn.js';
import { LocalTaskWaitTool } from '../../src/desktop/local-task-wait.js';
import type {
  LocalRuntimeToolContext,
  LocalTaskAdapter,
  LocalTaskControlAdapter,
} from '../../src/desktop/types.js';

const ctx = { sessionId: 'session-1', turnId: 'turn-1' } as LocalRuntimeToolContext;

function fakeTaskAdapter(
  startBackground: LocalTaskAdapter['startBackground'],
): LocalTaskAdapter {
  return { startBackground, runForeground: vi.fn() };
}

describe('native parallel delegation', () => {
  it('declares task parallel so Pi can overlap a batch of delegations', () => {
    expect(LocalTaskToolDef.executionMode).toBe('parallel');
    expect(LocalTaskSpawnToolDef.executionMode).toBe('parallel');
    // A park operation must not race the rest of its tool batch.
    expect(LocalTaskWaitToolDef.executionMode).toBe('sequential');
  });

  it('task_spawn starts every agent in the background and returns all handles', async () => {
    const startBackground = vi.fn(async (_ctx: unknown, input: { description: string; agent_name: string }) => ({
      status: 'started' as const,
      taskId: `task-${input.description}`,
      subSessionId: `session-${input.description}`,
    }));
    const tool = new LocalTaskSpawnTool(fakeTaskAdapter(startBackground as never));

    const result = await tool.execute(ctx, {
      label: 'recon',
      agents: [
        { description: 'map repo', prompt: 'Map the repo.', agent_name: 'explore' },
        { description: 'check docs', prompt: 'Review the docs.', agent_name: 'verifier' },
      ],
    });

    expect(startBackground).toHaveBeenCalledTimes(2);
    for (const call of startBackground.mock.calls) {
      expect(call[1]).toMatchObject({ run_in_background: true });
    }
    expect(startBackground.mock.calls[0]?.[1]).toMatchObject({ agent_name: 'explore' });
    expect(result.details).toMatchObject({ started: 2, total: 2 });
    expect(result.details?.task_ids).toEqual(['task-map repo', 'task-check docs']);
    expect(result.text).toContain('<task_spawn label="recon" started="2" total="2">');
    expect(result.text).toContain('task_id="task-map repo"');
    expect(result.text).toContain('session_id="session-check docs"');
  });

  it('task_spawn reports partial failure without hiding successful starts', async () => {
    let call = 0;
    const startBackground = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { status: 'started' as const, taskId: 'task-ok' }
        : { status: 'failed' as const, errorMessage: 'Unknown agent' };
    });
    const tool = new LocalTaskSpawnTool(fakeTaskAdapter(startBackground));

    const result = await tool.execute(ctx, {
      label: 'mixed',
      agents: [
        { description: 'one', prompt: 'first', agent_name: 'explore' },
        { description: 'two', prompt: 'second', agent_name: 'missing' },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(result.details).toMatchObject({ started: 1, total: 2 });
    expect(result.text).toContain('status="failed"');
    expect(result.text).toContain('Unknown agent');
  });

  it('task_wait forwards the ids and the agent-supplied deadline to the task service', async () => {
    const waitForTasks = vi.fn(async () => ({
      tasks: [{ task_id: 'task-a', status: 'succeeded' as const }],
      timedOut: false,
      effective_wait_ms: 120_000,
      wait_ms_clamped: false,
    }));
    const tool = new LocalTaskWaitTool({ waitForTasks } as unknown as LocalTaskControlAdapter);

    const result = await tool.execute(ctx, { task_ids: ['task-a'], wait_ms: 120_000 });

    expect(waitForTasks).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ taskIds: ['task-a'], waitMs: 120_000 }),
    );
    expect(result.text).toContain('status="succeeded"');
    expect(result.details).toMatchObject({ timedOut: false, effective_wait_ms: 120_000 });
  });

  it('omitted task ids mean every active task in this session', async () => {
    const waitForTasks = vi.fn(async () => ({
      tasks: [],
      timedOut: true,
      effective_wait_ms: 600_000,
      wait_ms_clamped: true,
    }));
    const tool = new LocalTaskWaitTool({ waitForTasks } as unknown as LocalTaskControlAdapter);

    const result = await tool.execute(ctx, { wait_ms: 900_000 });

    expect(waitForTasks.mock.calls[0]?.[1]).toMatchObject({ waitMs: 900_000 });
    expect(waitForTasks.mock.calls[0]?.[1].taskIds).toBeUndefined();
    expect(result.text).toContain('timed_out="true"');
    expect(result.text).toContain('capped at 600000 ms');
  });

  it('blocks canonical subagents from spawning or parking', () => {
    const names = ['task', 'task_append', 'task_spawn', 'task_wait'];
    const tools = names.map(
      (name) =>
        ({ def: { name }, execute: async () => ({ tool_name: name, text: '', content: [] }) }) as unknown as RuntimeTool,
    );
    for (const role of ['explore', 'worker', 'verifier']) {
      const allowed = filterCanonicalNativeToolCeiling(tools, role, true).map((tool) => tool.def.name);
      expect(allowed).not.toContain('task_spawn');
      expect(allowed).not.toContain('task_wait');
    }
  });
});
