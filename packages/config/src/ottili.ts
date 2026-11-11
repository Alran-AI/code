// Ottili platform endpoints, credentials, and environment resolution.
//
// Alran Code has no local account system and no local credit ledger. Identity,
// tenant isolation, and metering live in the Ottili platform; the Ottili AI
// Platform gateway serves OpenAI-compatible chat completions for every model
// tier. This module is the single place that knows those endpoints, so the CLI
// never hard-codes a vendor host.
//
// Environment variables:
//   ALRAN_API_KEY      Ottili API key (`sk-ottili-...`).
//   ALRAN_API_BASE     AI Platform gateway base URL. Defaults to the public gateway.
//   OTTILI_PLATFORM_URL  Ottili platform origin used for auth and identity checks.

/** Ottili platform origin: auth, identity, and tenant-scoped APIs. */
export const OTTILI_PLATFORM_URL = 'https://platform.ottili.one';

/**
 * Ottili AI Platform gateway base URL.
 *
 * The gateway speaks the OpenAI chat-completions protocol, so the provider
 * appends `/chat/completions` to this base.
 */
export const OTTILI_AI_PLATFORM_BASE_URL = 'https://ai.ottili.one/v1';

/** Every Ottili API key carries this prefix. */
export const OTTILI_API_KEY_PREFIX = 'sk-ottili-';

export const OTTILI_API_KEY_ENV = 'ALRAN_API_KEY';
export const OTTILI_API_BASE_ENV = 'ALRAN_API_BASE';
export const OTTILI_PLATFORM_URL_ENV = 'OTTILI_PLATFORM_URL';

/** Overrides the browser page opened by `alran login`. */
export const OTTILI_API_KEY_CONSOLE_ENV = 'OTTILI_API_KEY_CONSOLE_URL';

/** Path of the API-key page of the Ottili AI Platform (the product that mints `sk-ottili-` keys). */
export const OTTILI_API_KEY_CONSOLE_PATH = '/api-keys';

export interface OttiliEnvironment {
  /** Platform origin for auth, identity, and tenant-scoped calls. */
  readonly platformUrl: string;
  /** AI Platform gateway base URL for chat-completions requests. */
  readonly apiBaseUrl: string;
  /** Ottili API key, when one is configured. */
  readonly apiKey?: string;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/u, '');
}

/**
 * Normalize a gateway base URL.
 *
 * Users paste gateway URLs that already carry the completion path; the base
 * must stay reusable, so a trailing `/chat/completions` is removed.
 */
export function normalizeOttiliApiBaseUrl(value: string): string {
  const trimmed = stripTrailingSlashes(value.trim());
  if (trimmed.length === 0) return trimmed;
  return trimmed.replace(/\/chat\/completions$/iu, '');
}

/** The Ottili platform origin, overridable for a self-hosted deployment. */
export function resolveOttiliPlatformUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[OTTILI_PLATFORM_URL_ENV]?.trim();
  if (configured) return stripTrailingSlashes(configured);
  return OTTILI_PLATFORM_URL;
}

/**
 * The AI Platform gateway base URL.
 *
 * Precedence: `ALRAN_API_BASE`, then the public gateway.
 */
export function resolveOttiliApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[OTTILI_API_BASE_ENV]?.trim();
  if (configured) return normalizeOttiliApiBaseUrl(configured);
  return OTTILI_AI_PLATFORM_BASE_URL;
}

/**
 * The AI Platform gateway base URL for a Platform sign-in environment.
 *
 * Uses `ALRAN_API_BASE` when explicitly configured, otherwise the public
 * gateway. Local development gateway routing is not used.
 */
export function resolveOttiliGatewayBaseUrl(
  _platformEnv: 'dev' | 'prod',
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveOttiliApiBaseUrl(env);
}

/** The Ottili API key from the environment, when present. */
export function resolveOttiliApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env[OTTILI_API_KEY_ENV]?.trim();
  return configured || undefined;
}

/** True when the value looks like an Ottili API key. */
export function isOttiliApiKey(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith(OTTILI_API_KEY_PREFIX);
}

/**
 * The browser page that lists and mints Ottili API keys.
 *
 * Keys are minted by the Ottili AI Platform, the product that also serves the gateway, so the page
 * lives on the gateway's origin (`https://ai.ottili.one/api-keys`; a local gateway gives a local
 * page). `platformUrl` is kept for callers that still pass it and no longer decides the page.
 */
export function resolveOttiliApiKeyConsoleUrlFor(
  _platformUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[OTTILI_API_KEY_CONSOLE_ENV]?.trim();
  if (configured) return configured;
  return `${new URL(resolveOttiliApiBaseUrl(env)).origin}${OTTILI_API_KEY_CONSOLE_PATH}`;
}

/** The browser page that lists and mints Ottili API keys. */
export function resolveOttiliApiKeyConsoleUrl(env: NodeJS.ProcessEnv = process.env): string {
  return resolveOttiliApiKeyConsoleUrlFor(resolveOttiliPlatformUrl(env), env);
}

/** Resolve the whole Ottili environment in one call. */
export function resolveOttiliEnvironment(env: NodeJS.ProcessEnv = process.env): OttiliEnvironment {
  const apiKey = resolveOttiliApiKey(env);
  return {
    platformUrl: resolveOttiliPlatformUrl(env),
    apiBaseUrl: resolveOttiliApiBaseUrl(env),
    ...(apiKey ? { apiKey } : {}),
  };
}
