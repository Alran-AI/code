import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runAutoUpdateCommand,
  runAutoUpdateCycle,
  startAlranAutoUpdate,
} from '../../src/update/auto-update.js';
import type { AlranPackageManagerCommand } from '../../src/update/install-source.js';

let dataDir: string;
let writes: string[];

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'alran-auto-int-'));
  writes = [];
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const write = (value: string): void => {
  writes.push(value);
};

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** An npm global layout: <prefix>/lib/node_modules/alran with the installed manifest. */
function npmGlobalLayout(version: string): { prefix: string; packageRoot: string } {
  const prefix = path.join(dataDir, 'npm-global');
  const packageRoot = path.join(prefix, 'lib', 'node_modules', 'alran');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'alran', version }),
  );
  mkdirSync(path.join(prefix, 'bin'), { recursive: true });
  writeFileSync(path.join(prefix, 'bin', 'alran'), '#!/usr/bin/env node\n');
  return { prefix, packageRoot };
}

const metadataResponse = (latest: string, versions: Array<[string, number]>): Response =>
  new Response(
    JSON.stringify({
      'dist-tags': { latest },
      time: Object.fromEntries(
        versions.map(([version, publishedAtMs]) => [version, new Date(publishedAtMs).toISOString()]),
      ),
    }),
    { status: 200 },
  );

const environment = (): NodeJS.ProcessEnv => ({ XDG_DATA_HOME: path.join(dataDir, 'xdg') });

