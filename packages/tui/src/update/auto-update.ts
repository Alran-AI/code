// Background auto-update, in the style of Claude Code: new versions are installed silently in the
// background and become active on the next start, after which the user sees exactly one line about
// what changed.
//
// Privacy and safety rules this module must keep:
// - The only network request is the npm registry version lookup for the official package `alran`;
//   no telemetry, no user data, no project data ever leaves the machine.
// - The check runs in the background and never delays startup; it fails silently and shows nothing
//   when offline.
// - Installation happens only for npm global installs, only from the official registry, and only
//   for the package `alran`; the requested version is verified after the install, and a failing
//   install keeps the old version. Reasons are logged to a local file, never to the terminal.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import {
  ALRAN_NPM_PACKAGE_NAME,
  buildAlranPackageManagerCommand,
  detectAlranInstallSource,
  parseAlranPackageName,
  resolveAlranNpmDistribution,
  runAlranPackageManagerCommand,
  type AlranInstallSource,
  type AlranPackageManagerCommand,
  type AlranPackageManagerInstallSource,
} from './install-source.js';
import { compareAlranVersions, parseAlranVersion } from './release.js';
import { countAlranChangelogEntries, renderAutoUpdateAnnouncement } from './auto-update-changelog.js';

/** The update channels. `latest` is the npm dist-tag; `stable` lags it by a few days. */
export type AlranAutoUpdateChannel = 'latest' | 'stable';

/** Parse a channel name for the update command; anything else is a usage error. */
export function parseAutoUpdateChannel(
  value: string | undefined,
): AlranAutoUpdateChannel | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'latest' || normalized === 'stable') return normalized;
  throw new Error(`Alran update channel must be 'latest' or 'stable': ${JSON.stringify(value)}`);
}

/** How often the background start-up check may run, at most. */
export const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Budget for the single registry lookup; the check must never delay startup. */
export const AUTO_UPDATE_REGISTRY_TIMEOUT_MS = 3_000;
/** An install (or a failed one) is retried at most once per day. */
export const AUTO_UPDATE_INSTALL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** The once-a-day hint for installation methods auto-update does not touch. */
export const AUTO_UPDATE_HINT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** `stable` tracks versions published at least this long ago. */
export const AUTO_UPDATE_STABLE_LAG_MS = 3 * 24 * 60 * 60 * 1000;
/** A pid-less task lock is never trusted for longer than this. */
export const AUTO_UPDATE_TASK_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

const AUTO_UPDATE_ENV = 'ALRAN_DISABLE_AUTOUPDATE';
const AUTO_UPDATE_OFFLINE_ENV = 'ALRAN_OFFLINE';
const AUTO_UPDATE_CHANNEL_ENV = 'ALRAN_UPDATE_CHANNEL';

const AUTO_UPDATE_FILE = 'auto-update.json';
const AUTO_UPDATE_LOG = 'auto-update.log';
const AUTO_UPDATE_LOCK = 'auto-update.lock';
const TASK_LOCK = 'task.lock';

const CHANGELOG_FILE = 'CHANGELOG.md';

export interface AlranAutoUpdatePolicy {
  /** False when the user opted out through config or `ALRAN_DISABLE_AUTOUPDATE`. */
  readonly enabled: boolean;
  readonly channel: AlranAutoUpdateChannel;
  /** True when `ALRAN_OFFLINE` is set: no network call is made at all. */
  readonly offline: boolean;
}

export interface AutoUpdatePolicyOptions {
  readonly environment?: NodeJS.ProcessEnv;
  /** The `autoUpdate` key of the user config. */
  readonly autoUpdate?: boolean;
  /** The `autoUpdateChannel` key of the user config. */
  readonly autoUpdateChannel?: string;
}

