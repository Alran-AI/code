/**
 * Branch and tag names for a run (spec 3.3, 4.3, 13.5).
 *
 * These live in one module because git's ref namespace makes the naming a
 * correctness issue, not a cosmetic one: a ref stored as a file cannot coexist
 * with a ref of the same name stored as a directory. So `ultra/<run>` (the
 * branch the human merges) and `ultra/<run>/<packet>` (a packet's branch) can
 * never both exist — the second makes the first impossible, and every integrate
 * fails with "cannot lock ref ... exists; cannot create".
 *
 * Packet and spec-test branches are therefore siblings of the run branch:
 *
 *   ultra/<run>              the integrated result; the human merges this
 *   ultra/<run>-<packet>     one per packet
 *   ultra/<run>-spec-tests   the frozen acceptance checks
 *   ultra/<run>/round-N      checkpoint tags (a different namespace; no clash)
 *
 * Keeping the naming here means a new kind of ref cannot be added without
 * seeing the collision rule that constrains all of them.
 */

/** The integrated branch for a run; this is the name the report prints. */
export function runBranchFor(runId: string): string {
  return `ultra/${runId}`;
}

/**
 * A packet's branch.
 *
 * Deliberately a sibling of the run branch rather than a child: see the module
 * comment for why a child would make `git branch ultra/<run>` fail forever.
 */
export function packetBranchFor(runId: string, packetId: string): string {
  return `ultra/${runId}-${packetId}`;
}

/** The branch carrying the authored spec tests for a run. */
export function specTestBranchFor(runId: string): string {
  return `ultra/${runId}-spec-tests`;
}

/** The per-round checkpoint tag (spec 13.5). */
export function checkpointTagFor(runId: string, round: number): string {
  return `ultra/${runId}/round-${round}`;
}