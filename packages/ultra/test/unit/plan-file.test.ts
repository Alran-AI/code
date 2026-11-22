/**
 * Reading the plan of record.
 *
 * The plan on disk is the plan the run executed. It is read by the CLI, by
 * the TUI board and by a resume, and it is validated every time: a plan that
 * a human edited may break the rules the planner passed.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPlanFile } from '../../src/plan-file.js';
import type { UltraPlan } from '../../src/types.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-plan-file-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function plan(): UltraPlan {
  return {
    goal: 'do the thing',
    recipe: 'auto',
    packets: [{ id: 'p1', title: 'the work', goal: 'do it', scope: ['src/**'], depends_on: [] }],
  };
}

function write(dir: string, content: string): string {
  const file = path.join(dir, 'plan.json');
  writeFileSync(file, content);
  return file;
}

describe('readPlanFile', () => {
  it('reads a valid plan', () => {
    const file = write(tempDir(), `${JSON.stringify(plan())}\n`);
    const result = readPlanFile(file);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.plan.packets.length : 0).toBe(1);
  });

  it('says so when there is no plan at all', () => {
    const result = readPlanFile(path.join(tempDir(), 'plan.json'));
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toMatch(/no plan/iu);
  });

  it('explains a plan that is not JSON instead of raising', () => {
    const file = write(tempDir(), '{ this is not json');
    const result = readPlanFile(file);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toMatch(/not valid JSON/iu);
  });

  it('explains a plan that is not a plan', () => {
    const file = write(tempDir(), '{"goal":"x"}');
    const result = readPlanFile(file);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toMatch(/not a plan/iu);
  });

  it('lists the problems of a plan that breaks the rules', () => {
    // Two parallel packets with overlapping scope is the plan rule (ULT-07).
    const broken = plan();
    broken.packets = [
      { id: 'p1', title: 'a', goal: 'g', scope: ['src/**'], depends_on: [] },
      { id: 'p2', title: 'b', goal: 'g', scope: ['src/other/**'], depends_on: [] },
    ];
    const file = write(tempDir(), `${JSON.stringify(broken)}\n`);
    const result = readPlanFile(file);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toMatch(/overlapping scope/iu);
  });

  it('explains a plan that is broken deeper than the validator checks', () => {
    // A packet without `depends_on` makes the validator raise. The reader has
    // to turn that into a sentence about the plan.
    const file = write(tempDir(), '{"goal":"x","packets":[{"id":"p1","title":"a","goal":"g","scope":["src/**"]}]}');
    const result = readPlanFile(file);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toMatch(/not a usable plan/iu);
  });
});
