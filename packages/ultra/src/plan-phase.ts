/**
 * Plan phase for Ultra (build step 2).
 *
 * SCOPE → PLAN: a cheap scope check, three read-only explorer roles, one critic
 * that checks packet boundaries, and a validated `plan.json`. The phase is
 * written against ports so the same orchestration runs on the real runtime
 * adapter, in tests with fakes, and later in a cloud runner.
 *
 * Nothing here executes a packet; `alran ultra plan` stops after this module so
 * plan-only mode is a first-class entry point.
 */

import { detectUltraGates, type UltraGateSources } from './gates.js';
import { validatePlan } from './plan-schema.js';
import type {
  PlanPacket,
  PlanValidation,
  UltraGates,
  UltraPlan,
  UltraRecipeChoice,
} from './types.js';

/** Model identity for one planning role. */
export interface PlannerRoleConfig {
  readonly planner: string;
  readonly critic: string;
  readonly explorers?: number;
}

export interface ExplorerBrief {
  readonly role: 'structure' | 'tests' | 'risk';
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export interface ExplorerFinding {
  readonly role: ExplorerBrief['role'];
  readonly text: string;
  readonly costUsd?: number;
  readonly tokensUsed?: number;
}

export interface CriticVerdict {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly costUsd?: number;
}

/** What the planner returns before validation. */
export interface PlannerDraft {
  readonly packets: readonly PlanPacket[];
  readonly costUsd?: number;
  readonly tokensUsed?: number;
}

export interface UltraPlanPorts {
  /** Whether this task justifies Ultra at all; a routing decision, not a plan. */
  readonly scope: (input: {
    readonly goal: string;
    readonly structure: string;
  }) => Promise<{ ok: boolean; reason: string }>;
  readonly explore: (brief: ExplorerBrief) => Promise<ExplorerFinding>;
  readonly plan: (input: {
    readonly goal: string;
    readonly recipe: UltraRecipeChoice;
    readonly findings: readonly ExplorerFinding[];
    readonly model: string;
  }) => Promise<PlannerDraft>;
  readonly critique: (input: {
    readonly goal: string;
    /**
     * The recipe the plan must obey. The critic checks packet boundaries
     * against the recipe's ordering rules, so it has to see which one applies
     * rather than guessing from the packet titles.
     */
    readonly recipe: UltraRecipeChoice;
    readonly draft: readonly PlanPacket[];
    readonly validation: PlanValidation;
    readonly model: string;
  }) => Promise<CriticVerdict>;
  /** Reads the well-known project files so gate detection is shared, not duplicated. */
  readonly readGateSources: () => Promise<UltraGateSources>;
}

export interface PlanRunInput {
  readonly goal: string;
  readonly recipe: UltraRecipeChoice;
  readonly roles: PlannerRoleConfig;
  readonly ports: UltraPlanPorts;
  /** Overrides auto-detected gates; the plan shows whichever wins. */
  readonly gateOverrides?: Partial<UltraGates>;
}

export interface PlanRunResult {
  readonly plan: UltraPlan;
  readonly validation: PlanValidation;
  readonly findings: readonly ExplorerFinding[];
  readonly critic: CriticVerdict;
  readonly costUsd: number;
  /** Present when the scope check said this task is not worth Ultra. */
  readonly declined?: string;
}

const EXPLORER_PROMPTS: Record<ExplorerBrief['role'], string> = {
  structure:
    'Map the repository structure and dependency graph. Identify modules, entry points, and which directories can be changed independently.',
  tests:
    'Report how tests and build commands work here: which commands run which tests, what the project-wide gate is, and which suites are slow or flaky.',
  risk:
    'Identify risk areas for a large multi-packet change: shared mutable state, generated files, migration ordering hazards, and files that must not be touched.',
};

/**
 * Runs the full planning phase. The scope check runs first and short-circuits
 * with a decline; otherwise explorers run in parallel, the planner drafts, and
 * the critic reviews the validated draft. A failed critic still returns the
 * plan, with the problems attached, so plan-only mode can show what is wrong.
 */
export async function runPlanPhase(input: PlanRunInput): Promise<PlanRunResult> {
  const { ports, roles } = input;

  // The structure explorer is also the scope check's only evidence source.
  const structure = await ports.explore({
    role: 'structure',
    systemPrompt: EXPLORER_PROMPTS.structure,
    userPrompt: `Task: ${input.goal}`,
  });

  const scope = await ports.scope({ goal: input.goal, structure: structure.text });
  if (!scope.ok) {
    return {
      plan: { goal: input.goal, recipe: input.recipe, packets: [] },
      validation: { ok: false, problems: [scope.reason], waves: [] },
      findings: [structure],
      critic: { ok: false, problems: [scope.reason] },
      costUsd: structure.costUsd ?? 0,
      declined: scope.reason,
    };
  }

  const otherRoles: ExplorerBrief['role'][] = ['tests', 'risk'];
  const others = await Promise.all(
    otherRoles.map((role) =>
      ports.explore({ role, systemPrompt: EXPLORER_PROMPTS[role], userPrompt: `Task: ${input.goal}` }),
    ),
  );
  const findings: ExplorerFinding[] = [structure, ...others];

  const draft = await ports.plan({
    goal: input.goal,
    recipe: input.recipe,
    findings,
    model: roles.planner,
  });

  const gates = input.gateOverrides
    ? mergeGates(await ports.readGateSources(), input.gateOverrides)
    : detectUltraGates(await ports.readGateSources());

  const plan: UltraPlan = {
    goal: input.goal,
    recipe: input.recipe,
    packets: draft.packets,
    gates,
  };
  const validation = validatePlan(plan);

  const critic = await ports.critique({
    goal: input.goal,
    recipe: input.recipe,
    draft: draft.packets,
    validation,
    model: roles.critic,
  });

  const costUsd =
    findings.reduce((sum, finding) => sum + (finding.costUsd ?? 0), 0) +
    (draft.costUsd ?? 0) +
    (critic.costUsd ?? 0);

  return { plan, validation, findings, critic, costUsd };
}

function mergeGates(sources: UltraGateSources, overrides: Partial<UltraGates>): UltraGates {
  const detected = detectUltraGates(sources);
  return {
    test: overrides.test ?? detected.test,
    lint: overrides.lint ?? detected.lint,
    build: overrides.build ?? detected.build,
  };
}

/**
 * JSON Schema for the planner's structured output. Keeping it here means the
 * prompt and the validator cannot drift apart: `alran exec --output-schema`
 * rejects a draft that this schema would also reject.
 */
export const ULTRA_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['packets'],
  properties: {
    packets: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'goal', 'scope', 'depends_on'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
          title: { type: 'string', minLength: 1 },
          goal: { type: 'string', minLength: 1 },
          scope: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          readonly: { type: 'array', items: { type: 'string', minLength: 1 } },
          depends_on: { type: 'array', items: { type: 'string', minLength: 1 } },
          accept: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['cmd'],
              properties: {
                cmd: { type: 'string', minLength: 1 },
                must: { type: 'string', enum: ['exit0'] },
              },
            },
          },
          max_repairs: { type: 'integer', minimum: 0 },
          est_tokens: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
} as const;
