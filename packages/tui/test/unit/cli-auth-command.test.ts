import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTuiLogin, runTuiLogout } from '../../src/cli/auth-command.js';

const CONSOLE_URL = 'https://ai.ottili.one/api-keys';
const API_KEY = 'sk-ottili-test-key';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'alran-logout-'));
  vi.stubEnv('ALRAN_DATA_DIR', dataDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Alran Code auth commands', () => {
  it('opens the Ottili API key page and stores the pasted key', async () => {
    const stderr: string[] = [];
    const openedTargets: string[] = [];
    const storeKey = vi.fn(async () => {});

    await expect(
      runTuiLogin({
        consoleUrl: CONSOLE_URL,
        storeKey,
        readApiKey: async () => API_KEY,
        writeError: (value) => stderr.push(value),
        openExternalTarget: async (target) => {
          openedTargets.push(target);
        },
      }),
    ).resolves.toContain('Ottili API key');

    expect(openedTargets).toEqual([CONSOLE_URL]);
    expect(stderr.join('')).toContain(CONSOLE_URL);
    expect(storeKey).toHaveBeenCalledWith(API_KEY);
  });

  it('keeps the key page printable without a desktop browser', async () => {
    const stderr: string[] = [];
    const openedTargets: string[] = [];

    await runTuiLogin({
      openBrowser: false,
      consoleUrl: CONSOLE_URL,
      storeKey: async () => {},
      readApiKey: async () => API_KEY,
      writeError: (value) => stderr.push(value),
      openExternalTarget: async (target) => {
        openedTargets.push(target);
      },
    });

    expect(openedTargets).toEqual([]);
    expect(stderr.join('')).toContain(CONSOLE_URL);
  });

  it('continues when opening the default browser fails', async () => {
    const stderr: string[] = [];
    const storeKey = vi.fn(async () => {});

    await expect(
      runTuiLogin({
        consoleUrl: CONSOLE_URL,
        storeKey,
        readApiKey: async () => API_KEY,
        writeError: (value) => stderr.push(value),
        openExternalTarget: async () => {
          throw new Error('no desktop session');
        },
      }),
    ).resolves.toContain('Ottili API key');

    expect(storeKey).toHaveBeenCalledWith(API_KEY);
    expect(stderr.join('')).toContain(
      "Couldn't open the default browser. Open the URL above manually.",
    );
  });

  it('rejects a key that is not an Ottili API key', async () => {
    const storeKey = vi.fn(async () => {});

    await expect(
      runTuiLogin({
        consoleUrl: CONSOLE_URL,
        storeKey,
        readApiKey: async () => 'not-an-ottili-key',
        writeError: () => {},
        openExternalTarget: async () => {},
      }),
    ).rejects.toThrow(/sk-ottili-/);

    expect(storeKey).not.toHaveBeenCalled();
  });

  it('removes the stored key on logout', async () => {
    const clearKey = vi.fn(async () => {});

    await expect(runTuiLogout({ clearKey })).resolves.toContain('Signed out');

    expect(clearKey).toHaveBeenCalledOnce();
  });

  it('signs the OAuth credential out too, in every namespace a sign-in can have used', async () => {
    const scopes: string[] = [];
    const logout = vi.fn(async () => ({ status: 'anonymous' as const, generation: 4 }));

    await runTuiLogout({
      clearKey: async () => {},
      sharedAuthLogoutFor: (scope) => {
        scopes.push(`${scope.buildEnv}/${scope.region}`);
        return { logout };
      },
    });

    expect(scopes).toContain('prod/en');
    expect(logout).toHaveBeenCalledTimes(scopes.length);
    expect(logout).toHaveBeenCalledWith({ revoke: true });
  });

  it('removes the token from this machine even when the server cannot revoke it', async () => {
    const stderr: string[] = [];
    const logout = vi
      .fn()
      .mockResolvedValueOnce({ status: 'logout_pending', generation: 5 })
      .mockResolvedValueOnce({ status: 'anonymous', generation: 6 })
      .mockResolvedValue({ status: 'anonymous', generation: 1 });

    await runTuiLogout({
      clearKey: async () => {},
      writeError: (value) => stderr.push(value),
      sharedAuthLogoutFor: () => ({ logout }),
    });

    expect(logout).toHaveBeenNthCalledWith(1, { revoke: true });
    expect(logout).toHaveBeenNthCalledWith(2, { revoke: false });
    expect(stderr.join('')).toMatch(/could not revoke .*OAuth grant/i);
  });

  it('says so when the OAuth credential could not be removed at all', async () => {
    const stderr: string[] = [];
    await runTuiLogout({
      clearKey: async () => {},
      writeError: (value) => stderr.push(value),
      sharedAuthLogoutFor: () => ({
        logout: async () => {
          throw new Error('disk is read-only');
        },
      }),
    });
    expect(stderr.join('')).toContain('disk is read-only');
  });
});
