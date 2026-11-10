import type { ResolvedAgentCapabilities } from '@alran/config';

import type { HostedAgentCapabilityRestrictions } from './hosted-agent-capabilities.js';

export function applyHostedCapabilityRestrictions(
  capabilities: ResolvedAgentCapabilities,
  restrictions: HostedAgentCapabilityRestrictions,
): ResolvedAgentCapabilities {
  if (!restrictions.disableAlran) return capabilities;
  return {
    ...capabilities,
    features: {
      ...capabilities.features,
      alran: false,
    },
  };
}
