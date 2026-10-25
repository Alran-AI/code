import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  AlranToolsAuthStatusSnapshot,
  AlranToolsHostAuthSession,
  ValidatedAlranToolsResource,
} from '@mavis/alran-tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateTuiAlranToolsHostEnvironment,
  configureAlranToolsChildEnvironment,
} from '../../src/cli/alran-tools-environment.js';
import {
  createTuiAlranToolsRuntimeDir,
  prepareTuiAlranToolsIntegration,
  resolveBundledAlranToolsResourceDir,
} from '../../src/runtime/alran-tools-integration.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('TUI alran-tools integration readiness', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps the POSIX broker socket path below platform limits',
    async () => {
      const runtimeDir = await createTuiAlranToolsRuntimeDir();
      temporaryDirectories.push(runtimeDir);

      expect(runtimeDir).toMatch(/^\/tmp\/alran-tools-tui-\d+-/u);
      expect(path.join(runtimeDir, 'run', 'alran-auth-lease-v1.sock').length).toBeLessThan(100);
    },
  );

  it('does no resource or broker work when the capability is not requested', async () => {
    const validateResource = vi.fn();
    const startBroker = vi.fn();
    const result = await prepareTuiAlranToolsIntegration(
      {
        requested: false,
        dataDir: '/profile',
        buildEnv: 'test',
        region: 'cn',
        session: createSession({ status: 'anonymous', generation: 0 }).session,
        entryUrl: pathToFileURL('/package/cli.js').href,
      },
      { validateResource, startBroker },
    );

    expect(result).toMatchObject({ requested: false, ready: false, category: 'disabled' });
    expect(validateResource).not.toHaveBeenCalled();
    expect(startBroker).not.toHaveBeenCalled();
  });

  it('keeps the package-owned command active while the broker owns authentication', async () => {
    const dataDir = await makeTemporaryDirectory();
    const runtimeDir = path.join(dataDir, 'run', 'alran-tools', 'tui', 'runtime');
    const environment: Record<string, string | undefined> = {
      PATH: ['/usr/bin', '/bin'].join(path.delimiter),
    };
    const auth = createSession({ status: 'anonymous', generation: 1 });
    const brokerDispose = vi.fn(async () => undefined);
    const removeRuntimeDir = vi.fn(async () => undefined);
    const validateResource = vi.fn(() => validatedResource('/package/embedded/alran-tools'));
    const startBroker = vi.fn(async () => ({
      endpoint: path.join(runtimeDir, 'broker.sock'),
      capabilityFile: path.join(runtimeDir, 'broker.cap'),
      dispose: brokerDispose,
    }));

    const result = await prepareTuiAlranToolsIntegration(
      {
        requested: true,
        dataDir,
        buildEnv: 'dev',
        region: 'en',
        bedrockLane: 'oauth2',
        session: auth.session,
        entryUrl: pathToFileURL('/package/cli.js').href,
        environment,
      },
      {
        validateResource,
        startBroker,
        createRuntimeDir: vi.fn(async () => runtimeDir),
        removeRuntimeDir,
      },
    );

    expect(result).toMatchObject({
      requested: true,
      ready: true,
      category: 'ready',
      buildEnv: 'test',
      version: '0.0.0-test.1',
    });
    expect(validateResource).toHaveBeenCalledWith({
      resourceDir: path.resolve('/package', 'embedded', 'alran-tools'),
      expectedBuildEnv: 'test',
    });
    expect(startBroker).toHaveBeenCalledWith({
      dataDir: runtimeDir,
      session: auth.session,
      logger: expect.any(Object),
    });
    expect(environment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).toBe(
      path.join(runtimeDir, 'broker.sock'),
    );
    expect(environment.__MAVIS_ALRAN_TOOLS_BROKER_CAPABILITY_FILE).toBe(
      path.join(runtimeDir, 'broker.cap'),
    );
    expect(environment.__MAVIS_ALRAN_TOOLS_CONFIG_DIR).toBe(
      path.join(dataDir, 'integrations', 'alran-tools', 'en'),
    );
    expect(environment.__MAVIS_ALRAN_TOOLS_REGION).toBe('en');
    expect(environment.__MAVIS_ALRAN_TOOLS_EXTRA_HEADERS).toBe(
      'bedrock_lane:oauth2,bedrock-lane:oauth2',
    );
    expect(environment.__MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE).toBe(process.execPath);
    expect(environment.PATH?.split(path.delimiter)[0]).toBe(
      path.resolve('/package', 'internal-bin'),
    );

    environment.PATH = ['/stale/profile/bin', environment.PATH ?? ''].join(path.delimiter);
    result.ensureCommandPath();
    expect(environment.PATH.split(path.delimiter)[0]).toBe(path.resolve('/package', 'internal-bin'));

    await result.dispose();
    await result.dispose();
    expect(brokerDispose).toHaveBeenCalledOnce();
    expect(removeRuntimeDir).toHaveBeenCalledOnce();
    expect(environment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).toBeUndefined();
    expect(environment.__MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE).toBeUndefined();
    expect(environment.PATH?.split(path.delimiter)).not.toContain(
      path.resolve('/package', 'internal-bin'),
    );
  });

  it('keeps concurrent TUI broker and command environments independent', async () => {
    const sharedDataDir = await makeTemporaryDirectory();
    const firstEnvironment: Record<string, string | undefined> = { PATH: '/usr/bin' };
    const secondEnvironment: Record<string, string | undefined> = { PATH: '/usr/bin' };
    const brokerDisposals: ReturnType<typeof vi.fn>[] = [];
    const startBroker = vi.fn(async ({ dataDir }: { dataDir: string }) => {
      const dispose = vi.fn(async () => undefined);
      brokerDisposals.push(dispose);
      return {
        endpoint: path.join(dataDir, 'broker.sock'),
        capabilityFile: path.join(dataDir, 'broker.cap'),
        dispose,
      };
    });
    const dependencies = {
      validateResource: vi.fn(() => validatedResource('/package/embedded/alran-tools')),
      startBroker,
    };
    const options = {
      requested: true,
      dataDir: sharedDataDir,
      buildEnv: 'test' as const,
      region: 'en' as const,
      session: createSession({ status: 'authenticated' as const, generation: 1 }).session,
      entryUrl: pathToFileURL('/package/cli.js').href,
    };
    const [first, second] = await Promise.all([
      prepareTuiAlranToolsIntegration(
        { ...options, environment: firstEnvironment },
        dependencies,
      ),
      prepareTuiAlranToolsIntegration(
        { ...options, environment: secondEnvironment },
        dependencies,
      ),
    ]);

    try {
      expect(first).toMatchObject({ ready: true, category: 'ready' });
      expect(second).toMatchObject({ ready: true, category: 'ready' });
      expect(firstEnvironment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).not.toBe(
        secondEnvironment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT,
      );
      expect(firstEnvironment.PATH?.split(path.delimiter)[0]).toBe(
        path.resolve('/package', 'internal-bin'),
      );
      expect(secondEnvironment.PATH?.split(path.delimiter)[0]).toBe(
        path.resolve('/package', 'internal-bin'),
      );

      await first.dispose();
      expect(firstEnvironment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).toBeUndefined();
      expect(secondEnvironment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).toBeDefined();
      expect(second).toMatchObject({ ready: true, category: 'ready' });
      expect(brokerDisposals.map((dispose) => dispose.mock.calls.length).sort()).toEqual([0, 1]);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('falls back with a sanitized category when resource validation fails', async () => {
    const warnings: string[] = [];
    const result = await prepareTuiAlranToolsIntegration(
      {
        requested: true,
        dataDir: '/Users/private/profile',
        buildEnv: 'test',
        region: 'cn',
        session: createSession({ status: 'anonymous', generation: 0 }).session,
        entryUrl: pathToFileURL('/Users/private/package/cli.js').href,
        logger: { info: () => undefined, warn: (message) => warnings.push(message) },
      },
      {
        validateResource: () => {
          throw new Error('alran-tools manifest is missing at /Users/private/secret');
        },
      },
    );

    expect(result).toMatchObject({
      requested: true,
      ready: false,
      category: 'resource_unavailable',
    });
    expect(warnings.join('\n')).not.toContain('/Users/private');
  });

  it('uses only an explicit absolute dev resource override', () => {
    expect(
      resolveBundledAlranToolsResourceDir(pathToFileURL('/pkg/cli.js').href, {
        MAVIS_DEV_ALRAN_TOOLS_MODE: 'published',
        MAVIS_DEV_ALRAN_TOOLS_RESOURCE_DIR: path.resolve(tmpdir(), 'alran-tools-resource'),
      }),
    ).toBe(path.resolve(tmpdir(), 'alran-tools-resource'));
    expect(() =>
      resolveBundledAlranToolsResourceDir(pathToFileURL('/pkg/cli.js').href, {
        MAVIS_DEV_ALRAN_TOOLS_MODE: 'published',
        MAVIS_DEV_ALRAN_TOOLS_RESOURCE_DIR: '../alran-tools-resource',
      }),
    ).toThrow(/absolute/u);
  });
});

describe('alran-tools command environment', () => {
  it('uses the TUI runtime even when PATH resolves a different node', async () => {
    const temporaryRoot = await makeTemporaryDirectory();
    const packageRoot = path.join(temporaryRoot, 'package with spaces');
    const internalBin = path.join(packageRoot, 'internal-bin');
    const fakeBin = path.join(packageRoot, 'fake-bin');
    const launcherName = process.platform === 'win32' ? 'alran-tools.cmd' : 'alran-tools';
    const fakeNodeName = process.platform === 'win32' ? 'node.cmd' : 'node';
    const launcher = path.join(internalBin, launcherName);
    await mkdir(internalBin, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await copyFile(
      fileURLToPath(
        new URL(`../../src/cli/alran-tools-launchers/${launcherName}`, import.meta.url),
      ),
      launcher,
    );
    if (process.platform !== 'win32') await chmod(launcher, 0o755);
    await writeFile(
      path.join(packageRoot, 'alran-tools.js'),
      'console.log(JSON.stringify({ execPath: process.execPath, args: process.argv.slice(2) }));\n',
    );
    await writeFile(
      path.join(fakeBin, fakeNodeName),
      process.platform === 'win32' ? '@exit /b 97\r\n' : '#!/bin/sh\nexit 97\n',
    );
    if (process.platform !== 'win32') await chmod(path.join(fakeBin, fakeNodeName), 0o755);

    const environment: Record<string, string | undefined> = {
      ...process.env,
      PATH: [fakeBin, '/usr/bin', '/bin'].join(path.delimiter),
    };
    const activation = activateTuiAlranToolsHostEnvironment(environment, {
      runtimeExecutable: process.execPath,
      brokerEndpoint: path.join(packageRoot, 'broker.sock'),
      brokerCapabilityFile: path.join(packageRoot, 'broker.cap'),
      configDir: path.join(packageRoot, 'config'),
      region: 'en',
      commandBinDir: internalBin,
    });
    let output: string;
    try {
      output =
        process.platform === 'win32'
          ? execFileSync(
              process.env.ComSpec ?? 'cmd.exe',
              ['/d', '/s', '/c', `""${launcher}" probe "two words""`],
              { encoding: 'utf8', env: environment, windowsVerbatimArguments: true },
            )
          : execFileSync(launcher, ['probe', 'two words'], {
              encoding: 'utf8',
              env: environment,
            });
    } finally {
      activation.restore();
    }

    expect(JSON.parse(output)).toEqual({
      execPath: process.execPath,
      args: ['probe', 'two words'],
    });
  });

  it('preserves standalone user configuration outside a TUI-owned process', () => {
    const environment = {
      ALRAN_AUTH_PROVIDER: 'user-provider',
      ALRAN_CONFIG_DIR: '/user/config',
    };

    expect(configureAlranToolsChildEnvironment(environment)).toBe(false);
    expect(environment).toEqual({
      ALRAN_AUTH_PROVIDER: 'user-provider',
      ALRAN_CONFIG_DIR: '/user/config',
    });
  });

  it('maps the TUI broker into the child and removes inherited routing overrides', () => {
    const environment: Record<string, string | undefined> = {
      __MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT: '/runtime/broker.sock',
      __MAVIS_ALRAN_TOOLS_BROKER_CAPABILITY_FILE: '/runtime/broker.cap',
      __MAVIS_ALRAN_TOOLS_CONFIG_DIR: '/profile/integrations/alran-tools/cn',
      __MAVIS_ALRAN_TOOLS_REGION: 'cn',
      __MAVIS_ALRAN_TOOLS_EXTRA_HEADERS: 'bedrock_lane:oauth2,bedrock-lane:oauth2',
      __MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE: process.execPath,
      ALRAN_AUTH_PROVIDER: 'attacker-provider',
      ALRAN_API_BASE_URL: 'https://attacker.invalid/api',
      ALRAN_AUTH_BASE_URL: 'https://attacker.invalid/oauth',
      ALRAN_CLIENT_ID: 'attacker-client',
      ALRAN_SCOPE: 'attacker-scope',
      IS_SANDBOX: '1',
      MAVIS_BUILD_ENV: 'prod',
      MAVIS_REGION: 'us',
      MAVIS_AGENT: 'agent',
      MAVIS_SESSION: 'session',
      __MAVIS_RUNTIME_SECRET: 'runtime-secret',
      AGENTARCHON_SECRET: 'legacy-secret',
      alran_api_base_url: 'https://case-insensitive-attacker.invalid/api',
      __mavis_parent_access_token: 'case-insensitive-token',
    };

    expect(configureAlranToolsChildEnvironment(environment)).toBe(true);
    expect(environment).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      ALRAN_REGION: 'cn',
      ALRAN_CONFIG_DIR: '/profile/integrations/alran-tools/cn',
      ALRAN_AUTH_PROVIDER: 'shared-broker',
      ALRAN_AUTH_BROKER_ENDPOINT: '/runtime/broker.sock',
      ALRAN_AUTH_BROKER_CAPABILITY_FILE: '/runtime/broker.cap',
      ALRAN_EXTRA_HEADERS: 'bedrock_lane:oauth2,bedrock-lane:oauth2',
    });
    expect(environment.ALRAN_API_BASE_URL).toBeUndefined();
    expect(environment.ALRAN_AUTH_BASE_URL).toBeUndefined();
    expect(environment.ALRAN_CLIENT_ID).toBeUndefined();
    expect(environment.ALRAN_SCOPE).toBeUndefined();
    expect(environment.IS_SANDBOX).toBeUndefined();
    expect(environment.MAVIS_BUILD_ENV).toBeUndefined();
    expect(environment.MAVIS_REGION).toBeUndefined();
    expect(environment.MAVIS_AGENT).toBeUndefined();
    expect(environment.MAVIS_SESSION).toBeUndefined();
    expect(environment.__MAVIS_RUNTIME_SECRET).toBeUndefined();
    expect(environment.AGENTARCHON_SECRET).toBeUndefined();
    expect(environment.alran_api_base_url).toBeUndefined();
    expect(environment.__mavis_parent_access_token).toBeUndefined();
    expect(environment.__MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT).toBeUndefined();
    expect(environment.__MAVIS_ALRAN_TOOLS_RUNTIME_EXECUTABLE).toBeUndefined();
  });

  it('rejects a partial TUI host environment', () => {
    expect(() =>
      configureAlranToolsChildEnvironment({
        __MAVIS_ALRAN_TOOLS_BROKER_ENDPOINT: '/runtime/broker.sock',
      }),
    ).toThrow(/Restart Alran/u);
  });
});

