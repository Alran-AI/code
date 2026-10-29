import { createServer, type Server as HttpServer } from 'node:http';

import { AuthorizationCodeClient, type AuthorizationCodeStartResult } from './authorization-code-client.js';
import { OAuthProtocolError } from './oauth-client.js';
import { platformOidcLoginUrl, platformOidcRedeem, type PlatformSession } from './platform-oauth.js';

/** Result of a completed login via the callback server. */
export interface CallbackLoginResult {
  /** OAuth 2.0 token grant (when not using Platform OIDC). */
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly expiresInSec?: number;
  readonly scopes?: string[];
  readonly subject?: string;
  readonly accountId?: string;
  /** Platform session (when using Platform OIDC). */
  readonly platformSession?: PlatformSession;
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
  /** Expected state value for CSRF protection (OAuth 2.0 flow only). */
  readonly expectedState?: string;
  /** Platform OIDC options: when set, the /login page redirects to the
   *  Platform's `/v2/auth/oidc/login` (Keycloak), and the /callback redeems
   *  the one-time handoff code via the Platform's `/__dev/oidc/redeem`. */
  readonly platformOidc?: {
    /** The Platform base URL this process reaches (e.g. http://127.0.0.1:18150). */
    readonly platformBaseUrl: string;
  };
  /** Called when a login completes successfully. */
  readonly onLogin?: (result: CallbackLoginResult) => void | Promise<void>;
  /** Called when a login fails. */
  readonly onError?: (error: Error) => void | Promise<void>;
}

