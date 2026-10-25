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
 * Internal CLI model id -> platform tier.
 *
 * The order is the ascending capability ladder of the local catalog: the
 * high-speed text model is the cheapest tier, the flagship reasoning model is
 * the premium tier.
 */
export const ALRAN_MODEL_TIER_BY_MODEL_ID: Readonly<Record<string, OttiliModelTier>> = {
  'Alran-M2.7-highspeed': 'fast',
  'Alran-M2.7': 'standard',
  'Alran-M3.1-Flash': 'coding',
  'Alran-M3': 'premium',
};

/** Tier used when an internal model has no explicit mapping. */
export const DEFAULT_OTTILI_MODEL_TIER: OttiliModelTier = 'coding';

/** True when the value already is an Ottili platform model id. */
export function isOttiliModelId(value: unknown): boolean {
  return typeof value === 'string' && /^ottili\/[a-z0-9][a-z0-9._-]*$/iu.test(value.trim());
}

/** The platform tier an internal model id maps to. */
export function resolveOttiliModelTier(modelId: string | undefined): OttiliModelTier {
  const normalized = modelId?.trim();
  if (!normalized) return DEFAULT_OTTILI_MODEL_TIER;
  const tier = ALRAN_MODEL_TIER_BY_MODEL_ID[normalized];
  if (tier) return tier;
  // Tolerate a provider-qualified internal id such as `alran/Alran-M3`.
  const bare = normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized;
  return ALRAN_MODEL_TIER_BY_MODEL_ID[bare] ?? DEFAULT_OTTILI_MODEL_TIER;
}

/**
 * The Ottili AI Platform model id for an internal model id.
 *
 * Ids that already point at the platform are returned unchanged, so a user who
 * configured `ottili/werk-1.1` directly keeps working.
 */
export function resolveOttiliModelId(modelId: string | undefined): string {
  const normalized = modelId?.trim();
  if (!normalized) return OTTILI_MODEL_IDS[DEFAULT_OTTILI_MODEL_TIER];
  if (isOttiliModelId(normalized)) return normalized;
  return OTTILI_MODEL_IDS[resolveOttiliModelTier(normalized)];
}
