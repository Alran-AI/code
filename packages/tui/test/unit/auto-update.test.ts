import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTO_UPDATE_CHECK_INTERVAL_MS,
  AUTO_UPDATE_INSTALL_COOLDOWN_MS,
  AUTO_UPDATE_STABLE_LAG_MS,
  resolveAutoUpdatePolicy,
  resolveAutoUpdateAnnouncement,
  resolveChannelVersion,
  runAutoUpdateCycle,
  type AlranRegistryMetadata,
} from '../../src/update/auto-update.js';
import {
  countAlranChangelogEntries,
  renderAutoUpdateAnnouncement,
} from '../../src/update/auto-update-changelog.js';
import { compareAlranVersions } from '../../src/update/release.js';
import {
  classifyAlranInstallPath,
  detectAlranInstallSource,
} from '../../src/update/install-source.js';

let dataDir: string;
let writes: string[];

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'alran-auto-'));
  writes = [];
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const write = (value: string): void => {
  writes.push(value);
};

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

const registryMetadata = (
  latest: string,
  versions: Array<[string, number]>,
): ((...args: unknown[]) => Promise<Response>) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          'dist-tags': { latest },
          time: Object.fromEntries(
            versions.map(([version, publishedAtMs]) => [
              version,
              new Date(publishedAtMs).toISOString(),
            ]),
          ),
        }),
        { status: 200 },
      ),
  ) as unknown as () => Promise<Response>;

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const cycleOptions = (overrides: Record<string, unknown> = {}) => ({
  currentVersion: '1.0.0',
  dataDir,
  environment: { XDG_DATA_HOME: path.join(dataDir, 'xdg') },
  packageRoot: () => npmGlobalLayout('1.0.0').packageRoot,
  npmGlobalPrefix: async () => npmGlobalLayout('1.0.0').prefix,
  fetchImpl: registryMetadata('1.0.0', []),
  installCommand: vi.fn(async () => undefined),
  write,
  now: vi.fn(() => NOW),
  ...overrides,
});

