import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import { parseAlranVersion } from './release.js';
import type { AlranUpdateOperationOptions } from './progress.js';

export const ALRAN_INTERNAL_NPM_REGISTRY = 'https://npmmirror.example.invalid/';
export const ALRAN_PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
export const ALRAN_PUBLIC_NPM_MIRROR_REGISTRY = 'https://registry.npmmirror.com/';
const REGISTRY_FETCH_TIMEOUT_MS = 30_000;
const ALRAN_PACKAGE_BASENAME = 'alran-code';
const ALRAN_INTERNAL_SCOPE = '@alran';
const ALRAN_PUBLIC_SCOPE = '@ottili';
// Public packaging rewrites this marker together with the bundled package identity.
const ALRAN_EMBEDDED_PACKAGE_NAME = '@ottili/alran-code' as AlranNpmPackageName;

export type AlranNpmDistTag = 'latest' | 'test' | 'preview';
export type AlranNpmPackageName = '@ottili/alran-code' | '@alran/alran-code';
type TuiBuildEnvironment = 'test' | 'staging' | 'prod';

declare const __TUI_BUILD_ENV__: TuiBuildEnvironment | undefined;
declare const __TUI_NPM_DIST_TAG__: AlranNpmDistTag | undefined;

export type AlranPackageManagerInstallSource =
  'npm-global' | 'npm-prefix' | 'pnpm-global' | 'yarn-global' | 'bun-global';

export type AlranInstallSource =
  'managed-installer' | AlranPackageManagerInstallSource | 'unsupported';

export interface AlranPackageManagerCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly display: string;
}

export interface AlranNpmPrefixInstall {
  readonly executable: string;
  readonly packageName: AlranNpmPackageName;
  readonly prefix: string;
  readonly registry: string;
  /**
   * Node executable pinned by the install receipt. `process.execPath` resolves
   * Homebrew's stable bin/node symlink into a versioned Cellar path that
   * `brew upgrade` removes, so updates reuse the recorded path when present.
   */
  readonly nodeExecutable?: string;
}

export type AlranPackageManagerRunOptions = AlranUpdateOperationOptions;

export interface AlranNpmDistribution {
  readonly packageName: AlranNpmPackageName;
  readonly registry: string;
}

export interface ResolveLatestAlranRegistryVersionDependencies {
  readonly platform: NodeJS.Platform;
  readonly run: (command: string, args: readonly string[]) => Promise<string>;
  readonly distribution: AlranNpmDistribution;
  readonly npmExecutable: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly runtimeExecutable: string;
}

export interface DetectAlranInstallSourceDependencies {
  readonly installRoot: string;
  readonly platform: NodeJS.Platform;
  readonly packageRoot: () => string | undefined;
  readonly npmGlobalPrefix: () => Promise<string>;
  readonly managedInstall: (installRoot: string) => boolean;
  readonly prefixInstall: () => AlranNpmPrefixInstall | undefined;
}

export function isManagedAlranInstallRoot(installRoot: string): boolean {
  const metadataFile = path.join(installRoot, 'install.json');
  try {
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
    return metadata.product === 'alran-code' && metadata.updateOwner === 'alran-installer';
  } catch {
    return false;
  }
}

export async function detectAlranInstallSource(
  dependencies: Partial<DetectAlranInstallSourceDependencies> & { installRoot: string },
): Promise<AlranInstallSource> {
  const platform = dependencies.platform ?? process.platform;
  const resolved: DetectAlranInstallSourceDependencies = {
    installRoot: dependencies.installRoot,
    platform,
    packageRoot: dependencies.packageRoot ?? resolveAlranPackageRoot,
    npmGlobalPrefix:
      dependencies.npmGlobalPrefix ??
      (() => runText(platform === 'win32' ? 'npm.cmd' : 'npm', ['prefix', '--global'])),
    managedInstall: dependencies.managedInstall ?? isManagedAlranInstallRoot,
    prefixInstall: dependencies.prefixInstall ?? resolveAlranNpmPrefixInstall,
  };

  if (resolved.managedInstall(resolved.installRoot)) return 'managed-installer';
  if (resolved.prefixInstall()) return 'npm-prefix';

  const packageRoot = resolved.packageRoot();
  if (!packageRoot) return 'unsupported';
  const heuristic = classifyAlranInstallPath(packageRoot);
  if (heuristic) return heuristic;

  try {
    return classifyNpmGlobalInstall(packageRoot, await resolved.npmGlobalPrefix(), platform);
  } catch {
    return 'unsupported';
  }
}

