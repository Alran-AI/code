import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  StoreError,
  type InstalledStoreRecord,
  type StoreEntry,
  type StoreEntryKind,
  type StoreLedger,
} from './contract.js';
import {
  readStoreArchive,
  sha256Hex,
  StoreArchiveError,
  type StoreArchiveFile,
} from './archive.js';
import {
  pathExists,
  randomSuffix,
  removeTree,
  renameDirectory,
  storeRoot,
  withStoreLock,
} from './fs-util.js';
import { inspectPluginFiles, inspectSkillFiles } from './inspect.js';
import type { PluginInspection, SkillInspection } from './inspect.js';
import { StoreLedgerFile } from './ledger.js';
import type { StoreTransport } from './transport.js';

export interface StagedInstall {
  readonly entry: StoreEntry;
  readonly sourceId: string;
  readonly inspection: PluginInspection | SkillInspection;
  /** The version the Store put there before, when this is an update. */
  readonly replacesVersion?: string;
  /** Directory the package will be installed into. */
  readonly target: string;
  readonly files: readonly StoreArchiveFile[];
  readonly contentDigest: string;
}

export interface StoreInstallerOptions {
  readonly dataDir: string;
  readonly transport: StoreTransport;
  readonly now?: () => Date;
}

/**
 * Installs a package in two steps. `stage` downloads, verifies and inspects it and touches nothing
 * in the data directory; `commit` writes it. The caller shows `inspection.executes` between the
 * two steps and passes `consent: true` to `commit` for a package that runs commands.
 */
export class StoreInstaller {
  private readonly ledgerFile: StoreLedgerFile;
  private readonly now: () => Date;

  constructor(private readonly options: StoreInstallerOptions) {
    this.ledgerFile = new StoreLedgerFile(options.dataDir);
    this.now = options.now ?? (() => new Date());
  }

  ledger(): Promise<StoreLedger> {
    return this.ledgerFile.read();
  }

  installDirectory(kind: StoreEntryKind, name: string): string {
    return path.join(this.options.dataDir, kind === 'plugin' ? 'plugins' : 'skills', name);
  }

