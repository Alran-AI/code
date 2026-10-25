import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import { resolveAlranNpmPrefixInstall, type AlranNpmPackageName } from './install-source.js';

const PENDING_UPDATE_FILE = '.alran-update-pending.json';
const ACTIVE_PROCESS_DIRECTORY = '.alran-active';
const ACTIVATOR_LEASE_FILE = '.alran-update-activator.json';
const ACTIVATION_STATUS_FILE = '.alran-update-activation-status.json';
const PENDING_UPDATE_SCHEMA_VERSION = 1;
const ACTIVATOR_LEASE_SCHEMA_VERSION = 1;
const ACTIVATION_STATUS_SCHEMA_VERSION = 1;
const RESTART_PARENT_WAIT_TIMEOUT_MS = 30_000;
export const ALRAN_UPDATE_PARENT_PID_ENV = 'ALRAN_UPDATE_PARENT_PID';

type AlranPlatformPath = typeof path.posix | typeof path.win32;

export interface AlranPrefixPackageMetadata {
  readonly packageRoot: string;
  readonly version: string;
  readonly binEntry: string;
  readonly alranToolsBinEntry: string;
}

export interface AlranPrefixLauncherPair {
  readonly activePath: string;
  readonly stagedPath: string;
  readonly backupPath: string;
}

export interface AlranPrefixUpdateActivation {
  readonly stagingPrefix: string;
  readonly activePrefix: string;
  readonly activeModulesRoot: string;
  readonly stagedModulesRoot: string;
  readonly backupModulesRoot: string;
  readonly packageName: AlranNpmPackageName;
  readonly expectedVersion: string;
  readonly launchers: readonly AlranPrefixLauncherPair[];
}

export function createAlranPrefixUpdateStagingPrefix(
  activePrefix: string,
  version: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = platformPathFor(platform);
  return platformPath.join(
    platformPath.dirname(activePrefix),
    `.${platformPath.basename(activePrefix)}.update-${version}-${process.pid}-${randomUUID()}`,
  );
}

export function resolveAlranPrefixModulesRoot(
  prefix: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = platformPathFor(platform);
  return platform === 'win32'
    ? platformPath.join(prefix, 'node_modules')
    : platformPath.join(prefix, 'lib', 'node_modules');
}

export function resolveAlranPrefixPackageRoot(
  prefix: string,
  packageName: AlranNpmPackageName,
  platform: NodeJS.Platform = process.platform,
): string {
  const platformPath = platformPathFor(platform);
  return platformPath.join(
    resolveAlranPrefixModulesRoot(prefix, platform),
    ...packageName.split('/'),
  );
}

export function resolveAlranPrefixLauncherPairs(
  activePrefix: string,
  stagingPrefix: string,
  platform: NodeJS.Platform = process.platform,
): readonly AlranPrefixLauncherPair[] {
  const platformPath = platformPathFor(platform);
  const names = platform === 'win32' ? ['alran.cmd', 'alran.ps1'] : ['alran'];
  const directory = platform === 'win32' ? '' : 'bin';
  return names.map((name) => {
    const activePath = platformPath.join(activePrefix, directory, name);
    return {
      activePath,
      stagedPath: platformPath.join(stagingPrefix, directory, name),
      backupPath: `${activePath}.alran-update-backup`,
    };
  });
}

export function prepareAlranPrefixUpdateStaging(
  activePrefix: string,
  stagingPrefix: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const activeModulesRoot = resolveAlranPrefixModulesRoot(activePrefix, platform);
  const stagedModulesRoot = resolveAlranPrefixModulesRoot(stagingPrefix, platform);
  if (!existsSync(activeModulesRoot)) {
    throw new Error(`Active Alran modules directory is missing: ${activeModulesRoot}`);
  }
  cpSync(activeModulesRoot, stagedModulesRoot, { recursive: true, dereference: false });
  for (const launcher of resolveAlranPrefixLauncherPairs(activePrefix, stagingPrefix, platform)) {
    if (!existsSync(launcher.activePath)) continue;
    mkdirSync(path.dirname(launcher.stagedPath), { recursive: true });
    cpSync(launcher.activePath, launcher.stagedPath, { dereference: false, force: true });
  }
}

