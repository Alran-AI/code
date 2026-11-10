import type { AlranBuildEnv } from '@alran/config';
import {
  managedBackendRoutingHeaders as buildManagedBackendRoutingHeaders,
  normalizeManagedBackendRoutingContext,
  type ManagedBackendRoutingContext,
} from '@alran/agent-tools/desktop';

export type LocalRuntimeRoutingContext = ManagedBackendRoutingContext;

export interface LocalRuntimeRoutingOptions {
  routingContextGetter?: () => LocalRuntimeRoutingContext | undefined;
}

export function normalizeLocalRuntimeRoutingContext(
  value: unknown,
  buildEnv: AlranBuildEnv | undefined = getRawRuntimeBuildEnv(),
): LocalRuntimeRoutingContext | undefined {
  return normalizeManagedBackendRoutingContext(value, buildEnv);
}

export function managedBackendRoutingHeaders(
  context: LocalRuntimeRoutingContext | undefined,
  buildEnv: AlranBuildEnv | undefined = getRawRuntimeBuildEnv(),
): Record<string, string> {
  return buildManagedBackendRoutingHeaders(context, buildEnv);
}

/** Raw build-env gate for managed routing; intentionally has no config fallback. */
export function getRawRuntimeBuildEnv(): AlranBuildEnv | undefined {
  const value = process.env.ALRAN_BUILD_ENV;
  return value === 'dev' || value === 'test' || value === 'staging' || value === 'prod'
    ? value
    : undefined;
}
