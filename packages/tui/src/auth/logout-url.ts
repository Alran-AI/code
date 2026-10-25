import type { MavisBuildEnv, MavisRegion } from '@mavis/config';

const WEB_ORIGINS: Record<MavisRegion, Record<MavisBuildEnv, string>> = {
  cn: {
    dev: 'https://matrix-test.example.invalid',
    test: 'https://matrix-test.example.invalid',
    staging: 'https://matrix-pre.example.invalid',
    prod: 'https://api.ottili.one',
  },
  en: {
    dev: 'https://matrix-overseas-test.example.invalid',
    test: 'https://matrix-overseas-test.example.invalid',
    staging: 'https://matrix-overseas-pre.example.invalid',
    prod: 'https://api.ottili.one',
  },
};

export function buildAlranLogoutUrl(scope: {
  readonly region: MavisRegion;
  readonly buildEnv: MavisBuildEnv;
}): string {
  const origin = WEB_ORIGINS[scope.region][scope.buildEnv];
  return `${origin}/auth/logout?logout_redirect_uri=${encodeURIComponent(origin)}`;
}
