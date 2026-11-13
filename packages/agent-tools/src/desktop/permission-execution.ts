import type { BashEnvPolicy } from '@alran/agent-core/bash-subprocess-env';

/**
 * In-process permission execution metadata. The carrier is deliberately a
 * non-enumerable symbol so it never enters the model-visible Bash schema or
 * serialized tool arguments.
 */
const LOCAL_PERMISSION_EXECUTION_PLAN = Symbol.for('@alran/permission/execution-plan');

type PermissionExecutionPlanCarrier = {
  [LOCAL_PERMISSION_EXECUTION_PLAN]?: unknown;
};

export type LocalPermissionExecutionPlan = Readonly<{
  nativeDelete?: boolean;
  /**
   * The whole `Co-Authored-By` line a `git commit` of this call carries, set by the host from the
   * turn's model; absent when commits are not to carry one. Travels with the plan so every Bash path
   * (foreground, managed, background) resolves it the same way.
   */
  commitTrailer?: string;
}>;

/** Local hosts resolve deletion policy from the approved invocation when present. */
export type LocalBashEnvPolicySource =
  | BashEnvPolicy
  | ((plan?: LocalPermissionExecutionPlan) => BashEnvPolicy);

export function resolvePermissionBashEnvPolicy(
  source: LocalBashEnvPolicySource,
  plan?: LocalPermissionExecutionPlan,
): BashEnvPolicy {
  return typeof source === 'function' ? source(plan) : source;
}

export function withPermissionExecutionPlan<T extends Record<string, unknown>>(
  input: T,
  plan: unknown,
): T {
  Object.defineProperty(input, LOCAL_PERMISSION_EXECUTION_PLAN, {
    value: plan,
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return input;
}

export function copyWithPermissionExecutionPlan<T extends Record<string, unknown>>(
  input: T,
  plan: unknown,
): T {
  return withPermissionExecutionPlan({ ...input } as T, plan);
}

export function readPermissionExecutionPlan(
  input: unknown,
): LocalPermissionExecutionPlan | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = (input as PermissionExecutionPlanCarrier)[LOCAL_PERMISSION_EXECUTION_PLAN];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as LocalPermissionExecutionPlan;
}

/** One printable line: what the host's `git` shim may put into a commit message verbatim. */
const SINGLE_LINE = /^[^\u0000-\u001f\u007f]{1,200}$/u;

/**
 * The plan of a call with the host's commit trailer added. A missing or unsafe trailer (an empty one, a
 * line break, a control character) leaves the plan as it is, so the shim sees no trailer at all.
 */
export function withCommitTrailer(
  plan: LocalPermissionExecutionPlan | undefined,
  trailer: string | undefined,
): LocalPermissionExecutionPlan | undefined {
  if (trailer === undefined || !SINGLE_LINE.test(trailer)) return plan;
  return { ...plan, commitTrailer: trailer };
}