export function classifyAlranInstallPath(
  packageRoot: string,
): AlranPackageManagerInstallSource | undefined {
  const normalized = packageRoot.replaceAll('\\', '/').toLocaleLowerCase();
  const scope = alranPackageScopePattern();
  if (
    new RegExp(`\\/pnpm\\/global\\/(?:v11\\/[^/]+|[^/]+)\\/node_modules\\/${scope}\\/${ALRAN_PACKAGE_BASENAME}$`, 'u').test(
      normalized,
    )
  ) {
    return 'pnpm-global';
  }
  if (
    new RegExp(`\\/(?:\\.config\\/yarn|\\.yarn)\\/global\\/node_modules\\/${scope}\\/${ALRAN_PACKAGE_BASENAME}$`, 'u').test(
      normalized,
    )
  ) {
    return 'yarn-global';
  }
  if (
    new RegExp(`\\/\\.bun\\/install\\/global\\/node_modules\\/${scope}\\/${ALRAN_PACKAGE_BASENAME}$`, 'u').test(
      normalized,
    )
  ) {
    return 'bun-global';
  }
  if (
    new RegExp(`\\/(?:lib|npm)\\/node_modules\\/${scope}\\/${ALRAN_PACKAGE_BASENAME}$`, 'u').test(
      normalized,
    )
  ) {
    return 'npm-global';
  }
  return undefined;
}

/** The install-directory scopes the CLI recognizes, kept next to their constants. */
function alranPackageScopePattern(): string {
  const scopes = [ALRAN_INTERNAL_SCOPE, ALRAN_PUBLIC_SCOPE].map((scope) =>
    scope.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  );
  return `(?:${scopes.join('|')})`;
}

export function resolveAlranNpmDistribution(
  packageName: AlranNpmPackageName = resolveAlranPackageName() ?? ALRAN_EMBEDDED_PACKAGE_NAME,
  registry?: string,
): AlranNpmDistribution {
  if (packageName === alranPackageName(ALRAN_INTERNAL_SCOPE)) {
    const resolvedRegistry = registry ? new URL(registry).href : ALRAN_INTERNAL_NPM_REGISTRY;
    if (resolvedRegistry === ALRAN_INTERNAL_NPM_REGISTRY) {
      return { packageName, registry: resolvedRegistry };
    }
    throw new Error(`Unsupported Alran npm registry: ${resolvedRegistry}`);
  }
  if (packageName === alranPackageName(ALRAN_PUBLIC_SCOPE)) {
    const resolvedRegistry = registry ? new URL(registry).href : ALRAN_PUBLIC_NPM_REGISTRY;
    if (
      resolvedRegistry === ALRAN_PUBLIC_NPM_REGISTRY ||
      resolvedRegistry === ALRAN_PUBLIC_NPM_MIRROR_REGISTRY
    ) {
      return { packageName, registry: resolvedRegistry };
    }
    throw new Error(`Unsupported Alran npm registry: ${resolvedRegistry}`);
  }
  throw new Error(`Unsupported Alran npm package: ${String(packageName)}`);
}

export function resolveAlranNpmDistTag(
  environment: TuiBuildEnvironment | undefined = readEmbeddedTuiBuildEnvironment(),
  embeddedTag: AlranNpmDistTag | undefined = readEmbeddedTuiNpmDistTag(),
): AlranNpmDistTag {
  if (embeddedTag) return embeddedTag;
  if (environment === 'test') return 'test';
  if (environment === 'staging') return 'preview';
  return 'latest';
}

