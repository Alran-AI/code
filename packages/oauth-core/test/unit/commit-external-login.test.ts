import { afterEach, describe, expect, it } from 'vitest';

import { ALRAN_OAUTH_AUDIENCE, ALRAN_OAUTH_CLIENT_ID } from '../../src/contracts.js';
import type { StoredCredential } from '../../src/credential-store/types.js';
import { FileStore } from '../../src/credential-store/file-store.js';
import { createLocalAuthFixture } from '../helpers/local-auth.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function credential(generation: number, loginEpoch: string, token: string): StoredCredential {
  return {
    schemaVersion: 1,
    accessToken: `access-${token}`,
    refreshToken: `refresh-${token}`,
    tokenType: 'Bearer',
    clientId: ALRAN_OAUTH_CLIENT_ID,
    scopes: ['agent.default'],
    audience: ALRAN_OAUTH_AUDIENCE,
    expiresAtMs: 1_800_000_000_000 + 100_000_000,
    generation,
    loginEpoch,
  };
}

describe('commitExternalLogin', () => {
  it('allocates the generation from the core instead of resetting the refresh fence', async () => {
    const f = await createLocalAuthFixture();
    cleanups.push(f.cleanup);
    const core = f.createCore();
    await core.login();
    // A refresh in this (or another) process moves the fence forward.
    f.advanceTime(3_600_000);
    await core.getAccessToken({ requiredScopes: ['agent.default'], minValidityMs: 60_000 });
    const before = await core.getStatus();
    expect(before.generation).toBeGreaterThan(1);

    const result = await f.createCore().commitExternalLogin(({ generation, loginEpoch }) =>
      credential(generation, loginEpoch, 'keycloak'),
    );

    expect(result.generation).toBe(before.generation + 1);
    const status = await core.getStatus();
    expect(status).toMatchObject({ status: 'authenticated', generation: before.generation + 1 });
    const stored = await new FileStore({ authHome: f.namespace.namespaceHome }).get(
      f.namespace.credentialKey,
    );
    expect(stored).toMatchObject({ refreshToken: 'refresh-keycloak', generation: before.generation + 1 });
  });

  it('refuses a credential that carries another generation than the one allocated', async () => {
    const f = await createLocalAuthFixture();
    cleanups.push(f.cleanup);
    const core = f.createCore();
    await expect(
      core.commitExternalLogin(({ loginEpoch }) => credential(7, loginEpoch, 'forged')),
    ).rejects.toThrow(/generation/);
    expect((await core.getStatus()).status).not.toBe('authenticated');
  });

  it('serializes two sign-ins: both commit, with distinct increasing generations', async () => {
    const f = await createLocalAuthFixture();
    cleanups.push(f.cleanup);
    const generations = await Promise.all(
      ['a', 'b', 'c'].map((token) =>
        f
          .createCore()
          .commitExternalLogin(({ generation, loginEpoch }) => credential(generation, loginEpoch, token)),
      ),
    );
    expect(new Set(generations.map((entry) => entry.generation)).size).toBe(3);
    const status = await f.createCore().getStatus();
    expect(status.generation).toBe(Math.max(...generations.map((entry) => entry.generation)));
  });

  it('leaves nothing behind after logout, in the store and in the refresh journal', async () => {
    const f = await createLocalAuthFixture();
    cleanups.push(f.cleanup);
    const core = f.createCore();
    await core.commitExternalLogin(({ generation, loginEpoch }) => credential(generation, loginEpoch, 'x'));
    await expect(core.logout({ revoke: true })).resolves.toMatchObject({ status: 'anonymous' });
    const store = new FileStore({ authHome: f.namespace.namespaceHome });
    await expect(store.get(f.namespace.credentialKey)).resolves.toBeNull();
    expect((await core.getStatus()).status).toBe('anonymous');
  });
});
