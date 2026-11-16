import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The name of the data directory in the user's home directory. */
export const DATA_DIR_BASENAME = '.alran';

export type DataDirLogger = Pick<Console, 'error' | 'info' | 'warn'>;

export interface ResolveDataDirOptions {
  homeDir?: string;
  profile?: string | null;
  logger?: DataDirLogger;
}

const noopLogger: DataDirLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

function resolveHomeDir(homeDir?: string): string {
  return homeDir ?? os.homedir();
}

function basenameForProfile(base: string, profile?: string | null): string {
  return profile ? `${base}-${profile}` : base;
}

/**
 * The path of the data directory.
 *
 * A profile gets its own directory, so two profiles of the same user never
 * share agents, sessions or credentials.
 */
export function getDataDirPath(homeDir?: string, profile?: string | null): string {
  return path.join(resolveHomeDir(homeDir), basenameForProfile(DATA_DIR_BASENAME, profile));
}

function ensureDataDir(targetPath: string, logger: DataDirLogger): void {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      logger.warn(`Data dir path ${targetPath} exists but is not a directory; using it as it is`);
      return;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      logger.warn(`Data dir ${targetPath} is inaccessible: ${String(error)}`);
      return;
    }
  }
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch (error) {
    logger.warn(`Failed to create data dir ${targetPath}: ${String(error)}`);
  }
}

/**
 * The data directory of the current installation, created when it does not exist.
 *
 * @param options the home directory, the profile and the logger to report to
 */
export function resolveDataDir(options: ResolveDataDirOptions = {}): string {
  const targetPath = getDataDirPath(options.homeDir, options.profile ?? null);
  ensureDataDir(targetPath, options.logger ?? noopLogger);
  return targetPath;
}
