import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTuiLogin, runTuiLogout } from '../../src/cli/auth-command.js';
import { verifyOttiliApiKey } from '../../src/auth/ottili-api-key.js';

const CONSOLE_URL = 'https://ai.ottili.one/api-keys';
const API_KEY = 'sk-ottili-test-key';
const accepted = async () => ({ kind: 'verified' as const, models: 3 });

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
        verifyKey: accepted,
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
      verifyKey: accepted,
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
        verifyKey: accepted,
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
        verifyKey: accepted,
        readApiKey: async () => 'not-an-ottili-key',
        writeError: () => {},
        openExternalTarget: async () => {},
      }),
    ).rejects.toThrow(/sk-ottili-/);

    expect(storeKey).not.toHaveBeenCalled();
  });

  it('does not say "Signed in" for a key the platform rejects, and does not save it', async () => {
    const storeKey = vi.fn(async () => {});

    await expect(
      runTuiLogin({
        consoleUrl: CONSOLE_URL,
        storeKey,
        verifyKey: async () => ({ kind: 'rejected', detail: 'HTTP 401: invalid or revoked key' }),
        readApiKey: async () => API_KEY,
        writeError: () => {},
        openExternalTarget: async () => {},
      }),
    ).rejects.toThrow(/rejected this API key.*Nothing was saved.*Create a new key at https:\/\/ai\.ottili\.one\/api-keys/);

    expect(storeKey).not.toHaveBeenCalled();
  });

  it('saves the key but says so when the platform cannot confirm it', async () => {
    const storeKey = vi.fn(async () => {});

    const message = await runTuiLogin({
      consoleUrl: CONSOLE_URL,
      storeKey,
      verifyKey: async () => ({ kind: 'unconfirmed', detail: 'HTTP 502' }),
      readApiKey: async () => API_KEY,
      writeError: () => {},
      openExternalTarget: async () => {},
    });

    expect(storeKey).toHaveBeenCalledWith(API_KEY);
    expect(message).not.toMatch(/^Signed in/);
    expect(message).toMatch(/saved, but the platform could not confirm it \(HTTP 502\)/);
  });

  it('reports how many models a verified key can use', async () => {
    const message = await runTuiLogin({
      consoleUrl: CONSOLE_URL,
      storeKey: async () => {},
      verifyKey: accepted,
      readApiKey: async () => API_KEY,
      writeError: () => {},
      openExternalTarget: async () => {},
    });
    expect(message).toMatch(/^Signed in to the Ottili AI Platform/);
    expect(message).toContain('(3 models available)');
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

describe('verifyOttiliApiKey (what the gateway says about a key)', () => {
  const answer = (status: number, body: unknown = {}) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

  it('verifies a key the gateway accepts and counts its models, sending the key only as a bearer token', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl, baseUrl: 'https://ai.example/v1/' })).resolves.toEqual({ kind: 'verified', models: 2 });
    expect(seen).toEqual([{ url: 'https://ai.example/v1/models', auth: `Bearer ${API_KEY}` }]);
  });

  it('rejects only on 401; a 403 (a key that may not list models) is unconfirmed, not rejected', async () => {
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl: answer(401), baseUrl: 'https://ai.example/v1' })).resolves.toMatchObject({ kind: 'rejected' });
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl: answer(403), baseUrl: 'https://ai.example/v1' })).resolves.toEqual({ kind: 'unconfirmed', detail: 'HTTP 403' });
  });

  it('calls an outage an outage: 502, 429 and a dead connection are unconfirmed', async () => {
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl: answer(502), baseUrl: 'https://ai.example/v1' })).resolves.toEqual({ kind: 'unconfirmed', detail: 'HTTP 502' });
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl: answer(429), baseUrl: 'https://ai.example/v1' })).resolves.toEqual({ kind: 'unconfirmed', detail: 'HTTP 429' });
    const dead = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(verifyOttiliApiKey(API_KEY, { fetchImpl: dead, baseUrl: 'https://ai.example/v1' })).resolves.toEqual({ kind: 'unconfirmed', detail: 'the platform could not be reached' });
  });
});
