import type { AlranBuildEnv, AlranRegion } from '@alran/config';

export interface CliAuthScope {
  readonly region: AlranRegion;
  readonly buildEnv: AlranBuildEnv;
}
