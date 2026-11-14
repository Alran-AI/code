import { describe, expect, it } from 'vitest';

import {
  AuthorizationCodeClient,
  type AuthorizationCodeClientOptions,
} from '../src/authorization-code-client.js';

const BASE_OPTIONS: AuthorizationCodeClientOptions = {
  authorizationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/auth',
  tokenEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/token',
  revocationEndpoint: 'https://auth.ottili.one/realms/alran/protocol/openid-connect/revoke',
  redirectUri: 'http://127.0.0.1:54321/callback',
  fetchImpl: async (url: string, init: RequestInit) => {
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
      if (body.get('grant_type') === 'refresh_token') {
        return Response.json({
          access_token: 'test-access-token-2',
          refresh_token: 'test-refresh-token-2',
          token_type: 'Bearer',
          scope: 'openid profile email agent.default',
          expires_in: 3600,
        });
      }
    }
    return new Response(JSON.stringify({ error: 'unknown' }), { status: 400 });
  },
};

describe('AuthorizationCodeClient', () => {
  it('builds an authorization URL with PKCE parameters', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    const result = await client.startAuthorizationCodeFlow();

    expect(result.authorizeUrl).toContain('https://auth.ottili.one/realms/alran/protocol/openid-connect/auth');
    expect(result.authorizeUrl).toContain('response_type=code');
    expect(result.authorizeUrl).toContain('client_id=alran-public');
    expect(result.authorizeUrl).toContain('redirect_uri=');
    expect(result.authorizeUrl).toContain('scope=');
    expect(result.authorizeUrl).toContain('state=');
    expect(result.authorizeUrl).toContain('code_challenge=');
    expect(result.authorizeUrl).toContain('code_challenge_method=S256');
    expect(result.codeVerifier).toBeDefined();
    expect(result.state).toBeDefined();
    expect(result.codeVerifier.length).toBeGreaterThan(0);
    expect(result.state.length).toBeGreaterThan(0);
  });

  it('exchanges an authorization code for tokens', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    const result = await client.startAuthorizationCodeFlow();

    const grant = await client.exchangeCodeForToken('test-code', result.codeVerifier);

    expect(grant.accessToken).toBe('test-access-token');
    expect(grant.refreshToken).toBe('test-refresh-token');
    expect(grant.tokenType).toBe('Bearer');
    expect(grant.expiresInSec).toBe(3600);
    expect(grant.scopes).toContain('openid');
  });

  it('rejects state mismatch', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    await expect(
      client.exchangeCodeForToken('test-code', 'verifier', 'expected-state', 'wrong-state'),
    ).rejects.toThrow(/state_mismatch/);
  });

  it('rejects a callback that carries no state when one was expected', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    await expect(
      client.exchangeCodeForToken('test-code', 'verifier', 'expected-state', undefined),
    ).rejects.toThrow(/state_mismatch/);
  });

  it('accepts the matching state, and skips the check only when none was expected', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    await expect(client.exchangeCodeForToken('c', 'v', 'same', 'same')).resolves.toMatchObject({ accessToken: 'test-access-token' });
    await expect(client.exchangeCodeForToken('c', 'v')).resolves.toMatchObject({ accessToken: 'test-access-token' });
  });

  it('refreshes tokens', async () => {
    const client = new AuthorizationCodeClient(BASE_OPTIONS);
    const grant = await client.refreshToken('test-refresh-token');

    expect(grant.accessToken).toBe('test-access-token-2');
    expect(grant.refreshToken).toBe('test-refresh-token-2');
  });
});