export function readAlranPrefixPackageMetadata(
  prefix: string,
  packageName: AlranNpmPackageName,
  platform: NodeJS.Platform = process.platform,
): AlranPrefixPackageMetadata {
  const packageRoot = resolveAlranPrefixPackageRoot(prefix, packageName, platform);
  const manifestFile = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
  };
  const binEntry = readAlranBinEntry(manifest.bin, 'alran');
  const alranToolsBinEntry = readAlranBinEntry(manifest.bin, 'alran-tools');
  if (
    manifest.name !== packageName ||
    typeof manifest.version !== 'string' ||
    !binEntry ||
    !alranToolsBinEntry
  ) {
    throw new Error(`Alran package metadata is invalid at ${manifestFile}.`);
  }
  return { packageRoot, version: manifest.version, binEntry, alranToolsBinEntry };
}

export async function validateAlranPrefixPackage(
  prefix: string,
  metadata: AlranPrefixPackageMetadata,
  runtimeExecutable: string,
  expectedVersion: string,
): Promise<void> {
  await validateAlranPrefixEntry(
    prefix,
    runtimeExecutable,
    [path.join(metadata.packageRoot, ...metadata.binEntry.split('/')), '--version'],
    'Alran',
    (output) => output === expectedVersion,
  );
  await validateAlranPrefixEntry(
    prefix,
    runtimeExecutable,
    [path.join(metadata.packageRoot, ...metadata.alranToolsBinEntry.split('/')), '--version'],
    'alran-tools',
    (output) => output.length > 0,
  );
  // --version does not load the native runtime. Validate it with the exact Node
  // executable that the new release launcher will use, independently of npm's Node.
  await validateAlranPrefixEntry(
    prefix,
    runtimeExecutable,
    [
      '--input-type=module',
      '--eval',
      `
      import { createRequire } from 'node:module';
      const require = createRequire(process.argv[1]);
      const Database = require('better-sqlite3');
      const database = new Database(':memory:');
      try {
        if (database.prepare('SELECT 1 AS value').get()?.value !== 1) {
          throw new Error('SQLite validation returned an unexpected result.');
        }
      } finally { database.close(); }
    `,
      path.join(metadata.packageRoot, 'package.json'),
    ],
    'SQLite',
    () => true,
  );
}

function validateAlranPrefixEntry(
  prefix: string,
  runtimeExecutable: string,
  args: readonly string[],
  commandName: 'Alran' | 'alran-tools' | 'SQLite',
  outputIsValid: (output: string) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(runtimeExecutable, [...args], {
      cwd: prefix,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
      killSignal: 'SIGKILL',
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0 && outputIsValid(output)) return resolve();
      const details = Buffer.concat(stderr).toString('utf8').trim() || output;
      reject(
        new Error(
          `Staged ${commandName} validation failed (${signal ? `signal ${signal}` : `exit ${String(code)}`})` +
            `${details ? `: ${details}` : ''}`,
        ),
      );
    });
  });
}

export function writeAlranPrefixUpdatePending(activation: AlranPrefixUpdateActivation): string {
  const pendingFile = path.join(activation.activePrefix, PENDING_UPDATE_FILE);
  const temporaryFile = `${pendingFile}.tmp-${process.pid}-${randomUUID()}`;
  const contents = `${JSON.stringify(
    { schemaVersion: PENDING_UPDATE_SCHEMA_VERSION, ...activation, createdAtMs: Date.now() },
    null,
    2,
  )}\n`;
  try {
    writeFileSync(temporaryFile, contents, { mode: 0o600 });
    renameSync(temporaryFile, pendingFile);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    throw error;
  }
  return pendingFile;
}

