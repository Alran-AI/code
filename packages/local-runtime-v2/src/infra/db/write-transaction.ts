import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import type { AppDb } from './client.js';

const WRITE_LOCK_BUDGET_MS = 10_000;
const WRITE_LOCK_ATTEMPT_MS = 50;

const BUSY_ADMISSION_BUDGET_MS = 15_000;

/** Depth of the short, bounded admission attempts `runWithWriteLock` makes itself. */
let boundedAdmissionDepth = 0;

/** Whether the caller is inside one of `runWithWriteLock`'s own bounded admission attempts. */
export function inBoundedAdmissionAttempt(): boolean {
  return boundedAdmissionDepth > 0;
}

/**
 * Retries a write transaction that was refused its lock, for callers that cannot wait
 * asynchronously (the transaction API of the database driver is synchronous).
 *
 * Only admission is replayed: once `entered()` reports that the mutation callback has run, a
 * failure, whatever it is, belongs to the caller and nothing is replayed. Each attempt already
 * waits the connection's native busy timeout; between attempts the thread sleeps briefly with
 * jitter. After `budgetMs` in total the last busy error is thrown, exactly as without retry.
 */
export function retryBusyAdmission<T>(
  attempt: () => T,
  entered: () => boolean,
  budgetMs: number = BUSY_ADMISSION_BUDGET_MS,
): T {
  const deadline = performance.now() + budgetMs;
  for (let tries = 0; ; tries += 1) {
    try {
      return attempt();
    } catch (error) {
      const remaining = deadline - performance.now();
      if (entered() || !isBusy(error) || remaining <= 0) throw error;
      sleepSync(Math.min(remaining, 25 * 2 ** Math.min(tries, 4) + Math.random() * 25));
    }
  }
}

function sleepSync(delayMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Math.ceil(delayMs)));
}

/** Cancellation before the mutation callback starts; no write needs to be replayed. */
export class WriteLockWaitAbortedError extends Error {
  override readonly name = 'WriteLockWaitAbortedError';

  constructor(readonly signal: AbortSignal) {
    super('SQLite write lock wait was cancelled', { cause: signal.reason });
  }
}

/**
 * Retry only transaction admission: a callback that has started is never replayed.
 * The signal cancels contention waits, not an immediately available write. This
 * lets post-cancellation tool completion and cleanup messages remain durable.
 */
export async function runWithWriteLock<T>(
  db: AppDb,
  mutation: (tx: AppDb) => T,
  options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
): Promise<T> {
  const budget = options.timeoutMs ?? WRITE_LOCK_BUDGET_MS;
  if (!Number.isFinite(budget) || budget <= 0)
    throw new RangeError('Invalid write lock budget');
  const deadline = performance.now() + budget;
  let attempt = 0;
  let hasContended = false;
  let lastBusy: unknown = new Error('SQLite write lock wait exceeded its deadline');
  for (;;) {
    if (hasContended) throwIfWaitAborted(options.signal);
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw lastBusy;
    const previous = db.get<{ timeout: number }>(sql`PRAGMA busy_timeout`).timeout;
    let entered = false;
    try {
      const nativeWaitMs = options.signal?.aborted
        ? 0
        : Math.ceil(Math.min(WRITE_LOCK_ATTEMPT_MS, remaining));
      db.run(sql.raw(`PRAGMA busy_timeout = ${nativeWaitMs}`));
      boundedAdmissionDepth += 1;
      try {
        return db.transaction(
          (tx) => {
            entered = true;
            // Only lock acquisition gets a short timeout. Restore the connection's
            // policy before callbacks (including nested transactions) can use it.
            db.run(sql.raw(`PRAGMA busy_timeout = ${previous}`));
            return mutation(tx);
          },
          { behavior: 'immediate' },
        );
      } finally {
        boundedAdmissionDepth -= 1;
      }
    } catch (error) {
      if (entered || !isBusy(error)) throw error;
      lastBusy = error;
    } finally {
      // No await occurs while the shared connection has a temporary timeout.
      db.run(sql.raw(`PRAGMA busy_timeout = ${previous}`));
    }
    hasContended = true;
    throwIfWaitAborted(options.signal);
    const wait = Math.min(
      deadline - performance.now(),
      25 * 2 ** Math.min(attempt++, 3) + Math.random() * 25,
    );
    if (wait <= 0) throw lastBusy;
    try {
      await delay(wait, undefined, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted && error instanceof Error && error.name === 'AbortError') {
        throw new WriteLockWaitAbortedError(options.signal);
      }
      throw error;
    }
  }
}

function throwIfWaitAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new WriteLockWaitAbortedError(signal);
}

function isBusy(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_BUSY';
}
