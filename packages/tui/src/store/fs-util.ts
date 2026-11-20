import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { retryWindowsFileSystemOperation } from '@alran/shared';

export function storeRoot(dataDir: string): string {
  return path.join(dataDir, 'store');
}

export function randomSuffix(): string {
  return randomBytes(6).toString('hex');
}

export function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
  );
}

export async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * The same, read at once. A catalogue that is built while the screen draws reads a handful of
 * files, and a promise for each of them would hold the screen up.
 */
export function readTextIfExistsSync(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/**
 * The first line of a file, if it has one.
 *
 * A file that is written in two parts — a line of what is known about it, and then the rest — is
 * read without reading the rest. The cache of the Skills of a store holds a line like that in
 * front of a hundred megabytes of Skills, and the line is all that is needed to know whether the
 * Skills are the ones the cache expects.
 */
export function readFirstLineSync(file: string, maxBytes = 4_096): string | undefined {
  let handle: number | undefined;
  try {
    handle = openSync(file, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const read = readSync(handle, buffer, 0, maxBytes, 0);
    if (read === 0) return undefined;
    const text = buffer.toString('utf8', 0, read);
    const end = text.indexOf('\n');
    return end < 0 ? undefined : text.slice(0, end);
  } catch {
    // A file that cannot be read is a cache miss.
    return undefined;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

/** Writes through a sibling temp file and a rename, so a reader never sees half a document. */
export async function writeTextAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomSuffix()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
    retryWindowsFileSystemOperation(() => renameSync(temporary, file));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function renameDirectory(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  retryWindowsFileSystemOperation(() => renameSync(from, to));
}

export function removeTree(target: string): void {
  retryWindowsFileSystemOperation(() => rmSync(target, { recursive: true, force: true }));
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 15_000;

/**
 * Runs `work` while holding `<store>/lock`, a directory created atomically. A lock older than a
 * minute belongs to a process that died and is taken over. Two Alran processes (the TUI and a CLI
 * command) can therefore not interleave a read-modify-write of the ledger or a directory swap.
 */
export async function withStoreLock<T>(dataDir: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(storeRoot(dataDir), 'lock');
  await mkdir(storeRoot(dataDir), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await mkdir(lock);
      break;
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error)) throw error;
      if (error.code !== 'EEXIST') throw error;
      // eslint-disable-next-line no-await-in-loop
      const age = await stat(lock).then(
        (info) => Date.now() - info.mtimeMs,
        () => 0,
      );
      if (age > LOCK_STALE_MS) {
        // eslint-disable-next-line no-await-in-loop
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error('The Store is busy in another Alran process.');
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }
  try {
    return await work();
  } finally {
    // Rename first, then delete: the lock name is free again the moment the rename succeeds.
    const released = `${lock}.${randomSuffix()}.released`;
    await rename(lock, released).then(
      () => rm(released, { recursive: true, force: true }),
      () => undefined,
    );
  }
}
