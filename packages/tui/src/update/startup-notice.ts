import type { AlranUpdatePlan } from './application.js';

export interface AlranStartupUpdateNotice {
  readonly latestVersion: string;
}

export function resolveAlranStartupUpdateNotice(
  plan: AlranUpdatePlan,
): AlranStartupUpdateNotice | undefined {
  if (plan.kind !== 'available' && plan.kind !== 'package-manager') return undefined;
  const latestVersion = plan.latestVersion.trim();
  return latestVersion ? { latestVersion } : undefined;
}