/** Resolve the opt-out flags, the channel and the offline switch. Never throws. */
export function resolveAutoUpdatePolicy(options: AutoUpdatePolicyOptions = {}): AlranAutoUpdatePolicy {
  const environment = options.environment ?? process.env;
  const enabled = options.autoUpdate !== false && !isTruthyFlag(environment[AUTO_UPDATE_ENV]);
  const offline = isTruthyFlag(environment[AUTO_UPDATE_OFFLINE_ENV]);
  const requested = firstChannel([environment[AUTO_UPDATE_CHANNEL_ENV], options.autoUpdateChannel]);
  return { enabled, channel: requested ?? 'latest', offline };
}

function firstChannel(
  values: readonly (string | undefined)[],
): AlranAutoUpdateChannel | undefined {
  for (const value of values) {
    const normalized = value?.trim().toLocaleLowerCase();
    if (normalized === 'latest' || normalized === 'stable') return normalized;
  }
  return undefined;
}

function isTruthyFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes)$/iu.test(value ?? '');
}

export interface AlranAutoUpdateCache {
  readonly schemaVersion?: 1;
  checkedAtMs?: number;
  channel?: string;
  latestVersion?: string | null;
  lastInstallAttemptMs?: number;
  lastInstallError?: string | null;
  /** The version the background updater installed; announced once on the next start. */
  installedVersion?: string | null;
  announcementShownAtMs?: number | null;
  lastHintAtMs?: number | null;
  lastHintVersion?: string | null;
}

export function readAutoUpdateCache(dataDir: string): AlranAutoUpdateCache {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(dataDir, AUTO_UPDATE_FILE), 'utf8'),
    ) as Partial<AlranAutoUpdateCache>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return sanitizeAutoUpdateCache(parsed);
  } catch {
    return {};
  }
}

/** Keep only well-typed fields so a hand-edited or corrupted cache can never crash a start. */
function sanitizeAutoUpdateCache(cache: Partial<AlranAutoUpdateCache>): AlranAutoUpdateCache {
  const sanitized: AlranAutoUpdateCache = {};
  if (typeof cache.checkedAtMs === 'number' && Number.isFinite(cache.checkedAtMs)) {
    sanitized.checkedAtMs = cache.checkedAtMs;
  }
  if (typeof cache.channel === 'string') sanitized.channel = cache.channel;
  if (cache.latestVersion === null || typeof cache.latestVersion === 'string') {
    sanitized.latestVersion = cache.latestVersion;
  }
  if (typeof cache.lastInstallAttemptMs === 'number' && Number.isFinite(cache.lastInstallAttemptMs)) {
    sanitized.lastInstallAttemptMs = cache.lastInstallAttemptMs;
  }
  if (cache.lastInstallError === null || typeof cache.lastInstallError === 'string') {
    sanitized.lastInstallError = cache.lastInstallError;
  }
  if (cache.installedVersion === null || typeof cache.installedVersion === 'string') {
    sanitized.installedVersion = cache.installedVersion;
  }
  if (cache.announcementShownAtMs === null || typeof cache.announcementShownAtMs === 'number') {
    sanitized.announcementShownAtMs = cache.announcementShownAtMs;
  }
  if (typeof cache.lastHintAtMs === 'number' && Number.isFinite(cache.lastHintAtMs)) {
    sanitized.lastHintAtMs = cache.lastHintAtMs;
  }
  if (typeof cache.lastHintVersion === 'string') sanitized.lastHintVersion = cache.lastHintVersion;
  return sanitized;
}

