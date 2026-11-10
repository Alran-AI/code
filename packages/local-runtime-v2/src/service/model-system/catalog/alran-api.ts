import {
  resolveOttiliGatewayBaseUrl,
  resolvePlatformEnvironmentForBuild,
} from '@alran/config';

import type { LocalRuntimeConfig } from '../contracts.js';

export { alranApiModels } from '@alran/config';

/**
 * The Ottili AI Platform gateway speaks the OpenAI chat-completions protocol,
 * so the provider appends `/chat/completions` to the configured base URL.
 */
export const ALRAN_API_FORMAT = 'openai-completions';

/**
 * Default gateway base URL for this build: the local gateway in development,
 * the public `ottili.one` gateway in production. A signed-in local build has no
 * route to the public host, so it must not fall back to it.
 */
export function resolveAlranApiDefaultBaseUrl(): string {
  return resolveOttiliGatewayBaseUrl(resolvePlatformEnvironmentForBuild());
}

export const ALRAN_API_DEFAULT_BASE_URL = resolveAlranApiDefaultBaseUrl();

export const ALRAN_API_PROVIDER_NAME = 'Ottili AI Platform';

export function alranApiBaseUrl(config: LocalRuntimeConfig): string {
  return config.alran_api?.baseURL?.trim() || resolveAlranApiDefaultBaseUrl();
}
