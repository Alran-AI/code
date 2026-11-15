import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertV2MigrationSucceeded,
  ensureCurrentLocalRuntimeDataMigratedToV2OrThrow,
  type V2MigrationManifest,
} from '../../src/persistence/migration/v2-migration.js';

const failed = (errors: string[]): V2MigrationManifest =>
  ({ status: 'failed', errors }) as unknown as V2MigrationManifest;

describe('a runtime database that cannot be opened', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alran-corrupt-db-'));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('says which file is damaged and how to move it aside', () => {
    const file = path.join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');

    let message = '';
    try {
      assertV2MigrationSucceeded(
        failed(['sqlite:runtime-state:open:database disk image is malformed']),
        dataDir,
      );
    } catch (error) {
      message = (error as Error).message;
    }

    // The machine-readable start stays as it was.
    expect(message.startsWith('current_local_runtime_v2_migration_failed:sqlite:runtime-state:open:')).toBe(
      true,
    );
    expect(message).toContain('database disk image is malformed');
    expect(message).toContain(file);
    expect(message).toMatch(/mv .*runtime-state\.sqlite/u);
    expect(message).toMatch(/stop every Alran Code process/iu);
  });

  it.each([
    ['sqlite:runtime-state:open', 'database disk image is malformed'],
    ['sqlite:runtime-state:schema-check', 'database disk image is malformed'],
    ['sqlite:dev-draft-v2:schema-check', 'file is not a database'],
  ])('adds the hint for %s: %s', (step, reason) => {
    expect(() => assertV2MigrationSucceeded(failed([`${step}:${reason}`]), dataDir)).toThrow(
      /runtime-state\.sqlite/u,
    );
  });

  it('leaves every other migration failure exactly as it was', () => {
    for (const errors of [
      ['sqlite:runtime-state:open:database is locked'],
      // A damaged source database is a different file than the one the hint names.
      ['sqlite:legacy-current:copy:file is not a database'],
      ['copy:sessions:EACCES'],
      [],
    ]) {
      expect(() => assertV2MigrationSucceeded(failed(errors), dataDir)).toThrow(
        new Error(`current_local_runtime_v2_migration_failed:${errors.join('; ') || 'unknown'}`),
      );
    }
  });

  it('reaches the user through the start-up path with a real damaged file', () => {
    const file = path.join(dataDir, 'v2', 'sqlite', 'runtime-state.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'this is not a database '.repeat(500));

    expect(() => ensureCurrentLocalRuntimeDataMigratedToV2OrThrow(dataDir)).toThrow(
      new RegExp(file.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    );
  });
});
