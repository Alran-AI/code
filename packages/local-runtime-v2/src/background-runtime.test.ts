import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppDb } from './infra/db/client.js';
import { createBackgroundRuntime, type BackgroundRuntime } from './background-runtime.js';

const REPEAT_MS = 60_000;

describe('background maintenance of a long-running process', () => {
  let runtime: BackgroundRuntime | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  });

  afterEach(async () => {
    await runtime?.close();
    runtime = undefined;
    vi.useRealTimers();
  });

  async function started(task: () => Promise<unknown>, logger?: { warn: () => void; info: () => void }) {
    runtime = await createBackgroundRuntime({
      db: {} as AppDb,
      enableScheduler: false,
      maintenanceRepeatMs: REPEAT_MS,
      ...(logger ? { logger } : {}),
    });
    runtime.registerMaintenance('probe', task);
    runtime.startMaintenance();
    // The first pass is deferred to the next turn of the event loop.
    await vi.advanceTimersByTimeAsync(0);
    return runtime;
  }

  it('runs the registered tasks again while the process lives, not only at start-up', async () => {
    const task = vi.fn(async () => undefined);
    await started(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(REPEAT_MS * 3);
    expect(task).toHaveBeenCalledTimes(5);
  });

  it('does not start a pass while the previous one is still running', async () => {
    let release: (() => void) | undefined;
    const task = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await started(task);
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(REPEAT_MS * 3);
    expect(task).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    expect(task).toHaveBeenCalledTimes(2);
    release?.();
  });

  it('keeps going after a failed pass and reports it', async () => {
    const warn = vi.fn();
    const task = vi.fn(async () => {
      throw new Error('synthetic failure');
    });
    await started(task, { warn, info: vi.fn() });

    await vi.advanceTimersByTimeAsync(REPEAT_MS * 2);

    expect(task).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('stops repeating once the runtime is stopped', async () => {
    const task = vi.fn(async () => undefined);
    const background = await started(task);
    await vi.advanceTimersByTimeAsync(REPEAT_MS);
    const before = task.mock.calls.length;

    await background.stop();
    await vi.advanceTimersByTimeAsync(REPEAT_MS * 5);

    expect(task).toHaveBeenCalledTimes(before);
  });
});
