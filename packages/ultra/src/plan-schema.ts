/**
 * Plan schema validation.
 *
 * A plan is a DAG of packets. The harness refuses a plan whose parallel packets
 * have overlapping `scope` (two workers editing the same files in separate
 * worktrees would silently conflict), and rejects unknown dependencies,
 * dependency cycles, duplicate ids, and packets with no goal or scope. The
 * validated plan also yields the deterministic parallel waves the scheduler
 * will run.
 */

import type { PacketStatus, PlanPacket, PlanValidation, UltraPlan } from './types.js';
import { assertSpecTestsProtected, SPEC_TEST_DIR } from './spec-tests.js';

function normalize(glob: string): string {
  return glob.trim().replace(/\\/gu, '/').replace(/\/+$/u, '').replace(/^\.\//u, '');
}

/**
 * True when two writable globs can touch the same file. This is a conservative
 * prefix test, not a full glob matcher: `src/a/**` overlaps `src/a/b.ts`, and a
 * shared literal prefix (`src/scheduler`) is treated as overlap because the
 * two scopes cannot be proven disjoint.
 */
export function scopesOverlap(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);
  const stripGlob = (value: string): string => value.replace(/\/\*\*?$/u, '');
  const baseA = stripGlob(a);
  const baseB = stripGlob(b);
  if (baseA === baseB) return true;
  return (
    baseA.startsWith(`${baseB}/`) ||
    baseB.startsWith(`${baseA}/`) ||
    // A literal file path and a directory glob that contains it.
    a === baseB ||
    b === baseA
  );
}

/** True when `id` depends on `target`, directly or transitively. */
function dependsTransitively(
  byId: ReadonlyMap<string, PlanPacket>,
  id: string,
  target: string,
  seen = new Set<string>(),
): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const packet = byId.get(id);
  if (!packet) return false;
  return packet.depends_on.some(
    (dependency) => dependency === target || dependsTransitively(byId, dependency, target, seen),
  );
}

/**
 * Finds the first pair of packets whose scopes overlap *and* run in parallel.
 * Two packets that are ordered by `depends_on` may legitimately touch the same
 * files, because the scheduler never runs them at the same time.
 */
function findScopeOverlap(
  packets: readonly PlanPacket[],
): { a: PlanPacket; b: PlanPacket; left: string; right: string } | undefined {
  const byId = new Map(packets.map((packet) => [packet.id, packet]));
  for (let i = 0; i < packets.length; i += 1) {
    for (let j = i + 1; j < packets.length; j += 1) {
      const a = packets[i];
      const b = packets[j];
      if (!a || !b) continue;
      if (
        dependsTransitively(byId, a.id, b.id) ||
        dependsTransitively(byId, b.id, a.id)
      ) {
        continue;
      }
      for (const left of a.scope) {
        for (const right of b.scope) {
          if (scopesOverlap(left, right)) return { a, b, left, right };
        }
      }
    }
  }
  return undefined;
}

/** Detects a cycle via depth-first search over `depends_on`. */
function findCycle(packets: readonly PlanPacket[]): string[] | undefined {
  const byId = new Map(packets.map((packet) => [packet.id, packet]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | undefined => {
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (visited.has(id)) return undefined;
    const packet = byId.get(id);
    if (!packet) return undefined;
    visiting.add(id);
    stack.push(id);
    for (const dependency of packet.depends_on) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    stack.pop();
    visited.add(id);
    return undefined;
  };

  for (const packet of packets) {
    const cycle = visit(packet.id);
    if (cycle) return cycle;
  }
  return undefined;
}

/** Lazily yields parallel waves in dependency order; each wave is sorted by id. */
function computeWaves(packets: readonly PlanPacket[]): string[][] {
  const pending = new Map(packets.map((packet) => [packet.id, packet]));
  const done = new Set<string>();
  const waves: string[][] = [];
  while (pending.size > 0) {
    const wave = [...pending.values()]
      .filter((packet) => packet.depends_on.every((dependency) => done.has(dependency)))
      .map((packet) => packet.id)
      .sort();
    if (wave.length === 0) break; // unreachable after a cycle check; guard anyway.
    for (const id of wave) {
      pending.delete(id);
      done.add(id);
    }
    waves.push(wave);
  }
  return waves;
}

/**
 * Validates a plan and returns every problem found, not just the first, so a
 * plan-only run can report all of them at once. `waves` is only populated for
 * a valid plan.
 */
export function validatePlan(plan: UltraPlan, specTestDir: string = SPEC_TEST_DIR): PlanValidation {
  const problems: string[] = [];
  const packets = plan.packets;

  if (packets.length === 0) problems.push('the plan contains no packets');

  const seen = new Set<string>();
  for (const packet of packets) {
    if (!packet.id || !packet.id.trim()) {
      problems.push('a packet has an empty id');
      continue;
    }
    if (seen.has(packet.id)) problems.push(`duplicate packet id ${packet.id}`);
    seen.add(packet.id);
    if (!packet.goal || !packet.goal.trim()) {
      problems.push(`packet ${packet.id} has no goal`);
    }
    if (!packet.scope || packet.scope.length === 0) {
      problems.push(`packet ${packet.id} has an empty scope`);
    }
  }

  for (const packet of packets) {
    for (const dependency of packet.depends_on) {
      if (!seen.has(dependency)) {
        problems.push(`packet ${packet.id} has an unknown dependency ${dependency}`);
      }
    }
  }

  const cycle = findCycle(packets);
  if (cycle) problems.push(`dependency cycle: ${cycle.join(' → ')}`);

  // ULT-13: no packet may have a scope that reaches the frozen spec tests, or a
  // worker could rewrite the checks that judge it. Rejected here, before any
  // worktree exists.
  for (const packet of packets) {
    try {
      assertSpecTestsProtected(packet, specTestDir);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const overlap = findScopeOverlap(packets);
  if (overlap) {
    problems.push(
      `packets ${overlap.a.id} and ${overlap.b.id} have overlapping scope (${overlap.left} vs ${overlap.right}); parallel work on the same files would conflict`,
    );
  }

  const ok = problems.length === 0;
  return { ok, problems, waves: ok ? computeWaves(packets) : [] };
}

/** Type guard used by the scheduler to narrow a packet row to a terminal status. */
export function isTerminalPacketStatus(status: PacketStatus): boolean {
  return status === 'done' || status === 'blocked' || status === 'skipped' || status === 'cancelled';
}
