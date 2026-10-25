// Route-aware model availability.
//
// Managed and Alran API-key routes share the official model catalog.
// Custom providers retain their own configured models. This module owns the
// one answer to "may this route call this model", so the local model list, the
// save entry (`selectModel`) and the Turn execution gate cannot disagree and
// let a locally-known model reach a backend that retired it.
//
// Pure by contract: no fs, no process state, no runtime types. Callers pass a
// structured read-only view of the effective config plus the runtime PresetKey.
// Do not use a resolver's generic limit fallback as a validity signal — an
// unknown model resolving to default limits is exactly the bug this replaces.

import { ALRAN_MODELS } from './alran-model-catalog.js';
import type { PresetKey } from './config.js';
import { resolveProviderAuthMode } from './provider-auth-mode.js';

/** Reserved provider ids, mirrored by the local-runtime model-key parsers. */
export const MANAGED_ALRAN_PROVIDER_ID = 'alran';
export const ALRAN_API_PROVIDER_ID = 'alran_api';
export const CUSTOM_PROVIDER_ID_PREFIX = 'custom_provider:';

/** Which upstream a selected model would actually be called through. */
export type ModelCallRoute =
  | 'managed_token_plan'
  | 'alran_api_key'
  | 'custom_provider'
  | 'configured_provider';

/** Where the selected model came from; decides the failure handling. */
export type ModelSelectionSource = 'explicit_request' | 'session_override' | 'config_default';

export type ModelAvailabilityErrorCode =
  | 'MODEL_NOT_AVAILABLE_FOR_ROUTE'
  | 'DEFAULT_MODEL_NOT_AVAILABLE_FOR_ROUTE';

export interface ModelAvailabilityProviderView {
  readonly options?: {
    readonly authMode?: unknown;
    readonly baseURL?: unknown;
    readonly [key: string]: unknown;
  };
  readonly models?: Readonly<Record<string, { readonly enabled?: unknown }>>;
  readonly model_order?: unknown;
}

export interface ModelAvailabilityCustomProviderView extends ModelAvailabilityProviderView {
  readonly enabled?: boolean;
}

/** Read-only projection of the effective config this module needs. */
export interface ModelAvailabilityConfigView {
  readonly provider?: Readonly<Record<string, ModelAvailabilityProviderView>>;
  readonly alran_api?: { readonly apiKey?: string; readonly baseURL?: string };
  readonly custom_provider?: Readonly<Record<string, ModelAvailabilityCustomProviderView>>;
  readonly alranModelSource?: 'token_plan' | 'alran_api_key';
}

export interface ModelAvailabilityInput {
  readonly config: ModelAvailabilityConfigView;
  readonly providerId: string;
  readonly modelId: string;
  readonly preset: PresetKey;
  readonly source: ModelSelectionSource;
}

export type ModelAvailability =
  | { readonly available: true; readonly route: ModelCallRoute }
  | {
      readonly available: false;
      readonly route: ModelCallRoute;
      readonly code: ModelAvailabilityErrorCode;
      readonly message: string;
    };

/**
 * Shared cache-compatibility policy for Alran's first-party route.
 *
 * The first-party providers call the Ottili AI Platform, which does not offer
 * long-lived cache retention, so the flag must stay off for them whatever the
 * wire format is.
 */
export function isFirstPartyAlranRoute(providerId: string): boolean {
  return providerId === MANAGED_ALRAN_PROVIDER_ID || providerId === ALRAN_API_PROVIDER_ID;
}

/**
 * The route a provider id resolves to. `provider.alran` is not a fixed
 * route: with `alranModelSource = 'alran_api_key'` the very same builtin
 * entry is called with the user's own key, using the same official catalog.
 */
export function resolveModelCallRoute(
  config: ModelAvailabilityConfigView,
  providerId: string,
): ModelCallRoute {
  if (providerId === ALRAN_API_PROVIDER_ID) return 'alran_api_key';
  if (providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX)) return 'custom_provider';
  if (providerId !== MANAGED_ALRAN_PROVIDER_ID) return 'configured_provider';
  if (config.alranModelSource === 'alran_api_key') return 'alran_api_key';
  const options = config.provider?.[providerId]?.options;
  const authMode = resolveProviderAuthMode({
    authMode: options?.authMode,
    baseURL: options?.baseURL,
  }).authMode;
  // The first-party provider authenticates with an Ottili API key; there is no
  // managed token plan for it.
  if (authMode === 'api-key') return 'alran_api_key';
  return authMode === 'managed-login' ? 'managed_token_plan' : 'configured_provider';
}

/**
 * Model ids the given provider id may actually call right now. Both Alran
 * routes follow the official catalog and ordering; custom providers keep
 * their user-owned model lists.
 */
export function listRouteModelIds(
  config: ModelAvailabilityConfigView,
  providerId: string,
  _preset: PresetKey,
): readonly string[] {
  const route = resolveModelCallRoute(config, providerId);
  switch (route) {
    case 'managed_token_plan': {
      return configuredModelIds(config.provider?.[providerId], true);
    }
    case 'alran_api_key': {
      const provider = config.provider?.[MANAGED_ALRAN_PROVIDER_ID];
      return configuredModelIds({ ...provider, models: provider?.models ?? ALRAN_MODELS }, true);
    }
    case 'custom_provider': {
      const provider = config.custom_provider?.[providerId.slice(CUSTOM_PROVIDER_ID_PREFIX.length)];
      if (!provider || provider.enabled === false) return [];
      return configuredModelIds(provider);
    }
    case 'configured_provider':
      return configuredModelIds(config.provider?.[providerId]);
  }
}

/** The single availability answer shared by list, save and Turn execution. */
export function resolveModelAvailability(input: ModelAvailabilityInput): ModelAvailability {
  const route = resolveModelCallRoute(input.config, input.providerId);
  const modelId = input.modelId.trim();
  if (
    modelId.length > 0 &&
    listRouteModelIds(input.config, input.providerId, input.preset).includes(modelId)
  ) {
    return { available: true, route };
  }
  return {
    available: false,
    route,
    code:
      input.source === 'config_default'
        ? 'DEFAULT_MODEL_NOT_AVAILABLE_FOR_ROUTE'
        : 'MODEL_NOT_AVAILABLE_FOR_ROUTE',
    message: `Model "${input.providerId}/${input.modelId}" is not available for the "${route}" route (preset ${input.preset}).`,
  };
}

function configuredModelIds(
  provider: ModelAvailabilityProviderView | undefined,
  applyModelOrder = false,
): readonly string[] {
  const configured = Object.entries(provider?.models ?? {})
    .filter(([, model]) => model?.enabled !== false)
    .map(([modelId]) => modelId);
  const order = provider?.model_order;
  if (!applyModelOrder || !Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
    return configured;
  }
  const remaining = new Set(configured);
  const ordered = order.filter((modelId) => remaining.delete(modelId));
  return [...ordered, ...configured.filter((modelId) => remaining.has(modelId))];
}
