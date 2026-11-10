// @ottili/oauth-core — Platform OIDC login.
//
// Connects Alran Code to the Ottili AI Platform (alran-platform) through the
// Platform's OpenID Connect flow backed by Keycloak. The browser is sent to the
// Platform's `/v2/auth/oidc/login`, Keycloak renders the login, the Platform
// mints a session and hands the browser back to the registered callback with
// the one-time `ottili_handoff` code, and this code is redeemed server-to-server
// (`/v2/auth/sessions/handoff`) for a Platform session id. The password never
// reaches this code; the Platform session id stays in this process.

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
  /** The Platform base URL as the browser reaches it (e.g. https://platform.ottili.one). */
  readonly platformOrigin: string;
  /** The callback URL the Platform redirects back to (e.g. http://127.0.0.1:54321/callback).
   *  The Platform appends `ottili_handoff` to exactly this URL. */
  readonly callback: string;
  /** Optional Keycloak prompt (e.g. "login", "consent"). */
  readonly prompt?: string | null;
}

/** Options for redeeming a Platform OIDC handoff code. */
export interface PlatformOidcRedeemOptions {
  /** The Platform base URL as this process reaches it. */
  readonly platformBaseUrl: string;
  /** The one-time `ottili_handoff` code from the Platform callback. */
  readonly code: string;
}

/**
 * Build the URL the browser should be opened to for Platform OIDC sign-in.
 *
 * The Platform's `/v2/auth/oidc/login` starts the Keycloak flow. The
 * `return_to` parameter tells the Platform where to hand the browser back
 * after a successful login; the Platform appends `ottili_handoff` to exactly
 * that URL.
 */
export function platformOidcLoginUrl(options: PlatformOidcLoginOptions): string {
  const q = new URLSearchParams({ return_to: options.callback });
  if (options.prompt) q.set('prompt', options.prompt);
  return `${options.platformOrigin.replace(/\/+$/, '')}/v2/auth/oidc/login?${q}`;
}

/**
 * Redeem a one-time Platform OIDC handoff code for a Platform session.
 *
 * Server-to-server call to the Platform's `/v2/auth/sessions/handoff` endpoint.
 * The Platform answers in the `ottili.envelope/v1` shape (`{ data: {...} }`)
 * with the session id, company id, subject id and expiry. The live answer does
 * not include a base URL, so the configured Platform origin is used unless the
 * answer names one explicitly.
 */
export async function platformOidcRedeem(
  options: PlatformOidcRedeemOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformSession> {
  const res = await fetchImpl(`${options.platformBaseUrl.replace(/\/+$/, '')}/v2/auth/sessions/handoff`, {
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
  const envelope = body.data;
  const data = (
    envelope !== null && typeof envelope === 'object' ? envelope : body
  ) as Record<string, unknown>;
  const sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
  const companyId = typeof data.company_id === 'string' ? data.company_id : undefined;
  const subjectId = typeof data.subject_id === 'string' ? data.subject_id : undefined;
  // The live Platform answers with the session tuple and an expiry; it does
  // not echo a base URL. The origin this process already used to redeem is the
  // one every later call must use, so fall back to it rather than refusing a
  // valid handoff.
  const baseUrl =
    typeof data.base_url === 'string' && data.base_url.length > 0
      ? data.base_url
      : options.platformBaseUrl.replace(/\/+$/, '');
  if (!sessionId || !companyId) {
    throw new OAuthProtocolError(
      'platform_handoff_invalid',
      'The Platform handoff response is missing session_id or company_id.',
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