export function writeAutoUpdateCache(dataDir: string, cache: AlranAutoUpdateCache): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, AUTO_UPDATE_FILE);
    const temporary = `${file}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, ...cache }, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, file);
  } catch {
    // An unwritable cache only means the next start checks again; auto-update never fails loudly.
  }
}

/** Append one reason line to the local update log; the terminal never sees it. */
export function appendAutoUpdateLog(dataDir: string, message: string): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(path.join(dataDir, AUTO_UPDATE_LOG), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log that cannot be written must not break the update attempt.
  }
}

export interface AlranRegistryVersion {
  readonly version: string;
  readonly publishedAtMs: number;
}

export interface AlranRegistryMetadata {
  readonly latest: string | null;
  readonly versions: readonly AlranRegistryVersion[];
}

export interface FetchRegistryMetadataOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly registry?: string;
}

/**
 * The version list of the official `alran` package, or null when unreachable, slow or malformed.
 * This is the only network request auto-update ever makes.
 */
export async function fetchAlranRegistryMetadata(
  options: FetchRegistryMetadataOptions = {},
): Promise<AlranRegistryMetadata | null> {
  const registry =
    options.registry ?? resolveAlranNpmDistribution(ALRAN_NPM_PACKAGE_NAME).registry;
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${registry}${ALRAN_NPM_PACKAGE_NAME}`,
      { signal: AbortSignal.timeout(options.timeoutMs ?? AUTO_UPDATE_REGISTRY_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      'dist-tags'?: { latest?: unknown };
      time?: Record<string, unknown>;
    };
    const latest =
      typeof body['dist-tags']?.latest === 'string' ? body['dist-tags'].latest : null;
    const versions: AlranRegistryVersion[] = [];
    for (const [version, publishedAt] of Object.entries(body.time ?? {})) {
      try {
        parseAlranVersion(version);
      } catch {
        continue;
      }
      const publishedAtMs = Date.parse(String(publishedAt));
      if (Number.isFinite(publishedAtMs)) versions.push({ version, publishedAtMs });
    }
    if (latest !== null) {
      try {
        parseAlranVersion(latest);
      } catch {
        return null;
      }
    }
    return { latest, versions };
  } catch {
    return null;
  }
}

/** The version a channel points at; null when the metadata carries nothing usable. */
export function resolveChannelVersion(
  channel: AlranAutoUpdateChannel,
  metadata: AlranRegistryMetadata,
  options: { readonly now?: () => number; readonly stableLagMs?: number } = {},
): string | null {
  if (channel === 'latest') return metadata.latest;
  const now = (options.now ?? Date.now)();
  const cutoff = now - (options.stableLagMs ?? AUTO_UPDATE_STABLE_LAG_MS);
  let best: string | undefined;
  for (const entry of metadata.versions) {
    if (entry.publishedAtMs > cutoff) continue;
    if (entry.version.includes('-')) continue;
    if (best === undefined || compareAlranVersions(entry.version, best) > 0) best = entry.version;
  }
  return best ?? metadata.latest;
}

export interface AlranAutoUpdateAvailability {
  readonly status: 'available' | 'current' | 'ahead';
  readonly channel: AlranAutoUpdateChannel;
  readonly currentVersion: string;
  readonly latestVersion: string;
}

export interface InspectAutoUpdateOptions {
  readonly currentVersion: string;
  readonly channel?: AlranAutoUpdateChannel;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly registry?: string;
  readonly now?: () => number;
  readonly stableLagMs?: number;
}

/** A fresh registry check for `alran update --check`; null when the check is impossible. */
export async function inspectAutoUpdate(
  options: InspectAutoUpdateOptions,
): Promise<AlranAutoUpdateAvailability | null> {
  const channel = options.channel ?? 'latest';
  const metadata = await fetchAlranRegistryMetadata({
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    registry: options.registry,
  });
  if (!metadata) return null;
  const latestVersion = resolveChannelVersion(channel, metadata, {
    now: options.now,
    stableLagMs: options.stableLagMs,
  });
  if (!latestVersion) return null;
  const comparison = compareAlranVersions(options.currentVersion, latestVersion);
  return {
    status: comparison < 0 ? 'available' : comparison > 0 ? 'ahead' : 'current',
    channel,
    currentVersion: options.currentVersion,
    latestVersion,
  };
}

