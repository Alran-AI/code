import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DatabaseClient, loadSqlite3Constructor } from './client.js';

describe('DatabaseClient WAL handling', () => {
  let dataDir: string;
  let walPath: string;
  let databasePath: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'alran-db-client-'));
    databasePath = join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');
    walPath = `${databasePath}-wal`;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function writeRows(client: DatabaseClient, count: number): void {
    client.rawDb.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, body TEXT)');
    const insert = client.rawDb.prepare('INSERT INTO t (body) VALUES (?)');
    client.rawDb.transaction(() => {
      for (let index = 0; index < count; index += 1) insert.run('x'.repeat(2048));
    })();
  }

  it('leaves no WAL content behind on close while another connection is still open', () => {
    // The legacy host keeps a second connection open for the life of the
    // process, so closing the client is not the last close and SQLite does not
    // reset the WAL by itself.
    const client = new DatabaseClient({ dataDir });
    writeRows(client, 400);
    expect(statSync(walPath).size).toBeGreaterThan(0);
    const Database = loadSqlite3Constructor();
    const other = new Database(databasePath);
    other.prepare('SELECT COUNT(*) AS n FROM t').get();
    try {
      client.close();
      expect(existsSync(walPath) ? statSync(walPath).size : 0).toBe(0);
    } finally {
      other.close();
    }
  });

  it('keeps every committed row after the checkpoint', () => {
    const client = new DatabaseClient({ dataDir });
    writeRows(client, 50);
    client.close();

    const reopened = new DatabaseClient({ dataDir });
    try {
      const row = reopened.rawDb.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number };
      expect(row.n).toBe(50);
    } finally {
      reopened.close();
    }
  });

  it('truncates a WAL left by an earlier run when asked', () => {
    const client = new DatabaseClient({ dataDir });
    writeRows(client, 400);
    const Database = loadSqlite3Constructor();
    const other = new Database(databasePath);
    try {
      expect(statSync(walPath).size).toBeGreaterThan(0);
      client.checkpoint('TRUNCATE');
      expect(statSync(walPath).size).toBe(0);
      expect((client.rawDb.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n).toBe(
        400,
      );
    } finally {
      other.close();
      client.close();
    }
  });

  it('does not throw for a client that was never opened or is already closed', () => {
    const never = new DatabaseClient({ dataDir });
    expect(() => never.checkpoint('TRUNCATE')).not.toThrow();
    expect(existsSync(databasePath)).toBe(false);

    const client = new DatabaseClient({ dataDir });
    writeRows(client, 1);
    client.close();
    expect(() => client.checkpoint('TRUNCATE')).not.toThrow();
    expect(() => client.close()).not.toThrow();
  });
});
