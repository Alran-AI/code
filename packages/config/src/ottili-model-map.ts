// Ottili AI Platform model routing.
//
// The CLI keeps its own internal model identities: they own thinking modes,
// effort levels, context-window selection, and the local catalog that the model
// picker reads. The Ottili AI Platform only knows platform model ids, so every
// internal model is translated to a platform model id at the request boundary.
//
// Tier mapping:
//
//   Fast / Router  -> ottili/kern-1.1      routing model, not intended for coding work
//   Standard       -> ottili/fels-1.1
//   Smart / Coding -> ottili/werk-1.1
//   Premium        -> ottili/werk-1.1-pro

export type OttiliModelTier = 'fast' | 'standard' | 'coding' | 'premium';

export const OTTILI_MODEL_IDS = {
  fast: 'ottili/kern-1.1',
  standard: 'ottili/fels-1.1',
  coding: 'ottili/werk-1.1',
  premium: 'ottili/werk-1.1-pro',
} as const satisfies Record<OttiliModelTier, string>;

/**
 * Internal CLI model id -> Ottili AI Platform gateway model id.
 *
 * Every internal model in `ALRAN_MODELS` must have an entry here. All traffic
 * (internal and external) goes through the Ottili AI Gateway
 * (`ottili-gateway`), which forwards to OpenRouter — there is no direct
 * Anthropic or OpenAI key.
 *
 * A missing route is a configuration error: the resolver throws and never
 * silently falls back to Alran-Werk.
 */
export const ALRAN_MODEL_TO_GATEWAY_ID: Readonly<Record<string, string>> = {
  // Internal Ottili models
  'Alran-Werk-Pro': 'ottili/werk-1.1-pro',
  'Alran-Werk': 'ottili/werk-1.1',
  'Alran-Fels': 'ottili/fels-1.1',
  'Alran-Kern': 'ottili/kern-1.1',
  // External models routed through the Ottili AI Gateway -> OpenRouter.
  // Keys are the gateway family/id (e.g. `anthropic/sonnet-5.5`); values are
  // the full wire id (e.g. `ottili/anthropic/sonnet-5.5`).
  'anthropic/sonnet-5.5': 'ottili/anthropic/sonnet-5.5',
  'anthropic/opus-5.5': 'ottili/anthropic/opus-5.5',
  'anthropic/fable-5.1': 'ottili/anthropic/fable-5.1',
  'openai/gpt-6-astra': 'ottili/openai/gpt-6-astra',
  'openai/gpt-6.1-sol': 'ottili/openai/gpt-6.1-sol',
  'openai/gpt-6.1-terra': 'ottili/openai/gpt-6.1-terra',
} as const;

/** Tier used when an internal model has no explicit mapping. */
export const DEFAULT_OTTILI_MODEL_TIER: OttiliModelTier = 'coding';

/** True when the value already is an Ottili platform model id. */
export function isOttiliModelId(value: unknown): boolean {
  return typeof value === 'string' && /^ottili\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/iu.test(value.trim());
}

/**
 * The Ottili AI Platform model id for an internal model id.
 *
 * Ids that already point at the platform are returned unchanged, so a user who
 * configured `ottili/werk-1.1` directly keeps working. Internal model ids are
 * translated to their gateway route via `ALRAN_MODEL_TO_GATEWAY_ID`. Any
 * internal model without a route throws rather than falling back to a default.
 */
export function resolveOttiliModelId(modelId: string | undefined): string {
  const normalized = modelId?.trim();
  if (!normalized) return OTTILI_MODEL_IDS[DEFAULT_OTTILI_MODEL_TIER];
  if (isOttiliModelId(normalized)) return normalized;
  const gatewayId = ALRAN_MODEL_TO_GATEWAY_ID[normalized];
  if (gatewayId) return gatewayId;
  throw new Error(
    `No Ottili AI Platform gateway route for model "${modelId}". Add it to ALRAN_MODEL_TO_GATEWAY_ID; external models must not silently fall back to Alran-Werk.`,
  );
}
