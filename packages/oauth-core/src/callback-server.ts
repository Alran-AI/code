import { createServer, type Server as HttpServer } from 'node:http';

import { AuthorizationCodeClient, type AuthorizationCodeStartResult } from './authorization-code-client.js';
import { OAuthProtocolError } from './oauth-client.js';

/** Result of a completed login via the callback server. */
export interface CallbackLoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSec: number;
  readonly scopes: string[];
  readonly subject?: string;
  readonly accountId?: string;
}

/** Options for the callback server. */
export interface CallbackServerOptions {
  /** Port to listen on. Pass 0 to let the OS assign a free port. */
  readonly port?: number;
  /** Host to bind to. Defaults to 127.0.0.1. */
  readonly host?: string;
  /** Base URL of the callback server (e.g. http://127.0.0.1:54321). */
  readonly baseUrl: string;
  /** Authorization code client (optional; can be set later with setClient). */
  readonly client?: AuthorizationCodeClient;
  /** Expected state value for CSRF protection. */
  readonly expectedState: string;
  /** Called when a login completes successfully. */
  readonly onLogin?: (result: CallbackLoginResult) => void | Promise<void>;
  /** Called when a login fails. */
  readonly onError?: (error: Error) => void | Promise<void>;
}

/** HTML shown on the login page while waiting for the browser redirect. */
function loginPage(authorizeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in to Alran Code</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1f2937; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
  h1 { font-size: 20px; margin: 0 0 16px; }
  p { font-size: 14px; color: #4b5563; margin: 0 0 24px; line-height: 1.5; }
  .btn { display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; }
  .btn:hover { background: #374151; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 24px; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in to Alran Code</h1>
  <p>You will be redirected to the Ottili Platform to complete sign in.</p>
  <a class="btn" href="${escapeHtml(authorizeUrl)}">Continue to sign in</a>
  <p class="hint">If you are not redirected automatically, click the button above.</p>
</div>
<script>
  (function() {
    const url = "${escapeHtml(authorizeUrl)}";
    if (url) window.location.replace(url);
  })();
</script>
</body>
</html>`;
}

/** HTML shown after a successful login. */
function successPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signed in</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1f2937; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
  h1 { font-size: 20px; margin: 0 0 16px; color: #15803d; }
  p { font-size: 14px; color: #4b5563; margin: 0; }
</style>
</head>
<body>
<div class="card">
  <h1>Signed in successfully</h1>
  <p>You can close this window and return to Alran Code.</p>
</div>
<script>
  window.close?.();
</script>
</body>
</html>`;
}

/** HTML shown after a failed login. */
function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in failed</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1f2937; }
  .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 40px; max-width: 400px; text-align: center; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
  h1 { font-size: 20px; margin: 0 0 16px; color: #b91c1c; }
  p { font-size: 14px; color: #4b5563; margin: 0; white-space: pre-wrap; }
</style>
</head>
<body>
<div class="card">
  <h1>Sign in failed</h1>
  <p>${escapeHtml(message)}</p>
</div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * A local HTTP server that hosts the OAuth 2.0 authorization code callback.
 *
 * Routes:
 *   GET /login      - starts the authorization code flow, redirects to keycloak
 *   GET /callback   - keycloak redirects here with `?code=` and `?state=`
 *   GET /           - simple status page
 */
export class CallbackServer {
  private server: HttpServer | null = null;
  private listenedPort: number | null = null;
  private readonly host: string;
  private readonly baseUrl: string;
  private client: AuthorizationCodeClient | null = null;
  private readonly expectedState: string;
  private readonly onLogin?: CallbackServerOptions['onLogin'];
  private readonly onError?: CallbackServerOptions['onError'];
  private startResult: AuthorizationCodeStartResult | null = null;
  private resolveLogin: ((value: CallbackLoginResult) => void) | null = null;
  private rejectLogin: ((error: Error) => void) | null = null;

  constructor(options: CallbackServerOptions) {
    this.listenedPort = options.port ?? 0;
    this.host = options.host ?? '127.0.0.1';
    this.baseUrl = options.baseUrl;
    this.expectedState = options.expectedState;
    this.onLogin = options.onLogin;
    this.onError = options.onError;
    if (options.client) this.setClient(options.client);
  }

  /** Set the authorization code client (call after start() to know the redirect port). */
  setClient(client: AuthorizationCodeClient): void {
    this.client = client;
  }

  /** The port the server is listening on (null until started). */
  get port(): number | null {
    return this.listenedPort;
  }

  /** Start the server and return the base URL it is listening on. */
  async start(): Promise<string> {
    const listenPort = this.listenedPort ?? 0;
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.once('error', reject);
      this.server.listen(listenPort, this.host, () => {
        this.server!.once('error', () => {});
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.listenedPort = address.port;
        }
        resolve(`${this.baseUrl.split('://')[0]}://${this.host}:${this.listenedPort}`);
      });
    });
  }

  /** Start the authorization code flow and return the authorization URL. */
  async beginLogin(): Promise<string> {
    if (!this.client) throw new Error('Authorization code client not set.');
    this.startResult = await this.client.startAuthorizationCodeFlow();
    return this.startResult.authorizeUrl;
  }

  /** Wait for the callback to complete and return the login result. */
  waitForLogin(): Promise<CallbackLoginResult> {
    return new Promise((resolve, reject) => {
      this.resolveLogin = resolve;
      this.rejectLogin = reject;
    });
  }

  /** Close the server. */
  close(): Promise<void> {
    if (!this.server) return Promise.resolve();
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  private async handleRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${this.host}`);
    const path = url.pathname;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    try {
      if (path === '/login') {
        if (!this.startResult) {
          await this.beginLogin();
        }
        res.statusCode = 200;
        res.end(loginPage(this.startResult!.authorizeUrl));
        return;
      }

      if (path === '/callback') {
        await this.handleCallback(url, res);
        return;
      }

      if (path === '/') {
        res.statusCode = 200;
        res.end(
          '<html><body><p>Alran Code OAuth callback server.</p><p><a href="/login">Sign in</a></p></body></html>',
        );
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    } catch (error) {
      const err = error as Error;
      res.statusCode = 500;
      res.end(errorPage(err.message));
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
    }
  }

  private async handleCallback(
    url: URL,
    res: import('node:http').ServerResponse,
  ): Promise<void> {
    const code = url.searchParams.get('code') ?? undefined;
    const state = url.searchParams.get('state') ?? undefined;
    const error = url.searchParams.get('error') ?? undefined;
    const errorDescription = url.searchParams.get('error_description') ?? undefined;

    if (error) {
      const message = errorDescription ?? error;
      res.statusCode = 400;
      res.end(errorPage(`Keycloak returned an error: ${escapeHtml(message)}`));
      const err = new OAuthProtocolError(error, message);
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    if (!code || !state) {
      res.statusCode = 400;
      res.end(errorPage('Missing authorization code or state parameter.'));
      const err = new Error('Missing authorization code or state parameter.');
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    if (state !== this.expectedState) {
      res.statusCode = 400;
      res.end(errorPage('State mismatch — possible CSRF attack.'));
      const err = new OAuthProtocolError('state_mismatch');
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    let result: CallbackLoginResult;
    try {
      const grant = await this.client!.exchangeCodeForToken(code, this.startResult?.codeVerifier ?? '', this.expectedState, state);
      result = {
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresInSec: grant.expiresInSec,
        scopes: grant.scopes,
        ...(grant.subject ? { subject: grant.subject } : {}),
        ...(grant.accountId ? { accountId: grant.accountId } : {}),
      };
    } catch (error) {
      const err = error as Error;
      res.statusCode = 500;
      res.end(errorPage(`Failed to exchange code for tokens: ${escapeHtml(err.message)}`));
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    res.statusCode = 200;
    res.end(successPage());

    void this.onLogin?.(result);
    if (this.resolveLogin) {
      this.resolveLogin(result);
      this.resolveLogin = null;
      this.rejectLogin = null;
    }
  }
}
