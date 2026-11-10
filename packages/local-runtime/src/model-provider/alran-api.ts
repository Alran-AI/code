import { resolveOttiliApiBaseUrl } from '@alran/config';

import type { LocalRuntimeConfig } from '../config/types.js';

export { alranApiModels } from '@alran/config';

/**
 * The Ottili AI Platform gateway speaks the OpenAI chat-completions protocol,
 * so the provider appends `/chat/completions` to the configured base URL.
 */
export const ALRAN_API_FORMAT = 'openai-completions';

/** Default gateway base URL: `ALRAN_API_BASE`, then the dev gateway, then the public one. */
export function resolveAlranApiDefaultBaseUrl(): string {
  return resolveOttiliApiBaseUrl();
}

export const ALRAN_API_DEFAULT_BASE_URL = resolveAlranApiDefaultBaseUrl();

export const ALRAN_API_PROVIDER_NAME = 'Ottili AI Platform';

export function alranApiBaseUrl(config: LocalRuntimeConfig): string {
  return config.alran_api?.baseURL?.trim() || resolveAlranApiDefaultBaseUrl();
}
