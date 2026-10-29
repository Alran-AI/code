import { describe, expect, it, vi } from 'vitest';

import { CallbackServer } from '../src/callback-server.js';
import { AuthorizationCodeClient } from '../src/authorization-code-client.js';

const mockFetch = vi.fn(async (url: string, init: RequestInit) => {
  const u = String(url);
  if (u.endsWith('/token')) {
    const body = init?.body as URLSearchParams;
    if (body.get('grant_type') === 'authorization_code') {
      return Response.json({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'Bearer',
        scope: 'openid profile email agent.default',
        expires_in: 3600,
      });
    }
  }
  return new Response(JSON.stringify({ error: 'unknown' }), { status: 400 });
});

function createClient(options: { redirectUri: string }): AuthorizationCodeClient {
  return new AuthorizationCodeClient({
    authorizationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/auth',
    tokenEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/token',
    revocationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/revoke',
    redirectUri: options.redirectUri,
    fetchImpl: mockFetch,
  });
}

describe('CallbackServer', () => {
  it('serves /login with an authorization URL', async () => {
    const client = createClient({ redirectUri: 'http://127.0.0.1:0/callback' });
    const state = 'test-state-123';
    const server = new CallbackServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1',
      expectedState: state,
    });
    server.setClient(client);

    const serverUrl = await server.start();
    const port = server.port;
    expect(port).not.toBeNull();

    // Update the client with the correct redirect URI after we know the port.
    const actualClient = new AuthorizationCodeClient({
      authorizationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/auth',
      tokenEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/token',
      revocationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/revoke',
      redirectUri: `${serverUrl}/callback`,
      fetchImpl: mockFetch,
    });
    server.setClient(actualClient);

    const authorizeUrl = await server.beginLogin();
    expect(authorizeUrl).toContain('https://auth.ottili.one');
    expect(authorizeUrl).toContain('response_type=code');
    expect(authorizeUrl).toContain('code_challenge_method=S256');

    await server.close();
  });

  it('exchanges code for tokens on /callback', async () => {
    const state = 'test-state-456';
    let loginResult: { accessToken: string } | null = null;

    const server = new CallbackServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1',
      expectedState: state,
      onLogin: (result) => {
        loginResult = result;
      },
    });

    await server.start();
    const port = server.port;
    expect(port).not.toBeNull();

    const client = new AuthorizationCodeClient({
      authorizationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/auth',
      tokenEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/token',
      revocationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/revoke',
      redirectUri: `http://127.0.0.1:${port}/callback`,
      fetchImpl: mockFetch,
    });
    server.setClient(client);

    const startResult = await client.startAuthorizationCodeFlow();

    // Wait for login before simulating the callback, so the promise is ready.
    const loginPromise = server.waitForLogin();

    // Simulate the keycloak callback by fetching the /callback URL directly.
    const callbackUrl = `http://127.0.0.1:${port}/callback?code=test-code&state=${state}`;
    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);

    await loginPromise;

    expect(loginResult).not.toBeNull();
    expect(loginResult!.accessToken).toBe('test-access-token');

    await server.close();
  });

  it('rejects state mismatch on /callback', async () => {
    const state = 'expected-state';
    const server = new CallbackServer({
      port: 0,
      host: '127.0.0.1',
      baseUrl: 'http://127.0.0.1',
      expectedState: state,
    });

    await server.start();
    const port = server.port;
    expect(port).not.toBeNull();

    const callbackUrl = `http://127.0.0.1:${port}/callback?code=test-code&state=wrong-state`;
    const response = await fetch(callbackUrl);
    expect(response.status).toBe(400);

    await server.close();
  });
});
