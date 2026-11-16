// Ottili AI Platform model routing.
//
// The CLI keeps its own internal model identities: they own thinking modes,
// effort levels, context-window selection, and the local catalog that the model
// picker reads. The Ottili AI Gateway knows its own model ids, so every catalog
// model is translated to a gateway id at the request boundary.
//
//   Alran-Werk                   -> ottili/werk-1.1             (default; billed by Ottili, welcome credit pays)
//   anthropic/claude-sonnet-5.5  -> anthropic/claude-sonnet-5.5 (runs on the customer's own Anthropic key — BYOK)
//   anthropic/claude-opus-5.5    -> anthropic/claude-opus-5.5   (runs on the customer's own Anthropic key — BYOK)

export type OttiliModelTier = 'fast' | 'standard' | 'coding' | 'premium';

/** Gateway ids of Ottili's own tiers. Only `coding` (Werk) is served today. */
export const OTTILI_MODEL_IDS = {
  fast: 'ottili/kern-1.1',
  standard: 'ottili/fels-1.1',
  coding: 'ottili/werk-1.1',
  premium: 'ottili/werk-1.1-pro',
} as const satisfies Record<OttiliModelTier, string>;

/**
 * The partner models the gateway serves, by their gateway id. They run on the customer's OWN Anthropic API
 * key (BYOK): the customer adds it in the Ottili AI Platform, Anthropic bills them directly, and Ottili
 * charges nothing for these models — no token price, no service fee.
 */
export const OTTILI_PARTNER_MODEL_IDS = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5'] as const;

/**
 * Catalog model id -> Ottili AI Gateway model id.
 *
 * Every model in `ALRAN_MODELS` has an entry here, and nothing else does. All
 * of them are served by the Ottili AI Gateway; a third-party provider (bring
 * your own key) never goes through this map.
 *
 * A missing route is a configuration error: the resolver throws and never
 * silently falls back to Werk.
 */
export const ALRAN_MODEL_TO_GATEWAY_ID: Readonly<Record<string, string>> = {
  'Alran-Werk': 'ottili/werk-1.1',
  'anthropic/claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
  'anthropic/claude-opus-5.5': 'anthropic/claude-opus-5.5',
} as const;

/**
 * The short names a person types (`alran --model werk`, `alran models --info sonnet`) and the
 * catalog id they mean.
 */
export const OTTILI_MODEL_SHORT_NAMES: Readonly<Record<string, string>> = {
  werk: 'Alran-Werk',
  'ottili/werk-1.1': 'Alran-Werk',
  sonnet: 'anthropic/claude-sonnet-5.5',
  'claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
  'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
  opus: 'anthropic/claude-opus-5.5',
  'claude-opus-5.5': 'anthropic/claude-opus-5.5',
  'claude-opus-5-5': 'anthropic/claude-opus-5.5',
} as const;

/** The catalog id of a name a person typed, or the name itself when it already is one. */
export function resolveOttiliCatalogModelId(name: string): string {
  const trimmed = name.trim();
  return OTTILI_MODEL_SHORT_NAMES[trimmed.toLowerCase()] ?? trimmed;
}

/** True when a catalog model runs on the customer's own provider key (BYOK) and is billed by its maker. */
export function isByokOttiliModel(modelId: string): boolean {
  const gatewayId = ALRAN_MODEL_TO_GATEWAY_ID[resolveOttiliCatalogModelId(modelId)] ?? modelId;
  return (OTTILI_PARTNER_MODEL_IDS as readonly string[]).includes(gatewayId);
}

/** Tier used when an internal model has no explicit mapping. */
export const DEFAULT_OTTILI_MODEL_TIER: OttiliModelTier = 'coding';

/** True when the value already is an Ottili platform model id. */
export function isOttiliModelId(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^ottili\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/iu.test(trimmed)
    || (OTTILI_PARTNER_MODEL_IDS as readonly string[]).includes(trimmed);
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
  const gatewayId = ALRAN_MODEL_TO_GATEWAY_ID[resolveOttiliCatalogModelId(normalized)];
  if (gatewayId) return gatewayId;
  throw new Error(
    `No Ottili AI Platform gateway route for model "${modelId}". Add it to ALRAN_MODEL_TO_GATEWAY_ID; external models must not silently fall back to Alran-Werk.`,
  );
}
