import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  validateEmbeddedResourceFiles,
  validateEmbeddedResourceManifest,
} from './resource-manifest.mjs';

import {
  AUTH_LEASE_PROTOCOL_PACKAGE_NAME,
  AUTH_LEASE_PROTOCOL_PACKAGE_VERSION,
  AUTH_LEASE_PROTOCOL_VERSION,
} from '@mavis/oauth-lease-protocol';

export type AlranToolsBuildEnv = 'test' | 'staging' | 'prod';
export type AlranToolsRegion = 'cn' | 'en';

export interface AlranToolsManifest {
  schemaVersion: 3 | 4;
  packageName: string;
  version: string;
  gitSha: string;
  buildEnv: AlranToolsBuildEnv;
  bedrockLane: string;
  nodeRange: string;
  entry: 'cli.mjs';
  auth: {
    mode: 'shared-broker';
    protocol: {
      name: typeof AUTH_LEASE_PROTOCOL_PACKAGE_NAME;
      version: typeof AUTH_LEASE_PROTOCOL_PACKAGE_VERSION;
      wireVersion: typeof AUTH_LEASE_PROTOCOL_VERSION;
    };
  };
  nativePackages: { name: 'registry-js'; version: string; napiVersion: 3 }[];
  resources: [{ path: 'cli.mjs'; sha256: string }, ...{ path: string; sha256: string }[]];
}

export interface ValidatedAlranToolsResource {
  rootDir: string;
  cliPath: string;
  manifest: AlranToolsManifest;
}

export function validateAlranToolsResource(options: {
  resourceDir: string;
  expectedBuildEnv: AlranToolsBuildEnv;
}): ValidatedAlranToolsResource {
  const manifestPath = path.join(options.resourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('alran-tools manifest is missing');

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('alran-tools manifest is not valid JSON');
  }
  const manifest = parseManifest(value);
  if (manifest.buildEnv !== options.expectedBuildEnv) {
    throw new Error(
      `alran-tools build environment mismatch: expected ${options.expectedBuildEnv}, received ${manifest.buildEnv}`,
    );
  }
  const expectedPackageName = packageNameForBuildEnv(options.expectedBuildEnv);
  if (manifest.packageName !== expectedPackageName) {
    throw new Error(
      `alran-tools package mismatch: expected ${expectedPackageName}, received ${manifest.packageName}`,
    );
  }

  const cliPath = path.join(options.resourceDir, manifest.entry);
  if (!existsSync(cliPath)) throw new Error('alran-tools embedded cli is missing');
  validateEmbeddedResourceFiles(options.resourceDir, manifest);

  return { rootDir: options.resourceDir, cliPath, manifest };
}