/** Anything the cycle needs that tests can swap for a double. */
export interface AutoUpdateDependencies {
  readonly platform?: NodeJS.Platform;
  readonly fetchImpl?: typeof fetch;
  readonly runCommand?: (command: string, args: readonly string[]) => Promise<string>;
  readonly installCommand?: (command: AlranPackageManagerCommand) => Promise<void>;
  /** Where `detectAlranInstallSource` looks for the running package; defaults to the entry file. */
  readonly packageRoot?: () => string | undefined;
  readonly npmGlobalPrefix?: () => Promise<string>;
}

export interface RunAutoUpdateCycleOptions extends AutoUpdateDependencies {
  readonly currentVersion: string;
  readonly dataDir: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly autoUpdate?: boolean;
  readonly autoUpdateChannel?: string;
  readonly write?: (value: string) => void;
  readonly now?: () => number;
  readonly checkIntervalMs?: number;
  readonly stableLagMs?: number;
  readonly registryTimeoutMs?: number;
  readonly registry?: string;
  readonly hintIntervalMs?: number;
}

/**
 * The background cycle started once per process. Never throws: offline, timeouts and failed
 * installs are recorded in the cache and the local log, never on the terminal.
 */
export async function runAutoUpdateCycle(options: RunAutoUpdateCycleOptions): Promise<void> {
  const environment = options.environment ?? process.env;
  const now = options.now ?? Date.now;
  const policy = resolveAutoUpdatePolicy({
    environment,
    autoUpdate: options.autoUpdate,
    autoUpdateChannel: options.autoUpdateChannel,
  });
  const cache = readAutoUpdateCache(options.dataDir);
  const interval = options.checkIntervalMs ?? AUTO_UPDATE_CHECK_INTERVAL_MS;
  const needsFreshCheck =
    policy.offline
      ? false
      : !cache.latestVersion ||
        cache.channel !== policy.channel ||
        now() - (cache.checkedAtMs ?? 0) >= interval ||
        now() < (cache.checkedAtMs ?? 0);
  let latestVersion = cache.latestVersion ?? null;
  let checkedAtMs = cache.checkedAtMs;
  if (needsFreshCheck) {
    const metadata = await fetchAlranRegistryMetadata({
      fetchImpl: options.fetchImpl,
      timeoutMs: options.registryTimeoutMs,
      registry: options.registry,
    });
    if (metadata) {
      latestVersion = resolveChannelVersion(policy.channel, metadata, {
        now,
        stableLagMs: options.stableLagMs,
      });
      checkedAtMs = now();
    }
  }
  const nextCache: AlranAutoUpdateCache = { ...cache, channel: policy.channel };
  if (checkedAtMs !== undefined) nextCache.checkedAtMs = checkedAtMs;
  if (needsFreshCheck) nextCache.latestVersion = latestVersion;
  if (!latestVersion) {
    writeAutoUpdateCache(options.dataDir, nextCache);
    return;
  }
  if (compareAlranVersions(options.currentVersion, latestVersion) >= 0) {
    writeAutoUpdateCache(options.dataDir, nextCache);
    return;
  }
  if (!policy.enabled || policy.offline) {
    showAutoUpdateHint(options, latestVersion, nextCache);
    return;
  }
  const source = await detectAutoUpdateInstallSource(options, environment);
  if (source !== 'npm-global') {
    showAutoUpdateHint(options, latestVersion, nextCache, source);
    return;
  }
  await installAutoUpdate(options, latestVersion, nextCache);
}

/** The managed-installer root, inlined to keep the startup path free of the update service's imports. */
function resolveAutoUpdateInstallRoot(environment: NodeJS.ProcessEnv): string {
  if (environment.ALRAN_INSTALL_ROOT) return path.resolve(environment.ALRAN_INSTALL_ROOT);
  if (process.platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error('LOCALAPPDATA is required to resolve the Alran install root.');
    }
    return path.join(localAppData, 'AlranCode');
  }
  const dataHome = environment.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(dataHome, 'alran-code');
}

