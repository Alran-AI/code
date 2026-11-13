import { rename } from 'node:fs/promises';
import path from 'node:path';

import {
  STORE_LEDGER_SCHEMA,
  type InstalledStoreRecord,
  type StoreEntryKind,
  type StoreLedger,
} from './contract.js';
import { readTextIfExists, randomSuffix, storeRoot, writeTextAtomic } from './fs-util.js';

const EMPTY: StoreLedger = { schema: STORE_LEDGER_SCHEMA, plugins: {}, skills: {} };

/**
 * What the Store installed, and from where: `<data-dir>/store/installed.json`. A Plugin or Skill
 * directory that has no record here was put there by a person; the Store never overwrites or
 * removes one. Callers hold the store lock around a read-modify-write.
 */
export class StoreLedgerFile {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<StoreLedger> {
    const file = this.file();
    const text = await readTextIfExists(file);
    if (text === undefined) return EMPTY;
    try {
      const document = JSON.parse(text) as Record<string, unknown>;
      if (document.schema !== STORE_LEDGER_SCHEMA) throw new Error('unknown schema');
      return {
        schema: STORE_LEDGER_SCHEMA,
        plugins: readRecords(document.plugins),
        skills: readRecords(document.skills),
      };
    } catch {
      // Provenance is lost, nothing else: set the damaged file aside instead of deleting it. Its
      // directories then count as the person's own, which the Store treats as read-only.
      await rename(file, `${file}.corrupt-${randomSuffix()}`).catch(() => undefined);
      return EMPTY;
    }
  }

  async record(
    kind: StoreEntryKind,
    name: string,
    record: InstalledStoreRecord,
  ): Promise<StoreLedger> {
    const current = await this.read();
    const next = withRecord(current, kind, name, record);
    await this.write(next);
    return next;
  }

  async forget(kind: StoreEntryKind, name: string): Promise<StoreLedger> {
    const current = await this.read();
    const next = withRecord(current, kind, name, undefined);
    await this.write(next);
    return next;
  }

  private async write(ledger: StoreLedger): Promise<void> {
    await writeTextAtomic(this.file(), `${JSON.stringify(ledger, null, 2)}\n`);
  }

  private file(): string {
    return path.join(storeRoot(this.dataDir), 'installed.json');
  }
}

function withRecord(
  ledger: StoreLedger,
  kind: StoreEntryKind,
  name: string,
  record: InstalledStoreRecord | undefined,
): StoreLedger {
  const key = kind === 'plugin' ? 'plugins' : 'skills';
  const table = { ...ledger[key] };
  if (record) table[name] = record;
  else delete table[name];
  return { ...ledger, [key]: table };
}

function readRecords(value: unknown): Record<string, InstalledStoreRecord> {
  const records: Record<string, InstalledStoreRecord> = {};
  if (typeof value !== 'object' || value === null) return records;
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { source, version, contentDigest, installedAt } = raw as Record<string, unknown>;
    if (
      typeof source === 'string' &&
      typeof version === 'string' &&
      typeof contentDigest === 'string' &&
      typeof installedAt === 'string'
    ) {
      records[name] = { source, version, contentDigest, installedAt };
    }
  }
  return records;
}