export async function scheduleAlranPrefixUpdate(
  pendingFile: string,
  runtimeExecutable = process.execPath,
  parentPid = process.pid,
  restartArgs: readonly string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
  restartCwd = process.cwd(),
): Promise<void> {
  const { contents: pendingContents, pending } = readPendingUpdateFile(pendingFile);
  if (path.resolve(pendingFile) !== path.resolve(pending.activePrefix, PENDING_UPDATE_FILE)) {
    throw new Error(`Alran pending update file is outside its active prefix: ${pendingFile}`);
  }
  const pendingDigest = createHash('sha256').update(pendingContents).digest('hex');
  const leaseFile = path.join(pending.activePrefix, ACTIVATOR_LEASE_FILE);
  if (!acquireAlranPrefixActivatorLease(leaseFile, pendingDigest)) return;
  const helperFile = path.join(pending.activePrefix, '.alran-update-activator.cjs');
  try {
    writeAlranPrefixActivationStatus(pending.activePrefix, pendingDigest, 'scheduled');
    writeFileSync(helperFile, prefixActivatorSource(), { mode: 0o700 });
    const child = spawn(
      runtimeExecutable,
      [helperFile, pendingFile, pendingDigest, String(parentPid), restartCwd, ...restartArgs],
      {
        cwd: pending.activePrefix,
        env: environment,
        detached: true,
        stdio: restartArgs.length > 0 ? 'inherit' : 'ignore',
        windowsHide: true,
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    child.unref();
  } catch (error) {
    try {
      writeAlranPrefixActivationStatus(pending.activePrefix, pendingDigest, 'failed', error);
    } catch {
      // Preserve the scheduling failure when its diagnostic sidecar cannot be written.
    }
    removeAlranPrefixActivatorLease(leaseFile, pendingDigest, process.pid);
    throw error;
  }
}

export async function schedulePendingAlranPrefixUpdate(
  entryFile = process.argv[1],
  runtimeExecutable = process.execPath,
  parentPid = process.pid,
  restartArgs: readonly string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const prefix = resolvePrefixFromEntryFile(entryFile);
  if (!prefix) return false;
  const pendingFile = path.join(prefix, PENDING_UPDATE_FILE);
  if (!existsSync(pendingFile)) return false;
  await scheduleAlranPrefixUpdate(
    pendingFile,
    runtimeExecutable,
    parentPid,
    restartArgs,
    environment,
  );
  return true;
}

export function removeAlranPrefixUpdatePending(pendingFile: string): void {
  rmSync(pendingFile, { force: true });
}

export function removeAlranPrefixUpdateStaging(stagingPrefix: string): void {
  rmSync(stagingPrefix, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
}

export interface AlranPendingPrefixUpdateInspection {
  readonly pendingFile: string;
  readonly activation: AlranPrefixUpdateActivation;
  readonly state: 'staged' | 'activated';
}

export function inspectPendingAlranPrefixUpdate(
  entryFile = process.argv[1],
): AlranPendingPrefixUpdateInspection | undefined {
  const prefix = resolvePrefixFromEntryFile(entryFile);
  if (!prefix) return undefined;
  const pendingFile = path.join(prefix, PENDING_UPDATE_FILE);
  if (!existsSync(pendingFile)) return undefined;
  const { pending } = readPendingUpdateFile(pendingFile);
  if (path.resolve(pendingFile) !== path.resolve(pending.activePrefix, PENDING_UPDATE_FILE)) {
    throw new Error(`Alran pending update file is outside its active prefix: ${pendingFile}`);
  }
  const state = classifyRecoverableAlranPrefixUpdateArtifacts(pending);
  if (!state) {
    throw new Error(`Alran pending update artifacts are incomplete at ${pendingFile}.`);
  }
  return {
    pendingFile,
    activation: pending,
    state,
  };
}

function classifyRecoverableAlranPrefixUpdateArtifacts(
  pending: AlranPrefixUpdateActivation,
): 'staged' | 'activated' | undefined {
  if (pending.launchers.length === 0) return undefined;
  const activeMatches = pendingPackageMatches(
    pending.activeModulesRoot,
    pending.packageName,
    pending.expectedVersion,
  );
  if (
    activeMatches &&
    pending.launchers.every(
      (launcher) => existsSync(launcher.activePath) || existsSync(launcher.stagedPath),
    )
  ) {
    return 'activated';
  }

  const stagedMatches = pendingPackageMatches(
    pending.stagedModulesRoot,
    pending.packageName,
    pending.expectedVersion,
  );
  if (!stagedMatches) return undefined;
  const backupExists = existsSync(pending.backupModulesRoot);
  return pending.launchers.every(
    (launcher) =>
      existsSync(launcher.stagedPath) ||
      (backupExists && existsSync(launcher.activePath) && existsSync(launcher.backupPath)),
  )
    ? 'staged'
    : undefined;
}

function pendingPackageMatches(
  modulesRoot: string,
  packageName: AlranNpmPackageName,
  expectedVersion: string,
): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(modulesRoot, ...packageName.split('/'), 'package.json'), 'utf8'),
    ) as { name?: unknown; version?: unknown };
    return manifest.name === packageName && manifest.version === expectedVersion;
  } catch {
    return false;
  }
}