async function detectAutoUpdateInstallSource(
  options: AutoUpdateDependencies,
  environment: NodeJS.ProcessEnv,
): Promise<AlranInstallSource> {
  const platform = options.platform ?? process.platform;
  let installRoot = '';
  try {
    installRoot = resolveAutoUpdateInstallRoot(environment);
  } catch {
    installRoot = path.join(homedir(), '.alran', 'auto-update');
  }
  try {
    return await detectAlranInstallSource({
      installRoot,
      platform,
      packageRoot: options.packageRoot,
      npmGlobalPrefix: options.npmGlobalPrefix,
    });
  } catch {
    return 'unsupported';
  }
}

function hintCommand(source: AlranInstallSource, version: string, platform: NodeJS.Platform): string {
  const distribution = resolveAlranNpmDistribution(ALRAN_NPM_PACKAGE_NAME);
  if (source === 'managed-installer') return 'alran update';
  const installSource: AlranPackageManagerInstallSource =
    source === 'unsupported' ? 'npm-global' : source;
  return buildAlranPackageManagerCommand(installSource, version, platform, distribution).display;
}

function showAutoUpdateHint(
  options: RunAutoUpdateCycleOptions,
  version: string,
  cache: AlranAutoUpdateCache,
  source?: AlranInstallSource,
): void {
  const now = options.now ?? Date.now;
  const platform = options.platform ?? process.platform;
  const hintInterval = options.hintIntervalMs ?? AUTO_UPDATE_HINT_INTERVAL_MS;
  if (cache.lastHintVersion === version && now() - (cache.lastHintAtMs ?? 0) < hintInterval) {
    writeAutoUpdateCache(options.dataDir, cache);
    return;
  }
  let command: string;
  try {
    command = source
      ? hintCommand(source, version, platform)
      : `npm install --global ${ALRAN_NPM_PACKAGE_NAME}@${version}`;
  } catch {
    // The install method's own command could not be built; name the universal one instead.
    command = `npm install --global ${ALRAN_NPM_PACKAGE_NAME}@${version}`;
  }
  const write = options.write ?? process.stderr.write.bind(process.stderr);
  write(`Update available: ${version}. Run: ${command}\n`);
  writeAutoUpdateCache(options.dataDir, {
    ...cache,
    lastHintVersion: version,
    lastHintAtMs: now(),
  });
}