describe('auto-update against a mocked registry and installer', () => {
  it('installs a newer npm global version in the background and verifies it', async () => {
    const { prefix, packageRoot } = npmGlobalLayout('1.0.0');
    const installCommand = vi.fn(async () => {
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'alran', version: '1.1.1' }),
      );
    });
    const runCommand = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === 'prefix') return prefix;
      return '1.1.1';
    });
    await runAutoUpdateCycle({
      currentVersion: '1.0.0',
      dataDir,
      environment: environment(),
      packageRoot: () => packageRoot,
      npmGlobalPrefix: async () => prefix,
      fetchImpl: async () => metadataResponse('1.1.1', [['1.1.1', NOW - DAY]]),
      installCommand,
      runCommand,
      write,
      now: () => NOW,
    });

    expect(installCommand).toHaveBeenCalledTimes(1);
    const command: AlranPackageManagerCommand = installCommand.mock.calls[0][0];
    expect(command.executable).toBe('npm');
    expect(command.args.join(' ')).toContain('install --global alran@1.1.1');
    expect(command.args.join(' ')).toContain('--registry https://registry.npmjs.org/');
    expect(command.args.join(' ')).toContain('--allow-scripts=alran,better-sqlite3');

    const cache = JSON.parse(readFileSync(path.join(dataDir, 'auto-update.json'), 'utf8'));
    expect(cache.installedVersion).toBe('1.1.1');
    expect(cache.lastInstallError).toBeNull();
    // The running process was never touched, and nothing was printed for the install itself.
    expect(writes.join('')).toBe('');
  });

  it('announces the applied update exactly once on the next start', async () => {
    writeFileSync(path.join(dataDir, 'auto-update.json'), JSON.stringify({ installedVersion: '1.1.1' }));
    const changelogRoot = path.join(dataDir, 'announce', 'alran');
    mkdirSync(changelogRoot, { recursive: true });
    writeFileSync(path.join(changelogRoot, 'package.json'), JSON.stringify({ name: 'alran' }));
    writeFileSync(
      path.join(changelogRoot, 'CHANGELOG.md'),
      '## 1.1.1\n- feat: auto-update\n- feat: channels\n- fix: hint\n',
    );
    const entryFile = path.join(changelogRoot, 'dist', 'cli.js');

    startAlranAutoUpdate({
      currentVersion: '1.1.1',
      dataDir,
      environment: environment(),
      entryFile,
      write,
      fetchImpl: async () => metadataResponse('1.1.1', []),
    });
    expect(writes).toEqual([
      'Updated to 1.1.1 – 2 features, 1 fix. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1\n',
    ]);

    // The same line never repeats on the following starts.
    startAlranAutoUpdate({
      currentVersion: '1.1.1',
      dataDir,
      environment: environment(),
      entryFile,
      write,
      fetchImpl: async () => metadataResponse('1.1.1', []),
    });
    expect(writes).toHaveLength(1);
  });

  it('never delays startup and installs nothing while the user opted out', async () => {
    const { prefix, packageRoot } = npmGlobalLayout('1.0.0');
    const installCommand = vi.fn(async () => undefined);
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const startedAtMs = performance.now();
    startAlranAutoUpdate({
      currentVersion: '1.0.0',
      dataDir,
      environment: environment(),
      autoUpdate: false,
      packageRoot: () => packageRoot,
      npmGlobalPrefix: async () => prefix,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      installCommand,
      write,
    });
    expect(performance.now() - startedAtMs).toBeLessThan(100);

    resolveFetch(metadataResponse('1.1.1', [['1.1.1', NOW - DAY]]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(installCommand).not.toHaveBeenCalled();
    expect(writes.join('')).toContain('Update available: 1.1.1. Run:');
  });

  it('defers the install while another Alran process holds the task lock', async () => {
    const { prefix, packageRoot } = npmGlobalLayout('1.0.0');
    const installCommand = vi.fn(async () => undefined);
    writeFileSync(
      path.join(dataDir, 'task.lock'),
      JSON.stringify({ pid: process.pid, startedAtMs: NOW }),
    );
    await runAutoUpdateCycle({
      currentVersion: '1.0.0',
      dataDir,
      environment: environment(),
      packageRoot: () => packageRoot,
      npmGlobalPrefix: async () => prefix,
      fetchImpl: async () => metadataResponse('1.1.1', []),
      installCommand,
      write,
      now: () => NOW,
    });
    expect(installCommand).not.toHaveBeenCalled();

    // A lock left by a dead process does not block the next start.
    writeFileSync(
      path.join(dataDir, 'task.lock'),
      JSON.stringify({ pid: 2147483000, startedAtMs: NOW }),
    );
    await runAutoUpdateCycle({
      currentVersion: '1.0.0',
      dataDir,
      environment: environment(),
      packageRoot: () => packageRoot,
      npmGlobalPrefix: async () => prefix,
      fetchImpl: async () => metadataResponse('1.1.1', []),
      installCommand,
      write,
      now: () => NOW,
    });
    expect(installCommand).toHaveBeenCalledTimes(1);
  });

  it('checks without installing, and applies on a chosen channel, through the update command', async () => {
    const { prefix, packageRoot } = npmGlobalLayout('1.0.0');
    const installCommand = vi.fn(async () => {
      writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: 'alran', version: '1.1.0' }),
      );
    });
    const runCommand = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === 'prefix') return prefix;
      return '1.1.0';
    });
    const shared = {
      currentVersion: '1.0.0',
      dataDir,
      environment: environment(),
      packageRoot: () => packageRoot,
      npmGlobalPrefix: async () => prefix,
      fetchImpl: (async () =>
        metadataResponse('1.2.0', [
          ['1.1.0', NOW - 10 * DAY],
          ['1.2.0', NOW - DAY],
        ])) as unknown as typeof fetch,
      installCommand,
      runCommand,
      write,
      now: () => NOW,
    };

    await runAutoUpdateCommand({ ...shared, mode: 'check' });
    expect(writes).toEqual(['Alran 1.2.0 is available on latest (current 1.0.0).\n']);
    expect(installCommand).not.toHaveBeenCalled();

    writes = [];
    await runAutoUpdateCommand({ ...shared, mode: 'apply', channel: 'stable' });
    expect(writes).toEqual(['Alran 1.1.0 is installed; it becomes active on the next start.\n']);
    const command: AlranPackageManagerCommand = installCommand.mock.calls[0][0];
    expect(command.args.join(' ')).toContain('alran@1.1.0');
  });

  it('makes no network call for the command when offline', async () => {
    const fetchImpl = vi.fn(async () => metadataResponse('9.9.9', []));
    await runAutoUpdateCommand({
      currentVersion: '1.0.0',
      dataDir,
      mode: 'check',
      environment: { ...environment(), ALRAN_OFFLINE: '1' },
      fetchImpl,
      write,
    });
    expect(writes).toEqual(['Alran is offline (ALRAN_OFFLINE=1); no update check was performed.\n']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports an unreachable registry instead of installing', async () => {
    const installCommand = vi.fn(async () => undefined);
    await runAutoUpdateCommand({
      currentVersion: '1.0.0',
      dataDir,
      mode: 'apply',
      environment: environment(),
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
      installCommand,
      write,
    });
    expect(writes).toEqual([
      'Alran could not reach the npm registry; no update check was performed.\n',
    ]);
    expect(installCommand).not.toHaveBeenCalled();
  });
});
