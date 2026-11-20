import { describe, expect, it } from 'vitest';
import { checkScope } from '../../src/scope-guard.js';

// ULT-02: a change outside `scope` or inside `readonly` is rejected. This is
// the pure decision; the scheduler resets the worktree and counts a repair.
describe('scope guard', () => {
  it('accepts changes that are all inside the writable scope', () => {
    const result = checkScope({
      changedFiles: ['src/scheduler/queue.ts', 'src/scheduler/lock.ts'],
      scope: ['src/scheduler/**'],
      readonly: [],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects a change outside the writable scope', () => {
    const result = checkScope({
      changedFiles: ['src/scheduler/queue.ts', 'src/billing/invoice.ts'],
      scope: ['src/scheduler/**'],
      readonly: [],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { file: 'src/billing/invoice.ts', reason: 'outside-scope' },
    ]);
  });

  it('rejects a change to a readonly path even when it is inside scope', () => {
    const result = checkScope({
      changedFiles: ['src/scheduler/queue.ts', 'src/types/scheduler.ts'],
      scope: ['src/**'],
      readonly: ['src/types/**'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { file: 'src/types/scheduler.ts', reason: 'readonly' },
    ]);
  });

  it('reports readonly ahead of outside-scope for the same file', () => {
    const result = checkScope({
      changedFiles: ['src/types/scheduler.ts'],
      scope: ['src/scheduler/**'],
      readonly: ['src/types/**'],
    });
    expect(result.violations).toEqual([{ file: 'src/types/scheduler.ts', reason: 'readonly' }]);
  });

  it('accepts an empty change set; a no-op packet is decided by the gate, not here', () => {
    expect(checkScope({ changedFiles: [], scope: ['src/a/**'], readonly: [] })).toEqual({
      ok: true,
      violations: [],
    });
  });

  it('matches a literal file scope exactly', () => {
    expect(
      checkScope({ changedFiles: ['src/a.ts'], scope: ['src/a.ts'], readonly: [] }).ok,
    ).toBe(true);
    expect(
      checkScope({ changedFiles: ['src/a.ts.bak'], scope: ['src/a.ts'], readonly: [] }).ok,
    ).toBe(false);
  });

  it('matches a root-level file with a leading **/ pattern', () => {
    expect(
      checkScope({ changedFiles: ['README.md'], scope: ['**/*.md'], readonly: [] }).ok,
    ).toBe(true);
  });
});

describe('glob depth', () => {
  it('matches a nested glob at zero depth, so src/**/*.ts covers src/a.ts', () => {
    const result = checkScope({
      changedFiles: ['src/a.ts', 'src/x/b.ts'],
      scope: ['src/**/*.ts'],
      readonly: [],
    });
    expect(result.ok).toBe(true);
  });

  it('matches a middle **/ at zero depth', () => {
    expect(
      checkScope({ changedFiles: ['lib/index.ts'], scope: ['lib/**/index.ts'], readonly: [] }).ok,
    ).toBe(true);
  });

  it('still rejects a file outside the expanded scope', () => {
    expect(
      checkScope({ changedFiles: ['other/a.ts'], scope: ['src/**/*.ts'], readonly: [] }).ok,
    ).toBe(false);
  });

  // `readonly` must get the same zero-depth treatment as `scope`. Without it a
  // plan that marks `src/types/**/*.ts` read-only silently allows an edit to
  // `src/types/a.ts`, which is the exact file the planner meant to protect.
  it('expands a readonly glob at zero depth too', () => {
    const result = checkScope({
      changedFiles: ['src/types/a.ts'],
      scope: ['src/**'],
      readonly: ['src/types/**/*.ts'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ file: 'src/types/a.ts', reason: 'readonly' }]);
  });

  it('still allows a file the readonly glob does not cover', () => {
    expect(
      checkScope({
        changedFiles: ['src/types/a.js'],
        scope: ['src/**'],
        readonly: ['src/types/**/*.ts'],
      }).ok,
    ).toBe(true);
  });
});