async function installAutoUpdate(
  options: RunAutoUpdateCycleOptions,
  version: string,
  cache: AlranAutoUpdateCache,
): Promise<void> {
  const now = options.now ?? Date.now;
  if (isAlranTaskLockActive(options.dataDir, now())) {
    writeAutoUpdateCache(options.dataDir, cache);
    return;
  }
  if (now() - (cache.lastInstallAttemptMs ?? 0) < AUTO_UPDATE_INSTALL_COOLDOWN_MS) {
    writeAutoUpdateCache(options.dataDir, cache);
    return;
  }
  if (!acquireAutoUpdateLock(options.dataDir, now())) {
    writeAutoUpdateCache(options.dataDir, cache);
    return;
  }
  const attemptCache: AlranAutoUpdateCache = { ...cache, lastInstallAttemptMs: now() };
  try {
    await installAutoUpdateVersion(options, version);
    writeAutoUpdateCache(options.dataDir, {
      ...attemptCache,
      installedVersion: version,
      lastInstallError: null,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    appendAutoUpdateLog(options.dataDir, `${version}: ${reason}`);
    // No write permission on the global npm directory: never sudo, never chmod — fall back to the
    // once-a-day hint with the exact command to run by hand.
    if (isAutoUpdatePermissionError(reason)) {
      showAutoUpdateHint(options, version, attemptCache, 'npm-global');
      return;
    }
    writeAutoUpdateCache(options.dataDir, { ...attemptCache, lastInstallError: reason });
  } finally {
    releaseAutoUpdateLock(options.dataDir);
  }
}

function isAutoUpdatePermissionError(reason: string): boolean {
  return /EACCES|EPERM|permission/i.test(reason);
}

type AutoUpdateExecutor = Pick<
  AutoUpdateDependencies,
  'platform' | 'runCommand' | 'installCommand'
> & { readonly environment?: NodeJS.ProcessEnv };

async function installAutoUpdateVersion(
  options: AutoUpdateExecutor,
  version: string,
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const distribution = resolveAlranNpmDistribution(ALRAN_NPM_PACKAGE_NAME);
  const install =
    options.installCommand ??
    ((command: AlranPackageManagerCommand) =>
      runAlranPackageManagerCommand(command, environment));
  const runCommand =
    options.runCommand ?? ((command, args) => runAutoUpdateText(command, args, environment));
  // One package, one registry, one version: nothing else is ever installed.
  const command = buildAlranPackageManagerCommand('npm-global', version, platform, distribution);
  await install(command);
  // Verify against the prefix npm itself wrote to, then run the new binary's health check.
  const prefix = (await runCommand(npmExecutable(platform), ['prefix', '--global'])).trim();
  const modulesRoot = path.join(
    prefix,
    platform === 'win32' ? 'node_modules' : 'lib',
    'node_modules',
  );
  const manifest = JSON.parse(
    readFileSync(path.join(modulesRoot, ALRAN_NPM_PACKAGE_NAME, 'package.json'), 'utf8'),
  ) as { name?: unknown; version?: unknown };
  if (
    parseAlranPackageName(manifest.name) !== ALRAN_NPM_PACKAGE_NAME ||
    manifest.version !== version
  ) {
    throw new Error(
      `Installed Alran version mismatch: expected ${version}, found ${String(manifest.version)}`,
    );
  }
  const binary = path.join(prefix, platform === 'win32' ? 'alran.cmd' : 'bin', 'alran');
  const health = (await runCommand(binary, ['--version'])).trim();
  if (health !== version) {
    throw new Error(`Alran health check failed: expected ${version}, got ${health || '<empty>'}`);
  }
}

function npmExecutable(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function runAutoUpdateText(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      const details = Buffer.concat([...stderr, ...stdout]).toString('utf8').trim();
      reject(
        new Error(
          `${command} failed (${signal ? `signal ${signal}` : `exit ${String(code)}`})${
            details ? `: ${details}` : ''
          }`,
        ),
      );
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** True while another Alran process is running a task; the update waits for the next start. */
export function isAlranTaskLockActive(dataDir: string, now: number = Date.now()): boolean {
  const file = path.join(dataDir, TASK_LOCK);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown; startedAtMs?: unknown };
    const pid = typeof parsed.pid === 'number' ? parsed.pid : Number.NaN;
    if (Number.isSafeInteger(pid) && pid > 0) return isProcessAlive(pid);
    const startedAtMs = typeof parsed.startedAtMs === 'number' ? parsed.startedAtMs : 0;
    return now - startedAtMs < AUTO_UPDATE_TASK_LOCK_TTL_MS;
  } catch {
    try {
      return now - statSync(file).mtimeMs < AUTO_UPDATE_TASK_LOCK_TTL_MS;
    } catch {
      return false;
    }
  }
}

function acquireAutoUpdateLock(dataDir: string, now: number): boolean {
  const file = path.join(dataDir, AUTO_UPDATE_LOCK);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAtMs: now })}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
    }
    const holder = readAutoUpdateLockHolder(dataDir);
    if (holder && isProcessAlive(holder.pid)) return false;
    rmSync(file, { force: true });
  }
  return false;
}

function readAutoUpdateLockHolder(dataDir: string): { pid: number } | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dataDir, AUTO_UPDATE_LOCK), 'utf8')) as {
      pid?: unknown;
    };
    const pid = typeof parsed.pid === 'number' ? parsed.pid : Number.NaN;
    return Number.isSafeInteger(pid) && pid > 0 ? { pid } : undefined;
  } catch {
    return undefined;
  }
}

