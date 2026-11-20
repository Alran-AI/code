/**
 * Spec tests (spec 13.2, ULT-13).
 *
 * The spec tests are the executable form of the goal document's criteria. They
 * are written before any worker starts, and they are the one part of the
 * repository no worker may touch: a run that could edit its own acceptance
 * checks could pass by weakening them, which is the exact fake-fix the design
 * exists to catch.
 *
 * This module is pure. It does not write test files — the `spec_tester` agent
 * does that — it defines *where* they live, which paths are frozen, and whether
 * a packet's scope is compatible with that freeze.
 */

import type { PlanPacket } from './types.js';

/**
 * Directory the spec tests live in. Chosen to be conventional and easy to add to
 * a repo's own tooling; a project that already uses another location can set
 * `specTestDir` on the run instead.
 */
export const SPEC_TEST_DIR = 'tests/spec';

/** Paths that are read-only for every worker, whatever the packet scope says. */
export function specTestDenyPaths(specTestDir: string = SPEC_TEST_DIR): string[] {
  return [`${specTestDir}/**`];
}

/** True when a repo-relative path is one of the frozen spec tests. */
export function isSpecTestPath(file: string, specTestDir: string = SPEC_TEST_DIR): boolean {
  const normalized = file.trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  const prefix = `${specTestDir}/`;
  return normalized.startsWith(prefix);
}

/**
 * True when a writable scope glob could reach the spec tests.
 *
 * This is deliberately conservative: `**` and `*` both match, because a scope
 * that *might* include the spec tests is enough to reject. A plan that wants to
 * work near them has to say so precisely and keep them out.
 */
function scopeReachesSpecTests(scope: readonly string[], specTestDir: string): boolean {
  const prefix = `${specTestDir}/`;
  for (const raw of scope) {
    const glob = raw.trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
    if (glob.length === 0) continue;
    if (glob === '**' || glob === '*' || glob === specTestDir || glob === `${specTestDir}/**`) {
      return true;
    }
    // A leading `**/` reaches every directory, including this one.
    if (glob.startsWith('**/')) return true;
    // An ancestor directory glob: `tests/**` covers `tests/spec/**`.
    if (prefix.startsWith(`${glob.replace(/\/\*\*$/u, '')}/`)) return true;
    // A literal path inside the spec dir.
    if (isSpecTestPath(glob, specTestDir)) return true;
  }
  return false;
}

/**
 * Refuses a plan that would let a worker edit the spec tests.
 *
 * Called at plan validation, so a bad plan is rejected before any worktree is
 * created rather than discovered after a worker has already changed the checks.
 */
export function assertSpecTestsProtected(
  packet: PlanPacket,
  specTestDir: string = SPEC_TEST_DIR,
): void {
  if (scopeReachesSpecTests(packet.scope, specTestDir)) {
    throw new Error(
      `packet ${packet.id} has a scope that reaches ${specTestDir}/: the spec tests are read-only for every worker, so a run cannot edit its own acceptance checks`,
    );
  }
}

/** The ledger/report line for a worker that changed a spec test anyway. */
export function describeSpecTestViolation(file: string): string {
  return `${file} is a spec test and is read-only for workers; the change was reverted`;
}