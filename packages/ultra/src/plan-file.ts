/**
 * Reading the plan of record.
 *
 * `plan.json` is what a run executed, what the report describes and what a
 * resume reads back. It is also the one file a human may edit before the
 * execution (spec 3.2: the gate commands are shown in the plan and can be
 * replaced), so it is validated again every time it is read.
 *
 * Reading it is a place where three different things can go wrong — the file is
 * gone, it is not JSON, or it breaks the rules of a plan — and all three
 * deserve a sentence a person can act on. A raw `JSON.parse` error or a
 * `TypeError` from deep inside the validator is neither.
 *
 * The helper lives in the core so the CLI and the TUI read a plan the same
 * way: the two surfaces share the state directory, and a rule that differs
 * between them is a rule one of them gets wrong.
 */

import { existsSync, readFileSync } from 'node:fs';
import { validatePlan } from './plan-schema.js';
import type { UltraPlan } from './types.js';

export type UltraPlanFile =
  /** The plan was read and it passes the plan rules. */
  | { readonly ok: true; readonly plan: UltraPlan }
  /** The plan could not be used; every problem found is listed. */
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Reads the plan at `path` and checks that it is a plan that may run.
 *
 * The problems are returned, not thrown: the caller is a command that has to
 * explain itself to a person, and a list of reasons is more useful than an
 * exception.
 */
export function readPlanFile(path: string): UltraPlanFile {
  if (!existsSync(path)) {
    return { ok: false, problems: [`there is no plan at ${path}`] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      problems: [`the plan at ${path} is not valid JSON: ${errorMessage(error)}`],
    };
  }

  if (!looksLikePlan(parsed)) {
    return { ok: false, problems: [`the plan at ${path} is not a plan (it has no packets)`] };
  }

  try {
    const validation = validatePlan(parsed);
    if (!validation.ok) {
      return { ok: false, problems: validation.problems };
    }
  } catch (error) {
    // The validator walks the plan without checking every field, so a plan
    // that is broken in a deeper way raises instead of reporting. That is
    // still a broken plan, and it still has to be explained.
    return {
      ok: false,
      problems: [`the plan at ${path} is not a usable plan: ${errorMessage(error)}`],
    };
  }

  return { ok: true, plan: parsed };
}

/** True when the value has the shape a plan has to have before it is walked. */
function looksLikePlan(value: unknown): value is UltraPlan {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Partial<UltraPlan>;
  return Array.isArray(plan.packets);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