export function classifyNpmGlobalInstall(
  packageRoot: string,
  globalPrefix: string,
  platform: NodeJS.Platform = process.platform,
): AlranInstallSource {
  const normalizedRoot = normalizeResolvedPath(packageRoot, platform);
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const packageName =
    alranPackageNameFromPath(packageRoot) ?? alranPackageName(ALRAN_INTERNAL_SCOPE);
  const candidates =
    platform === 'win32'
      ? [platformPath.join(globalPrefix, 'node_modules', packageName)]
      : [
          platformPath.join(globalPrefix, 'lib', 'node_modules', packageName),
          platformPath.join(globalPrefix, 'node_modules', packageName),
        ];
  return candidates.some(
    (candidate) => normalizeResolvedPath(candidate, platform) === normalizedRoot,
  )
    ? 'npm-global'
    : 'unsupported';
}

export function buildAlranPackageManagerCommand(
  source: AlranPackageManagerInstallSource,
  version: string,
  platform: NodeJS.Platform = process.platform,
  distribution: AlranNpmDistribution = resolveAlranNpmDistribution(),
  prefixInstall?: AlranNpmPrefixInstall,
): AlranPackageManagerCommand {
  const targetVersion = ['latest', 'preview', 'test'].includes(version)
    ? version
    : parseAlranVersion(version);
  const target = `${distribution.packageName}@${targetVersion}`;
  const registryArgs = ['--registry', distribution.registry] as const;
  const registryDisplay = `--registry ${distribution.registry}`;
  const npmInstallArgs = [
    '--ignore-scripts=false',
    '--include=optional',
    `--allow-scripts=${distribution.packageName},better-sqlite3`,
  ];
  const npmInstallDisplay = npmInstallArgs.join(' ');
  switch (source) {
    case 'npm-prefix': {
      if (!prefixInstall) throw new Error('Alran npm prefix ownership metadata is missing.');
      if (
        prefixInstall.packageName !== distribution.packageName ||
        new URL(prefixInstall.registry).href !== distribution.registry
      ) {
        throw new Error('Alran npm prefix ownership does not match the installed package.');
      }
      return {
        executable: prefixInstall.executable,
        args: [
          'install',
          '--global',
          '--prefix',
          prefixInstall.prefix,
          target,
          ...npmInstallArgs,
          ...registryArgs,
        ],
        display:
          `${prefixInstall.executable} install --global --prefix ${prefixInstall.prefix} ` +
          `${target} ${npmInstallDisplay} ${registryDisplay}`,
      };
    }
    case 'npm-global':
      return {
        executable: platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['install', '--global', target, ...npmInstallArgs, ...registryArgs],
        display: `npm install --global ${target} ${npmInstallDisplay} ${registryDisplay}`,
      };
    case 'pnpm-global':
      return {
        executable: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        args: ['add', '--global', target, ...registryArgs],
        display: `pnpm add --global ${target} ${registryDisplay}`,
      };
    case 'yarn-global':
      return {
        executable: platform === 'win32' ? 'yarn.cmd' : 'yarn',
        args: ['global', 'add', target, ...registryArgs],
        display: `yarn global add ${target} ${registryDisplay}`,
      };
    case 'bun-global':
      return {
        executable: platform === 'win32' ? 'bun.exe' : 'bun',
        args: ['add', '--global', target, ...registryArgs],
        display: `bun add --global ${target} ${registryDisplay}`,
      };
  }
}

