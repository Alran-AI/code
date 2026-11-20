/**
 * Spec-test authoring (spec 13.2, ULT-13).
 *
 * The freeze is only meaningful if something actually writes the frozen checks
 * before the first worker starts. These tests pin the authoring step: it turns
 * criteria into one test file per criterion, refuses a criterion it cannot
 * express, and writes into the frozen directory — so the files it produces are
 * immediately covered by the read-only rule the workers obey.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SPEC_TEST_FILENAME,
  buildSpecTestPrompt,
  createFileSpecTestWriter,
  parseSpecTestReply,
  renderSpecTest,
  specTestFileFor,
} from '../../src/spec-authoring.js';
import { parseGoalDocument, type Criterion } from '../../src/goal.js';
import { SPEC_TEST_DIR, isSpecTestPath } from '../../src/spec-tests.js';

const GOAL = parseGoalDocument({
  goal: 'Build a drawing app',
  criteria: [
    { id: 'C1', priority: 'must', verification: 'scenario', description: 'A user can create, move and hide layers' },
    { id: 'C2', priority: 'should', verification: 'command', description: 'Export writes a PNG via `app export out.png`' },
  ],
});

const CRITERIA: Criterion[] = GOAL.criteria;

describe('specTestFileFor', () => {
  it('maps a criterion id to a file inside the frozen directory', () => {
    const file = specTestFileFor('C1');
    expect(file.startsWith(`${SPEC_TEST_DIR}/`)).toBe(true);
    // And the file it names is one the workers must not touch.
    expect(isSpecTestPath(file)).toBe(true);
  });

  it('derives a readable filename from the id', () => {
    // Lower-cased so the file name is stable across case-insensitive filesystems.
    expect(specTestFileFor('C1')).toMatch(/c1/u);
    expect(SPEC_TEST_FILENAME).toMatch(/\.spec\.[cm]?[jt]s$/u);
  });
});

describe('buildSpecTestPrompt', () => {
  it('carries every criterion with its verification method', () => {
    const prompt = buildSpecTestPrompt({ goal: GOAL, specTestDir: SPEC_TEST_DIR });
    expect(prompt).toContain('C1');
    expect(prompt).toContain('C2');
    expect(prompt).toContain('scenario');
    expect(prompt).toContain('command');
  });

  it('states that the files are frozen and must fail before the work exists', () => {
    const prompt = buildSpecTestPrompt({ goal: GOAL, specTestDir: SPEC_TEST_DIR });
    // The point of a spec test is that it fails until the feature exists.
    expect(prompt).toMatch(/fail|red/iu);
    expect(prompt).toMatch(/read.only|frozen|do not edit/iu);
  });

  it('names the directory the agent must write into', () => {
    const prompt = buildSpecTestPrompt({ goal: GOAL, specTestDir: 'tests/spec' });
    expect(prompt).toContain('tests/spec');
  });
});

describe('renderSpecTest', () => {
  it('renders a criterion as a test file with the goal in it', () => {
    const rendered = renderSpecTest(CRITERIA[0]!, { specTestDir: SPEC_TEST_DIR });
    expect(rendered.file).toBe(specTestFileFor('C1'));
    expect(rendered.content).toContain('A user can create, move and hide layers');
    expect(rendered.content).toContain('C1');
  });

  it('marks the file as generated so nobody edits it by hand', () => {
    const rendered = renderSpecTest(CRITERIA[0]!, { specTestDir: SPEC_TEST_DIR });
    expect(rendered.content).toMatch(/generated|do not edit/iu);
  });
});

describe('parseSpecTestReply', () => {
  it('reads a fenced reply into files inside the frozen directory', () => {
    const reply = [
      'Here are the spec tests.',
      '',
      '```file tests/spec/c1-layers.spec.ts',
      'export const check = () => "layers";',
      '```',
    ].join('\n');
    const files = parseSpecTestReply(reply, SPEC_TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0]?.file).toBe('tests/spec/c1-layers.spec.ts');
    expect(files[0]?.content).toContain('export const check');
  });

  it('rejects a file written outside the frozen directory', () => {
    // The agent must not be able to smuggle the checks somewhere a worker could
    // edit them, or somewhere nothing would run.
    const reply = ['```file tests/unit/cheat.spec.ts', 'x', '```'].join('\n');
    expect(() => parseSpecTestReply(reply, SPEC_TEST_DIR)).toThrow(/tests\/spec/iu);
  });

  it('rejects a reply with no files', () => {
    expect(() => parseSpecTestReply('I could not write the tests.', SPEC_TEST_DIR)).toThrow(
      /no files|no test files/iu,
    );
  });

  it('accepts several files in one reply', () => {
    const reply = [
      '```file tests/spec/c1.spec.ts',
      'a',
      '```',
      '```file tests/spec/c2.spec.ts',
      'b',
      '```',
    ].join('\n');
    expect(parseSpecTestReply(reply, SPEC_TEST_DIR)).toHaveLength(2);
  });
});

describe('createFileSpecTestWriter', () => {
  it('writes the files under the run directory so they can be reviewed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spec-'));
    const writer = createFileSpecTestWriter(dir);
    writer.write({
      files: [{ file: 'tests/spec/c1.spec.ts', content: '// c1\n' }],
    });
    const written = readFileSync(path.join(dir, 'tests/spec/c1.spec.ts'), 'utf8');
    expect(written).toBe('// c1\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses a file path that escapes the target directory', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spec-'));
    const writer = createFileSpecTestWriter(dir);
    expect(() =>
      writer.write({ files: [{ file: '../escape.spec.ts', content: 'x' }] }),
    ).toThrow(/outside/iu);
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists what it wrote so the caller can report it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spec-'));
    const writer = createFileSpecTestWriter(dir);
    writer.write({
      files: [
        { file: 'tests/spec/c1.spec.ts', content: 'a' },
        { file: 'tests/spec/c2.spec.ts', content: 'b' },
      ],
    });
    expect(readdirSync(path.join(dir, 'tests/spec')).sort()).toEqual([
      'c1.spec.ts',
      'c2.spec.ts',
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('end-to-end authoring', () => {
  it('produces files that the freeze then protects', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'spec-'));
    const writer = createFileSpecTestWriter(dir);
    for (const criterion of CRITERIA) {
      const rendered = renderSpecTest(criterion, { specTestDir: SPEC_TEST_DIR });
      writer.write({ files: [rendered] });
    }
    // Every file the authoring step produced is inside the frozen directory, so
    // the read-only rule that protects the run covers all of it.
    const files = readdirSync(path.join(dir, SPEC_TEST_DIR));
    expect(files.length).toBe(2);
    for (const file of files) {
      expect(isSpecTestPath(path.join(SPEC_TEST_DIR, file))).toBe(true);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not write anything into the repository when the writer targets a run dir', () => {
    // Authoring targets the run directory; copying into the repo is a separate,
    // explicit step, so a bad reply cannot pollute the working tree.
    const runDir = mkdtempSync(path.join(tmpdir(), 'spec-'));
    const writer = createFileSpecTestWriter(runDir);
    writer.write({ files: [{ file: 'tests/spec/c1.spec.ts', content: 'x' }] });
    expect(readdirSync(path.join(runDir, 'tests/spec'))).toEqual(['c1.spec.ts']);
    rmSync(runDir, { recursive: true, force: true });
  });
});

void writeFileSync;