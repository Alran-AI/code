import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogoutResult } from '@alran/oauth-core';

import { createLocalAuthFixture } from '../../../oauth-core/test/helpers/local-auth.js';

import type { AlranBusinessEvent } from '../../src/analytics/business-telemetry.js';
import { AlranAuthApplication } from '../../src/auth/application.js';

import {
  clearStoredPlatformSession,
  platformEnvironmentOrder,
  resolvePlatformEnvironmentForBuild,
  resolveStoredPlatformSession,
} from '@alran/config';
import { clearOttiliApiKey } from '../../src/auth/ottili-api-key.js';

vi.mock('@alran/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alran/config')>();
  return {
    ...actual,
    clearStoredPlatformSession: vi.fn(),
    resolveStoredPlatformSession: vi.fn(() => null),
  };
});

vi.mock('../../src/auth/ottili-api-key.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/ottili-api-key.js')>();
  return {
    ...actual,
    clearOttiliApiKey: vi.fn(async () => undefined),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveStoredPlatformSession).mockReturnValue(null);
});

function sharedCore(status: 'anonymous' | 'authenticated' | 'logout_pending' = 'anonymous') {
  return {
    getStatus: vi.fn(async () => ({
      status,
      generation: status === 'authenticated' ? 1 : 0,
      scopes: status === 'authenticated' ? ['agent.default'] : [],
    })),
    // Mirrors the real core: an authenticated session only refreshes, while
    // any other state starts a Device Flow and fires the prompt callback.
    login: vi.fn(async ({ onDeviceAuthorization } = {}) => {
      if (status !== 'authenticated') {
        onDeviceAuthorization?.({
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://account.example.test/device',
          expiresInSec: 300,
        });
      }
      return { status: 'authenticated' as const, generation: 1 };
    }),
    logout: vi.fn(async (): Promise<LogoutResult> => ({ status: 'anonymous', generation: 2 })),
  };
}