export async function resolveLatestAlranRegistryVersion(
  tag: AlranNpmDistTag,
  dependencies: Partial<ResolveLatestAlranRegistryVersionDependencies> = {},
): Promise<string> {
  const platform = dependencies.platform ?? process.platform;
  const distribution = dependencies.distribution ?? resolveAlranNpmDistribution();
  const run =
    dependencies.run ??
    ((executable, args) => {
      const command = { executable, args, display: executable };
      const bound = dependencies.runtimeExecutable
        ? bindAlranNpmCommandToRuntime(command, dependencies.runtimeExecutable)
        : command;
      return runText(bound.executable, bound.args, dependencies.environment);
    });
  const npmExecutable = dependencies.npmExecutable ?? (platform === 'win32' ? 'npm.cmd' : 'npm');
  const output = await run(npmExecutable, [
    'view',
    `${distribution.packageName}@${tag}`,
    'version',
    '--json',
    '--registry',
    distribution.registry,
    '--fetch-timeout',
    String(REGISTRY_FETCH_TIMEOUT_MS),
  ]);
  let version: unknown;
  try {
    version = JSON.parse(output);
  } catch {
    version = output.trim();
  }
  if (Array.isArray(version)) {
    if (version.length !== 1) {
      throw new Error('Alran registry returned an invalid latest version.');
    }
    version = version[0];
  }
  if (typeof version !== 'string') {
    throw new Error('Alran registry returned an invalid latest version.');
  }
  const parsed = parseAlranVersion(version);
  if (tag === 'latest' && parsed.includes('-')) {
    throw new Error('Alran latest must resolve to a stable semantic version.');
  }
  return parsed;
}

function readEmbeddedTuiBuildEnvironment(): TuiBuildEnvironment | undefined {
  if (typeof __TUI_BUILD_ENV__ === 'undefined') return undefined;
  return __TUI_BUILD_ENV__;
}

function readEmbeddedTuiNpmDistTag(): AlranNpmDistTag | undefined {
  if (typeof __TUI_NPM_DIST_TAG__ === 'undefined') return undefined;
  return __TUI_NPM_DIST_TAG__;
}

