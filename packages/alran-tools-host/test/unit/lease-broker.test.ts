import { mkdtemp, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { createNodeAuthLeaseClient } from '@alran/oauth-lease-protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { startAlranToolsAuthLeaseBroker } from '../../src/lease-broker.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('alran-tools auth lease broker', () => {
  it('serves fixed leases and removes the private capability on dispose', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'mtb-'));
    const stopWatching = vi.fn();
    const broker = await startAlranToolsAuthLeaseBroker({
      dataDir,
      session: {
        getStatus: async () => ({ status: 'authenticated', generation: 3 }),
        getAccessToken: async () => ({
          accessToken: 'at-3',
          expiresAtMs: Date.now() + 120_000,
          generation: 3,
          audience: 'agent-backend',
          scopes: ['agent.default'],
        }),
        handleUnauthorized: async () => 'retry',
        watch: () => stopWatching,
      },
    });
    cleanups.push(() => broker.dispose());
    const client = createNodeAuthLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    });
    cleanups.push(async () => client.close());

    await expect(client.getLease(30_000)).resolves.toMatchObject({
      accessToken: 'at-3',
      generation: 3,
      audience: 'agent-backend',
      scopes: ['agent.default'],
    });
    expect((await readFile(broker.capabilityFile, 'utf8')).trim()).toHaveLength(43);
    if (process.platform !== 'win32') {
      expect((await stat(broker.capabilityFile)).mode & 0o777).toBe(0o600);
    }

    await broker.dispose();
    await expect(stat(broker.capabilityFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(stopWatching).toHaveBeenCalledOnce();
  });

  it('rejects a lease outside the fixed audience contract', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'mtb-'));
    const broker = await startAlranToolsAuthLeaseBroker({
      dataDir,
      session: {
        getStatus: async () => ({ status: 'authenticated', generation: 1 }),
        getAccessToken: async () => ({
          accessToken: 'wrong-at',
          expiresAtMs: Date.now() + 120_000,
          generation: 1,
          audience: 'wrong-audience' as 'agent-backend',
          scopes: ['agent.default'],
        }),
        handleUnauthorized: async () => 'logout',
        watch: () => () => undefined,
      },
    });
    cleanups.push(() => broker.dispose());
    const client = createNodeAuthLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    });
    cleanups.push(async () => client.close());

    await expect(client.getLease(30_000)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('asks the token endpoint once, not in a loop, for a token shorter-lived than requested', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'mtb-'));
    const getAccessToken = vi.fn(async () => ({
      accessToken: 'short-at',
      expiresAtMs: Date.now() + 5_000,
      generation: 2,
      audience: 'agent-backend' as const,
      scopes: ['agent.default'] as ['agent.default'],
    }));
    const broker = await startAlranToolsAuthLeaseBroker({
      dataDir,
      session: {
        getStatus: async () => ({ status: 'authenticated', generation: 2 }),
        getAccessToken,
        handleUnauthorized: async () => 'retry',
        watch: () => () => undefined,
      },
    });
    cleanups.push(() => broker.dispose());
    const client = createNodeAuthLeaseClient({
      endpoint: broker.endpoint,
      capabilityFile: broker.capabilityFile,
    });
    cleanups.push(async () => client.close());

    await expect(client.getLease(60_000)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    // A request the same token does satisfy still works.
    await expect(client.getLease(1_000)).resolves.toMatchObject({ accessToken: 'short-at' });
  });
});