  async stage(
    entry: StoreEntry,
    sourceId: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<StagedInstall> {
    const ledger = await this.ledgerFile.read();
    const table = entry.kind === 'plugin' ? ledger.plugins : ledger.skills;
    const owned = table[entry.name];
    const target = this.installDirectory(entry.kind, entry.name);
    if (owned && owned.source !== sourceId) {
      throw new StoreError(
        'CONFLICT',
        `"${entry.name}" is installed from the "${owned.source}" store; remove it before installing it from "${sourceId}".`,
      );
    }
    if (!owned && (await pathExists(target))) {
      throw new StoreError(
        'CONFLICT',
        `${target} already exists and was not installed by the Store. Move or remove it first; the Store never overwrites a ${entry.kind} you put there.`,
      );
    }
    const bytes = await this.options.transport.readBytes(entry.archive.url, {
      maxBytes: entry.archive.size,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (bytes.length !== entry.archive.size) {
      throw new StoreError(
        'DIGEST_MISMATCH',
        `${entry.name}: the archive is ${bytes.length} bytes, the index says ${entry.archive.size}.`,
      );
    }
    if (sha256Hex(bytes) !== entry.archive.archiveSha256) {
      throw new StoreError(
        'DIGEST_MISMATCH',
        `${entry.name}: the downloaded archive does not match the SHA-256 in the index. Nothing was installed.`,
      );
    }
    let files: readonly StoreArchiveFile[];
    let contentDigest: string;
    try {
      ({ files, contentDigest } = readStoreArchive(bytes));
    } catch (error) {
      if (error instanceof StoreArchiveError) {
        throw new StoreError('ARCHIVE_INVALID', `${entry.name}: ${error.message}`, {
          cause: error,
        });
      }
      throw error;
    }
    if (contentDigest !== entry.archive.contentDigest) {
      throw new StoreError(
        'DIGEST_MISMATCH',
        `${entry.name}: the unpacked files do not match the content digest in the index. Nothing was installed.`,
      );
    }
    const inspection =
      entry.kind === 'plugin'
        ? inspectPluginFiles(files, { name: entry.name, version: entry.version })
        : inspectSkillFiles(files, { name: entry.name });
    return {
      entry,
      sourceId,
      inspection,
      ...(owned ? { replacesVersion: owned.version } : {}),
      target,
      files,
      contentDigest,
    };
  }

  async commit(
    staged: StagedInstall,
    options: { readonly consent: boolean },
  ): Promise<InstalledStoreRecord> {
    if (staged.inspection.requiresConsent && !options.consent) {
      throw new StoreError(
        'CONSENT_REQUIRED',
        `${staged.entry.name} runs commands or connects to services (${staged.inspection.executes.length}); it was not installed because it was not approved.`,
      );
    }
    return withStoreLock(this.options.dataDir, async () => {
      // Re-check under the lock: another process may have installed something there meanwhile.
      const ledger = await this.ledgerFile.read();
      const table = staged.entry.kind === 'plugin' ? ledger.plugins : ledger.skills;
      const owned = table[staged.entry.name];
      const exists = await pathExists(staged.target);
      if (exists && (!owned || owned.source !== staged.sourceId)) {
        throw new StoreError('CONFLICT', `${staged.target} appeared while installing; left alone.`);
      }
      const suffix = randomSuffix();
      const stageDirectory = path.join(storeRoot(this.options.dataDir), 'staging', suffix);
      const trashDirectory = path.join(storeRoot(this.options.dataDir), 'trash', suffix);
      try {
        await writeTree(stageDirectory, staged.files);
        if (exists) renameDirectory(staged.target, trashDirectory);
        try {
          renameDirectory(stageDirectory, staged.target);
        } catch (error) {
          if (exists) renameDirectory(trashDirectory, staged.target);
          throw error;
        }
      } catch (error) {
        removeTree(stageDirectory);
        if (error instanceof StoreError) throw error;
        throw new StoreError(
          'INSTALL_FAILED',
          `Could not install ${staged.entry.name}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      removeTree(trashDirectory);
      const record: InstalledStoreRecord = {
        source: staged.sourceId,
        version: staged.entry.version,
        contentDigest: staged.contentDigest,
        installedAt: this.now().toISOString(),
      };
      await this.ledgerFile.record(staged.entry.kind, staged.entry.name, record);
      return record;
    });
  }

  /**
   * Deletes a package the Store installed. Refuses a directory that has no ledger record: that one
   * belongs to the person, whatever its name.
   */
  async remove(kind: StoreEntryKind, name: string): Promise<boolean> {
    return withStoreLock(this.options.dataDir, async () => {
      const ledger = await this.ledgerFile.read();
      const owned = (kind === 'plugin' ? ledger.plugins : ledger.skills)[name];
      if (!owned) {
        throw new StoreError(
          'NOT_FOUND',
          `"${name}" was not installed by the Store, so the Store will not delete it.`,
        );
      }
      const target = this.installDirectory(kind, name);
      const existed = await pathExists(target);
      if (existed) removeTree(target);
      await this.ledgerFile.forget(kind, name);
      return existed;
    });
  }

  /** Forgets a record whose directory is already gone. */
  async forget(kind: StoreEntryKind, name: string): Promise<void> {
    await withStoreLock(this.options.dataDir, async () => {
      await this.ledgerFile.forget(kind, name);
    });
  }
}

async function writeTree(root: string, files: readonly StoreArchiveFile[]): Promise<void> {
  await mkdir(root, { recursive: true });
  const resolvedRoot = path.resolve(root);
  for (const file of files) {
    const destination = path.resolve(resolvedRoot, ...file.path.split('/'));
    if (!destination.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new StoreError('ARCHIVE_INVALID', `${file.path} would be written outside the package.`);
    }
    // eslint-disable-next-line no-await-in-loop
    await mkdir(path.dirname(destination), { recursive: true });
    // `wx`: an archive that lists a path twice (the reader forbids it) still cannot overwrite.
    // eslint-disable-next-line no-await-in-loop
    await writeFile(destination, file.content, { flag: 'wx', mode: 0o644 });
  }
}
