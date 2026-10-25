import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AlranUpdateApplication,
  type AlranUpdateApplicationDependencies,
} from '../../src/update/application.js';
import {
  bindAlranNpmCommandToRuntime,
  buildAlranPackageManagerCommand,
  classifyAlranInstallPath,
  classifyNpmGlobalInstall,
  detectAlranInstallSource,
  isInternalAlranPackageName,
  resolveAlranNpmDistribution,
  resolveAlranNpmDistTag,
  resolveAlranNpmPrefixInstall,
  resolveAlranPackageName,
  resolveInstalledAlranPackageVersion,
  resolveLatestAlranRegistryVersion,
} from '../../src/update/install-source.js';
import {
  resolveAlranPrefixLauncherPairs,
  resolveAlranPrefixModulesRoot,
  writeAlranPrefixUpdatePending,
} from '../../src/update/prefix-update.js';

describe('installer-owned npm runtime binding', () => {
  const target = 'nodejs/26.3.1/lib/node_modules/npm/bin/npm-cli.js';
  const shim = (cli = target) =>
    [
      '#!/bin/sh',
      'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
      'if [ -x "$basedir/node" ]; then',
      `  exec "$basedir/node" "$basedir/${cli}" "$@"`,
      'else',
      `  exec node "$basedir/${cli}" "$@"`,
      'fi',
    ].join('\n');

  async function withLayout(
    run: (root: string, write: (file: string, text?: string) => string) => void | Promise<void>,
  ) {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'alran-npm-shim-')));
    const write = (file: string, text = '') => {
      const fullPath = path.join(root, file);
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, text);
      return fullPath;
    };
    try {
      await run(root, write);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function bind(executable: string) {
    return bindAlranNpmCommandToRuntime(
      { executable, args: ['view', '@ottili/alran-code@latest', '--json'], display: 'owned npm' },
      process.execPath,
    );
  }

  it('resolves the reported pnpm shell shim and runs its CLI with the selected Node', async () => {
    await withLayout(async (root, write) => {
      const marker = path.join(root, 'shim-was-executed');
      const npm = write(
        'pnpm home/npm',
        shim().replace('#!/bin/sh', `#!/bin/sh\ntouch "${marker}"`),
      );
      const cli = write(`pnpm home/${target}`, 'console.log(JSON.stringify("1.2.4"));');
      // A different installed pnpm Node version must not influence the selection.
      write(
        'pnpm home/nodejs/24.2.0/lib/node_modules/npm/bin/npm-cli.js',
        'throw new Error("wrong npm");',
      );
      expect(bind(npm)).toEqual({
        executable: process.execPath,
        args: [cli, 'view', '@ottili/alran-code@latest', '--json'],
        display: 'owned npm',
      });
      await expect(
        resolveLatestAlranRegistryVersion('latest', {
          npmExecutable: npm,
          runtimeExecutable: process.execPath,
          distribution: resolveAlranNpmDistribution('@ottili/alran-code'),
        }),
      ).resolves.toBe('1.2.4');
      expect(existsSync(marker)).toBe(false);
    });
  });

  it.skipIf(process.platform === 'win32')(
    'preserves regular npm symlinks and resolves symlinked pnpm shims',
    async () => {
      await withLayout((root, write) => {
        const cli = write(`pnpm home/${target}`);
        const npm = write('pnpm home/npm', shim());
        symlinkSync(npm, path.join(root, 'npm'));
        expect(bind(path.join(root, 'npm')).args[0]).toBe(cli);
        const regularCli = write('node/lib/node_modules/npm/bin/npm-cli.js');
        mkdirSync(path.join(root, 'node/bin'), { recursive: true });
        symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', path.join(root, 'node/bin/npm'));
        expect(bind(path.join(root, 'node/bin/npm')).args[0]).toBe(regularCli);
      });
    },
  );

  it.each([
    ['node/npm.cmd', 'node/node_modules/npm/bin/npm-cli.js'],
    ['node/bin/npm', 'node/lib/node_modules/npm/bin/npm-cli.js'],
  ])('preserves conventional npm layout for %s', async (executable, cliPath) => {
    await withLayout((_root, write) => {
      const npm = write(executable, '@ECHO OFF\r\n');
      const cli = write(cliPath);
      expect(bind(npm).args[0]).toBe(cli);
    });
  });

  it.each([
    ['missing target', shim()],
    ['directory target', shim()],
    ['traversal', shim(`../${target}`)],
    ['dynamic version', shim('nodejs/$(node -v)/lib/node_modules/npm/bin/npm-cli.js')],
    [
      'ambiguous branches',
      shim().replace('exec node "$basedir/nodejs/26.3.1/', 'exec node "$basedir/nodejs/24.2.0/'),
    ],
    ['comment-only target', `#!/bin/sh\n# exec node "$basedir/${target}" "$@"`],
    ['unknown wrapper', '#!/bin/sh\nexec npm "$@"'],
  ])('rejects %s without searching other installed versions', async (kind, content) => {
    await withLayout((root, write) => {
      const npm = write('pnpm/npm', content);
      write('pnpm/nodejs/24.2.0/lib/node_modules/npm/bin/npm-cli.js');
      if (kind === 'directory target')
        mkdirSync(path.join(root, 'pnpm', target), { recursive: true });
      else if (kind !== 'missing target') write(`pnpm/${target}`);
      write(target);
      expect(() => bind(npm)).toThrow('Cannot locate npm-cli.js for the owned npm executable');
    });
  });

  it.skipIf(process.platform === 'win32').each(['file', 'version directory', 'dangling file'])(
    'rejects a pnpm %s symlink escaping its version directory',
    async (kind) => {
      await withLayout((root, write) => {
        const npm = write('pnpm/npm', shim());
        const outside = write('outside/lib/node_modules/npm/bin/npm-cli.js');
        const cli = path.join(root, 'pnpm', target);
        if (kind === 'version directory') {
          mkdirSync(path.join(root, 'pnpm/nodejs'), { recursive: true });
          symlinkSync(path.join(root, 'outside'), path.join(root, 'pnpm/nodejs/26.3.1'));
        } else {
          mkdirSync(path.dirname(cli), { recursive: true });
          symlinkSync(kind === 'dangling file' ? `${outside}.missing` : outside, cli);
        }
        expect(() => bind(npm)).toThrow('Cannot locate npm-cli.js for the owned npm executable');
      });
    },
  );

  it('rejects a missing owned executable even when a conventional CLI exists', async () => {
    await withLayout((root, write) => {
      write('node_modules/npm/bin/npm-cli.js');
      expect(() => bind(path.join(root, 'npm'))).toThrow();
    });
  });
});

