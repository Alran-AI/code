import type { AlranBuildEnv } from '@alran/config';

/** Read the managed-routing gate without a config fallback. */
export function getRawRuntimeBuildEnv(): AlranBuildEnv | undefined {
  const value = process.env.ALRAN_BUILD_ENV;
  return value === 'dev' || value === 'test' || value === 'staging' || value === 'prod'
    ? value
    : undefined;
}