export async function installAlranToolsLauncher(options: {
  resourceDir: string;
  expectedBuildEnv: AlranToolsBuildEnv;
  dataDir: string;
  executable: string;
  platform: NodeJS.Platform;
  region: AlranToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): Promise<{
  launcherPath: string;
  regionalLauncherPath: string;
  resource: ValidatedAlranToolsResource;
}> {
  const resource = validateAlranToolsResource(options);
  const binDir = path.join(options.dataDir, 'bin');
  const configDir = path.join(options.dataDir, 'integrations', 'alran-tools', options.region);
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(binDir, 0o700);
  chmodSync(configDir, 0o700);

  const isWindows = options.platform === 'win32';
  const launcherPath = path.join(binDir, isWindows ? 'alran-tools.cmd' : 'alran-tools');
  const regionLabel = options.region === 'cn' ? 'cn' : 'global';
  const regionalLauncherPath = path.join(
    binDir,
    isWindows ? `alran-tools-${regionLabel}.cmd` : `alran-tools-${regionLabel}`,
  );
  const staleLauncherPaths = isWindows
    ? ['alran-tools', 'alran-tools-cn', 'alran-tools-global']
    : ['alran-tools.cmd', 'alran-tools-cn.cmd', 'alran-tools-global.cmd'];
  const bedrockLane = resolveManagedBedrockLane(options.bedrockLane);
  const contents = isWindows
    ? renderWindowsLauncher({
        executable: options.executable,
        cliPath: resource.cliPath,
        configDir,
        region: options.region,
        ...(bedrockLane ? { bedrockLane } : {}),
        brokerEndpoint: options.brokerEndpoint,
        brokerCapabilityFile: options.brokerCapabilityFile,
      })
    : renderPosixLauncher({
        executable: options.executable,
        cliPath: resource.cliPath,
        configDir,
        region: options.region,
        ...(bedrockLane ? { bedrockLane } : {}),
        brokerEndpoint: options.brokerEndpoint,
        brokerCapabilityFile: options.brokerCapabilityFile,
      });
  const dispatcher = isWindows ? renderWindowsDispatcher() : renderPosixDispatcher();

  writeFileIfChanged(regionalLauncherPath, contents, isWindows ? 0o600 : 0o755);
  writeFileIfChanged(launcherPath, dispatcher, isWindows ? 0o600 : 0o755);
  for (const staleName of staleLauncherPaths) {
    rmSync(path.join(binDir, staleName), { force: true });
  }
  return { launcherPath, regionalLauncherPath, resource };
}

export function removeAlranToolsLaunchers(dataDir: string, region?: AlranToolsRegion): void {
  const binDir = path.join(dataDir, 'bin');
  const regionLabels = region ? [region === 'cn' ? 'cn' : 'global'] : ['cn', 'global'];
  for (const name of regionLabels.flatMap((label) => [
    `alran-tools-${label}`,
    `alran-tools-${label}.cmd`,
  ])) {
    rmSync(path.join(binDir, name), { force: true });
  }
  const hasRegionalLauncher = ['cn', 'global'].some(
    (label) =>
      existsSync(path.join(binDir, `alran-tools-${label}`)) ||
      existsSync(path.join(binDir, `alran-tools-${label}.cmd`)),
  );
  if (!hasRegionalLauncher) {
    rmSync(path.join(binDir, 'alran-tools'), { force: true });
    rmSync(path.join(binDir, 'alran-tools.cmd'), { force: true });
  }
}

function renderPosixDispatcher(): string {
  return [
    '#!/bin/sh',
    'alran_tools_bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    ['alran_tools_region=$', '{ALRAN_REGION:-$', '{MAVIS_REGION:-}}'].join(''),
    'case "$alran_tools_region" in',
    '  cn) alran_tools_target="$alran_tools_bin_dir/alran-tools-cn" ;;',
    '  en|global) alran_tools_target="$alran_tools_bin_dir/alran-tools-global" ;;',
    '  "")',
    '    if [ -x "$alran_tools_bin_dir/alran-tools-cn" ] && [ ! -x "$alran_tools_bin_dir/alran-tools-global" ]; then',
    '      alran_tools_target="$alran_tools_bin_dir/alran-tools-cn"',
    '    elif [ -x "$alran_tools_bin_dir/alran-tools-global" ] && [ ! -x "$alran_tools_bin_dir/alran-tools-cn" ]; then',
    '      alran_tools_target="$alran_tools_bin_dir/alran-tools-global"',
    '    else',
    '      echo "ALRAN_REGION must be cn or global when both regional alran-tools launchers are installed." >&2',
    '      exit 2',
    '    fi',
    '    ;;',
    '  *) echo "Invalid ALRAN_REGION; expected cn or global." >&2; exit 2 ;;',
    'esac',
    'exec "$alran_tools_target" "$@"',
    '',
  ].join('\n');
}

function renderWindowsDispatcher(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "alran_tools_region=%ALRAN_REGION%"',
    'if not defined alran_tools_region set "alran_tools_region=%MAVIS_REGION%"',
    'if /i "%alran_tools_region%"=="cn" goto alran_tools_cn',
    'if /i "%alran_tools_region%"=="en" goto alran_tools_global',
    'if /i "%alran_tools_region%"=="global" goto alran_tools_global',
    'if defined alran_tools_region goto alran_tools_invalid',
    'if exist "%~dp0alran-tools-cn.cmd" if not exist "%~dp0alran-tools-global.cmd" goto alran_tools_cn',
    'if exist "%~dp0alran-tools-global.cmd" if not exist "%~dp0alran-tools-cn.cmd" goto alran_tools_global',
    'echo ALRAN_REGION must be cn or global when both regional alran-tools launchers are installed. 1>&2',
    'exit /b 2',
    ':alran_tools_cn',
    'call "%~dp0alran-tools-cn.cmd" %*',
    'exit /b %ERRORLEVEL%',
    ':alran_tools_global',
    'call "%~dp0alran-tools-global.cmd" %*',
    'exit /b %ERRORLEVEL%',
    ':alran_tools_invalid',
    'echo Invalid ALRAN_REGION; expected cn or global. 1>&2',
    'exit /b 2',
    '',
  ].join('\r\n');
}

