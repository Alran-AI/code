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
export const OTTILI_PLATFORM_URL = 'https://api.ottili.one';

/**
 * Ottili AI Platform gateway base URL.
 *
 * The gateway speaks the OpenAI chat-completions protocol, so the provider
 * appends `/chat/completions` to this base.
 */
export const OTTILI_AI_PLATFORM_BASE_URL = 'https://api.ottili.one/v1';

/** Local AI Platform used while the CLI runs in development mode. */
export const OTTILI_DEV_AI_PLATFORM_BASE_URL = 'http://127.0.0.1:3000/v1';

/** Every Ottili API key carries this prefix. */
export const OTTILI_API_KEY_PREFIX = 'sk-ottili-';

export const OTTILI_API_KEY_ENV = 'ALRAN_API_KEY';
export const OTTILI_API_BASE_ENV = 'ALRAN_API_BASE';
export const OTTILI_PLATFORM_URL_ENV = 'OTTILI_PLATFORM_URL';

/** Overrides the browser page opened by `alran login`. */
export const OTTILI_API_KEY_CONSOLE_ENV = 'OTTILI_API_KEY_CONSOLE_URL';

/** Default path on the Ottili platform where a user mints an API key. */
export const OTTILI_API_KEY_CONSOLE_PATH = '/settings/api-keys';

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
 * Precedence: `ALRAN_API_BASE`, then the local development gateway when
 * `NODE_ENV=development`, then the public gateway.
 */
export function resolveOttiliApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[OTTILI_API_BASE_ENV]?.trim();
  if (configured) return normalizeOttiliApiBaseUrl(configured);
  if (env.NODE_ENV === 'development') return OTTILI_DEV_AI_PLATFORM_BASE_URL;
  return OTTILI_AI_PLATFORM_BASE_URL;
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

/** The browser page that lists and mints Ottili API keys. */
export function resolveOttiliApiKeyConsoleUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[OTTILI_API_KEY_CONSOLE_ENV]?.trim();
  if (configured) return configured;
  return `${resolveOttiliPlatformUrl(env)}${OTTILI_API_KEY_CONSOLE_PATH}`;
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
