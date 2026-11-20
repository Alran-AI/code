/**
 * Spec-test protection (spec 13.2, ULT-13).
 *
 * The spec tests are the run's definition of done, written before any worker
 * starts. If a worker could edit them, a failing run could simply weaken the
 * check that failed — the exact fake-fix the whole design exists to prevent. So
 * they live outside every packet's writable scope and inside every packet's
 * readonly set.
 *
 * These tests pin both halves: the planner must refuse a packet that would write
 * them, and the scheduler must reject a worker that tries.
 */

import { describe, expect, it } from 'vitest';
import {
  SPEC_TEST_DIR,
  assertSpecTestsProtected,
  describeSpecTestViolation,
  isSpecTestPath,
  specTestDenyPaths,
} from '../../src/spec-tests.js';

describe('spec test protection', () => {
  it('recognises spec-test paths at the conventional location', () => {
    expect(isSpecTestPath('tests/spec/layers.spec.ts')).toBe(true);
    expect(isSpecTestPath('tests/spec/nested/deep.spec.ts')).toBe(true);
  });

  it('does not treat ordinary tests as spec tests', () => {
    // A worker's own tests are legitimate work; only the frozen spec tests are
    // protected, or no worker could write a test at all.
    expect(isSpecTestPath('tests/unit/widget.test.ts')).toBe(false);
    expect(isSpecTestPath('src/widget.test.ts')).toBe(false);
  });

  it('denies the spec directory for every worker, whatever the scope', () => {
    const deny = specTestDenyPaths();
    expect(deny).toContain(`${SPEC_TEST_DIR}/**`);
    // The patterns are usable directly by the deny-path matcher.
    expect(deny.length).toBeGreaterThan(0);
  });

  it('accepts a packet whose scope does not touch the spec tests', () => {
    expect(() =>
      assertSpecTestsProtected({
        id: 'p1',
        title: 'Widget',
        goal: 'g',
        scope: ['src/widget/**'],
        depends_on: [],
      }),
    ).not.toThrow();
  });

  it('rejects a packet whose scope would let a worker edit the spec tests', () => {
    expect(() =>
      assertSpecTestsProtected({
        id: 'p2',
        title: 'Everything',
        goal: 'g',
        // A broad scope that includes tests/spec: the worker could rewrite the
        // checks that judge it.
        scope: ['**'],
        depends_on: [],
      }),
    ).toThrow(/spec test/iu);
  });

  it('rejects a packet that explicitly scopes the spec directory', () => {
    expect(() =>
      assertSpecTestsProtected({
        id: 'p3',
        title: 'Rewrite the checks',
        goal: 'g',
        scope: ['tests/spec/**'],
        depends_on: [],
      }),
    ).toThrow(/spec test/iu);
  });

  it('names the offending packet and path in the violation', () => {
    let message = '';
    try {
      assertSpecTestsProtected({
        id: 'p4',
        title: 'Broad',
        goal: 'g',
        scope: ['tests/**', 'src/**'],
        depends_on: [],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/p4/);
    expect(message).toMatch(/tests\/spec/);
  });

  it('describes a runtime violation the scheduler can put in the ledger', () => {
    const text = describeSpecTestViolation('tests/spec/layers.spec.ts');
    expect(text).toMatch(/tests\/spec\/layers\.spec\.ts/);
    expect(text).toMatch(/read-only/iu);
  });
});