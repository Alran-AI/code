/**
 * The task service owns both the park/wake loop and the child-Agent fan-out
 * limit. Both are exercised here with an in-memory task store.
 */
import { describe, expect, it } from 'vitest';
import type { LocalRuntimeToolContext } from '@alran/agent-tools/desktop';

import type {
  BackgroundTask,
  BackgroundTaskPatch,
  TaskListResult,
  TaskOutputStore,
  TaskQuery,
  TaskStore,
} from '../../src/background-task/domain.js';
import {
  MAX_CONCURRENT_SUBAGENT_TASKS,
  waitForSubagentSlot,
} from '../../src/background-task/lifecycle.js';
import { LocalBackgroundTaskService } from '../../src/background-task/service.js';
import { backgroundBashHost, taskRecord } from './background-task-test-helpers.js';

class MemoryTaskStore implements TaskStore {
  readonly tasks = new Map<string, BackgroundTask>();

  async create(task: BackgroundTask): Promise<BackgroundTask> {
    this.tasks.set(task.taskId, task);
    return task;
  }

  async get(taskId: string): Promise<BackgroundTask | undefined> {
    return this.tasks.get(taskId);
  }

  async list(query: TaskQuery): Promise<TaskListResult> {
    return {
      items: [...this.tasks.values()].filter(
        (task) => !query.ownerSessionId || task.ownerSessionId === query.ownerSessionId,
      ),
    };
  }

  async snapshotPending(): Promise<BackgroundTask[]> {
    return [...this.tasks.values()];
  }

  async reminderSnapshot(): Promise<{
    tasks: BackgroundTask[];
    undeliveredTotal: number;
    terminalTotal: number;
  }> {
    return { tasks: [], undeliveredTotal: 0, terminalTotal: 0 };
  }

  async patch(taskId: string, patch: BackgroundTaskPatch): Promise<BackgroundTask> {
    const current = this.tasks.get(taskId);
    if (!current) throw new Error(`Unknown task ${taskId}`);
    const next = { ...current, ...patch } as BackgroundTask;
    this.tasks.set(taskId, next);
    return next;
  }

  async updateStatus(taskId: string, status: BackgroundTask['status']): Promise<BackgroundTask> {
    return this.patch(taskId, { status } as BackgroundTaskPatch);
  }

  async appendEvent(): Promise<void> {}
}

const outputStore = {
  append: async () => ({ offset: 0, bytes: 0 }),
  read: async () => ({ content: '', nextOffset: 0 }),
  tail: async () => ({ content: '', nextOffset: 0 }),
  finalize: async () => undefined,
} as unknown as TaskOutputStore;

const ctx = { sessionId: 'session-a', turnId: 'turn-1' } as LocalRuntimeToolContext;

function fixture() {
  const store = new MemoryTaskStore();
  const service = new LocalBackgroundTaskService({ store, outputStore });
  return { store, service };
}

describe('task_wait', () => {
  it('wakes as soon as a watched task commits a terminal state', async () => {
    const { service } = fixture();
    await service.create(taskRecord('task-1', 'session-a', { status: 'running' }));

    const pending = service.waitForTasks(ctx, { taskIds: ['task-1'], waitMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.patch('task-1', { status: 'succeeded' });
    const result = await pending;

    expect(result.tasks).toEqual([
      expect.objectContaining({ task_id: 'task-1', status: 'succeeded' }),
    ]);
    expect(result.timedOut).toBe(false);
  });

  it('returns a bounded timeout while the work keeps running', async () => {
    const { service } = fixture();
    const task = await service.create(
      taskRecord('task-2', 'session-a', { status: 'running' }),
    );
    expect(task.status).toBe('running');

    const started = Date.now();
    const result = await service.waitForTasks(ctx, { taskIds: ['task-2'], waitMs: 60 });

    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(result.tasks[0]?.status).toBe('running');
  });

  it('clamps an agent-supplied deadline and treats unknown ids as settled', async () => {
    const { service } = fixture();
    const result = await service.waitForTasks(ctx, {
      taskIds: ['missing'],
      waitMs: 900_000,
    });
    expect(result.effective_wait_ms).toBe(600_000);
    expect(result.wait_ms_clamped).toBe(true);
    expect(result.tasks[0]?.status).toBe('not_found');
    expect(result.timedOut).toBe(false);
  });

  it('waits for every active task in the session when no ids are given', async () => {
    const { service } = fixture();
    await service.create(taskRecord('task-3', 'session-a', { status: 'running' }));
    await service.create(taskRecord('other-session', 'session-b', { status: 'running' }));

    const pending = service.waitForTasks(ctx, { waitMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.patch('task-3', { status: 'succeeded' });
    const result = await pending;

    expect(result.tasks.map((task) => task.task_id)).toEqual(['task-3']);
    expect(result.timedOut).toBe(false);
  });
});

describe('subagent fan-out limit', () => {
  it('runs at most eight child Agents and queues the rest without blocking the parent', async () => {
    const { service } = fixture();
    const host = backgroundBashHost(service, '/tmp');
    const releases: Array<() => void> = [];
    try {
      for (let index = 0; index < MAX_CONCURRENT_SUBAGENT_TASKS; index += 1) {
        releases.push(await waitForSubagentSlot(host));
      }
      let overflowStarted = false;
      const overflow = waitForSubagentSlot(host).then((release) => {
        overflowStarted = true;
        releases.push(release);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(overflowStarted).toBe(false);

      releases[0]?.();
      await overflow;
      expect(overflowStarted).toBe(true);
    } finally {
      for (const release of releases) release();
    }
  });

  it('lets an aborted queued child release its wait without a slot', async () => {
    const { service } = fixture();
    const host = backgroundBashHost(service, '/tmp');
    const releases: Array<() => void> = [];
    const controller = new AbortController();
    try {
      for (let index = 0; index < MAX_CONCURRENT_SUBAGENT_TASKS; index += 1) {
        releases.push(await waitForSubagentSlot(host));
      }
      const queued = waitForSubagentSlot(host, controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      await expect(queued).rejects.toThrow('Operation aborted');
    } finally {
      for (const release of releases) release();
    }
  });
});
