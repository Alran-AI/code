import { describe, expect, it } from 'vitest';
import { detectUltraGates } from '../../src/gates.js';
import { runPlanPhase, ULTRA_PLAN_SCHEMA, type UltraPlanPorts } from '../../src/plan-phase.js';

// Gate detection must agree with the CI Fixer's inference so Ultra and CI Fix
// never disagree about what "test" means in the same repository.
describe('gate detection', () => {
  it('uses npm scripts when a package.json is present', () => {
    const gates = detectUltraGates({
      packageJson: { scripts: { test: 'vitest', lint: 'eslint .', build: 'tsc' } },
    });
    expect(gates.test).toEqual(['npm run test']);
    expect(gates.lint).toEqual(['npm run lint']);
    expect(gates.build).toEqual(['npm run build']);
  });

  it('fills an empty slot from the Makefile when npm has no such script', () => {
    const gates = detectUltraGates({
      packageJson: { scripts: { test: 'vitest' } },
      makefile: 'test:\n\techo hi\nlint:\n\techo lint\n',
    });
    expect(gates.test).toEqual(['npm run test']);
    expect(gates.lint).toEqual(['make lint']);
  });

  it('falls back to language defaults for a Python-only project', () => {
    const gates = detectUltraGates({ pyproject: '[tool.pytest.ini_options]\n' });
    expect(gates.test).toEqual(['pytest']);
  });

  it('returns empty slots when nothing is detectable', () => {
    expect(detectUltraGates({})).toEqual({ test: [], lint: [], build: [] });
  });
});

function fakePorts(overrides: Partial<UltraPlanPorts> = {}): UltraPlanPorts {
  return {
    scope: async () => ({ ok: true, reason: 'large enough' }),
    explore: async (brief) => ({ role: brief.role, text: `${brief.role} findings`, costUsd: 0.01 }),
    plan: async () => ({
      packets: [
        { id: 'p1', title: 'A', goal: 'A', scope: ['src/a/**'], depends_on: [] },
        { id: 'p2', title: 'B', goal: 'B', scope: ['src/b/**'], depends_on: ['p1'] },
      ],
      costUsd: 0.05,
    }),
    critique: async () => ({ ok: true, problems: [], costUsd: 0.02 }),
    readGateSources: async () => ({ packageJson: { scripts: { test: 'vitest' } } }),
    ...overrides,
  };
}

const roles = { planner: 'ottili/werk-1.1', critic: 'ottili/werk-1.1' };

describe('plan phase', () => {
  it('runs three explorers, the planner, and the critic in one pass', async () => {
    const rolesSeen: string[] = [];
    const ports = fakePorts({
      explore: async (brief) => {
        rolesSeen.push(brief.role);
        return { role: brief.role, text: `${brief.role} findings`, costUsd: 0.01 };
      },
    });
    const result = await runPlanPhase({ goal: 'migrate', recipe: 'auto', roles, ports });
    expect(rolesSeen.sort()).toEqual(['risk', 'structure', 'tests']);
    expect(result.validation.ok).toBe(true);
    expect(result.plan.gates?.test).toEqual(['npm run test']);
    expect(result.findings).toHaveLength(3);
  });

  it('declines a task the scope check rejects, without planning', async () => {
    let planned = false;
    const ports = fakePorts({
      scope: async () => ({ ok: false, reason: 'one file, use the normal agent' }),
      plan: async () => {
        planned = true;
        return { packets: [] };
      },
    });
    const result = await runPlanPhase({ goal: 'fix a typo', recipe: 'auto', roles, ports });
    expect(planned).toBe(false);
    expect(result.declined).toContain('normal agent');
    expect(result.plan.packets).toEqual([]);
  });

  it('surfaces an invalid draft through the critic instead of throwing', async () => {
    const ports = fakePorts({
      plan: async () => ({
        packets: [
          { id: 'p1', title: 'A', goal: 'A', scope: ['src/x/**'], depends_on: [] },
          { id: 'p2', title: 'B', goal: 'B', scope: ['src/x/y.ts'], depends_on: [] },
        ],
      }),
      critique: async ({ validation }) => ({
        ok: false,
        problems: validation.problems,
      }),
    });
    const result = await runPlanPhase({ goal: 'g', recipe: 'auto', roles, ports });
    expect(result.validation.ok).toBe(false);
    expect(result.critic.ok).toBe(false);
    expect(result.critic.problems.join(' ')).toMatch(/overlap/iu);
  });

  it('sums cost across explorers, planner and critic', async () => {
    const result = await runPlanPhase({ goal: 'g', recipe: 'auto', roles, ports: fakePorts() });
    // 3 explorers × 0.01 + 0.05 planner + 0.02 critic
    expect(result.costUsd).toBeCloseTo(0.1, 10);
  });

  it('applies gate overrides without discarding the other detected slots', async () => {
    const ports = fakePorts({
      readGateSources: async () => ({
        packageJson: { scripts: { test: 'vitest', lint: 'eslint .' } },
      }),
    });
    const result = await runPlanPhase({
      goal: 'g',
      recipe: 'auto',
      roles,
      ports,
      gateOverrides: { test: ['pnpm test:unit'] },
    });
    expect(result.plan.gates?.test).toEqual(['pnpm test:unit']);
    expect(result.plan.gates?.lint).toEqual(['npm run lint']);
  });

  it('exposes a schema that matches the packet shape the planner must emit', () => {
    const item = ULTRA_PLAN_SCHEMA.properties.packets.items;
    expect(item.required).toEqual(['id', 'title', 'goal', 'scope', 'depends_on']);
    expect(item.properties.accept.items.properties.must.enum).toEqual(['exit0']);
  });
});
