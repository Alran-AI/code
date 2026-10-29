import { createHash, randomBytes } from 'node:crypto';

import {
  ALRAN_KEYCLOAK_AUDIENCE,
  ALRAN_KEYCLOAK_CLIENT_ID,
  ALRAN_KEYCLOAK_SCOPES,
} from './contracts.js';
import { OAuthProtocolError } from './oauth-client.js';

/** Result of starting an authorization code flow. */
export interface AuthorizationCodeStartResult {
  /** Full authorization URL to open in the browser. */
  readonly authorizeUrl: string;
  /** PKCE code verifier, needed to exchange the code. Keep secret. */
  readonly codeVerifier: string;
  /** OAuth state parameter, used to validate the callback. */
  readonly state: string;
}

/** Result of exchanging an authorization code for tokens. */
export interface AuthorizationCodeTokenGrant {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  scopes: string[];
  audience: string;
  expiresInSec: number;
  subject?: string;
  accountId?: string;
}

/** Options for the authorization code client. */
export interface AuthorizationCodeClientOptions {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  redirectUri: string;
  clientId?: string;
  scopes?: readonly string[];
  audience?: string;
  fetchImpl?: typeof fetch;
}

/** Client for OAuth 2.0 Authorization Code Flow with PKCE (RFC 7636). */
export class AuthorizationCodeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly redirectUri: string;
  private readonly clientId: string;
  private readonly scopes: string[];
  private readonly audience: string;

  constructor(private readonly options: AuthorizationCodeClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.redirectUri = options.redirectUri;
    this.clientId = options.clientId ?? ALRAN_KEYCLOAK_CLIENT_ID;
    this.scopes = options.scopes ? [...options.scopes] : [...ALRAN_KEYCLOAK_SCOPES];
    this.audience = options.audience ?? ALRAN_KEYCLOAK_AUDIENCE;
  }

  /**
   * Start an authorization code flow.
   *
   * Generates a PKCE code verifier and challenge, builds the authorization URL
   * that the user's browser should be opened to. The caller must retain
   * `codeVerifier` and `state` to validate the callback and exchange the code.
   */
  async startAuthorizationCodeFlow(): Promise<AuthorizationCodeStartResult> {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
    const state = randomBytes(16).toString('base64url');

    const url = new URL(this.options.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', this.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (this.audience) url.searchParams.set('audience', this.audience);

    return {
      authorizeUrl: url.toString(),
      codeVerifier,
      state,
    };
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * Validates the state parameter against the expected state to prevent CSRF.
   */
  async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    expectedState?: string,
    state?: string,
  ): Promise<AuthorizationCodeTokenGrant> {
    if (expectedState !== undefined && state !== undefined && state !== expectedState) {
      throw new OAuthProtocolError('state_mismatch');
    }

    const body = await this.postForm(this.options.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier,
    });

    return parseAuthorizationCodeTokenGrant(body);
  }

  async refreshToken(refreshToken: string): Promise<AuthorizationCodeTokenGrant> {
    const body = await this.postForm(this.options.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      scope: this.scopes.join(' '),
      audience: this.audience,
    });
    return parseAuthorizationCodeTokenGrant(body, refreshToken);
  }

  async revokeToken(token: string): Promise<void> {
    const response = await this.postFormAllowOAuthError(
      this.options.revocationEndpoint,
      {
        token,
        token_type_hint: 'refresh_token',
        client_id: this.clientId,
      },
      { allowEmptySuccess: true },
    );
    if (!response.ok) {
      throw new OAuthProtocolError(
        response.error ?? 'oauth_request_failed',
        undefined,
        response.status,
      );
    }
  }

  private async postForm(
    endpoint: string,
    values: Record<string, string>,
    options: OAuthHttpRequestOptions = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.postFormAllowOAuthError(endpoint, values, options);
    if (!response.ok)
      throw new OAuthProtocolError(
        response.error ?? 'oauth_request_failed',
        undefined,
        response.status,
      );
    return response.body;
  }

  private async postFormAllowOAuthError(
    endpoint: string,
    values: Record<string, string>,
    options: OAuthHttpRequestOptions = {},
  ): Promise<{ ok: boolean; status: number; body: Record<string, unknown>; error?: string }> {
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        ...options.headers,
      },
      body: new URLSearchParams(values),
      signal: options.signal,
    });
    const body = asRecord(await response.json().catch(() => undefined));
    if (!body && response.ok && options.allowEmptySuccess)
      return { ok: true, status: response.status, body: {} };
    if (!body) throw new OAuthProtocolError('invalid_json_response', undefined, response.status);
    const error = readString(body, 'error');
    return {
      ok: response.ok && !error,
      status: response.status,
      body,
      ...(error ? { error } : {}),
    };
  }
}

interface OAuthHttpRequestOptions {
  headers?: Record<string, string>;
  allowEmptySuccess?: boolean;
  signal?: AbortSignal;
}

function parseAuthorizationCodeTokenGrant(
  body: Record<string, unknown>,
  previousRefreshToken?: string,
): AuthorizationCodeTokenGrant {
  const accessToken = readString(body, 'access_token');
  const refreshToken = readString(body, 'refresh_token') ?? previousRefreshToken;
  const tokenType = readString(body, 'token_type');
  const expiresInSec = readPositiveNumber(body, 'expires_in');
  const claims = accessToken ? decodeJwtPayload(accessToken) : undefined;
  const scopes = parseScopes(body.scope ?? claims?.scope ?? claims?.scp);
  if (
    !accessToken ||
    !refreshToken ||
    tokenType?.toLowerCase() !== 'bearer' ||
    !expiresInSec ||
    !scopes.includes(ALRAN_KEYCLOAK_SCOPES[0])
  ) {
    throw new OAuthProtocolError('invalid_token_response');
  }
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    scopes,
    audience: ALRAN_KEYCLOAK_AUDIENCE,
    expiresInSec,
    ...(readString(claims, 'sub') ? { subject: readString(claims, 'sub') } : {}),
    ...(readString(claims, 'account_id') ? { accountId: readString(claims, 'account_id') } : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) return undefined;
  try {
    return asRecord(JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

function parseScopes(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/\s+/u).filter(Boolean);
  if (Array.isArray(value) && value.every((scope) => typeof scope === 'string')) return value;
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function readPositiveNumber(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  const candidate = record?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    ? candidate
    : undefined;
}
