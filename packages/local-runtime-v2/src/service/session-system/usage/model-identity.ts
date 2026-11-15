/**
 * The `provider/model` a usage row is recorded under. The model arrives in two shapes: the
 * provider client's (`{ provider, id }`) and the one the turn host projects for a turn
 * (`{ provider, model_id }`). Reading only one of them records every row of the other as
 * "unknown model".
 */
export function modelIdentity(model: unknown): string | null {
  if (!model || typeof model !== 'object') return null;
  const provider = Reflect.get(model, 'provider') as unknown;
  const id = [
    Reflect.get(model, 'model_id') as unknown,
    Reflect.get(model, 'id') as unknown,
    Reflect.get(model, 'modelId') as unknown,
  ].find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
  if (id === undefined) return null;
  return typeof provider === 'string' && provider !== '' ? `${provider}/${id}` : id;
}
