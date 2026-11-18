import type { LocalTaskRunnerHostWithSessionLookup } from '../api/local-task-host.js';
import { logger } from '../common/logger.js';

interface ActiveBackgroundTask {
  readonly settled: Promise<void>;
  readonly abort?: (reason: string) => void;
  /** Bash and subagent tasks share the stop cascade but not the fan-out cap. */
  readonly kind: 'bash' | 'subagent';
  /**
   * Durable row identity, published by the runner before it writes the row.
   * Admission happens before `createBackgroundTaskId()`, so this stays undefined
   * until the runner has selected the id and the task is not claimed yet.
   */
  taskId?: string;
}

interface HostBackgroundTaskState {
  closing: boolean;
  readonly active: Set<ActiveBackgroundTask>;
  /** Execution slots held by child turns that are actually running. */
  readonly runningSubagents: Set<symbol>;
  readonly slotWaiters: Set<() => void>;
}

/** Bound a single turn's child-Agent fan-out without capping background Bash. */
export const MAX_CONCURRENT_SUBAGENT_TASKS = 8;

export interface BackgroundTaskAdmission {
  bind(settled: Promise<void>): void;
  release(): void;
  /**
   * Claim the durable task row for this process. Only claimed tasks may be
   * stopped by a Session cascade: `performStop` writes `canceled` whether or not
   * `stopRuntime` actually reached a live runner, so stopping a row owned by
   * another client process (shared data directory) would mark it canceled while
   * it keeps running there. Unclaimed rows are skipped instead.
   */
  identify(taskId: string): void;
}

const hostStates = new WeakMap<LocalTaskRunnerHostWithSessionLookup, HostBackgroundTaskState>();

export function admitBackgroundTask(
  host: LocalTaskRunnerHostWithSessionLookup,
  abort?: (reason: string) => void,
  kind: ActiveBackgroundTask['kind'] = 'bash',
): BackgroundTaskAdmission {
  const state = getHostState(host);
  if (state.closing) throw new Error('Local Runtime is shutting down');

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const settled = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const active: ActiveBackgroundTask = { settled, kind, ...(abort ? { abort } : {}) };
  state.active.add(active);
  const forget = () => {
    state.active.delete(active);
  };
  void settled.then(forget, forget);

  let bound = false;
  return {
    bind: (task) => {
      if (bound) throw new Error('Background task admission already settled');
      bound = true;
      void task.then(resolve, reject);
    },
    release: () => {
      if (bound) return;
      bound = true;
      resolve();
    },
    identify: (taskId) => {
      active.taskId = taskId;
    },
  };
}

/**
 * Reserves one child-Agent execution slot. Admission itself stays immediate so
 * the parent gets every task id back at once; only the child turn waits here.
 * The returned release function must be called when that turn settles.
 */
export async function waitForSubagentSlot(
  host: LocalTaskRunnerHostWithSessionLookup,
  signal?: AbortSignal,
): Promise<() => void> {
  const state = getHostState(host);
  for (;;) {
    if (state.closing) throw new Error('Local Runtime is shutting down');
    if (signal?.aborted) throw new Error('Operation aborted');
    if (state.runningSubagents.size < MAX_CONCURRENT_SUBAGENT_TASKS) {
      const token = Symbol('subagent-slot');
      state.runningSubagents.add(token);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        state.runningSubagents.delete(token);
        releaseSlotWaiters(state);
      };
    }
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('Operation aborted'));
      };
      const cleanup = () => {
        state.slotWaiters.delete(wake);
        signal?.removeEventListener('abort', onAbort);
      };
      state.slotWaiters.add(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

function releaseSlotWaiters(state: HostBackgroundTaskState): void {
  if (state.slotWaiters.size === 0) return;
  const next = state.slotWaiters.values().next().value;
  if (next) next();
}

/**
 * Whether this process admitted (and therefore can actually stop) the task.
 *
 * The entry is removed as soon as the task settles, so a terminal task always
 * answers `false`; callers only need this for non-terminal rows, which are the
 * ones a cascade would otherwise mis-cancel.
 */
export function isBackgroundTaskAdmittedHere(
  host: LocalTaskRunnerHostWithSessionLookup,
  taskId: string,
): boolean {
  const state = hostStates.get(host);
  if (!state) return false;
  for (const task of state.active) {
    if (task.taskId === taskId) return true;
  }
  return false;
}

/** Abort this task's runner, including setup before its child Turn is admitted. */
export function abortAdmittedBackgroundTask(
  host: LocalTaskRunnerHostWithSessionLookup,
  taskId: string,
  reason: string,
): void {
  for (const task of hostStates.get(host)?.active ?? []) {
    if (task.taskId !== taskId || !task.abort) continue;
    try {
      task.abort(reason);
    } catch {
      try {
        logger.warn(
          { event: 'background_task_admission_abort_failed', taskId, reason },
          'Background task admission abort failed',
        );
      } catch {
        // Diagnostics must not skip the host's existing process/Turn stop.
      }
    }
  }
}

export function beginBackgroundTaskShutdown(
  host: LocalTaskRunnerHostWithSessionLookup,
  reason = 'runtime-shutdown',
): number {
  const state = getHostState(host);
  state.closing = true;
  for (const wake of [...state.slotWaiters]) wake();
  let aborted = 0;
  for (const task of state.active) {
    if (!task.abort) continue;
    task.abort(reason);
    aborted += 1;
  }
  return aborted;
}

export async function drainBackgroundTasks(
  host: LocalTaskRunnerHostWithSessionLookup,
): Promise<void> {
  const results = await Promise.allSettled(
    [...getHostState(host).active].map(({ settled }) => settled),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}

async function shutdownBackgroundTasks(
  host: LocalTaskRunnerHostWithSessionLookup,
  reason: string,
): Promise<number> {
  const aborted = beginBackgroundTaskShutdown(host, reason);
  await drainBackgroundTasks(host);
  return aborted;
}

export { shutdownBackgroundTasks };

function getHostState(host: LocalTaskRunnerHostWithSessionLookup): HostBackgroundTaskState {
  let state = hostStates.get(host);
  if (!state) {
    state = {
      closing: false,
      active: new Set(),
      runningSubagents: new Set(),
      slotWaiters: new Set(),
    };
    hostStates.set(host, state);
  }
  return state;
}
