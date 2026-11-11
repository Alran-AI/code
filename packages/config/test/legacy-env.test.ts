import { describe, expect, it } from 'vitest';

import { applyLegacyEnvironmentAliases, formatLegacyEnvironmentWarning } from '../src/legacy-env.js';

// legacy-brand-compat:begin — the translation of the old variable names. TODO: remove after 2027-Q1.
describe('legacy environment variables', () => {
  it('reads an old name under its ALRAN_ name when the new one is unset', () => {
    const env: NodeJS.ProcessEnv = { MAVIS_DATA_DIR: '/tmp/data', MCODE_REGION: 'en' };
    const applied = applyLegacyEnvironmentAliases(env);
    expect(env.ALRAN_DATA_DIR).toBe('/tmp/data');
    expect(env.ALRAN_REGION).toBe('en');
    expect(applied).toEqual([
      { from: 'MAVIS_DATA_DIR', to: 'ALRAN_DATA_DIR' },
      { from: 'MCODE_REGION', to: 'ALRAN_REGION' },
    ]);
    expect(env.MAVIS_DATA_DIR).toBe('/tmp/data');
  });

  it('never overrides a new name the user already set', () => {
    const env: NodeJS.ProcessEnv = { MAVIS_DATA_DIR: '/old', ALRAN_DATA_DIR: '/new' };
    expect(applyLegacyEnvironmentAliases(env)).toEqual([]);
    expect(env.ALRAN_DATA_DIR).toBe('/new');
  });

  it('warns once, naming every translated variable and the end of support', () => {
    expect(formatLegacyEnvironmentWarning([])).toBeNull();
    const warning = formatLegacyEnvironmentWarning([{ from: 'MAVIS_PROFILE', to: 'ALRAN_PROFILE' }]);
    expect(warning).toContain('MAVIS_PROFILE → ALRAN_PROFILE');
    expect(warning).toContain('2027-Q1');
  });
});
// legacy-brand-compat:end
