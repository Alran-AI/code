import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseClient } from '../packages/local-runtime-v2/src/infra/db/client.js';
import { runWithWriteLock } from '../packages/local-runtime-v2/src/infra/db/write-transaction.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(options: { retryBusyAdmission?: boolean } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'alran-immediate-retry-'));
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }));
  const client = new DatabaseClient({ dataDir, ...options });
  cleanup.push(() => client.close());
  client.db.run(sql`CREATE TABLE probe (value INTEGER)`);
  // A short native wait keeps these tests fast; the policy under test is what happens after it.
  client.db.run(sql`PRAGMA busy_timeout = 50`);
  return { client, dataDir };
}

/** Another process that holds the write lock for `durationMs`, as a second Alran process would. */
async function holdWriter(dataDir: string, durationMs: number) {
  const file = join(dataDir, 'lock-holder.cjs');
  await writeFile(
    file,
    `
    const Database = require(process.argv[2]);
    const db = new Database(process.argv[3]);
    db.exec('BEGIN IMMEDIATE');
    process.send('locked');
    setTimeout(() => { db.exec('COMMIT'); db.close(); process.disconnect(); }, Number(process.argv[4]));
  `,
  );
  const child = fork(
    file,
    [
      createRequire(import.meta.url).resolve('better-sqlite3'),
      join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite'),
      String(durationMs),
    ],
    { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  const exited = once(child, 'exit');
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  await Promise.race([
    once(child, 'message'),
    exited.then(() => {
      throw new Error('Lock holder exited before acquiring the lock');
    }),
  ]);
  return { exited };
}

const insert = (value: number) => (tx: DatabaseClient['db']) =>
  tx.run(sql`INSERT INTO probe VALUES (${value})`);
const rows = (client: DatabaseClient) =>
  client.db.all<{ value: number }>(sql`SELECT value FROM probe`).map((row) => row.value);

it('fails an immediate transaction the moment the native wait is over when nothing retries it', async () => {
  const { client, dataDir } = await fixture();
  await holdWriter(dataDir, 800);

  expect(() => client.db.transaction(insert(1), { behavior: 'immediate' })).toThrow(
    expect.objectContaining({ code: 'SQLITE_BUSY' }),
  );
});

it('commits an immediate transaction once the foreign writer lets go, when admission is retried', async () => {
  const { client, dataDir } = await fixture({ retryBusyAdmission: true });
  await holdWriter(dataDir, 800);

  const result = client.db.transaction(
    (tx) => {
      insert(1)(tx);
      return 'done';
    },
    { behavior: 'immediate' },
  );

  expect(result).toBe('done');
  expect(rows(client)).toEqual([1]);
});

it('never replays a callback that has started, even when it fails with SQLITE_BUSY', async () => {
  const { client } = await fixture({ retryBusyAdmission: true });
  const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
  const callback = vi.fn((tx: DatabaseClient['db']) => {
    insert(1)(tx);
    throw busy;
  });

  expect(() => client.db.transaction(callback, { behavior: 'immediate' })).toThrow(busy);

  expect(callback).toHaveBeenCalledTimes(1);
  expect(rows(client)).toEqual([]);
});

it('hands any other failure straight back', async () => {
  const { client } = await fixture({ retryBusyAdmission: true });
  const failure = new Error('constraint');
  const callback = vi.fn(() => {
    throw failure;
  });

  expect(() => client.db.transaction(callback, { behavior: 'immediate' })).toThrow(failure);
  expect(callback).toHaveBeenCalledTimes(1);
});

it('leaves transactions that do not take the write lock at the start alone', async () => {
  const { client } = await fixture({ retryBusyAdmission: true });

  expect(client.db.transaction((tx) => tx.all(sql`SELECT 1 AS one`))).toEqual([{ one: 1 }]);
});

it('keeps the bounded asynchronous wait of runWithWriteLock short', async () => {
  const { client, dataDir } = await fixture({ retryBusyAdmission: true });
  await holdWriter(dataDir, 2_000);
  const mutation = vi.fn();
  const started = performance.now();

  await expect(runWithWriteLock(client.db, mutation, { timeoutMs: 200 })).rejects.toMatchObject({
    code: 'SQLITE_BUSY',
  });

  expect(performance.now() - started).toBeLessThan(1_000);
  expect(mutation).not.toHaveBeenCalled();
});
