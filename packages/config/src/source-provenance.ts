import { resolveSourceProvenanceEnabled } from '@alran/shared/source-provenance';

/** Local product ownership is supplied by the host, never inferred from env. */
export function isLocalSourceProvenanceEnabled(
  runtimeOwnerKind: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveSourceProvenanceEnabled({
    platform: runtimeOwnerKind,
    internalBuild: env.__ALRAN_BUILD_INTERNAL === 'true',
    insideBuild: env.__ALRAN_BUILD_INSIDE === 'true',
  });
}
