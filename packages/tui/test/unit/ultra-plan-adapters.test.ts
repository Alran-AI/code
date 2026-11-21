/**
 * The plan adapter (build step 2's runtime half).
 *
 * The plan phase itself is pure and well tested; what was missing is the piece
 * that supplies it from a real repository and a real model. These tests pin the
 * parts that can be checked without a model: the structured-output prompts carry
 * the explorers' findings, the JSON schemas match what the core validates, the
 * gate sources are read from the real project files, and a malformed planner
 * reply is rejected rather than guessed at.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLAN_SCHEMA,
  buildPlannerPrompt,
  buildScopePrompt,
  buildCriticPrompt,
  parseScopeVerdict,
  buildExplorerPrompt,
  createUltraPlanAdapters,
  parsePlanDraft,
  readGateSources,
} from '../../src/cli/ultra-plan-adapters.js';
import { validatePlan } from '@alran/ultra';
import type { ExplorerFinding } from '@alran/ultra';

const FINDINGS: ExplorerFinding[] = [
  { role: 'structure', text: 'Three packages: core, tui, ci-fix' },
  { role: 'tests', text: 'pnpm test runs vitest' },
  { role: 'risk', text: 'src/scheduler has shared mutable state' },
];

describe('prompts', () => {
  it('the explorer prompt states the role and forbids editing', () => {
    const prompt = buildExplorerPrompt({
      role: 'structure',
      systemPrompt: 'sys',
      userPrompt: 'Map the repo',
    });
    expect(prompt).toContain('Map the repo');
    expect(prompt).toMatch(/read.only|do not (edit|modify|write)/iu);
  });

  it('the planner prompt carries every explorer finding', () => {
    const prompt = buildPlannerPrompt({
      goal: 'Migrate the API',
      recipe: 'migrate',
      findings: FINDINGS,
    });
    expect(prompt).toContain('Migrate the API');
    expect(prompt).toContain('Three packages: core, tui, ci-fix');
    expect(prompt).toContain('pnpm test runs vitest');
    expect(prompt).toContain('shared mutable state');
  });

  it('the planner prompt states the overlap and spec-test rules', () => {
    const prompt = buildPlannerPrompt({ goal: 'g', recipe: 'auto', findings: [] });
    // Parallel packets may not overlap, and the spec tests are not writable.
    expect(prompt).toMatch(/overlap/iu);
    expect(prompt).toMatch(/tests\/spec/);
  });

  it('the critic prompt carries the draft and the validation problems', () => {
    const prompt = buildCriticPrompt({
      goal: 'g',
      recipe: 'auto',
      draft: [{ id: 'p1', title: 'A', goal: 'a', scope: ['src/a/**'], depends_on: [] }],
      validation: { ok: false, problems: ['packets p1 and p2 overlap'], waves: [] },
    });
    expect(prompt).toContain('p1');
    expect(prompt).toContain('packets p1 and p2 overlap');
  });

  it('the planner and critic prompts state the recipe rather than labelling it', () => {
    const planner = buildPlannerPrompt({ goal: 'migrate the old client', recipe: 'migrate', findings: [] });
    expect(planner).toContain('Recipe: migrate');
    expect(planner).toMatch(/How to cut the packets/iu);
    // The verifier runs after each packet, so the planner has to know what it checks.
    expect(planner).toMatch(/verifier/iu);

    const critic = buildCriticPrompt({
      goal: 'migrate the old client',
      recipe: 'migrate',
      draft: [{ id: 'p1', title: 'A', goal: 'a', scope: ['src/a/**'], depends_on: [] }],
      validation: { ok: true, problems: [], waves: [] },
    });
    // Extract-then-rewire ordering is a migration rule the critic must apply.
    expect(critic).toContain('Recipe: migrate');
    expect(critic).toMatch(/no dependencies|depends on it/iu);
  });

  it('the planner prompt says auto means the planner chooses', () => {
    const prompt = buildPlannerPrompt({ goal: 'g', recipe: 'auto', findings: [] });
    expect(prompt).toContain('Recipe: auto');
  });

  it('the scope prompt asks for a routing decision, not a plan', () => {
    const prompt = buildScopePrompt({ goal: 'Rename a variable', structure: 'small repo' });
    expect(prompt).toContain('Rename a variable');
    expect(prompt).toMatch(/justif/iu);
  });
});

describe('parsePlanDraft', () => {
  it('parses a well-formed planner reply', () => {
    const draft = parsePlanDraft(
      JSON.stringify({
        packets: [
          {
            id: 'p1',
            title: 'Extract types',
            goal: 'Move shared types',
            scope: ['src/types/**'],
            depends_on: [],
            accept: [{ cmd: 'pnpm test' }],
          },
        ],
      }),
    );
    expect(draft.packets).toHaveLength(1);
    expect(draft.packets[0]?.scope).toEqual(['src/types/**']);
  });

  it('rejects a reply that is not an object with packets', () => {
    expect(() => parsePlanDraft('not json')).toThrow(/could not read the plan/iu);
    expect(() => parsePlanDraft('{"items": []}')).toThrow(/packets/iu);
  });

  it('rejects a packet with no id', () => {
    expect(() =>
      parsePlanDraft(JSON.stringify({ packets: [{ title: 'A', goal: 'a', scope: ['src/**'], depends_on: [] }] })),
    ).toThrow(/id/iu);
  });

  it('accepts a reply wrapped in a markdown fence', () => {
    const draft = parsePlanDraft(
      ['```json', JSON.stringify({ packets: [{ id: 'p1', title: 'A', goal: 'a', scope: ['src/**'], depends_on: [] }] }), '```'].join(
        '\n',
      ),
    );
    expect(draft.packets).toHaveLength(1);
  });

  it('produces a plan that passes core validation', () => {
    const draft = parsePlanDraft(
      JSON.stringify({
        packets: [
          { id: 'p1', title: 'A', goal: 'a', scope: ['src/a/**'], depends_on: [] },
          { id: 'p2', title: 'B', goal: 'b', scope: ['src/b/**'], depends_on: ['p1'] },
        ],
      }),
    );
    const result = validatePlan({ goal: 'g', recipe: 'auto', packets: draft.packets });
    expect(result.ok).toBe(true);
  });
});

describe('readGateSources', () => {
  it('reads the real project files from a repository root', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gates-'));
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', build: 'tsc -p .' } }),
    );
    mkdirSync(path.join(dir, 'src'), { recursive: true });

    const sources = readGateSources(dir);
    expect(sources.packageJson?.scripts?.test).toBe('vitest run');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads pyproject and Cargo.toml when present', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gates-'));
    writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"\n');
    writeFileSync(path.join(dir, 'go.mod'), 'module x\n');
    writeFileSync(path.join(dir, 'Makefile'), 'test:\n\techo hi\n');

    const sources = readGateSources(dir);
    expect(sources.pyproject).toContain('[project]');
    expect(sources.cargo).toContain('[package]');
    expect(sources.goMod).toContain('module x');
    expect(sources.makefile).toContain('test:');
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty source set for a directory with no project files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gates-'));
    expect(readGateSources(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createUltraPlanAdapters', () => {
  it('exposes the five ports the plan phase needs', () => {
    const ports = createUltraPlanAdapters({ cwd: process.cwd(), env: process.env });
    expect(typeof ports.scope).toBe('function');
    expect(typeof ports.explore).toBe('function');
    expect(typeof ports.plan).toBe('function');
    expect(typeof ports.critique).toBe('function');
    expect(typeof ports.readGateSources).toBe('function');
  });

  it('separates "the model said no" from "the model did not answer"', () => {
    // A live run answered the scope check with a work report. Reading that as a
    // "no" ended the run with "this task does not need Ultra", which points at
    // the wrong problem: the routing call was broken, not the task.
    expect(parseScopeVerdict('YES — it touches three modules')).toEqual({
      decided: true,
      ok: true,
      reason: 'YES — it touches three modules',
    });
    expect(parseScopeVerdict('No, a small change.')).toEqual({
      decided: true,
      ok: false,
      reason: 'No, a small change.',
    });

    const undecided = parseScopeVerdict('Implemented it via TDD.\n\nChanges:\n- src/a.ts');
    expect(undecided.decided).toBe(false);
    // The reply is kept as the reason, so the failure says what came back.
    expect(undecided.reason).toContain('Implemented it via TDD');
  });

  it('the planner schema requires the fields the core validates', () => {
    expect(PLAN_SCHEMA.required).toContain('packets');
    const item = PLAN_SCHEMA.properties.packets.items;
    expect(item.required).toEqual(
      expect.arrayContaining(['id', 'title', 'goal', 'scope', 'depends_on']),
    );
  });
});