describe('AlranAuthApplication', () => {
  it('uses the shared OAuth Device Flow when a shared OAuth provider is requested', async () => {
    const core = sharedCore();
    const onProgress = vi.fn();
    const application = new AlranAuthApplication({
      dataDir: '/data',
      region: 'cn',
      buildEnv: 'test',
      sharedAuthCore: core,
    });

    await expect(application.login(onProgress, undefined, 'keycloak')).resolves.toEqual({
      state: 'authenticated',
      message: 'Signed in with Alran.',
    });
    expect(core.login).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      state: 'device-authorization',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://account.example.test/device',
      expiresInSec: 300,
    });
  });

  it('lets Core reuse an authenticated session without forcing a refresh', async () => {
    const core = sharedCore('authenticated');
    const application = new AlranAuthApplication({ dataDir: '/data', sharedAuthCore: core });

    await expect(application.login(undefined, undefined, 'keycloak')).resolves.toEqual({
      state: 'already-authenticated',
      message: 'Already signed in with Alran.',
    });
    expect(core.login).toHaveBeenCalledOnce();
    expect(core.login).toHaveBeenCalledWith({ onDeviceAuthorization: expect.any(Function) });
  });

  it.each(['offline', 'unavailable'] as const)(
    'reuses a healthy session without contacting Account when it is %s',
    async (failure) => {
      const fixture = await createLocalAuthFixture();
      try {
        const core = fixture.createManager();
        const application = new AlranAuthApplication({
          dataDir: fixture.dataDir, sharedAuthCore: core, region: 'cn', buildEnv: 'test',
        });
        await application.login(undefined, undefined, 'keycloak');
        const lease = await core.getAccessToken({ minValidityMs: 30_000 });
        fixture.setRefreshFailure(failure);

        await expect(application.login(undefined, undefined, 'keycloak')).resolves.toMatchObject({ state: 'already-authenticated' });
        await expect(core.getAccessToken({ minValidityMs: 30_000 })).resolves.toEqual(lease);
        expect(fixture.calls).toEqual({ device: 1, refresh: 0 });
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it('logs in to another region without replacing the authenticated current region', async () => {
    const chinaCore = sharedCore('authenticated');
    const globalCore = sharedCore();
    const resolveSharedAuthCore = vi.fn(() => globalCore);
    const application = new AlranAuthApplication({
      dataDir: '/data',
      region: 'cn',
      buildEnv: 'test',
      sharedAuthCore: chinaCore,
      resolveSharedAuthCore,
    });

    await expect(application.login(undefined, 'en', 'keycloak')).resolves.toEqual({
      state: 'authenticated',
      message: 'Signed in with Alran Global.',
      restartRequired: true,
    });
    expect(resolveSharedAuthCore).toHaveBeenCalledWith('en');
    expect(chinaCore.login).not.toHaveBeenCalled();
    expect(globalCore.login).toHaveBeenCalledOnce();
  });

  it('persists only the non-sensitive selected region after login succeeds', async () => {
    const core = sharedCore();
    const writeRegionPreference = vi.fn();
    const application = new AlranAuthApplication({
      dataDir: '/data',
      region: 'cn',
      buildEnv: 'test',
      sharedAuthCore: core,
      writeRegionPreference,
    });

    await application.login(undefined, 'cn', 'keycloak');

    expect(writeRegionPreference).toHaveBeenCalledWith('/data', {
      region: 'cn',
      buildEnv: 'test',
    });
  });

  it('reuses an authenticated selected region without starting Device Flow', async () => {
    const chinaCore = sharedCore();
    const globalCore = sharedCore('authenticated');
    const resolveSharedAuthCore = vi.fn(() => globalCore);
    const application = new AlranAuthApplication({
      dataDir: '/data',
      region: 'cn',
      buildEnv: 'test',
      sharedAuthCore: chinaCore,
      resolveSharedAuthCore,
    });

    await expect(application.login(undefined, 'en', 'keycloak')).resolves.toEqual({
      state: 'already-authenticated',
      message: 'Already signed in with Alran Global.',
      restartRequired: true,
    });
    expect(resolveSharedAuthCore).toHaveBeenCalledWith('en');
    expect(chinaCore.login).not.toHaveBeenCalled();
    expect(globalCore.login).toHaveBeenCalledOnce();
    expect(globalCore.login).toHaveBeenCalledWith({ onDeviceAuthorization: expect.any(Function) });
  });

  it.each([
    ['cn', 'dev'],
    ['cn', 'test'],
    ['cn', 'staging'],
    ['cn', 'prod'],
    ['en', 'dev'],
    ['en', 'test'],
    ['en', 'staging'],
    ['en', 'prod'],
  ] as const)(
    'signs out locally for %s/%s without opening a browser logout URL',
    async (region, buildEnv) => {
      const core = sharedCore('authenticated');
      const application = new AlranAuthApplication({
        dataDir: '/data',
        region,
        buildEnv,
        sharedAuthCore: core,
      });

      await expect(application.logout()).resolves.toEqual({
        state: 'signed-out',
        message: `Signed out of Alran ${region === 'cn' ? 'China' : 'Global'} on this device.`,
      });
      expect(core.logout).toHaveBeenCalledWith({ revoke: true });
      expect(clearOttiliApiKey).toHaveBeenCalled();
      const platformEnv = resolvePlatformEnvironmentForBuild(buildEnv);
      for (const env of platformEnvironmentOrder(platformEnv)) {
        expect(clearStoredPlatformSession).toHaveBeenCalledWith('/data', env);
      }
    },
  );

  it('treats logout of an already anonymous shared domain as a safe no-op', async () => {
    const core = sharedCore();
    const application = new AlranAuthApplication({
      dataDir: '/data',
      sharedAuthCore: core,
      region: 'cn',
      buildEnv: 'prod',
    });

    await expect(application.logout()).resolves.toEqual({
      state: 'already-signed-out',
      message: 'Already signed out of Alran.',
    });
    expect(core.logout).toHaveBeenCalledWith({ revoke: true });
    expect(clearOttiliApiKey).toHaveBeenCalled();
  });

  it('signs out locally while server revocation is pending', async () => {
    const core = sharedCore('authenticated');
    core.logout.mockResolvedValue({ status: 'logout_pending', generation: 2 });
    const application = new AlranAuthApplication({
      dataDir: '/data',
      sharedAuthCore: core,
      region: 'en',
      buildEnv: 'prod',
    });

    await expect(application.logout()).resolves.toEqual({
      state: 'signed-out',
      message: `Signed out locally from Alran Global. Server revocation is pending until the network recovers.`,
    });
  });

  it('clears a stored Platform session even when shared logout is unavailable offline', async () => {
    vi.mocked(resolveStoredPlatformSession).mockReturnValue({
      sessionId: 'sess_test',
      companyId: 'co_test',
      subjectId: 'usr_test',
      baseUrl: 'https://platform.ottili.one',
      via: 'oidc',
      storedAtMs: 1,
    } as never);
    const core = sharedCore();
    core.getStatus.mockRejectedValue(new Error('offline'));
    core.logout.mockRejectedValue(new Error('offline'));
    const application = new AlranAuthApplication({
      dataDir: '/data',
      sharedAuthCore: core,
      region: 'en',
      buildEnv: 'prod',
    });

    await expect(application.logout()).resolves.toEqual({
      state: 'signed-out',
      message: 'Signed out of Alran Global on this device.',
    });
    expect(clearOttiliApiKey).toHaveBeenCalled();
    expect(clearStoredPlatformSession).toHaveBeenCalledWith('/data', 'prod');
    expect(clearStoredPlatformSession).toHaveBeenCalledWith('/data', 'dev');
  });

  it('reports OAuth telemetry and preserves login failures', async () => {
    const events: AlranBusinessEvent[] = [];
    const core = sharedCore();
    core.login.mockRejectedValueOnce(new Error('OAuth authorization failed.'));
    const application = new AlranAuthApplication({
      dataDir: '/data',
      sharedAuthCore: core,
      telemetry: {
        track: (event, properties) => events.push({ event, properties } as AlranBusinessEvent),
        flush: async () => undefined,
      },
      telemetrySource: 'alran_tui',
    });

    await expect(application.login(undefined, undefined, 'keycloak')).rejects.toThrow('OAuth authorization failed.');
    expect(events.at(-1)).toEqual({
      event: 'login_result',
      properties: {
        source: 'alran_tui',
        result_type: '2',
        fail_reason: '5',
        login_type: 'alran_oauth',
      },
    });
  });
});
