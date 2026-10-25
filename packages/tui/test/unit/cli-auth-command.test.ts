import { describe, expect, it, vi } from 'vitest';

import { runTuiLogin, runTuiLogout } from '../../src/cli/auth-command.js';

const CONSOLE_URL = 'https://api.ottili.one/settings/api-keys';
const API_KEY = 'sk-ottili-test-key';

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
});