export interface AlranPrefixProcessPreparation {
  readonly remove: () => void;
}

export async function prepareAlranPrefixProcess(
  entryFile = process.argv[1],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AlranPrefixProcessPreparation> {
  const parentPid = Number(environment[ALRAN_UPDATE_PARENT_PID_ENV]);
  if (Number.isSafeInteger(parentPid) && parentPid > 0) await waitForProcessExit(parentPid);
  return {
    remove: registerAlranPrefixProcess(entryFile) ?? (() => undefined),
  };
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + RESTART_PARENT_WAIT_TIMEOUT_MS;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`Alran restart waited too long for parent process ${pid} to exit.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface AlranPrefixActivatorLease {
  readonly schemaVersion: number;
  readonly journalDigest: string;
  readonly pid: number;
  readonly startedAtMs: number;
}

function acquireAlranPrefixActivatorLease(leaseFile: string, journalDigest: string): boolean {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease: AlranPrefixActivatorLease = {
      schemaVersion: ACTIVATOR_LEASE_SCHEMA_VERSION,
      journalDigest,
      pid: process.pid,
      startedAtMs: Date.now(),
    };
    try {
      writeFileSync(leaseFile, `${JSON.stringify(lease)}\n`, { flag: 'wx', mode: 0o600 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const existing = readAlranPrefixActivatorLease(leaseFile);
    if (existing && isProcessAlive(existing.pid)) {
      if (existing.journalDigest === journalDigest) return false;
      throw new Error('Another Alran prefix activator is running for a different journal.');
    }
    rmSync(leaseFile, { force: true });
  }
  throw new Error(`Alran prefix activator lease could not be acquired at ${leaseFile}.`);
}

function readAlranPrefixActivatorLease(leaseFile: string): AlranPrefixActivatorLease | undefined {
  try {
    const value = JSON.parse(readFileSync(leaseFile, 'utf8')) as Partial<AlranPrefixActivatorLease>;
    if (
      value.schemaVersion !== ACTIVATOR_LEASE_SCHEMA_VERSION ||
      typeof value.journalDigest !== 'string' ||
      !Number.isSafeInteger(value.pid) ||
      (value.pid ?? 0) <= 0 ||
      typeof value.startedAtMs !== 'number'
    ) {
      return undefined;
    }
    return value as AlranPrefixActivatorLease;
  } catch {
    return undefined;
  }
}

function removeAlranPrefixActivatorLease(
  leaseFile: string,
  journalDigest: string,
  pid: number,
): void {
  const lease = readAlranPrefixActivatorLease(leaseFile);
  if (lease?.journalDigest !== journalDigest || lease.pid !== pid) return;
  rmSync(leaseFile, { force: true });
}

function writeAlranPrefixActivationStatus(
  activePrefix: string,
  journalDigest: string,
  state: 'scheduled' | 'failed',
  error?: unknown,
): void {
  const statusFile = path.join(activePrefix, ACTIVATION_STATUS_FILE);
  const temporaryFile = `${statusFile}.tmp-${process.pid}-${randomUUID()}`;
  const errorMessage =
    error instanceof Error ? error.message : error === undefined ? undefined : String(error);
  const status = {
    schemaVersion: ACTIVATION_STATUS_SCHEMA_VERSION,
    journalDigest,
    state,
    updatedAtMs: Date.now(),
    ...(errorMessage ? { error: errorMessage.slice(0, 2_000) } : {}),
  };
  try {
    writeFileSync(temporaryFile, `${JSON.stringify(status)}\n`, { mode: 0o600 });
    rmSync(statusFile, { force: true });
    renameSync(temporaryFile, statusFile);
  } catch (statusError) {
    rmSync(temporaryFile, { force: true });
    throw statusError;
  }
}

export function registerAlranPrefixProcess(entryFile = process.argv[1]): (() => void) | undefined {
  const prefix = resolvePrefixFromEntryFile(entryFile);
  if (!prefix) return undefined;
  const directory = path.join(prefix, ACTIVE_PROCESS_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const marker = path.join(directory, `${process.pid}.json`);
  let removed = false;
  const removeOnExit = () => rmSync(marker, { force: true });
  const remove = () => {
    if (removed) return;
    removed = true;
    process.off('exit', removeOnExit);
    rmSync(marker, { force: true });
  };
  writeFileSync(marker, `${JSON.stringify({ pid: process.pid, startedAtMs: Date.now() })}\n`, {
    mode: 0o600,
  });
  process.once('exit', removeOnExit);
  return remove;
}

export function countAlranPrefixUpdateBlockers(
  activePrefix: string,
  currentPid = process.pid,
): number | undefined {
  const directory = path.join(activePrefix, ACTIVE_PROCESS_DIRECTORY);
  if (!existsSync(directory)) return 0;
  let markerNames: string[];
  try {
    markerNames = readdirSync(directory);
  } catch {
    return undefined;
  }
  let blockers = 0;
  for (const name of markerNames) {
    if (!name.endsWith('.json')) continue;
    const pid = Number(name.slice(0, -5));
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === currentPid) continue;
    if (isProcessAlive(pid)) {
      blockers += 1;
      continue;
    }
    try {
      rmSync(path.join(directory, name), { force: true });
    } catch {
      // A stale marker does not block activation; the detached helper also retries cleanup.
    }
  }
  return blockers;
}

function resolvePrefixFromEntryFile(entryFile: string | undefined): string | undefined {
  if (!entryFile) return undefined;
  try {
    const detected = resolveAlranNpmPrefixInstall(entryFile);
    if (detected) return detected.prefix;
  } catch {
    // Fall through to pending-journal recovery for legacy prefixes whose receipt is missing.
  }
  let current = path.dirname(entryFile);
  for (;;) {
    const receiptFile = path.join(current, 'install.json');
    if (existsSync(receiptFile)) {
      try {
        const receipt = JSON.parse(readFileSync(receiptFile, 'utf8')) as {
          updateOwner?: unknown;
          prefix?: unknown;
        };
        if (receipt.updateOwner === 'npm-prefix' && typeof receipt.prefix === 'string') {
          return receipt.prefix;
        }
      } catch {
        return undefined;
      }
    }
    const pendingFile = path.join(current, PENDING_UPDATE_FILE);
    if (existsSync(pendingFile)) {
      try {
        const pending = readPendingUpdate(pendingFile);
        return path.resolve(pending.activePrefix) === path.resolve(current)
          ? pending.activePrefix
          : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readPendingUpdate(file: string): AlranPrefixUpdateActivation & { schemaVersion: number } {
  return readPendingUpdateFile(file).pending;
}

function readPendingUpdateFile(file: string): {
  readonly contents: string;
  readonly pending: AlranPrefixUpdateActivation & { schemaVersion: number };
} {
  const contents = readFileSync(file, 'utf8');
  const value = JSON.parse(contents) as Partial<
    AlranPrefixUpdateActivation & { schemaVersion: number }
  >;
  if (
    value.schemaVersion !== PENDING_UPDATE_SCHEMA_VERSION ||
    typeof value.activePrefix !== 'string' ||
    typeof value.stagingPrefix !== 'string' ||
    typeof value.activeModulesRoot !== 'string' ||
    typeof value.stagedModulesRoot !== 'string' ||
    typeof value.backupModulesRoot !== 'string' ||
    (value.packageName !== '@ottili/alran-code' && value.packageName !== '@ottili/alran-code') ||
    typeof value.expectedVersion !== 'string' ||
    !Array.isArray(value.launchers) ||
    !value.launchers.every(
      (launcher) =>
        launcher !== null &&
        typeof launcher === 'object' &&
        'activePath' in launcher &&
        typeof launcher.activePath === 'string' &&
        'stagedPath' in launcher &&
        typeof launcher.stagedPath === 'string' &&
        'backupPath' in launcher &&
        typeof launcher.backupPath === 'string',
    )
  ) {
    throw new Error(`Alran pending update metadata is invalid at ${file}.`);
  }
  const pending = value as AlranPrefixUpdateActivation & { schemaVersion: number };
  const expectedActiveModulesRoot = resolveAlranPrefixModulesRoot(
    pending.activePrefix,
    process.platform,
  );
  const expectedStagedModulesRoot = resolveAlranPrefixModulesRoot(
    pending.stagingPrefix,
    process.platform,
  );
  const expectedLaunchers = resolveAlranPrefixLauncherPairs(
    pending.activePrefix,
    pending.stagingPrefix,
    process.platform,
  );
  if (
    path.resolve(pending.activePrefix) === path.resolve(pending.stagingPrefix) ||
    !sameResolvedPath(pending.activeModulesRoot, expectedActiveModulesRoot) ||
    !sameResolvedPath(pending.stagedModulesRoot, expectedStagedModulesRoot) ||
    !sameResolvedPath(
      pending.backupModulesRoot,
      `${expectedActiveModulesRoot}.alran-update-backup`,
    ) ||
    pending.launchers.length !== expectedLaunchers.length ||
    pending.launchers.some((launcher, index) => {
      const expected = expectedLaunchers[index];
      return (
        !expected ||
        !sameResolvedPath(launcher.activePath, expected.activePath) ||
        !sameResolvedPath(launcher.stagedPath, expected.stagedPath) ||
        !sameResolvedPath(launcher.backupPath, expected.backupPath)
      );
    }) ||
    !isPathInside(pending.activePrefix, pending.activeModulesRoot) ||
    !isPathInside(pending.activePrefix, pending.backupModulesRoot) ||
    !isPathInside(pending.stagingPrefix, pending.stagedModulesRoot) ||
    pending.launchers.some(
      (launcher) =>
        !isPathInside(pending.activePrefix, launcher.activePath) ||
        !isPathInside(pending.activePrefix, launcher.backupPath) ||
        !isPathInside(pending.stagingPrefix, launcher.stagedPath),
    )
  ) {
    throw new Error(`Alran pending update paths are invalid at ${file}.`);
  }
  return { contents, pending };
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sameResolvedPath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function platformPathFor(platform: NodeJS.Platform): AlranPlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function readAlranBinEntry(value: unknown, name: 'alran' | 'alran-tools'): string | undefined {
  const entry =
    typeof value === 'string' && name === 'alran'
      ? value
      : value && typeof value === 'object' && name in value
        ? (value as Record<string, unknown>)[name]
        : undefined;
  if (typeof entry !== 'string' || !entry.trim()) return undefined;
  const normalized = entry.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..'))
    return undefined;
  return normalized;
}

function prefixActivatorSource(): string {
  return String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const pendingFile = process.argv[2];
const pendingDigest = process.argv[3];
const parentPid = Number(process.argv[4]);
const restartCwd = process.argv[5];
const restartArgs = process.argv.slice(6);
const pendingContents = fs.readFileSync(pendingFile, 'utf8');
if (crypto.createHash('sha256').update(pendingContents).digest('hex') !== pendingDigest) throw new Error('Alran pending update journal changed after scheduling.');
const pending = JSON.parse(pendingContents);
const leaseFile = path.join(pending.activePrefix, '.alran-update-activator.json');
const statusFile = path.join(pending.activePrefix, '.alran-update-activation-status.json');
fs.writeFileSync(leaseFile, JSON.stringify({ schemaVersion: 1, journalDigest: pendingDigest, pid: process.pid, startedAtMs: Date.now() }) + '\n', { mode: 0o600 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error && error.code === 'EPERM'; } };
const remove = (target) => { try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch {} };
const writeStatus = (state, error) => {
  const temporaryFile = statusFile + '.tmp-' + process.pid;
  const errorMessage = error === undefined ? undefined : String(error && error.message || error).slice(0, 2000);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify({ schemaVersion: 1, journalDigest: pendingDigest, state, updatedAtMs: Date.now(), ...(errorMessage ? { error: errorMessage } : {}) }) + '\n', { mode: 0o600 });
    fs.rmSync(statusFile, { force: true });
    fs.renameSync(temporaryFile, statusFile);
  } catch {
    remove(temporaryFile);
  }
};
// The pending journal is durable. Keep the detached handoff alive until every process using the
// old prefix exits; a TUI-owned Runtime or another Alran session may legitimately take over 30s.
async function waitForExit(pid) {
  while (alive(pid)) await sleep(100);
}
async function waitForMarkers() {
  const directory = path.join(pending.activePrefix, '.alran-active');
  for (;;) {
    const blockers = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith('.json')).filter((name) => {
      const pid = Number(name.slice(0, -5));
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
      if (alive(pid)) return true;
      try { fs.rmSync(path.join(directory, name), { force: true }); } catch {}
      return false;
    }) : [];
    if (blockers.length === 0) return;
    await sleep(100);
  }
}
async function recoverInterrupted() {
  const activeVersion = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pending.activeModulesRoot, ...pending.packageName.split('/'), 'package.json'), 'utf8')).version;
    } catch { return undefined; }
  })();
  if (activeVersion === pending.expectedVersion) {
    const launchers = pending.launchers || [];
    const canCompleteLaunchers = launchers.every((launcher) => fs.existsSync(launcher.activePath) || fs.existsSync(launcher.stagedPath));
    if (canCompleteLaunchers) {
      for (const launcher of launchers) {
        if (!fs.existsSync(launcher.activePath)) fs.renameSync(launcher.stagedPath, launcher.activePath);
      }
      return true;
    }
  }
  if (!fs.existsSync(pending.backupModulesRoot)) return false;
  if (fs.existsSync(pending.activeModulesRoot)) {
    if (!fs.existsSync(pending.stagedModulesRoot)) fs.renameSync(pending.activeModulesRoot, pending.stagedModulesRoot);
    else remove(pending.activeModulesRoot);
  }
  fs.renameSync(pending.backupModulesRoot, pending.activeModulesRoot);
  for (const launcher of pending.launchers || []) {
    if (!fs.existsSync(launcher.backupPath)) continue;
    if (fs.existsSync(launcher.activePath)) {
      if (!fs.existsSync(launcher.stagedPath)) fs.renameSync(launcher.activePath, launcher.stagedPath);
      else remove(launcher.activePath);
    }
    fs.renameSync(launcher.backupPath, launcher.activePath);
  }
  return false;
}
function cleanup() {
  remove(pending.backupModulesRoot);
  for (const launcher of pending.launchers || []) remove(launcher.backupPath);
  fs.rmSync(pendingFile, { force: true });
  remove(pending.stagingPrefix);
  remove(path.join(pending.activePrefix, '.alran-update-activator.cjs'));
  remove(leaseFile);
}
async function activate() {
  const alreadyActivated = await recoverInterrupted();
  const restart = (args) => new Promise((resolve, reject) => {
    if (args.length === 0) return resolve();
    const child = cp.spawn(process.execPath, args, {
      cwd: restartCwd, env: process.env, detached: true, stdio: 'inherit', windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  if (alreadyActivated) {
    await restart(restartArgs);
    writeStatus('completed');
    cleanup();
    return;
  }
  const launchers = pending.launchers || [];
  let modulesMoved = false;
  const moved = [];
  const installed = [];
  try {
    const stagedManifest = JSON.parse(fs.readFileSync(path.join(pending.stagedModulesRoot, ...pending.packageName.split('/'), 'package.json'), 'utf8'));
    if (stagedManifest.name !== pending.packageName || stagedManifest.version !== pending.expectedVersion) throw new Error('Staged Alran package identity or version is invalid.');
    if (launchers.some((launcher) => !fs.existsSync(launcher.stagedPath))) throw new Error('Staged Alran launcher is missing.');
    fs.renameSync(pending.activeModulesRoot, pending.backupModulesRoot);
    modulesMoved = true;
    for (const launcher of launchers) { if (fs.existsSync(launcher.activePath)) { fs.renameSync(launcher.activePath, launcher.backupPath); moved.push(launcher); } }
    fs.renameSync(pending.stagedModulesRoot, pending.activeModulesRoot);
    for (const launcher of launchers) { if (fs.existsSync(launcher.stagedPath)) { fs.renameSync(launcher.stagedPath, launcher.activePath); installed.push(launcher); } }
    const manifest = JSON.parse(fs.readFileSync(path.join(pending.activeModulesRoot, ...pending.packageName.split('/'), 'package.json'), 'utf8'));
    if (manifest.name !== pending.packageName || manifest.version !== pending.expectedVersion) throw new Error('Activated Alran package identity or version is invalid.');
    await restart(restartArgs);
    writeStatus('completed');
    cleanup();
  } catch (error) {
    try {
      if (modulesMoved) {
        if (fs.existsSync(pending.activeModulesRoot)) {
          if (!fs.existsSync(pending.stagedModulesRoot)) fs.renameSync(pending.activeModulesRoot, pending.stagedModulesRoot);
          else remove(pending.activeModulesRoot);
        }
        if (fs.existsSync(pending.backupModulesRoot)) fs.renameSync(pending.backupModulesRoot, pending.activeModulesRoot);
      }
      for (const launcher of installed) { if (fs.existsSync(launcher.activePath)) { if (!fs.existsSync(launcher.stagedPath)) fs.renameSync(launcher.activePath, launcher.stagedPath); else remove(launcher.activePath); } }
      for (const launcher of moved) if (fs.existsSync(launcher.backupPath)) fs.renameSync(launcher.backupPath, launcher.activePath);
    } catch (rollbackError) {
      process.stderr.write(String(rollbackError && rollbackError.stack || rollbackError) + '\\n');
    }
    writeStatus('failed', error);
    process.stderr.write(String(error && error.stack || error) + '\\n');
  }
}
(async () => {
  writeStatus('waiting-parent');
  await waitForExit(parentPid);
  writeStatus('waiting-processes');
  await waitForMarkers();
  writeStatus('activating');
  await activate();
})().catch((error) => { writeStatus('failed', error); process.stderr.write(String(error && error.stack || error) + '\n'); process.exitCode = 1; });
`;
}