function releaseAutoUpdateLock(dataDir: string): void {
  try {
    rmSync(path.join(dataDir, AUTO_UPDATE_LOCK), { force: true });
  } catch {
    // The next cycle clears a lease it cannot read.
  }
}

// ── Announcement of the update that just became active ─────────────────

export interface AlranAutoUpdateAnnouncement {
  readonly version: string;
  readonly counts: { readonly features: number; readonly fixes: number };
  readonly line: string;
}

export interface ResolveAutoUpdateAnnouncementOptions {
  readonly currentVersion: string;
  readonly dataDir: string;
  readonly entryFile?: string;
  /** Injected CHANGELOG.md text; defaults to the one shipped with the running install. */
  readonly changelog?: string;
}

/**
 * The one line shown after an auto-update becomes active, exactly once. Null when no update is
 * pending announcement or when the running version is not the installed one.
 */
export function resolveAutoUpdateAnnouncement(
  options: ResolveAutoUpdateAnnouncementOptions,
): AlranAutoUpdateAnnouncement | null {
  const cache = readAutoUpdateCache(options.dataDir);
  const installedVersion = cache.installedVersion;
  if (typeof installedVersion !== 'string' || installedVersion !== options.currentVersion) {
    return null;
  }
  if (cache.announcementShownAtMs) return null;
  try {
    const changelog = options.changelog ?? readInstalledAutoUpdateChangelog(options.entryFile);
    const counts = countAlranChangelogEntries(changelog, installedVersion);
    return {
      version: installedVersion,
      counts,
      line: renderAutoUpdateAnnouncement(installedVersion, counts),
    };
  } catch {
    return null;
  }
}

