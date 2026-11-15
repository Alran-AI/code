import { resolveOttiliModelId } from '@alran/config';

/** The provider id of the models the Ottili AI Platform serves. */
const OTTILI_PROVIDER_ID = 'alran';

/**
 * The model name a person can use outside the CLI: in `curl`, in another tool, in the Console's logs.
 *
 * Inside the CLI the official models carry internal keys (`alran/Alran-Werk`) that own their thinking and
 * context settings. Those keys mean nothing anywhere else, and showing them next to the platform's real ids
 * (`ottili/werk-1.1`, `anthropic/claude-sonnet-5.5`) made people paste an id the API did not know. For the
 * Ottili models this prints the platform id; every other provider keeps `provider/model`.
 */
export function displayModelRef(providerId: string, modelId: string): string {
  if (providerId === OTTILI_PROVIDER_ID) {
    try {
      return resolveOttiliModelId(modelId);
    } catch {
      // An id the platform has no route for is shown as it is.
    }
  }
  return `${providerId}/${modelId}`;
}
