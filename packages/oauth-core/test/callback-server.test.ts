import { createServer as createTcpServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CallbackServer, type CallbackLoginResult } from '../src/callback-server.js';
import { AuthorizationCodeClient } from '../src/authorization-code-client.js';
import {
  ALRAN_PLATFORM_OIDC_CALLBACK_URI,
  parsePlatformOidcCallbackUri,
  resolvePlatformOidcCallbackUri,
} from '../src/contracts.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

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

  it('parses the registered callback URI', () => {
    expect(parsePlatformOidcCallbackUri('http://127.0.0.1:18370/callback')).toEqual({
      uri: 'http://127.0.0.1:18370/callback',
      origin: 'http://127.0.0.1:18370',
      host: '127.0.0.1',
      port: 18370,
      path: '/callback',
    });
    expect(parsePlatformOidcCallbackUri('https://alran.example/auth/callback')).toMatchObject({
      origin: 'https://alran.example',
      host: 'alran.example',
      port: 443,
      path: '/auth/callback',
    });
  });

  it('refuses a callback URI the Platform could not have registered', () => {
    expect(() => parsePlatformOidcCallbackUri('not-a-url')).toThrow(/absolute URL/);
    expect(() => parsePlatformOidcCallbackUri('alran://callback')).toThrow(/http or https/);
    expect(() => parsePlatformOidcCallbackUri('http://user:pw@127.0.0.1:18370/callback')).toThrow(
      /credentials/,
    );
    expect(() => parsePlatformOidcCallbackUri('http://127.0.0.1:18370/callback?x=1')).toThrow(
      /query or fragment/,
    );
    expect(() => parsePlatformOidcCallbackUri('http://127.0.0.1:18370/callback#x')).toThrow(
      /query or fragment/,
    );
    expect(() => parsePlatformOidcCallbackUri('http://127.0.0.1:18370/')).toThrow(/callback path/);
  });

  it('uses ALRAN_OIDC_CALLBACK_URI before the built-in default', () => {
    vi.stubEnv('ALRAN_OIDC_CALLBACK_URI', '');
    vi.stubEnv('ALRAN_OIDC_CALLBACK_URI_DEV', '');
    vi.stubEnv('ALRAN_OIDC_CALLBACK_URI_PROD', '');
    expect(resolvePlatformOidcCallbackUri('prod')).toBe(ALRAN_PLATFORM_OIDC_CALLBACK_URI);

    vi.stubEnv('ALRAN_OIDC_CALLBACK_URI_PROD', 'http://127.0.0.1:19000/callback');
    expect(resolvePlatformOidcCallbackUri('prod')).toBe('http://127.0.0.1:19000/callback');
    expect(resolvePlatformOidcCallbackUri('dev')).toBe(ALRAN_PLATFORM_OIDC_CALLBACK_URI);

    vi.stubEnv('ALRAN_OIDC_CALLBACK_URI', 'http://127.0.0.1:19001/callback');
    expect(resolvePlatformOidcCallbackUri('prod')).toBe('http://127.0.0.1:19001/callback');
    expect(resolvePlatformOidcCallbackUri('dev')).toBe('http://127.0.0.1:19001/callback');
  });

  it('binds the registered callback URI and advertises it as return_to', async () => {
    const port = await freePort();
    const callbackUri = `http://127.0.0.1:${port}/auth/callback`;
    const server = new CallbackServer({
      baseUrl: `http://127.0.0.1:${port}`,
      callbackUri,
      platformOidc: { platformBaseUrl: 'https://platform.ottili.one' },
    });

    expect(await server.start()).toBe(`http://127.0.0.1:${port}`);
    expect(server.port).toBe(port);

    const authorize = new URL(server.platformOidcAuthorizeUrl());
    expect(authorize.origin).toBe('https://platform.ottili.one');
    expect(authorize.pathname).toBe('/v2/auth/oidc/login');
    expect(authorize.searchParams.get('return_to')).toBe(callbackUri);

    // The custom path is the one the Platform redirects to.
    const response = await fetch(`${callbackUri}?error=access_denied`);
    expect(response.status).toBe(400);

    await server.close();
  });

  it('redeems the Platform ottili_handoff callback parameter', async () => {
    const port = await freePort();
    const callbackUri = `http://127.0.0.1:${port}/callback`;
    const originalFetch = globalThis.fetch;
    const redeemed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/v2/auth/sessions/handoff')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string };
          redeemed.push(body.code ?? '');
          return Response.json({
            data: {
              session_id: 'sess_platform',
              company_id: 'co_platform',
              subject_id: 'usr_platform',
              base_url: 'https://platform.ottili.one',
            },
          });
        }
        return originalFetch(input, init);
      }),
    );

    let loginResult: CallbackLoginResult | null = null;
    const server = new CallbackServer({
      baseUrl: `http://127.0.0.1:${port}`,
      callbackUri,
      platformOidc: { platformBaseUrl: 'https://platform.ottili.one' },
      onLogin: (result) => {
        loginResult = result;
      },
    });

    await server.start();
    const loginPromise = server.waitForLogin();
    // This is the URL the Platform's callback redirects to: the code is
    // `ottili_handoff`, not the OAuth `code` parameter.
    const response = await originalFetch(`${callbackUri}?ottili_handoff=hnd_test-code`);
    expect(response.status).toBe(200);

    const result = await loginPromise;
    expect(redeemed).toEqual(['hnd_test-code']);
    expect(result.platformSession).toMatchObject({
      sessionId: 'sess_platform',
      companyId: 'co_platform',
      subjectId: 'usr_platform',
      baseUrl: 'https://platform.ottili.one',
    });
    expect(loginResult).not.toBeNull();

    await server.close();
  });
});