function createSession(initialStatus: AlranToolsAuthStatusSnapshot): {
  session: AlranToolsHostAuthSession;
  status: AlranToolsAuthStatusSnapshot;
  emit(status: AlranToolsAuthStatusSnapshot): void;
  stopWatching: ReturnType<typeof vi.fn>;
} {
  let listener: ((status: AlranToolsAuthStatusSnapshot) => void) | undefined;
  const stopWatching = vi.fn();
  const state = {
    status: initialStatus,
    session: {
      getStatus: vi.fn(async () => state.status),
      getAccessToken: vi.fn(),
      handleUnauthorized: vi.fn(),
      watch: vi.fn((nextListener: (status: AlranToolsAuthStatusSnapshot) => void) => {
        listener = nextListener;
        return stopWatching;
      }),
    } satisfies AlranToolsHostAuthSession,
    emit(status: AlranToolsAuthStatusSnapshot): void {
      state.status = status;
      listener?.(status);
    },
    stopWatching,
  };
  return state;
}

function validatedResource(rootDir: string): ValidatedAlranToolsResource {
  return {
    rootDir,
    cliPath: path.join(rootDir, 'cli.mjs'),
    manifest: {
      schemaVersion: 3,
      packageName: '@alran/alran-tools-test',
      version: '0.0.0-test.1',
      gitSha: 'abc1234',
      buildEnv: 'test',
      bedrockLane: 'oauth',
      nodeRange: '>=20',
      entry: 'cli.mjs',
      auth: {
        mode: 'shared-broker',
        protocol: {
          name: '@mavis/oauth-lease-protocol',
          version: '0.1.0-beta.0',
          wireVersion: 1,
        },
      },
      nativePackages: [],
      resources: [{ path: 'cli.mjs', sha256: '0'.repeat(64) }],
    },
  };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'alran-tools-tui-integration-'));
  temporaryDirectories.push(directory);
  return directory;
}
