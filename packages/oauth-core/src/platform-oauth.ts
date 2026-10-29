// @ottili/oauth-core — Platform OIDC login.
//
// Connects Alran Code to the Ottili AI Platform (alran-platform) through the
// Platform's OpenID Connect flow backed by Keycloak. The browser is sent to the
// Platform's `/v2/auth/oidc/login`, Keycloak renders the login, the Platform
// mints a session and hands the browser back with a one-time code
// (`/__dev/oidc/handoff`), and this code is redeemed server-to-server
// (`/__dev/oidc/redeem`) for a Platform session id. The password never reaches
// this code; the Platform session id stays in this process.

import { OAuthProtocolError } from './oauth-client.js';

/** The result of redeeming a Platform OIDC handoff code. */
export interface PlatformSession {
  readonly sessionId: string;
  readonly companyId: string;
  readonly subjectId: string;
  readonly baseUrl: string;
  readonly via: 'oidc';
}

/** Options for starting a Platform OIDC login. */
export interface PlatformOidcLoginOptions {
  /** The Platform base URL as the browser reaches it (e.g. https://api.alran.ai). */
  readonly platformOrigin: string;
  /** The callback URL the Platform redirects back to (e.g. http://127.0.0.1:54321/callback). */
  readonly callback: string;
  /** Optional Keycloak prompt (e.g. "login", "consent"). */
  readonly prompt?: string | null;
}

/** Options for redeeming a Platform OIDC handoff code. */
export interface PlatformOidcRedeemOptions {
  /** The Platform base URL as this process reaches it. */
  readonly platformBaseUrl: string;
  /** The one-time code from the handoff URL. */
  readonly code: string;
}

/**
 * Build the URL the browser should be opened to for Platform OIDC sign-in.
 *
 * The Platform's `/v2/auth/oidc/login` starts the Keycloak flow. The
 * `return_to` parameter tells the Platform where to hand the browser back
 * after a successful login, carrying the one-time redemption code.
 */
export function platformOidcLoginUrl(options: PlatformOidcLoginOptions): string {
  const handoff = `/__dev/oidc/handoff?to=${encodeURIComponent(options.callback)}`;
  const q = new URLSearchParams({ return_to: handoff });
  if (options.prompt) q.set('prompt', options.prompt);
  return `${options.platformOrigin.replace(/\/+$/, '')}/v2/auth/oidc/login?${q}`;
}

/**
 * Redeem a one-time Platform OIDC handoff code for a Platform session.
 *
 * Server-to-server call to the Platform's `__dev/oidc/redeem` endpoint.
 * Returns the session id, company id, subject id and base url of the session.
 */
export async function platformOidcRedeem(
  options: PlatformOidcRedeemOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformSession> {
  const res = await fetchImpl(`${options.platformBaseUrl.replace(/\/+$/, '')}/__dev/oidc/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: options.code }),
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(`Platform OIDC handoff refused: HTTP ${res.status}`),
      { status: res.status, code: 'platform_handoff_refused' },
    );
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = typeof body.session_id === 'string' ? body.session_id : undefined;
  const companyId = typeof body.company_id === 'string' ? body.company_id : undefined;
  const subjectId = typeof body.subject_id === 'string' ? body.subject_id : undefined;
  const baseUrl = typeof body.base_url === 'string' ? body.base_url : undefined;
  if (!sessionId || !companyId || !baseUrl) {
    throw new OAuthProtocolError(
      'platform_handoff_invalid',
      'The Platform handoff response is missing session_id, company_id or base_url.',
    );
  }
  return {
    sessionId,
    companyId,
    subjectId: subjectId ?? '',
    baseUrl,
    via: 'oidc',
  };
}