describe('version comparison', () => {
  it('orders core parts, prereleases and missing parts', () => {
    expect(compareAlranVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareAlranVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareAlranVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareAlranVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
    expect(compareAlranVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareAlranVersions('1.0.0-beta', '1.0.0-alpha')).toBeGreaterThan(0);
  });
});

describe('the auto-update policy', () => {
  it('is on by default on the latest channel', () => {
    expect(resolveAutoUpdatePolicy({ environment: {} })).toEqual({
      enabled: true,
      channel: 'latest',
      offline: false,
    });
  });

  it('turns off through the config key or the environment variable', () => {
    expect(resolveAutoUpdatePolicy({ environment: {}, autoUpdate: false }).enabled).toBe(false);
    expect(
      resolveAutoUpdatePolicy({ environment: { ALRAN_DISABLE_AUTOUPDATE: '1' } }).enabled,
    ).toBe(false);
    expect(
      resolveAutoUpdatePolicy({
        environment: { ALRAN_DISABLE_AUTOUPDATE: 'true' },
        autoUpdate: true,
      }).enabled,
    ).toBe(false);
  });

  it('makes no network call at all when offline', () => {
    expect(resolveAutoUpdatePolicy({ environment: { ALRAN_OFFLINE: '1' } }).offline).toBe(true);
    expect(resolveAutoUpdatePolicy({ environment: { ALRAN_OFFLINE: 'yes' } }).offline).toBe(true);
    expect(resolveAutoUpdatePolicy({ environment: {} }).offline).toBe(false);
  });

  it('selects the channel from the environment, then the config, then the default', () => {
    expect(resolveAutoUpdatePolicy({ environment: { ALRAN_UPDATE_CHANNEL: 'stable' } }).channel).toBe(
      'stable',
    );
    expect(
      resolveAutoUpdatePolicy({ environment: {}, autoUpdateChannel: 'stable' }).channel,
    ).toBe('stable');
    expect(
      resolveAutoUpdatePolicy({
        environment: { ALRAN_UPDATE_CHANNEL: 'stable' },
        autoUpdateChannel: 'latest',
      }).channel,
    ).toBe('stable');
    expect(
      resolveAutoUpdatePolicy({ environment: { ALRAN_UPDATE_CHANNEL: 'beta' }, autoUpdateChannel: 'nope' })
        .channel,
    ).toBe('latest');
  });
});

describe('the check interval and the cache', () => {
  it('checks the registry at most once every six hours and caches the result', async () => {
    const fetchImpl = registryMetadata('1.1.0', []);
    const now = vi.fn(() => NOW);
    await runAutoUpdateCycle(cycleOptions({ fetchImpl, now }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readFileSync(path.join(dataDir, 'auto-update.json'), 'utf8')).toContain('"latestVersion": "1.1.0"');

    await runAutoUpdateCycle(cycleOptions({ fetchImpl, now }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now.mockReturnValue(NOW + AUTO_UPDATE_CHECK_INTERVAL_MS);
    await runAutoUpdateCycle(cycleOptions({ fetchImpl, now }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rechecks when the channel changes and shows nothing when already current', async () => {
    const fetchImpl = registryMetadata('1.1.0', []);
    const first = cycleOptions({ fetchImpl, autoUpdateChannel: 'stable' });
    await runAutoUpdateCycle(first);
    await runAutoUpdateCycle(cycleOptions({ fetchImpl, autoUpdateChannel: 'latest' }));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const current = registryMetadata('1.0.0', []);
    await runAutoUpdateCycle(cycleOptions({ fetchImpl: current }));
    expect(writes.join('')).toBe('');
  });
});

describe('channel selection', () => {
  const metadata = (): AlranRegistryMetadata => ({
    latest: '1.2.0',
    versions: [
      { version: '1.0.0', publishedAtMs: NOW - 30 * DAY },
      { version: '1.1.0', publishedAtMs: NOW - DAY },
      { version: '1.2.0-beta.1', publishedAtMs: NOW - 10 * DAY },
    ],
  });

  it('latest follows the dist-tag', () => {
    expect(resolveChannelVersion('latest', metadata())).toBe('1.2.0');
  });

  it('stable tracks the newest release a few days old, skipping prereleases', () => {
    expect(resolveChannelVersion('stable', metadata(), { now: () => NOW })).toBe('1.0.0');
    expect(
      resolveChannelVersion('stable', metadata(), {
        now: () => NOW,
        stableLagMs: DAY / 2,
      }),
    ).toBe('1.1.0');
  });

  it('falls back to latest when nothing is old enough', () => {
    const fresh = { latest: '1.2.0', versions: [{ version: '1.2.0', publishedAtMs: NOW - 1000 }] };
    expect(resolveChannelVersion('stable', fresh, { now: () => NOW })).toBe('1.2.0');
  });
});

describe('install-method detection', () => {
  it('classifies the supported package-manager layouts', () => {
    expect(classifyAlranInstallPath('/usr/lib/node_modules/alran')).toBe('npm-global');
    expect(classifyAlranInstallPath('/home/u/.npm-global/npm/node_modules/alran')).toBe('npm-global');
    expect(
      classifyAlranInstallPath('/home/u/.local/share/pnpm/global/v11/abc/node_modules/alran'),
    ).toBe('pnpm-global');
    expect(
      classifyAlranInstallPath('/home/u/.config/yarn/global/node_modules/alran'),
    ).toBe('yarn-global');
    expect(
      classifyAlranInstallPath('/home/u/.bun/install/global/node_modules/alran'),
    ).toBe('bun-global');
    expect(classifyAlranInstallPath('/home/u/projects/alran')).toBeUndefined();
  });

  it('detects npm global through the injected package root and prefix', async () => {
    const { packageRoot, prefix } = npmGlobalLayout('1.0.0');
    expect(
      await detectAlranInstallSource({
        installRoot: path.join(dataDir, 'managed'),
        platform: 'linux',
        packageRoot: () => packageRoot,
        npmGlobalPrefix: async () => prefix,
      }),
    ).toBe('npm-global');
  });

  it('detects yarn global and unsupported installs the same way', async () => {
    const yarnRoot = path.join(dataDir, '.config', 'yarn', 'global', 'node_modules', 'alran');
    mkdirSync(yarnRoot, { recursive: true });
    expect(
      await detectAlranInstallSource({
        installRoot: path.join(dataDir, 'managed'),
        platform: 'linux',
        packageRoot: () => yarnRoot,
        npmGlobalPrefix: async () => '/usr',
      }),
    ).toBe('yarn-global');
    const fromSource = path.join(dataDir, 'from-source', 'alran');
    mkdirSync(fromSource, { recursive: true });
    expect(
      await detectAlranInstallSource({
        installRoot: path.join(dataDir, 'managed'),
        platform: 'linux',
        packageRoot: () => fromSource,
        npmGlobalPrefix: async () => '/usr',
      }),
    ).toBe('unsupported');
  });

  it('recognizes a managed installer root and keeps it out of auto-update', async () => {
    const installRoot = path.join(dataDir, 'managed');
    mkdirSync(installRoot, { recursive: true });
    writeFileSync(path.join(installRoot, 'install.json'), JSON.stringify({
      product: 'alran-code',
      updateOwner: 'alran-installer',
    }));
    expect(
      await detectAlranInstallSource({ installRoot, platform: 'linux' }),
    ).toBe('managed-installer');
  });
});

describe('changelog count parsing', () => {
  it('counts conventional feat/fix prefixes with scopes and bangs', () => {
    const changelog = [
      '## 1.1.1',
      '',
      '- feat: add auto-update',
      '- feat(scope)!: break the old checker',
      '- fix: keep the old version on failure',
      '- docs: nothing counted here',
      '## 1.1.0',
      '- feat: older entry',
    ].join('\n');
    expect(countAlranChangelogEntries(changelog, '1.1.1')).toEqual({ features: 2, fixes: 1 });
  });

  it('counts Added/Fixed sections when entries carry no prefixes', () => {
    const changelog = [
      '## 1.1.0',
      '### Added',
      '- background installs',
      '- channels',
      '### Fixed',
      '- startup delay',
      '### Changed',
      '- not counted',
    ].join('\n');
    expect(countAlranChangelogEntries(changelog, '1.1.0')).toEqual({ features: 2, fixes: 1 });
  });

  it('returns zero counts for a missing version and renders the fallback line', () => {
    expect(countAlranChangelogEntries('## 1.0.0\n- feat: x', '2.0.0')).toEqual({
      features: 0,
      fixes: 0,
    });
    expect(renderAutoUpdateAnnouncement('1.1.1', { features: 0, fixes: 0 })).toBe(
      'Updated to 1.1.1. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1',
    );
    expect(
      renderAutoUpdateAnnouncement('1.1.1', { features: 3, fixes: 12 }),
    ).toBe(
      'Updated to 1.1.1 – 3 features, 12 fixes. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1',
    );
  });
});

describe('the announcement of an applied update', () => {
  it('shows exactly one line after the installed version becomes active', () => {
    writeFileSync(
      path.join(dataDir, 'auto-update.json'),
      JSON.stringify({ installedVersion: '1.1.1', announcementShownAtMs: null }),
    );
    const announcement = resolveAutoUpdateAnnouncement({
      currentVersion: '1.1.1',
      dataDir,
      changelog: '## 1.1.1\n- feat: auto-update\n- fix: hint',
    });
    expect(announcement?.line).toBe(
      'Updated to 1.1.1 – 1 feature, 1 fix. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1',
    );
  });

  it('stays silent before the update is active, after it was shown, or without counts', () => {
    writeFileSync(
      path.join(dataDir, 'auto-update.json'),
      JSON.stringify({ installedVersion: '1.1.1' }),
    );
    expect(
      resolveAutoUpdateAnnouncement({ currentVersion: '1.0.0', dataDir, changelog: '' }),
    ).toBeNull();

    writeFileSync(
      path.join(dataDir, 'auto-update.json'),
      JSON.stringify({ installedVersion: '1.1.1', announcementShownAtMs: NOW }),
    );
    expect(
      resolveAutoUpdateAnnouncement({ currentVersion: '1.1.1', dataDir, changelog: '' }),
    ).toBeNull();

    writeFileSync(
      path.join(dataDir, 'auto-update.json'),
      JSON.stringify({ installedVersion: '1.1.1' }),
    );
    const silent = resolveAutoUpdateAnnouncement({
      currentVersion: '1.1.1',
      dataDir,
      changelog: '## 1.1.1\n- nothing countable',
    });
    expect(silent?.line).toBe(
      'Updated to 1.1.1. Changelog: https://github.com/Alran-AI/code/releases/tag/v1.1.1',
    );
  });
});

describe('failure paths', () => {
  it('survives a corrupted cache and rechecks', async () => {
    writeFileSync(
      path.join(dataDir, 'auto-update.json'),
      '{"latestVersion": 42, "checkedAtMs": "soon"}',
    );
    const fetchImpl = registryMetadata('1.1.0', []);
    await runAutoUpdateCycle(cycleOptions({ fetchImpl }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const cache = JSON.parse(readFileSync(path.join(dataDir, 'auto-update.json'), 'utf8'));
    expect(cache.latestVersion).toBe('1.1.0');
  });

  it('makes no network call and installs nothing when offline', async () => {
    const fetchImpl = registryMetadata('9.9.9', []);
    const installCommand = vi.fn(async () => undefined);
    await runAutoUpdateCycle(
      cycleOptions({
        fetchImpl,
        installCommand,
        environment: { XDG_DATA_HOME: path.join(dataDir, 'xdg'), ALRAN_OFFLINE: '1' },
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(installCommand).not.toHaveBeenCalled();
    expect(writes.join('')).toBe('');
  });

  it('fails silently when the registry does not answer in time', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
        }),
    ) as unknown as typeof fetch;
    await expect(
      runAutoUpdateCycle(cycleOptions({ fetchImpl, registryTimeoutMs: 10 })),
    ).resolves.toBeUndefined();
    expect(writes.join('')).toBe('');
  });

  it('fails silently when the registry is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(runAutoUpdateCycle(cycleOptions({ fetchImpl }))).resolves.toBeUndefined();
    expect(writes.join('')).toBe('');
  });

  it('keeps the old version, logs the reason and waits a day before retrying a failed install', async () => {
    const installCommand = vi.fn(async () => {
      throw new Error('npm ERR! ECONNREFUSED');
    });
    const now = vi.fn(() => NOW);
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        now,
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(installCommand).toHaveBeenCalledTimes(1);
    expect(writes.join('')).toBe('');
    const cache = JSON.parse(readFileSync(path.join(dataDir, 'auto-update.json'), 'utf8'));
    expect(cache.installedVersion).toBeUndefined();
    expect(cache.lastInstallError).toContain('ECONNREFUSED');
    expect(readFileSync(path.join(dataDir, 'auto-update.log'), 'utf8')).toContain('ECONNREFUSED');

    now.mockReturnValue(NOW + 1000);
    await runAutoUpdateCycle(
      cycleOptions({ installCommand, now, fetchImpl: registryMetadata('1.1.1', []) }),
    );
    expect(installCommand).toHaveBeenCalledTimes(1);
  });

  it('keeps the old version when the installed binary fails its health check', async () => {
    const installCommand = vi.fn(async () => undefined);
    const { prefix, packageRoot } = npmGlobalLayout('1.1.1');
    const runCommand = vi.fn(async (command: string, args: readonly string[]) => {
      if (args[0] === 'prefix') return prefix;
      return '1.0.0'; // the new binary reports the old version
    });
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        runCommand,
        packageRoot: () => packageRoot,
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    const cache = JSON.parse(readFileSync(path.join(dataDir, 'auto-update.json'), 'utf8'));
    expect(cache.installedVersion).toBeUndefined();
    expect(cache.lastInstallError).toContain('health check');
    expect(readFileSync(path.join(dataDir, 'auto-update.log'), 'utf8')).toContain('health check');
  });

  it('falls back to the hint message when the global npm directory is not writable', async () => {
    const installCommand = vi.fn(async () => {
      throw Object.assign(new Error('npm ERR! code EACCES'), { code: 'EACCES' });
    });
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(installCommand).toHaveBeenCalledTimes(1);
    expect(writes.join('')).toContain('Update available: 1.1.1. Run:');
  });

  it('shows the once-a-day hint for install methods auto-update does not touch', async () => {
    const yarnRoot = path.join(dataDir, '.config', 'yarn', 'global', 'node_modules', 'alran');
    mkdirSync(yarnRoot, { recursive: true });
    writeFileSync(
      path.join(yarnRoot, 'package.json'),
      JSON.stringify({ name: 'alran', version: '1.0.0' }),
    );
    const installCommand = vi.fn(async () => undefined);
    const now = vi.fn(() => NOW);
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        now,
        packageRoot: () => yarnRoot,
        npmGlobalPrefix: async () => '/usr',
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(installCommand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('Update available: 1.1.1. Run: yarn global add alran@1.1.1');

    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        now,
        packageRoot: () => yarnRoot,
        npmGlobalPrefix: async () => '/usr',
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(writes).toHaveLength(1);

    now.mockReturnValue(NOW + AUTO_UPDATE_INSTALL_COOLDOWN_MS + 1000);
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        now,
        packageRoot: () => yarnRoot,
        npmGlobalPrefix: async () => '/usr',
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(writes).toHaveLength(2);
  });

  it('shows the hint instead of installing when the user opted out', async () => {
    const installCommand = vi.fn(async () => undefined);
    await runAutoUpdateCycle(
      cycleOptions({
        installCommand,
        autoUpdate: false,
        fetchImpl: registryMetadata('1.1.1', []),
      }),
    );
    expect(installCommand).not.toHaveBeenCalled();
    expect(writes.join('')).toContain('Update available: 1.1.1. Run:');
  });
});