function readInstalledAutoUpdateChangelog(entryFile: string = process.argv[1]): string {
  let current = path.dirname(entryFile);
  for (;;) {
    const manifestFile = path.join(current, 'package.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name?: unknown };
      if (parseAlranPackageName(manifest.name) !== undefined) {
        return readFileSync(path.join(current, CHANGELOG_FILE), 'utf8');
      }
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Alran package root not found for the changelog.');
    current = parent;
  }
}

/** Mark the pending announcement as shown so it never repeats. */
export function markAutoUpdateAnnouncementShown(dataDir: string, now: number = Date.now()): void {
  writeAutoUpdateCache(dataDir, {
    ...readAutoUpdateCache(dataDir),
    announcementShownAtMs: now,
  });
}

export interface StartAlranAutoUpdateOptions extends AutoUpdateDependencies {
  readonly currentVersion: string;
  readonly dataDir: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly autoUpdate?: boolean;
  readonly autoUpdateChannel?: string;
  readonly entryFile?: string;
  readonly write?: (value: string) => void;
}

/**
 * The startup entry point: print the pending "Updated to …" line (once), then start the background
 * cycle without awaiting it. Everything before the first `await` is a file read, so startup is
 * never delayed.
 */
export function startAlranAutoUpdate(options: StartAlranAutoUpdateOptions): void {
  try {
    const announcement = resolveAutoUpdateAnnouncement({
      currentVersion: options.currentVersion,
      dataDir: options.dataDir,
      entryFile: options.entryFile,
    });
    if (announcement) {
      const write = options.write ?? process.stderr.write.bind(process.stderr);
      write(`${announcement.line}\n`);
      markAutoUpdateAnnouncementShown(options.dataDir);
    }
  } catch {
    // The announcement is a nicety; it must never break startup.
  }
  void runAutoUpdateCycle({
    currentVersion: options.currentVersion,
    dataDir: options.dataDir,
    environment: options.environment,
    autoUpdate: options.autoUpdate,
    autoUpdateChannel: options.autoUpdateChannel,
    platform: options.platform,
    fetchImpl: options.fetchImpl,
    runCommand: options.runCommand,
    installCommand: options.installCommand,
    packageRoot: options.packageRoot,
    npmGlobalPrefix: options.npmGlobalPrefix,
    write: options.write,
  }).catch(() => undefined);
}

export interface RunAutoUpdateCommandOptions extends AutoUpdateDependencies {
  readonly currentVersion: string;
  readonly dataDir: string;
  readonly mode: 'check' | 'apply';
  readonly channel?: AlranAutoUpdateChannel;
  readonly environment?: NodeJS.ProcessEnv;
  readonly autoUpdate?: boolean;
  readonly autoUpdateChannel?: string;
  readonly write: (value: string) => void;
  readonly now?: () => number;
  readonly stableLagMs?: number;
  readonly registryTimeoutMs?: number;
}

/** `alran update --check` and `alran update --channel <channel>`. */
export async function runAutoUpdateCommand(options: RunAutoUpdateCommandOptions): Promise<void> {
  const environment = options.environment ?? process.env;
  const policy = resolveAutoUpdatePolicy({
    environment,
    autoUpdate: options.autoUpdate,
    autoUpdateChannel: options.autoUpdateChannel,
  });
  const channel = options.channel ?? policy.channel;
  if (policy.offline) {
    options.write('Alran is offline (ALRAN_OFFLINE=1); no update check was performed.\n');
    return;
  }
  const availability = await inspectAutoUpdate({
    currentVersion: options.currentVersion,
    channel,
    fetchImpl: options.fetchImpl,
    stableLagMs: options.stableLagMs,
    timeoutMs: options.registryTimeoutMs,
    now: options.now,
  });
  if (!availability) {
    options.write('Alran could not reach the npm registry; no update check was performed.\n');
    return;
  }
  if (options.mode === 'check' || availability.status !== 'available' || policy.offline) {
    options.write(renderAvailability(availability));
    return;
  }
  const source = await detectAutoUpdateInstallSource(options, environment);
  if (source !== 'npm-global') {
    options.write(
      `Update available: ${availability.latestVersion}. Run: ${hintCommand(source, availability.latestVersion, options.platform ?? process.platform)}\n`,
    );
    return;
  }
  const now = options.now ?? Date.now;
  const cache: AlranAutoUpdateCache = {
    ...readAutoUpdateCache(options.dataDir),
    channel,
    checkedAtMs: now(),
    latestVersion: availability.latestVersion,
  };
  if (
    isAlranTaskLockActive(options.dataDir, now()) ||
    !acquireAutoUpdateLock(options.dataDir, now())
  ) {
    options.write(
      `Alran ${availability.latestVersion} is available, but another Alran process is working; the update is deferred to the next start.\n`,
    );
    writeAutoUpdateCache(options.dataDir, cache);
    return;
  }
  try {
    await installAutoUpdateVersion(options, availability.latestVersion);
    writeAutoUpdateCache(options.dataDir, {
      ...cache,
      installedVersion: availability.latestVersion,
      lastInstallAttemptMs: now(),
      lastInstallError: null,
    });
    options.write(`Alran ${availability.latestVersion} is installed; it becomes active on the next start.\n`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    appendAutoUpdateLog(options.dataDir, `${availability.latestVersion}: ${reason}`);
    writeAutoUpdateCache(options.dataDir, {
      ...cache,
      lastInstallAttemptMs: now(),
      lastInstallError: reason,
    });
    options.write(
      `Alran ${availability.latestVersion} could not be installed; the previous version is unchanged. The reason is logged in the Alran data directory.\n`,
    );
  } finally {
    releaseAutoUpdateLock(options.dataDir);
  }
}

function renderAvailability(availability: AlranAutoUpdateAvailability): string {
  if (availability.status === 'available') {
    return `Alran ${availability.latestVersion} is available on ${availability.channel} (current ${availability.currentVersion}).\n`;
  }
  if (availability.status === 'ahead') {
    return `Alran ${availability.currentVersion} is newer than ${availability.channel} ${availability.latestVersion}; no update was applied.\n`;
  }
  return `Alran ${availability.currentVersion} is current on ${availability.channel}.\n`;
}
