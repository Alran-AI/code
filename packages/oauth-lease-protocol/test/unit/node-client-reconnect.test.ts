import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AuthLeaseFrameDecoder,
  createAuthLeaseSuccessResponse,
  createNodeAuthLeaseClient,
  encodeAuthLeaseFrame,
  resolveAuthLeaseEndpoint,
} from '../../src/index.js';

const CAPABILITY = 'A'.repeat(43);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** A broker that hands every connection to `onConnection` and nothing else. */
async function startBroker(onConnection: (socket: net.Socket, index: number) => void) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'alt-'));
  const endpoint = resolveAuthLeaseEndpoint(dataDir);
  await mkdir(path.dirname(endpoint.endpoint), { recursive: true, mode: 0o700 });
  await writeFile(endpoint.capabilityFile, CAPABILITY, { mode: 0o600 });
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    onConnection(socket, connections++);
  });
  await new Promise<void>((resolve) => server.listen(endpoint.endpoint, resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { endpoint, sockets };
}

/** Reads request frames from a connection. */
function frames(socket: net.Socket, onRequest: (request: { requestId: string }) => void): void {
  const decoder = new AuthLeaseFrameDecoder();
  socket.on('data', (chunk) => {
    for (const frame of decoder.push(chunk)) onRequest(frame as { requestId: string });
  });
}

describe('node auth lease client across a reconnect', () => {
  it.skipIf(process.platform === 'win32')(
    'fails the request of a dropped connection and serves the next one on a new connection',
    async () => {
      const broker = await startBroker((socket, index) => {
        frames(socket, ({ requestId }) => {
          // The first connection takes the request and is dropped; the second answers.
          if (index === 0) {
            socket.destroy();
            return;
          }
          socket.write(
            encodeAuthLeaseFrame(
              createAuthLeaseSuccessResponse(requestId, {
                method: 'status',
                status: 'authenticated',
                generation: 7,
              }),
            ),
          );
        });
      });
      const client = createNodeAuthLeaseClient({
        endpoint: broker.endpoint.endpoint,
        capabilityFile: broker.endpoint.capabilityFile,
        requestTimeoutMs: 2_000,
      });
      cleanups.push(async () => client.close());

      await expect(client.getStatus()).rejects.toMatchObject({ code: 'BROKER_UNAVAILABLE' });

      // The late `close` of the first connection must not take this request down with it.
      const answer = await client.getStatus();
      expect(answer).toEqual({ method: 'status', status: 'authenticated', generation: 7 });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not accept an answer for a request that was written to a different connection',
    async () => {
      let first: net.Socket | undefined;
      let heldRequestId: string | undefined;
      const broker = await startBroker((socket, index) => {
        if (index === 0) first = socket;
        frames(socket, ({ requestId }) => {
          if (index === 0) {
            heldRequestId = requestId;
            return;
          }
        });
      });
      const client = createNodeAuthLeaseClient({
        endpoint: broker.endpoint.endpoint,
        capabilityFile: broker.endpoint.capabilityFile,
        requestTimeoutMs: 400,
      });
      cleanups.push(async () => client.close());

      const pending = client.getStatus();
      await expect.poll(() => heldRequestId).toBeDefined();
      // Answered on the right connection it resolves; the client must be listening on that one.
      first?.write(
        encodeAuthLeaseFrame(
          createAuthLeaseSuccessResponse(heldRequestId as string, {
            method: 'status',
            status: 'anonymous',
            generation: 0,
          }),
        ),
      );
      await expect(pending).resolves.toEqual({ method: 'status', status: 'anonymous', generation: 0 });
    },
  );
});
