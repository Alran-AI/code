/**
 * The project-wide gate and the reader's overrides.
 *
 * Detection is a guess about a repository the harness has never seen, and the
 * reader has to be able to correct it (spec §3.2). An override replaces the
 * group it names; a group nobody named keeps what was there.
 */

import { describe, expect, it } from 'vitest';
import { applyGateOverrides, detectUltraGates } from '../../src/gates.js';

describe('applyGateOverrides', () => {
  it('replaces the group the reader named', () => {
    const gates = applyGateOverrides(
      { test: ['pnpm test'], lint: ['pnpm lint'], build: ['pnpm build'] },
      { test: ['pnpm test:unit'] },
    );
    expect(gates.test).toEqual(['pnpm test:unit']);
    // The groups nobody mentioned keep what they had.
    expect(gates.lint).toEqual(['pnpm lint']);
    expect(gates.build).toEqual(['pnpm build']);
  });

  it('starts from nothing when the plan has no gates at all', () => {
    const gates = applyGateOverrides(undefined, { build: ['make'] });
    expect(gates).toEqual({ test: [], lint: [], build: ['make'] });
  });

  it('changes nothing when there are no overrides', () => {
    const detected = { test: ['pnpm test'], lint: [], build: [] };
    expect(applyGateOverrides(detected, {})).toEqual(detected);
  });
});

describe('detectUltraGates', () => {
  it('reads the test command out of a package.json script', () => {
    const gates = detectUltraGates({ packageJson: { scripts: { test: 'vitest' } } });
    // The detected command runs the project's own script; the script's
    // contents are the project's business, not the harness's.
    expect(gates.test.join(' ')).toMatch(/test/iu);
  });
});