describe('AlranUpdateApplication', () => {
  it('keeps signed managed-installer check and apply behind one product intent', async () => {
    const check = vi.fn(async () => ({
      status: 'available' as const,
      channel: 'stable' as const,
      currentVersion: '1.2.3',
      latestVersion: '1.2.4',
      manifest: {} as never,
    }));
    const apply = vi.fn(async () => ({
      ...(await check()),
      applied: true,
      installRoot: '/managed',
    }));
    const application = createApplication({
      detectInstallSource: async () => 'managed-installer',
      createManagedService: () => ({ check, apply }),
    });

    const plan = await application.inspect();

    expect(plan).toMatchObject({
      kind: 'available',
      source: 'managed-installer',
      currentVersion: '1.2.3',
      latestVersion: '1.2.4',
      channel: 'stable',
    });
    const signal = new AbortController().signal;
    const onPhase = vi.fn();
    await expect(application.apply(plan, { signal, onPhase })).resolves.toMatchObject({
      applied: true,
      message: 'Alran 1.2.4 is installed. Restart running Alran sessions to use it.',
    });
    expect(apply).toHaveBeenCalledWith({
      channel: 'stable',
      version: '1.2.4',
      signal,
      onPhase,
    });
  });

  it('delegates global package installations to their owning package manager', async () => {
    const runPackageManager = vi.fn(async () => undefined);
    const createManagedService = vi.fn();
    const resolveLatestPackageVersion = vi.fn(async () => '1.2.4');
    const application = createApplication(
      {
        detectInstallSource: async () => 'pnpm-global',
        createManagedService,
        runPackageManager,
        resolveLatestPackageVersion,
      },
      { packageTag: 'test' },
    );

    const plan = await application.inspect();

    expect(plan).toEqual({
      kind: 'package-manager',
      source: 'pnpm-global',
      currentVersion: '1.2.3',
      latestVersion: '1.2.4',
      packageTag: 'test',
      command: {
        executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        args: [
          'add',
          '--global',
          '@ottili/alran-code@1.2.4',
          '--registry',
          'https://registry.npmjs.org/',
        ],
        display:
          'pnpm add --global @ottili/alran-code@1.2.4 --registry https://registry.npmjs.org/',
      },
    });
    const onOutput = vi.fn();
    const onPhase = vi.fn();
    const signal = new AbortController().signal;
    await expect(application.apply(plan, { onOutput, onPhase, signal })).resolves.toMatchObject({
      applied: true,
      message: 'Alran 1.2.4 was installed through pnpm. Restart Alran to use the installed version.',
    });
    expect(createManagedService).not.toHaveBeenCalled();
    expect(resolveLatestPackageVersion).toHaveBeenCalledWith('test');
    expect(runPackageManager).toHaveBeenCalledWith(plan.command, { onOutput, onPhase, signal });
    expect(onPhase).toHaveBeenNthCalledWith(1, { phase: 'installing', cancellable: false });
    expect(onPhase).toHaveBeenNthCalledWith(2, { phase: 'completed', cancellable: false });
  });

  it('does not reinstall a package-manager installation already at the registry version', async () => {
    const runPackageManager = vi.fn(async () => undefined);
    const application = createApplication({
      detectInstallSource: async () => 'npm-global',
      resolveLatestPackageVersion: async () => '1.2.3',
      runPackageManager,
    });

    const plan = await application.inspect();

    expect(plan).toEqual({
      kind: 'current',
      source: 'npm-global',
      currentVersion: '1.2.3',
      latestVersion: '1.2.3',
      packageTag: 'latest',
    });
    await expect(application.apply(plan)).rejects.toThrow(/cannot be applied automatically/i);
    expect(runPackageManager).not.toHaveBeenCalled();
  });

  it('does not downgrade a package-manager installation newer than the registry version', async () => {
    const application = createApplication({
      detectInstallSource: async () => 'bun-global',
      resolveLatestPackageVersion: async () => '1.2.2',
    });

    await expect(application.inspect()).resolves.toEqual({
      kind: 'ahead',
      source: 'bun-global',
      currentVersion: '1.2.3',
      latestVersion: '1.2.2',
      packageTag: 'latest',
    });
  });

  it('follows the test dist-tag when a custom prerelease sorts ahead of the tagged build', async () => {
    const resolveLatestPackageVersion = vi.fn(
      async () => '0.0.1-beta.1786162945.e3fdada2',
    );
    const application = createApplication(
      {
        detectInstallSource: async () => 'npm-global',
        resolveLatestPackageVersion,
      },
      {
        currentVersion: '0.0.1-beta.matrixfix.7069818510',
        packageTag: 'test',
      },
    );

    await expect(application.inspect()).resolves.toEqual({
      kind: 'package-manager',
      source: 'npm-global',
      currentVersion: '0.0.1-beta.matrixfix.7069818510',
      latestVersion: '0.0.1-beta.1786162945.e3fdada2',
      packageTag: 'test',
      command: {
        executable: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        args: [
          'install',
          '--global',
          '@ottili/alran-code@0.0.1-beta.1786162945.e3fdada2',
          '--ignore-scripts=false',
          '--include=optional',
          '--allow-scripts=@ottili/alran-code,better-sqlite3',
          '--registry',
          'https://registry.npmjs.org/',
        ],
        display:
          'npm install --global @ottili/alran-code@0.0.1-beta.1786162945.e3fdada2 ' +
          '--ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3 ' +
          '--registry https://registry.npmjs.org/',
      },
    });
    expect(resolveLatestPackageVersion).toHaveBeenCalledWith('test');
  });

  it('follows the preview dist-tag instead of applying SemVer downgrade protection', async () => {
    const application = createApplication(
      {
        detectInstallSource: async () => 'npm-global',
        resolveLatestPackageVersion: async () => '0.2.1-previewtrain.41',
      },
      {
        currentVersion: '0.2.1-previewtrain.hotfix.42',
        packageTag: 'preview',
      },
    );

    await expect(application.inspect()).resolves.toMatchObject({
      kind: 'package-manager',
      currentVersion: '0.2.1-previewtrain.hotfix.42',
      latestVersion: '0.2.1-previewtrain.41',
      packageTag: 'preview',
    });
  });

  it('fails closed when the installation owner cannot be identified', async () => {
    const runPackageManager = vi.fn(async () => undefined);
    const createManagedService = vi.fn();
    const resolveLatestPackageVersion = vi.fn(async () => '9.9.9');
    const application = createApplication({
      detectInstallSource: async () => 'unsupported',
      createManagedService,
      runPackageManager,
      resolveLatestPackageVersion,
    });

    const plan = await application.inspect();

    expect(plan).toMatchObject({
      kind: 'manual',
      source: 'unsupported',
      command:
        'npm install --global @ottili/alran-code@latest ' +
        '--ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3 ' +
        '--registry https://registry.npmjs.org/',
    });
    await expect(application.apply(plan)).rejects.toThrow(/cannot be applied automatically/i);
    expect(createManagedService).not.toHaveBeenCalled();
    expect(resolveLatestPackageVersion).not.toHaveBeenCalled();
    expect(runPackageManager).not.toHaveBeenCalled();
  });

  it.each([
    '/Users/demo/project/pnpm/global/5/source/@ottili/alran-code',
    '/Users/demo/project/.config/yarn/global/source/@ottili/alran-code',
    '/Users/demo/project/.yarn/global/source/@ottili/alran-code',
    '/Users/demo/project/.bun/install/global/source/@ottili/alran-code',
  ])(
    'treats a local checkout containing a global-install marker as unsupported: %s',
    async (packageRoot) => {
      const createManagedService = vi.fn();
      const resolveLatestPackageVersion = vi.fn(async () => '9.9.9');
      const application = createApplication({
        detectInstallSource: () =>
          detectAlranInstallSource({
            installRoot: '/source',
            platform: 'darwin',
            packageRoot: () => packageRoot,
            npmGlobalPrefix: async () => '/usr/local',
            managedInstall: () => false,
          }),
        createManagedService,
        resolveLatestPackageVersion,
      });

      await expect(application.inspect()).resolves.toMatchObject({
        kind: 'manual',
        source: 'unsupported',
      });
      expect(createManagedService).not.toHaveBeenCalled();
      expect(resolveLatestPackageVersion).not.toHaveBeenCalled();
    },
  );

  it('keeps a future public package on the official npm registry', async () => {
    const application = createApplication(
      { detectInstallSource: async () => 'unsupported' },
      { packageName: '@ottili/alran-code' },
    );

    await expect(application.inspect()).resolves.toMatchObject({
      kind: 'manual',
      command:
        'npm install --global @ottili/alran-code@latest ' +
        '--ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3 ' +
        '--registry https://registry.npmjs.org/',
    });
  });

  it('keeps a China mirror prefix on the same registry during updates', async () => {
    const resolveLatestPackageVersion = vi.fn(async () => '1.2.4');
    const application = createApplication(
      {
        detectInstallSource: async () => 'npm-prefix',
        resolveLatestPackageVersion,
      },
      {
        packageName: '@ottili/alran-code',
        prefixInstall: {
          executable: '/opt/alran/runtime/node/bin/npm',
          packageName: '@ottili/alran-code',
          prefix: '/opt/alran',
          registry: 'https://registry.npmmirror.com/',
        },
      },
    );

    await expect(application.inspect()).resolves.toMatchObject({
      kind: 'package-manager',
      source: 'npm-prefix',
      command: {
        args: [
          'install',
          '--global',
          '--prefix',
          '/opt/alran',
          '@ottili/alran-code@1.2.4',
          '--ignore-scripts=false',
          '--include=optional',
          '--allow-scripts=@ottili/alran-code,better-sqlite3',
          '--registry',
          'https://registry.npmmirror.com/',
        ],
      },
    });
    expect(resolveLatestPackageVersion).toHaveBeenCalledWith('latest');
  });

  it('reads the installed public package identity from its real entry path', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'alran-update-public-'));
    const packageRoot = path.join(
      temporaryRoot,
      'lib',
      'node_modules',
      '@alran-ai',
      'code',
    );
    try {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code' }),
      );
      const entryFile = path.join(packageRoot, 'cli.js');
      writeFileSync(entryFile, '');

      expect(resolveAlranPackageName(entryFile)).toBe('@ottili/alran-code');
      expect(resolveInstalledAlranPackageVersion(entryFile)).toBeUndefined();
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('recognizes only the internal package identity as environment-selectable', () => {
    expect(isInternalAlranPackageName('@ottili/alran-code')).toBe(true);
    expect(isInternalAlranPackageName('@ottili/alran-code')).toBe(false);
    expect(isInternalAlranPackageName(undefined)).toBe(false);
  });

  it('rejects a package-manager update when the installed exact version does not match', async () => {
    const application = createApplication({
      detectInstallSource: async () => 'npm-global',
      resolveLatestPackageVersion: async () => '1.2.4',
      runPackageManager: async () => undefined,
      readInstalledPackageVersion: () => '1.2.3',
    });

    const plan = await application.inspect();

    await expect(application.apply(plan)).rejects.toThrow(
      'Alran update installed 1.2.3; expected 1.2.4.',
    );
  });
});