export function renderPosixLauncher(options: {
  executable: string;
  cliPath: string;
  configDir: string;
  region: AlranToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): string {
  const lines = [
    '#!/bin/sh',
    'unset MAVIS_ACCESS_TOKEN MAVIS_DATA_DIR ALRAN_DATA_DIR MAVIS_PORT MAVIS_PROFILE IS_SANDBOX ALRAN_API_BASE_URL ALRAN_AUTH_BASE_URL ALRAN_CLIENT_ID ALRAN_SCOPE ALRAN_AUTH_PROVIDER ALRAN_AUTH_BROKER_ENDPOINT ALRAN_AUTH_BROKER_CAPABILITY_FILE ALRAN_EXTRA_HEADERS',
    "for alran_tools_name in $(env | sed -n 's/^\\([^=]*\\)=.*$/\\1/p'); do",
    '  case "$alran_tools_name" in',
    '    __MAVIS_PARENT_*|__MAVIS_RUNTIME_*|AGENTARCHON_*|AGENT_ARCHON_*) unset "$alran_tools_name" ;;',
    '  esac',
    'done',
    'unset alran_tools_name',
    'export ELECTRON_RUN_AS_NODE=1',
    `export ALRAN_REGION=${quotePosix(options.region)}`,
    `export ALRAN_CONFIG_DIR=${quotePosix(options.configDir)}`,
  ];
  lines.push(
    'export ALRAN_AUTH_PROVIDER=shared-broker',
    `export ALRAN_AUTH_BROKER_ENDPOINT=${quotePosix(options.brokerEndpoint)}`,
    `export ALRAN_AUTH_BROKER_CAPABILITY_FILE=${quotePosix(options.brokerCapabilityFile)}`,
  );
  if (options.bedrockLane) {
    lines.push(
      `export ALRAN_EXTRA_HEADERS=${quotePosix(`bedrock_lane:${options.bedrockLane},bedrock-lane:${options.bedrockLane}`)}`,
    );
  }
  lines.push(`exec ${quotePosix(options.executable)} ${quotePosix(options.cliPath)} "$@"`, '');
  return lines.join('\n');
}

export function renderWindowsLauncher(options: {
  executable: string;
  cliPath: string;
  configDir: string;
  region: AlranToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): string {
  const lines = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "MAVIS_ACCESS_TOKEN="',
    'set "MAVIS_DATA_DIR="',
    'set "ALRAN_DATA_DIR="',
    'set "MAVIS_PORT="',
    'set "MAVIS_PROFILE="',
    'set "IS_SANDBOX="',
    'set "ALRAN_API_BASE_URL="',
    'set "ALRAN_AUTH_BASE_URL="',
    'set "ALRAN_CLIENT_ID="',
    'set "ALRAN_SCOPE="',
    'set "ALRAN_AUTH_PROVIDER="',
    'set "ALRAN_AUTH_BROKER_ENDPOINT="',
    'set "ALRAN_AUTH_BROKER_CAPABILITY_FILE="',
    'set "ALRAN_EXTRA_HEADERS="',
    'for /f "tokens=1 delims==" %%V in (\'set __MAVIS_PARENT_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set __MAVIS_RUNTIME_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set AGENTARCHON_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set AGENT_ARCHON_ 2^>nul\') do set "%%V="',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "ALRAN_REGION=${escapeWindowsBatchValue(options.region)}"`,
    `set "ALRAN_CONFIG_DIR=${escapeWindowsBatchValue(options.configDir)}"`,
  ];
  lines.push(
    'set "ALRAN_AUTH_PROVIDER=shared-broker"',
    `set "ALRAN_AUTH_BROKER_ENDPOINT=${escapeWindowsBatchValue(options.brokerEndpoint)}"`,
    `set "ALRAN_AUTH_BROKER_CAPABILITY_FILE=${escapeWindowsBatchValue(options.brokerCapabilityFile)}"`,
  );
  if (options.bedrockLane) {
    lines.push(
      `set "ALRAN_EXTRA_HEADERS=${escapeWindowsBatchValue(`bedrock_lane:${options.bedrockLane},bedrock-lane:${options.bedrockLane}`)}"`,
    );
  }
  lines.push(
    `"${escapeWindowsBatchValue(options.executable)}" "${escapeWindowsBatchValue(options.cliPath)}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  );
  return lines.join('\r\n');
}

function parseManifest(value: unknown): AlranToolsManifest {
  if (!value || typeof value !== 'object') throw new Error('alran-tools manifest is invalid');
  const input = value as Record<string, unknown>;
  const buildEnv = input.buildEnv;
  if (buildEnv !== 'test' && buildEnv !== 'staging' && buildEnv !== 'prod') {
    throw new Error('alran-tools manifest buildEnv is invalid');
  }
  if (input.entry !== 'cli.mjs') throw new Error('alran-tools manifest entry is invalid');
  for (const key of ['packageName', 'version', 'gitSha', 'nodeRange'] as const) {
    if (typeof input[key] !== 'string' || input[key].trim().length === 0) {
      throw new Error(`alran-tools manifest ${key} is invalid`);
    }
  }
  if (typeof input.bedrockLane !== 'string') {
    throw new Error('alran-tools manifest bedrockLane is invalid');
  }
  if (buildEnv !== 'test' && input.bedrockLane.trim().length > 0) {
    throw new Error('alran-tools non-test manifest must not select a Bedrock lane');
  }

  const auth = input.auth as Record<string, unknown> | undefined;
  const protocol = auth?.protocol as Record<string, unknown> | undefined;
  if (
    (input.schemaVersion !== 3 && input.schemaVersion !== 4) ||
    auth?.mode !== 'shared-broker' ||
    protocol?.name !== AUTH_LEASE_PROTOCOL_PACKAGE_NAME ||
    protocol?.version !== AUTH_LEASE_PROTOCOL_PACKAGE_VERSION ||
    protocol?.wireVersion !== AUTH_LEASE_PROTOCOL_VERSION
  ) {
    throw new Error('alran-tools shared-broker lease protocol manifest is incompatible');
  }
  if (hasOwn(input, 'sharedLocal') || hasOwn(input, 'platform') || hasOwn(input, 'arch')) {
    throw new Error(
      'alran-tools shared-broker manifest must not contain shared-local platform metadata',
    );
  }
  validateEmbeddedResourceManifest(input);
  return input as unknown as AlranToolsManifest;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveManagedBedrockLane(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const lane = value.trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(lane)) {
    throw new Error('alran-tools Bedrock lane is invalid');
  }
  return lane;
}

function packageNameForBuildEnv(buildEnv: AlranToolsBuildEnv): string {
  if (buildEnv === 'test') return '@alran/alran-tools-test';
  if (buildEnv === 'staging') return '@alran/alran-tools-staging';
  return '@alran/alran-tools';
}

function quotePosix(value: string): string {
  if (/\r|\n|\0/u.test(value)) throw new Error('alran-tools launcher path contains control data');
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function escapeWindowsBatchValue(value: string): string {
  if (/\r|\n|\0|"/u.test(value)) {
    throw new Error('alran-tools launcher path contains unsupported characters');
  }
  return value.replace(/%/gu, '%%');
}

function writeFileIfChanged(file: string, contents: string, mode: number): void {
  if (existsSync(file) && readFileSync(file, 'utf8') === contents) {
    chmodSync(file, mode);
    return;
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, contents, { mode });
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  chmodSync(file, mode);
}
