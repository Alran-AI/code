import type { Api, Model } from '@earendil-works/pi-ai';
import { isFirstPartyAlranRoute } from '@mavis/config';

export function resolveLocalModelCompatibility(input: {
  api: Api;
  provider: string;
  forceAdaptiveThinking: boolean;
  completionsThinkingCompat?: Model<Api>['compat'];
}): Model<Api>['compat'] | undefined {
  const firstPartyAlranRoute = isFirstPartyAlranRoute(input.provider);
  const compat: Model<Api>['compat'] = {
    ...(input.forceAdaptiveThinking ? { forceAdaptiveThinking: true } : {}),
    ...(input.completionsThinkingCompat ?? {}),
    ...(firstPartyAlranRoute ? { supportsLongCacheRetention: false } : {}),
  };
  return Object.keys(compat).length > 0 ? compat : undefined;
}