/** HTML shown on the login page while waiting for the browser redirect. */
function loginPage(authorizeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Anmelden – Alran Code</title>
<link rel="stylesheet" href="https://unpkg.com/@ottili/foundation-ui@2.0.0-alpha.1/dist/styles.css" />
<style>
  :root {
    --ottili-auth-max-width: 380px;
    --ottili-auth-card-radius: var(--ottili-radius-md, 12px);
  }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    background: var(--ottili-color-surface-canvas, #f4f5f7);
    color: var(--ottili-color-text-primary, #16181d);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .ottili-auth-shell {
    width: min(var(--ottili-auth-max-width), calc(100vw - 32px));
  }
  .ottili-auth-shell__sign-in {
    background: var(--ottili-color-surface-raised, #ffffff);
    border: 1px solid var(--ottili-color-border-default, #d9dce3);
    border-radius: var(--ottili-auth-card-radius);
    padding: var(--ottili-space-page, 32px);
    box-shadow: var(--ottili-elevation-raised, 0 4px 6px -1px rgb(0 0 0 / 0.1));
  }
  .ottili-auth-heading {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    font-size: var(--ottili-type-h2-size, 22px);
    line-height: var(--ottili-type-h2-line, 1.3);
    margin: 0 0 8px;
    color: var(--ottili-color-text-primary, #16181d);
  }
  .ottili-auth-shell__sign-in p {
    margin: 0 0 24px;
    color: var(--ottili-color-text-secondary, #4a5060);
    line-height: var(--ottili-type-body-line, 1.5);
  }
  .ottili-auth-button {
    width: 100%;
    display: block;
    text-align: center;
    padding: 10px 14px;
    border-radius: var(--ottili-radius-sm, 8px);
    background: var(--ottili-color-text-primary, #0a7d3b);
    color: var(--ottili-color-text-inverse, #ffffff);
    border: none;
    font-family: inherit;
    font-size: var(--ottili-type-body-size, 14px);
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .ottili-auth-button:hover {
    opacity: 0.9;
  }
  .ottili-auth-button:focus-visible {
    outline: 2px solid var(--ottili-color-focus-ring, #0a7d3b);
    outline-offset: 2px;
  }
  .hint {
    margin-top: 24px;
    font-size: 12px;
    color: var(--ottili-color-text-secondary, #6b7180);
  }
</style>
</head>
<body>
<div class="ottili-auth-shell" data-ottili-state="signed_out">
  <div class="ottili-auth-shell__sign-in">
    <h2 class="ottili-auth-heading">Anmelden</h2>
    <p>Du wirst zur Ottili Platform weitergeleitet, um die Anmeldung abzuschließen.</p>
    <a class="ottili-auth-button" href="${escapeHtml(authorizeUrl)}">Weiter zur Anmeldung</a>
    <p class="hint">Wenn du nicht automatisch weitergeleitet wirst, klicke auf den Button oben.</p>
  </div>
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
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Angemeldet – Alran Code</title>
<link rel="stylesheet" href="https://unpkg.com/@ottili/foundation-ui@2.0.0-alpha.1/dist/styles.css" />
<style>
  :root {
    --ottili-auth-max-width: 380px;
    --ottili-auth-card-radius: var(--ottili-radius-md, 12px);
  }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    background: var(--ottili-color-surface-canvas, #f4f5f7);
    color: var(--ottili-color-text-primary, #16181d);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .ottili-auth-shell {
    width: min(var(--ottili-auth-max-width), calc(100vw - 32px));
  }
  .ottili-auth-shell__sign-in {
    background: var(--ottili-color-surface-raised, #ffffff);
    border: 1px solid var(--ottili-color-border-default, #d9dce3);
    border-radius: var(--ottili-auth-card-radius);
    padding: var(--ottili-space-page, 32px);
    box-shadow: var(--ottili-elevation-raised, 0 4px 6px -1px rgb(0 0 0 / 0.1));
    text-align: center;
  }
  .ottili-auth-heading {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    font-size: var(--ottili-type-h2-size, 22px);
    line-height: var(--ottili-type-h2-line, 1.3);
    margin: 0 0 16px;
    color: var(--ottili-color-text-primary, #16181d);
  }
  .ottili-auth-shell__sign-in p {
    margin: 0;
    color: var(--ottili-color-text-secondary, #4a5060);
    line-height: var(--ottili-type-body-line, 1.5);
  }
</style>
</head>
<body>
<div class="ottili-auth-shell" data-ottili-state="active">
  <div class="ottili-auth-shell__sign-in">
    <h2 class="ottili-auth-heading" style="color: var(--ottili-color-text-primary, #15803d);">Erfolgreich angemeldet</h2>
    <p>Du kannst dieses Fenster schließen und zu Alran Code zurückkehren.</p>
  </div>
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
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Anmeldung fehlgeschlagen – Alran Code</title>
<link rel="stylesheet" href="https://unpkg.com/@ottili/foundation-ui@2.0.0-alpha.1/dist/styles.css" />
<style>
  :root {
    --ottili-auth-max-width: 380px;
    --ottili-auth-card-radius: var(--ottili-radius-md, 12px);
  }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    background: var(--ottili-color-surface-canvas, #f4f5f7);
    color: var(--ottili-color-text-primary, #16181d);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .ottili-auth-shell {
    width: min(var(--ottili-auth-max-width), calc(100vw - 32px));
  }
  .ottili-auth-shell__sign-in {
    background: var(--ottili-color-surface-raised, #ffffff);
    border: 1px solid var(--ottili-color-border-danger, #f3b8b2);
    border-radius: var(--ottili-auth-card-radius);
    padding: var(--ottili-space-page, 32px);
    box-shadow: var(--ottili-elevation-raised, 0 4px 6px -1px rgb(0 0 0 / 0.1));
  }
  .ottili-auth-heading {
    font-family: var(--ottili-font-sans, system-ui, -apple-system, sans-serif);
    font-size: var(--ottili-type-h2-size, 22px);
    line-height: var(--ottili-type-h2-line, 1.3);
    margin: 0 0 16px;
    color: var(--ottili-color-text-danger, #8a1c12);
  }
  .ottili-auth-shell__sign-in p {
    margin: 0;
    color: var(--ottili-color-text-secondary, #4a5060);
    line-height: var(--ottili-type-body-line, 1.5);
    white-space: pre-wrap;
  }
</style>
</head>
<body>
<div class="ottili-auth-shell" data-ottili-state="signed_out">
  <div class="ottili-auth-shell__sign-in">
    <h2 class="ottili-auth-heading">Anmeldung fehlgeschlagen</h2>
    <p>${escapeHtml(message)}</p>
  </div>
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
 * A local HTTP server that hosts the OAuth 2.0 / Platform OIDC callback.
 *
 * Routes:
 *   GET /login      - starts the sign-in flow, presents a page that redirects
 *                     to Keycloak (OAuth 2.0) or the Platform's OIDC endpoint
 *   GET /callback   - Keycloak/Platform redirects here with `?code=` (and
 *                     `?state=` for OAuth 2.0)
 *   GET /           - simple status page
 *
 * When `platformOidc` is configured, the callback is a Platform OIDC handoff:
 * the one-time code is redeemed via the Platform's `/__dev/oidc/redeem` for a
 * Platform session (session_id, company_id, base_url).
 */
export class CallbackServer {
  private server: HttpServer | null = null;
  private listenedPort: number | null = null;
  private readonly host: string;
  private readonly baseUrl: string;
  private client: AuthorizationCodeClient | null = null;
  private readonly expectedState?: string;
  private readonly platformOidc?: CallbackServerOptions['platformOidc'];
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
    this.platformOidc = options.platformOidc;
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

  /** Build the Platform OIDC authorize URL for the /login page. */
  platformOidcAuthorizeUrl(): string {
    if (!this.platformOidc) throw new Error('Platform OIDC is not configured.');
    const port = this.listenedPort ?? 0;
    const callback = `http://${this.host}:${port}/callback`;
    return platformOidcLoginUrl({
      platformOrigin: this.platformOidc.platformBaseUrl,
      callback,
    });
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
        let authorizeUrl: string;
        if (this.platformOidc) {
          authorizeUrl = this.platformOidcAuthorizeUrl();
        } else {
          if (!this.startResult) {
            await this.beginLogin();
          }
          authorizeUrl = this.startResult!.authorizeUrl;
        }
        res.statusCode = 200;
        res.end(loginPage(authorizeUrl));
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
      res.end(errorPage(`The auth server returned an error: ${escapeHtml(message)}`));
      const err = new OAuthProtocolError(error, message);
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    if (!code) {
      res.statusCode = 400;
      res.end(errorPage('Missing authorization code or handoff code.'));
      const err = new Error('Missing authorization code or handoff code.');
      void this.onError?.(err);
      if (this.rejectLogin) {
        this.rejectLogin(err);
        this.rejectLogin = null;
        this.resolveLogin = null;
      }
      return;
    }

    // OAuth 2.0 flow: validate state for CSRF protection.
    if (!this.platformOidc) {
      if (!state || state !== this.expectedState) {
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
    }

    let result: CallbackLoginResult;
    try {
      if (this.platformOidc) {
        // Platform OIDC: redeem the one-time handoff code for a Platform session.
        const session = await platformOidcRedeem(
          { platformBaseUrl: this.platformOidc.platformBaseUrl, code },
        );
        result = { platformSession: session };
      } else {
        // OAuth 2.0 authorization code: exchange code for tokens.
        const grant = await this.client!.exchangeCodeForToken(
          code,
          this.startResult?.codeVerifier ?? '',
          this.expectedState ?? '',
          state ?? '',
        );
        result = {
          accessToken: grant.accessToken,
          refreshToken: grant.refreshToken,
          expiresInSec: grant.expiresInSec,
          scopes: grant.scopes,
          ...(grant.subject ? { subject: grant.subject } : {}),
          ...(grant.accountId ? { accountId: grant.accountId } : {}),
        };
      }
    } catch (error) {
      const err = error as Error;
      res.statusCode = 500;
      res.end(errorPage(`Failed to complete sign in: ${escapeHtml(err.message)}`));
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