describe('Alran update install-source commands', () => {
  it.each([
    ['/opt/homebrew/lib/node_modules/@ottili/alran-code', 'npm-global'],
    ['C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\@alran\\code', 'npm-global'],
    ['/usr/local/lib/node_modules/@ottili/alran-code', 'npm-global'],
    ['/Users/demo/.local/share/pnpm/global/5/node_modules/@ottili/alran-code', 'pnpm-global'],
    [
      '/Users/demo/Library/pnpm/global/v11/10c0afe5/node_modules/@ottili/alran-code',
      'pnpm-global',
    ],
    [
      'C:\\Users\\demo\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@alran\\code',
      'pnpm-global',
    ],
    [
      'C:\\Users\\demo\\AppData\\Local\\pnpm\\global\\v11\\10c0afe5\\node_modules\\@alran-ai\\code',
      'pnpm-global',
    ],
    ['/Users/demo/.config/yarn/global/node_modules/@ottili/alran-code', 'yarn-global'],
    [
      'C:\\Users\\demo\\.config\\yarn\\global\\node_modules\\@alran\\code',
      'yarn-global',
    ],
    ['/Users/demo/.bun/install/global/node_modules/@ottili/alran-code', 'bun-global'],
    [
      'C:\\Users\\demo\\.bun\\install\\global\\node_modules\\@alran\\code',
      'bun-global',
    ],
  ] as const)('classifies %s as %s', (packageRoot, expected) => {
    expect(classifyAlranInstallPath(packageRoot)).toBe(expected);
  });

  it('uses Windows command shims for the Windows-aware process launcher', () => {
    expect(buildAlranPackageManagerCommand('npm-global', '1.2.4', 'win32')).toEqual({
      executable: 'npm.cmd',
      args: [
        'install',
        '--global',
        '@ottili/alran-code@1.2.4',
        '--ignore-scripts=false',
        '--include=optional',
        '--allow-scripts=@ottili/alran-code,better-sqlite3',
        '--registry',
        'https://registry.npmjs.org/',
      ],
      display:
        'npm install --global @ottili/alran-code@1.2.4 --ignore-scripts=false --include=optional ' +
        '--allow-scripts=@ottili/alran-code,better-sqlite3 --registry https://registry.npmjs.org/',
    });
    expect(buildAlranPackageManagerCommand('bun-global', '1.2.4', 'win32')).toEqual({
      executable: 'bun.exe',
      args: [
        'add',
        '--global',
        '@ottili/alran-code@1.2.4',
        '--registry',
        'https://registry.npmjs.org/',
      ],
      display:
        'bun add --global @ottili/alran-code@1.2.4 --registry https://registry.npmjs.org/',
    });
  });

  it('uses the installer-owned npm executable, prefix, package, and registry', () => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');
    const command = buildAlranPackageManagerCommand(
      'npm-prefix',
      '1.2.4',
      'linux',
      distribution,
      {
        executable: '/opt/alran/runtime/node/bin/npm',
        packageName: '@ottili/alran-code',
        prefix: '/opt/alran',
        registry: 'https://registry.npmjs.org/',
      },
    );

    expect(command).toEqual({
      executable: '/opt/alran/runtime/node/bin/npm',
      args: [
        'install',
        '--global',
        '--prefix',
        '/opt/alran',
        '@ottili/alran-code@1.2.4',
        '--ignore-scripts=false',
        '--include=optional',
        '--allow-scripts=@ottili/alran-code,better-sqlite3',
        '--registry',
        'https://registry.npmjs.org/',
      ],
      display:
        '/opt/alran/runtime/node/bin/npm install --global --prefix /opt/alran ' +
        '@ottili/alran-code@1.2.4 --ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3 --registry https://registry.npmjs.org/',
    });
  });

  it('keeps the explicit public mirror for installer-owned updates', () => {
    const distribution = resolveAlranNpmDistribution(
      '@ottili/alran-code',
      'https://registry.npmmirror.com',
    );
    const command = buildAlranPackageManagerCommand(
      'npm-prefix',
      '1.2.4',
      'linux',
      distribution,
      {
        executable: '/opt/alran/runtime/node/bin/npm',
        packageName: '@ottili/alran-code',
        prefix: '/opt/alran',
        registry: 'https://registry.npmmirror.com/',
      },
    );

    expect(command.args).toEqual([
      'install',
      '--global',
      '--prefix',
      '/opt/alran',
      '@ottili/alran-code@1.2.4',
      '--ignore-scripts=false',
      '--include=optional',
      '--allow-scripts=@ottili/alran-code,better-sqlite3',
      '--registry',
      'https://registry.npmmirror.com/',
    ]);
    expect(() =>
      resolveAlranNpmDistribution('@ottili/alran-code', 'https://registry.example.com/'),
    ).toThrow('Unsupported Alran npm registry');
  });

  it('uses the active package manifest entry when argv points at the npm bin shim', async () => {
    const runPackageManager = vi.fn(async () => undefined);
    const activateVersionedPrefix = vi.fn(() => '/opt/alran/releases/1.2.4');
    const releasePrefixUpdateLock = vi.fn();
    const application = createApplication(
      {
        detectInstallSource: async () => 'npm-prefix',
        resolveLatestPackageVersion: async () => '1.2.4',
        runPackageManager,
        createVersionedPrefixStaging: () => '/opt/alran/releases/.staging-1.2.4',
        prepareVersionedPrefixStaging: vi.fn(),
        readPrefixPackageMetadata: (prefix, packageName) => ({
          packageRoot: `${prefix}/lib/node_modules/${packageName}`,
          version: '1.2.4',
          binEntry: 'dist/index.js',
          alranToolsBinEntry: 'alran-tools.js',
        }),
        validatePrefixPackage: vi.fn(async () => undefined),
        activateVersionedPrefix,
        acquirePrefixUpdateLock: () => releasePrefixUpdateLock,
      },
      {
        entryFile: '/opt/alran/bin/alran',
        packageName: '@ottili/alran-code',
        prefixInstall: {
          executable: '/opt/alran/runtime/node/bin/npm',
          packageName: '@ottili/alran-code',
          prefix: '/opt/alran',
          registry: 'https://registry.npmjs.org/',
        },
      },
    );

    const plan = await application.inspect();
    await expect(application.apply(plan)).resolves.toEqual({
      applied: true,
      restartRequired: false,
      message:
        'Alran 1.2.4 is installed. New Alran sessions will use it; running sessions can continue normally.',
    });
    expect(activateVersionedPrefix).toHaveBeenCalledWith({
      stagingPrefix: '/opt/alran/releases/.staging-1.2.4',
      activePrefix: '/opt/alran',
      packageName: '@ottili/alran-code',
      expectedVersion: '1.2.4',
      runtimeExecutable: process.execPath,
      npmExecutable: '/opt/alran/runtime/node/bin/npm',
      registry: 'https://registry.npmjs.org/',
    });
    expect(releasePrefixUpdateLock).toHaveBeenCalledOnce();
  });

  it('reports malformed pending metadata instead of treating it as a staged update', async () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-malformed-pending-'));
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@ottili/alran-code');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    const pendingFile = path.join(prefix, '.alran-update-pending.json');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3' }),
      );
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({ updateOwner: 'npm-prefix', prefix }),
      );
      writeFileSync(pendingFile, '{}');

      const application = new AlranUpdateApplication(
        {
          currentVersion: '1.2.3',
          entryFile,
          environment: {},
          installRoot: prefix,
          prefixInstall: {
            executable: path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm'),
            packageName: '@ottili/alran-code',
            prefix,
            registry: 'https://registry.npmjs.org/',
          },
        },
        {
          detectInstallSource: async () => 'npm-prefix',
          resolveLatestPackageVersion: async () => '1.2.4',
        },
      );

      await expect(application.inspect()).rejects.toThrow(
        `Alran pending update metadata is invalid at ${pendingFile}.`,
      );
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it('rejects a pending journal owned by a different active prefix', async () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-foreign-pending-'));
    const foreignPrefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-foreign-owner-'));
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@ottili/alran-code');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    const pendingFile = path.join(prefix, '.alran-update-pending.json');
    const foreignStaging = path.join(path.dirname(foreignPrefix), '.foreign-staging');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3' }),
      );
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({ updateOwner: 'npm-prefix', prefix }),
      );
      writeFileSync(
        pendingFile,
        JSON.stringify({
          schemaVersion: 1,
          stagingPrefix: foreignStaging,
          activePrefix: foreignPrefix,
          activeModulesRoot: resolveAlranPrefixModulesRoot(foreignPrefix, process.platform),
          stagedModulesRoot: resolveAlranPrefixModulesRoot(foreignStaging, process.platform),
          backupModulesRoot: `${resolveAlranPrefixModulesRoot(foreignPrefix, process.platform)}.alran-update-backup`,
          packageName: '@ottili/alran-code',
          expectedVersion: '1.2.4',
          launchers: resolveAlranPrefixLauncherPairs(foreignPrefix, foreignStaging, process.platform),
        }),
      );

      const application = new AlranUpdateApplication(
        {
          currentVersion: '1.2.3',
          entryFile,
          environment: {},
          installRoot: prefix,
          prefixInstall: {
            executable: path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm'),
            packageName: '@ottili/alran-code',
            prefix,
            registry: 'https://registry.npmjs.org/',
          },
        },
        {
          detectInstallSource: async () => 'npm-prefix',
          resolveLatestPackageVersion: async () => '1.2.4',
        },
      );

      await expect(application.inspect()).rejects.toThrow(
        `Alran pending update file is outside its active prefix: ${pendingFile}`,
      );
    } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(foreignPrefix, { recursive: true, force: true });
      rmSync(foreignStaging, { recursive: true, force: true });
    }
  });

  it('resumes a valid staged update without checking for a newer registry version', async () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-valid-pending-'));
    const stagingPrefix = path.join(path.dirname(prefix), `.${path.basename(prefix)}.staging`);
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@ottili/alran-code');
    const stagedPackageRoot = path.join(resolveAlranPrefixModulesRoot(stagingPrefix), '@ottili/alran-code');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      mkdirSync(path.join(stagedPackageRoot, 'dist'), { recursive: true });
      mkdirSync(path.join(prefix, 'bin'), { recursive: true });
      mkdirSync(path.join(stagingPrefix, 'bin'), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3', bin: { alran: 'dist/index.js' } }),
      );
      writeFileSync(
        path.join(stagedPackageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.4', bin: { alran: 'dist/index.js' } }),
      );
      writeFileSync(path.join(prefix, process.platform === 'win32' ? 'alran' : 'bin/alran'), '1.2.3');
      writeFileSync(path.join(stagingPrefix, process.platform === 'win32' ? 'alran' : 'bin/alran'), '1.2.4');
      for (const pair of resolveAlranPrefixLauncherPairs(prefix, stagingPrefix)) {
        mkdirSync(path.dirname(pair.activePath), { recursive: true });
        mkdirSync(path.dirname(pair.stagedPath), { recursive: true });
        writeFileSync(pair.activePath, '1.2.3');
        writeFileSync(pair.stagedPath, '1.2.4');
      }
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({ updateOwner: 'npm-prefix', prefix }),
      );
      const activeModulesRoot = resolveAlranPrefixModulesRoot(prefix, process.platform);
      writeAlranPrefixUpdatePending({
        stagingPrefix,
        activePrefix: prefix,
        activeModulesRoot,
        stagedModulesRoot: resolveAlranPrefixModulesRoot(stagingPrefix, process.platform),
        backupModulesRoot: `${activeModulesRoot}.alran-update-backup`,
        packageName: '@ottili/alran-code',
        expectedVersion: '1.2.4',
        launchers: resolveAlranPrefixLauncherPairs(prefix, stagingPrefix, process.platform),
      });

      const resolveLatestPackageVersion = vi.fn(async () => '1.2.5');
      const application = new AlranUpdateApplication(
        {
          currentVersion: '1.2.3',
          entryFile,
          environment: {},
          installRoot: prefix,
          platform: process.platform,
          prefixInstall: {
            executable: path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm'),
            packageName: '@ottili/alran-code',
            prefix,
            registry: 'https://registry.npmjs.org/',
          },
        },
        {
          detectInstallSource: async () => 'npm-prefix',
          resolveLatestPackageVersion,
        },
      );

      const plan = await application.inspect();

      expect(resolveLatestPackageVersion).not.toHaveBeenCalled();
      await expect(application.apply(plan)).resolves.toEqual({
        applied: false,
        restartRequired: true,
        message: 'Alran 1.2.4 is already staged. It will activate after this process exits.',
      });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(stagingPrefix, { recursive: true, force: true });
    }
  });

  it('rejects a pending update whose staged package and launchers are missing', async () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-missing-staging-'));
    const stagingPrefix = path.join(path.dirname(prefix), `.${path.basename(prefix)}.missing`);
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@ottili/alran-code');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      mkdirSync(path.join(prefix, 'bin'), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3', bin: { alran: 'dist/index.js' } }),
      );
      writeFileSync(path.join(prefix, process.platform === 'win32' ? 'alran' : 'bin/alran'), '1.2.3');
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({ updateOwner: 'npm-prefix', prefix }),
      );
      const activeModulesRoot = resolveAlranPrefixModulesRoot(prefix, process.platform);
      const pendingFile = writeAlranPrefixUpdatePending({
        stagingPrefix,
        activePrefix: prefix,
        activeModulesRoot,
        stagedModulesRoot: resolveAlranPrefixModulesRoot(stagingPrefix, process.platform),
        backupModulesRoot: `${activeModulesRoot}.alran-update-backup`,
        packageName: '@ottili/alran-code',
        expectedVersion: '1.2.4',
        launchers: resolveAlranPrefixLauncherPairs(prefix, stagingPrefix, process.platform),
      });

      const application = new AlranUpdateApplication(
        {
          currentVersion: '1.2.3',
          entryFile,
          environment: {},
          installRoot: prefix,
          platform: process.platform,
          prefixInstall: {
            executable: path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm'),
            packageName: '@ottili/alran-code',
            prefix,
            registry: 'https://registry.npmjs.org/',
          },
        },
        {
          detectInstallSource: async () => 'npm-prefix',
          resolveLatestPackageVersion: async () => '1.2.4',
        },
      );

      await expect(application.inspect()).rejects.toThrow(
        `Alran pending update artifacts are incomplete at ${pendingFile}.`,
      );
    } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(stagingPrefix, { recursive: true, force: true });
    }
  });

  it('finishes cleanup when the staged version is already active', async () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-pending-cleanup-'));
    const stagingPrefix = path.join(path.dirname(prefix), `.${path.basename(prefix)}.activated`);
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@ottili/alran-code');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      mkdirSync(path.join(prefix, 'bin'), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.4', bin: { alran: 'dist/index.js' } }),
      );
      writeFileSync(path.join(prefix, process.platform === 'win32' ? 'alran' : 'bin/alran'), '1.2.4');
      for (const pair of resolveAlranPrefixLauncherPairs(prefix, stagingPrefix)) {
        mkdirSync(path.dirname(pair.activePath), { recursive: true });
        writeFileSync(pair.activePath, '1.2.4');
      }
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({ updateOwner: 'npm-prefix', prefix }),
      );
      const activeModulesRoot = resolveAlranPrefixModulesRoot(prefix, process.platform);
      writeAlranPrefixUpdatePending({
        stagingPrefix,
        activePrefix: prefix,
        activeModulesRoot,
        stagedModulesRoot: resolveAlranPrefixModulesRoot(stagingPrefix, process.platform),
        backupModulesRoot: `${activeModulesRoot}.alran-update-backup`,
        packageName: '@ottili/alran-code',
        expectedVersion: '1.2.4',
        launchers: resolveAlranPrefixLauncherPairs(prefix, stagingPrefix, process.platform),
      });

      const resolveLatestPackageVersion = vi.fn(async () => '1.2.4');
      const application = new AlranUpdateApplication(
        {
          currentVersion: '1.2.4',
          entryFile,
          environment: {},
          installRoot: prefix,
          platform: process.platform,
          prefixInstall: {
            executable: path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm'),
            packageName: '@ottili/alran-code',
            prefix,
            registry: 'https://registry.npmjs.org/',
          },
        },
        {
          detectInstallSource: async () => 'npm-prefix',
          resolveLatestPackageVersion,
        },
      );

      const plan = await application.inspect();

      expect(plan).toMatchObject({
        kind: 'package-manager',
        source: 'npm-prefix',
        currentVersion: '1.2.4',
        latestVersion: '1.2.4',
      });
      expect(resolveLatestPackageVersion).not.toHaveBeenCalled();
      await expect(application.apply(plan)).resolves.toEqual({
        applied: false,
        restartRequired: true,
        message: 'Alran 1.2.4 is already active. Restarting will finish update cleanup.',
      });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
      rmSync(stagingPrefix, { recursive: true, force: true });
    }
  });

  it.each(['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'])(
    'recovers installer prefix ownership from the versioned receipt using %s',
    async (registry) => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'alran-update-prefix-'));
    const packageRoot = path.join(
      temporaryRoot,
      ...(process.platform === 'win32' ? [] : ['lib']),
      'node_modules',
      '@alran-ai',
      'code',
    );
    const npmExecutable = path.join(temporaryRoot, 'runtime', 'node', ...(process.platform === 'win32' ? ['npm.cmd'] : ['bin', 'npm']));
    const entryFile = path.join(packageRoot, 'cli.js');
    try {
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(path.dirname(npmExecutable), { recursive: true });
      writeFileSync(npmExecutable, '');
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3' }),
      );
      writeFileSync(
        path.join(temporaryRoot, 'install.json'),
        `\uFEFF${JSON.stringify({
          schemaVersion: 1,
          product: 'alran-code',
          updateOwner: 'npm-prefix',
          packageManager: 'npm',
          packageName: '@ottili/alran-code',
          registry,
          distTag: 'latest',
          prefix: temporaryRoot,
          npmExecutable,
        })}`,
      );

      const prefixInstall = resolveAlranNpmPrefixInstall(entryFile, process.platform);
      expect(prefixInstall).toEqual({
        executable: npmExecutable,
        packageName: '@ottili/alran-code',
        prefix: realpathSync(temporaryRoot),
        registry,
      });
      expect(resolveInstalledAlranPackageVersion(entryFile)).toBe('1.2.3');
      await expect(
        detectAlranInstallSource({
          installRoot: temporaryRoot,
          platform: process.platform,
          packageRoot: () => packageRoot,
          prefixInstall: () => prefixInstall,
          managedInstall: () => false,
        }),
      ).resolves.toBe('npm-prefix');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
    },
  );

  it('resolves versioned installer ownership from a release package entry', () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'alran-update-versioned-prefix-'));
    const packageRoot = path.join(
      prefix,
      'releases/1.2.3',
      ...(process.platform === 'win32' ? [] : ['lib']),
      'node_modules/@ottili/alran-code',
    );
    const npmExecutable = path.join(prefix, process.platform === 'win32' ? 'runtime/node/npm.cmd' : 'runtime/node/bin/npm');
    const entryFile = path.join(packageRoot, 'dist/index.js');
    try {
      mkdirSync(path.dirname(entryFile), { recursive: true });
      mkdirSync(path.dirname(npmExecutable), { recursive: true });
      writeFileSync(entryFile, '');
      writeFileSync(npmExecutable, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3' }),
      );
      writeFileSync(
        path.join(prefix, 'install.json'),
        JSON.stringify({
          schemaVersion: 2,
          product: 'alran-code',
          updateOwner: 'npm-prefix',
          packageManager: 'npm',
          packageName: '@ottili/alran-code',
          registry: 'https://registry.npmjs.org/',
          distTag: 'latest',
          prefix,
          npmExecutable,
          layoutVersion: 2,
          releasesDirectory: 'releases',
          currentFile: 'current',
        }),
      );

      expect(resolveAlranNpmPrefixInstall(entryFile, process.platform)).toEqual({
        executable: npmExecutable,
        packageName: '@ottili/alran-code',
        prefix: realpathSync(prefix),
        registry: 'https://registry.npmjs.org/',
      });
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it('recovers a legacy installer prefix only from its package root and adjacent npm', () => {
    const temporaryParent = mkdtempSync(path.join(os.tmpdir(), 'alran-update-legacy-'));
    const prefix = path.join(temporaryParent, '.alran-code');
    const packageRoot = path.join(resolveAlranPrefixModulesRoot(prefix), '@alran-ai', 'code');
    const nodeExecutable = path.join(prefix, 'runtime', 'node', ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node']));
    const npmExecutable = path.join(prefix, 'runtime', 'node', ...(process.platform === 'win32' ? ['npm.cmd'] : ['bin', 'npm']));
    const entryFile = path.join(packageRoot, 'cli.js');
    try {
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(path.dirname(nodeExecutable), { recursive: true });
      writeFileSync(nodeExecutable, '');
      writeFileSync(npmExecutable, '');
      writeFileSync(entryFile, '');
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@ottili/alran-code', version: '1.2.3' }),
      );

      expect(resolveAlranNpmPrefixInstall(entryFile, process.platform, nodeExecutable)).toEqual({
        executable: npmExecutable,
        packageName: '@ottili/alran-code',
        prefix: realpathSync(prefix),
        registry: 'https://registry.npmjs.org/',
      });
    } finally {
      rmSync(temporaryParent, { recursive: true, force: true });
    }
  });

  it.each([
    ['npm-global', 'npm install --global'],
    ['pnpm-global', 'pnpm add --global'],
    ['yarn-global', 'yarn global add'],
    ['bun-global', 'bun add --global'],
  ] as const)('pins %s updates to the internal registry', (source, prefix) => {
    const command = buildAlranPackageManagerCommand(source, '1.2.4', 'linux');
    const scriptOptions =
      source === 'npm-global'
        ? ' --ignore-scripts=false --include=optional --allow-scripts=@ottili/alran-code,better-sqlite3'
        : '';

    expect(command.args.slice(-2)).toEqual([
      '--registry',
      'https://registry.npmjs.org/',
    ]);
    expect(command.display).toBe(
      `${prefix} @ottili/alran-code@1.2.4${scriptOptions} --registry https://registry.npmjs.org/`,
    );
  });

  it('resolves the target version from the internal registry with npm shipped by Node', async () => {
    const run = vi.fn(async () => '"1.2.4"');

    await expect(
      resolveLatestAlranRegistryVersion('test', { platform: 'linux', run }),
    ).resolves.toBe('1.2.4');
    expect(run).toHaveBeenCalledWith('npm', [
      'view',
      '@ottili/alran-code@test',
      'version',
      '--json',
      '--registry',
      'https://registry.npmjs.org/',
      '--fetch-timeout',
      '30000',
    ]);
  });

  it('uses installer-owned npm for a prefix installation registry lookup', async () => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');
    const run = vi.fn(async () => '"1.2.4"');

    await expect(
      resolveLatestAlranRegistryVersion('latest', {
        platform: 'linux',
        run,
        distribution,
        npmExecutable: '/opt/alran/runtime/node/bin/npm',
      }),
    ).resolves.toBe('1.2.4');
    expect(run).toHaveBeenCalledWith('/opt/alran/runtime/node/bin/npm', [
      'view',
      '@ottili/alran-code@latest',
      'version',
      '--json',
      '--registry',
      'https://registry.npmjs.org/',
      '--fetch-timeout',
      '30000',
    ]);
  });

  it('accepts npm registry metadata returned as a single-item JSON array', async () => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');

    await expect(
      resolveLatestAlranRegistryVersion('latest', {
        platform: 'linux',
        run: async () => '["1.2.4"]',
        distribution,
      }),
    ).resolves.toBe('1.2.4');
  });

  it('keeps public package lookup and installation on the official npm registry', async () => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');
    const run = vi.fn(async () => '"1.2.4"');

    expect(distribution).toEqual({
      packageName: '@ottili/alran-code',
      registry: 'https://registry.npmjs.org/',
    });
    await expect(
      resolveLatestAlranRegistryVersion('latest', {
        platform: 'linux',
        run,
        distribution,
      }),
    ).resolves.toBe('1.2.4');
    expect(run).toHaveBeenCalledWith('npm', [
      'view',
      '@ottili/alran-code@latest',
      'version',
      '--json',
      '--registry',
      'https://registry.npmjs.org/',
      '--fetch-timeout',
      '30000',
    ]);
    expect(
      buildAlranPackageManagerCommand('npm-global', '1.2.4', 'linux', distribution),
    ).toMatchObject({
      args: [
        'install',
        '--global',
        '@ottili/alran-code@1.2.4',
        '--ignore-scripts=false',
        '--include=optional',
        '--allow-scripts=@ottili/alran-code,better-sqlite3',
        '--registry',
        'https://registry.npmjs.org/',
      ],
    });
  });

  it('does not fall back to the internal registry when the public package is absent', async () => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');
    const run = vi.fn(async () => {
      throw new Error('E404 Not Found');
    });

    await expect(
      resolveLatestAlranRegistryVersion('latest', {
        platform: 'linux',
        run,
        distribution,
      }),
    ).rejects.toThrow('E404 Not Found');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['[]', /invalid latest version/u],
    ['"1.2.4-beta.1"', /stable semantic version/u],
  ])('rejects invalid public latest metadata: %s', async (metadata, error) => {
    const distribution = resolveAlranNpmDistribution('@ottili/alran-code');

    await expect(
      resolveLatestAlranRegistryVersion('latest', {
        platform: 'linux',
        run: async () => metadata,
        distribution,
      }),
    ).rejects.toThrow(error);
  });

  it.each([
    ['prod', 'latest'],
    ['staging', 'preview'],
    ['test', 'test'],
    [undefined, 'latest'],
  ] as const)('maps the %s build to the %s update tag', (environment, tag) => {
    expect(resolveAlranNpmDistTag(environment)).toBe(tag);
  });

  it('keeps an explicitly embedded preview update channel independent of the backend', () => {
    expect(resolveAlranNpmDistTag('prod', 'preview')).toBe('preview');
  });

  it.each([
    ['/usr/local/lib/node_modules/@ottili/alran-code', '/usr/local', 'linux'],
    [
      'C:\\Users\\demo\\AppData\\Roaming\\npm\\node_modules\\@alran\\code',
      'C:\\Users\\demo\\AppData\\Roaming\\npm',
      'win32',
    ],
  ] as const)('recognizes npm global ownership for %s', (packageRoot, prefix, platform) => {
    expect(classifyNpmGlobalInstall(packageRoot, prefix, platform)).toBe('npm-global');
  });
});

function createApplication(
  dependencies: Partial<AlranUpdateApplicationDependencies>,
  options: {
    currentVersion?: string;
    packageTag?: 'latest' | 'test' | 'preview';
    packageName?: '@ottili/alran-code' | '@ottili/alran-code';
    prefixInstall?: {
      executable: string;
      packageName: '@ottili/alran-code' | '@ottili/alran-code';
      prefix: string;
      registry: string;
    };
  } = {},
): AlranUpdateApplication {
  return new AlranUpdateApplication(
    { currentVersion: '1.2.3', installRoot: '/managed', ...options },
    { readInstalledPackageVersion: () => '1.2.4', ...dependencies },
  );
}