export function bindAlranNpmCommandToRuntime(
  command: AlranPackageManagerCommand,
  runtimeExecutable: string,
): AlranPackageManagerCommand {
  const npmExecutable = realpathSync(command.executable);
  const npmDirectory = path.dirname(npmExecutable);
  // Unix npm is normally a symlink to npm-cli.js. Windows npm.cmd prefers its
  // adjacent node.exe over PATH, so bypass that shim and invoke the JS entry.
  const candidates = [
    ...(path.basename(npmExecutable) === 'npm-cli.js' ? [npmExecutable] : []),
    path.join(npmDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(npmDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const npmCli =
    candidates.find((file) => existsSync(file) && statSync(file).isFile()) ??
    resolvePnpmNpmShim(npmExecutable);
  if (!npmCli)
    throw new Error(`Cannot locate npm-cli.js for the owned npm executable: ${command.executable}`);
  return { ...command, executable: runtimeExecutable, args: [npmCli, ...command.args] };
}

function resolvePnpmNpmShim(npmExecutable: string): string | undefined {
  // pnpm env places npm behind a shell shim in PNPM_HOME. Read only its literal
  // versioned CLI target; never execute/source the shim or search other runtimes.
  try {
    const metadata = statSync(npmExecutable);
    if (!metadata.isFile() || metadata.size > 64 * 1024) return undefined;
    const lines = readFileSync(npmExecutable, 'utf8').split(/\r?\n/u);
    if (lines[0] !== '#!/bin/sh') return undefined;
    const commands = lines.map((line) => line.trim()).filter((line) => /^exec\s/u.test(line));
    if (commands.length === 0) return undefined;
    const targets = commands.map(
      (line) =>
        /^exec (?:"\$basedir\/node"|node) "\$basedir\/(nodejs\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/lib\/node_modules\/npm\/bin\/npm-cli\.js)" "\$@"$/u.exec(
          line,
        )?.[1],
    );
    const target = targets[0];
    if (!target || targets.some((candidate) => candidate !== target)) return undefined;
    const npmDirectory = path.dirname(npmExecutable);
    const versionRoot = path.join(npmDirectory, ...target.split('/').slice(0, 2));
    const cli = realpathSync(path.join(npmDirectory, target));
    // Reject symlinks that redirect the target outside this pnpm Node version.
    if (!isResolvedPathInside(versionRoot, cli, path) || !statSync(cli).isFile()) return undefined;
    return cli;
  } catch {
    return undefined;
  }
}

export function createAlranNpmRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  runtimeExecutable: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const result = { ...environment };
  // Windows environment keys are case-insensitive. Keep only one PATH key so Node and
  // cross-spawn cannot choose a different inherited spelling.
  const pathKeys = Object.keys(result)
    .filter((key) => (platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH'))
    .sort();
  const inheritedPath = result[pathKeys[0] ?? 'PATH'];
  for (const key of pathKeys) delete result[key];
  result.PATH = [platformPath.dirname(runtimeExecutable), inheritedPath]
    .filter(Boolean)
    .join(platformPath.delimiter);
  return result;
}

export function runAlranPackageManagerCommand(
  command: AlranPackageManagerCommand,
  environment: NodeJS.ProcessEnv = process.env,
  options: AlranPackageManagerRunOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command.executable, [...command.args], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      notifyPackageManagerOutput(options, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      notifyPackageManagerOutput(options, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const details = Buffer.concat([...stderr, ...stdout])
        .toString('utf8')
        .trim();
      reject(
        new Error(
          `${command.executable} failed (${
            signal ? `signal ${signal}` : `exit ${String(code)}`
          })${details ? `: ${details}` : ''}`,
        ),
      );
    });
  });
}

function notifyPackageManagerOutput(options: AlranPackageManagerRunOptions, chunk: Buffer): void {
  try {
    options.onOutput?.(chunk.toString('utf8'));
  } catch {
    // Progress rendering must never change the package-manager result.
  }
}

export function resolveAlranPackageName(
  entryFile = process.argv[1],
): AlranNpmPackageName | undefined {
  return resolveAlranPackageIdentity(entryFile)?.packageName;
}

export function isInternalAlranPackageName(packageName: string | undefined): boolean {
  return packageName === alranPackageName(ALRAN_INTERNAL_SCOPE);
}

export function resolveInstalledAlranPackageVersion(
  entryFile = process.argv[1],
): string | undefined {
  return resolveAlranPackageIdentity(entryFile)?.version;
}

export function resolveAlranNpmPrefixInstall(
  entryFile = process.argv[1],
  platform: NodeJS.Platform = process.platform,
  nodeExecutable = process.execPath,
): AlranNpmPrefixInstall | undefined {
  const identity = resolveAlranPackageIdentity(entryFile);
  if (!identity) return undefined;
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const nodeModules = platformPath.dirname(platformPath.dirname(identity.packageRoot));
  if (platformPath.basename(nodeModules).toLocaleLowerCase() !== 'node_modules') return undefined;
  const nodeModulesParent = platformPath.dirname(nodeModules);
  const packagePrefix =
    platform !== 'win32' && platformPath.basename(nodeModulesParent) === 'lib'
      ? platformPath.dirname(nodeModulesParent)
      : nodeModulesParent;
  const receipt = findNpmPrefixReceipt(packagePrefix, identity.packageRoot, platform, platformPath);
  if (receipt) {
    if (receipt.packageName !== identity.packageName) return undefined;
    return receipt;
  }

  if (platformPath.basename(packagePrefix).toLocaleLowerCase() !== '.alran-code')
    return undefined;
  const adjacentNpm = platformPath.join(
    platformPath.dirname(nodeExecutable),
    platform === 'win32' ? 'npm.cmd' : 'npm',
  );
  if (!existsSync(adjacentNpm)) return undefined;
  const distribution = resolveAlranNpmDistribution(identity.packageName);
  return {
    executable: adjacentNpm,
    packageName: identity.packageName,
    prefix: packagePrefix,
    registry: distribution.registry,
  };
}

function resolveAlranPackageRoot(entryFile = process.argv[1]): string | undefined {
  return resolveAlranPackageIdentity(entryFile)?.packageRoot;
}

function resolveAlranPackageIdentity(
  entryFile: string | undefined,
): { packageName: AlranNpmPackageName; packageRoot: string; version?: string } | undefined {
  if (!entryFile) return undefined;
  let current: string;
  try {
    const resolved = realpathSync(entryFile);
    current = statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return undefined;
  }

  for (;;) {
    const manifestFile = path.join(current, 'package.json');
    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        const packageName = parseAlranPackageName(manifest.name);
        if (packageName) {
          return {
            packageName,
            packageRoot: current,
            ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
          };
        }
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findNpmPrefixReceipt(
  packagePrefix: string,
  packageRoot: string,
  platform: NodeJS.Platform,
  platformPath: typeof path.posix | typeof path.win32,
): AlranNpmPrefixInstall | undefined {
  let candidate = packagePrefix;
  for (let depth = 0; depth < 3; depth += 1) {
    const receipt = readNpmPrefixReceipt(
      candidate,
      packagePrefix,
      packageRoot,
      platform,
      platformPath,
    );
    if (receipt) return receipt;
    const parent = platformPath.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

function readNpmPrefixReceipt(
  prefix: string,
  packagePrefix: string,
  packageRoot: string,
  platform: NodeJS.Platform,
  platformPath: typeof path.posix | typeof path.win32,
): AlranNpmPrefixInstall | undefined {
  try {
    const raw = readFileSync(platformPath.join(prefix, 'install.json'), 'utf8').replace(
      /^\uFEFF/u,
      '',
    );
    const value = JSON.parse(raw) as {
      schemaVersion?: unknown;
      product?: unknown;
      updateOwner?: unknown;
      packageManager?: unknown;
      packageName?: unknown;
      registry?: unknown;
      distTag?: unknown;
      prefix?: unknown;
      npmExecutable?: unknown;
      nodeExecutable?: unknown;
      layoutVersion?: unknown;
      releasesDirectory?: unknown;
      currentFile?: unknown;
    };
    const packageName = parseAlranPackageName(value.packageName);
    const legacyLayout = value.schemaVersion === 1 && value.layoutVersion === undefined;
    const versionedLayout =
      value.schemaVersion === 2 &&
      value.layoutVersion === 2 &&
      value.releasesDirectory === 'releases' &&
      value.currentFile === 'current';
    if (
      (!legacyLayout && !versionedLayout) ||
      value.product !== 'alran-code' ||
      value.updateOwner !== 'npm-prefix' ||
      value.packageManager !== 'npm' ||
      !packageName ||
      typeof value.registry !== 'string' ||
      value.distTag !== 'latest' ||
      typeof value.prefix !== 'string' ||
      typeof value.npmExecutable !== 'string'
    ) {
      return undefined;
    }
    const distribution = resolveAlranNpmDistribution(packageName, value.registry);
    if (
      normalizeResolvedPath(value.prefix, platform) !== normalizeResolvedPath(prefix, platform) ||
      new URL(value.registry).href !== distribution.registry ||
      !existsSync(value.npmExecutable)
    ) {
      return undefined;
    }
    if (
      legacyLayout &&
      normalizeResolvedPath(packagePrefix, platform) !== normalizeResolvedPath(prefix, platform)
    ) {
      return undefined;
    }
    if (versionedLayout) {
      const expectedReleasesRoot = platformPath.join(prefix, 'releases');
      const relativeRelease = platformPath.relative(expectedReleasesRoot, packagePrefix);
      if (
        !relativeRelease ||
        relativeRelease.startsWith('..') ||
        platformPath.isAbsolute(relativeRelease) ||
        relativeRelease.includes(platformPath.sep) ||
        !/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(relativeRelease) ||
        !isResolvedPathInside(packagePrefix, packageRoot, platformPath)
      ) {
        return undefined;
      }
    }
    const nodeExecutable =
      typeof value.nodeExecutable === 'string' && platformPath.isAbsolute(value.nodeExecutable)
        ? canonicalReceiptNodeExecutable(value.nodeExecutable)
        : undefined;
    return {
      executable: value.npmExecutable,
      packageName,
      prefix,
      registry: distribution.registry,
      ...(nodeExecutable ? { nodeExecutable } : {}),
    };
  } catch {
    return undefined;
  }
}

// Homebrew deletes versioned Cellar kegs on `brew upgrade` while the
// formula-managed opt/<formula> symlink keeps tracking the installed version,
// and keeps the update PATH prefix scoped to the Node formula instead of all
// of <brew>/bin. Receipts that recorded a Cellar keg (or the linked bin/node)
// therefore heal to the stable opt path when both resolve to the same
// executable; everything else keeps the recorded path unchanged.
const HOMEBREW_CELLAR_NODE_PATH =
  /^(?<prefix>.+)\/Cellar\/(?<formula>node(?:@\d+(?:\.\d+)*)?)\/[^/]+\/bin\/node$/u;
const HOMEBREW_MANAGED_NODE_PATH =
  /^(?<prefix>\/(?:opt\/homebrew|usr\/local|home\/linuxbrew\/\.linuxbrew))\/(?:opt\/(?<formula>node(?:@\d+(?:\.\d+)*)?)\/bin\/node|bin\/node)$/u;

function canonicalReceiptNodeExecutable(nodeExecutable: string): string | undefined {
  const canonical = canonicalHomebrewNodeExecutable(nodeExecutable);
  return usableNodeExecutable(canonical) ?? usableNodeExecutable(nodeExecutable);
}

function canonicalHomebrewNodeExecutable(nodeExecutable: string): string {
  const cellar = HOMEBREW_CELLAR_NODE_PATH.exec(nodeExecutable);
  const managed = HOMEBREW_MANAGED_NODE_PATH.exec(nodeExecutable);
  const prefix = cellar?.groups?.prefix ?? managed?.groups?.prefix;
  if (!prefix) return nodeExecutable;
  const formula = cellar?.groups?.formula ?? managed?.groups?.formula ?? 'node';
  const candidate = `${prefix}/opt/${formula}/bin/node`;
  if (candidate === nodeExecutable) return nodeExecutable;
  try {
    if (realpathSync(candidate) === realpathSync(nodeExecutable)) return candidate;
  } catch {
    // Keep the recorded path when either side does not resolve.
  }
  return nodeExecutable;
}

function usableNodeExecutable(nodeExecutable: string): string | undefined {
  try {
    if (!statSync(nodeExecutable).isFile()) return undefined;
    accessSync(nodeExecutable, constants.X_OK);
    return nodeExecutable;
  } catch {
    return undefined;
  }
}

function isResolvedPathInside(
  root: string,
  candidate: string,
  platformPath: typeof path.posix | typeof path.win32,
): boolean {
  const relative = platformPath.relative(
    platformPath.resolve(root),
    platformPath.resolve(candidate),
  );
  return relative !== '' && !relative.startsWith('..') && !platformPath.isAbsolute(relative);
}

function parseAlranPackageName(value: unknown): AlranNpmPackageName | undefined {
  if (value === alranPackageName(ALRAN_INTERNAL_SCOPE)) return value as AlranNpmPackageName;
  if (value === alranPackageName(ALRAN_PUBLIC_SCOPE)) return value as AlranNpmPackageName;
  return undefined;
}

function alranPackageName(scope: string): AlranNpmPackageName {
  return `${scope}/${ALRAN_PACKAGE_BASENAME}` as AlranNpmPackageName;
}

function alranPackageNameFromPath(packageRoot: string): AlranNpmPackageName | undefined {
  const normalized = packageRoot.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.at(-1) !== ALRAN_PACKAGE_BASENAME) return undefined;
  return parseAlranPackageName(`${segments.at(-2)}/${ALRAN_PACKAGE_BASENAME}`);
}

function normalizeResolvedPath(value: string, platform: NodeJS.Platform): string {
  let resolved: string;
  try {
    resolved = realpathSync(value);
  } catch {
    resolved = (platform === 'win32' ? path.win32 : path.posix).resolve(value);
  }
  return platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function runText(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
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
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8').trim());
        return;
      }
      const details = Buffer.concat([...stderr, ...stdout])
        .toString('utf8')
        .trim();
      reject(
        new Error(
          `${command} failed (${
            signal ? `signal ${signal}` : `exit ${String(code)}`
          })${details ? `: ${details}` : ''}`,
        ),
      );
    });
  });
}
