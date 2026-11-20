/**
 * Acceptance adapters (spec 13.2).
 *
 * The acceptor is an independent agent that exercises the real result against the
 * goal document. These tests pin the adapter's contract, not a model's judgement:
 * the prompt it builds must carry the goal and the evidence, must NOT carry the
 * workers' reasoning, and its output must parse into per-criterion findings that
 * the goal layer can apply — including a malformed reply, which must not be
 * silently read as `met`.
 */

import { describe, expect, it } from 'vitest';
import {
  ACCEPTOR_SYSTEM_PROMPT,
  buildAcceptancePrompt,
  parseAcceptanceReport,
} from '../../src/acceptance.js';
import { parseGoalDocument } from '../../src/goal.js';

const GOAL = parseGoalDocument({
  goal: 'Build a drawing app',
  criteria: [
    { id: 'C1', priority: 'must', verification: 'scenario', description: 'A user can create a layer' },
    { id: 'C2', priority: 'should', verification: 'command', description: 'Export writes a PNG' },
  ],
});

describe('buildAcceptancePrompt', () => {
  it('carries the goal and every criterion', () => {
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 1 });
    expect(prompt).toContain('Build a drawing app');
    expect(prompt).toContain('C1');
    expect(prompt).toContain('C2');
    expect(prompt).toContain('A user can create a layer');
  });

  it('states the allowed verdicts and the evidence requirement', () => {
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 1 });
    expect(prompt).toMatch(/met|partial|unmet|needs_human/u);
    // No evidence, no `met`.
    expect(prompt).toMatch(/evidence/iu);
  });

  it('does not carry worker reasoning or transcripts', () => {
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 1 });
    expect(prompt).not.toMatch(/transcript/iu);
    expect(prompt).not.toMatch(/worker said/iu);
  });

  it('points at the frozen checks and says a failure is unmet (ULT-13)', () => {
    // The checks are the executable form of the criteria; an acceptor that never
    // runs them is back to judging the run on the workers' own tests.
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 1, specTestDir: 'tests/spec' });
    expect(prompt).toContain('tests/spec/');
    expect(prompt).toMatch(/run them first/iu);
    expect(prompt).toMatch(/unmet/iu);
  });

  it('says nothing about frozen checks when the run froze none', () => {
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 1 });
    expect(prompt).not.toMatch(/frozen/iu);
  });

  it('includes the round number so the report is traceable', () => {
    const prompt = buildAcceptancePrompt({ goal: GOAL, round: 3 });
    expect(prompt).toMatch(/round 3/iu);
  });
});

describe('parseAcceptanceReport', () => {
  it('parses a well-formed report into findings', () => {
    const text = [
      'C1: met',
      'evidence: ./shots/layer.png',
      'C2: unmet',
      'evidence: none',
    ].join('\n');
    const report = parseAcceptanceReport(text);
    expect(report.findings).toHaveLength(2);
    expect(report.findings[0]).toMatchObject({ id: 'C1', status: 'met' });
    expect(report.findings[0]?.evidence).toEqual(['./shots/layer.png']);
    expect(report.findings[1]).toMatchObject({ id: 'C2', status: 'unmet' });
  });

  it('reads needs_human as its own verdict, not as unmet', () => {
    const report = parseAcceptanceReport(['C1: needs_human', 'evidence: cannot judge visually'].join('\n'));
    expect(report.findings[0]?.status).toBe('needs_human');
  });

  it('accepts several evidence lines for one criterion', () => {
    const report = parseAcceptanceReport(
      ['C1: met', 'evidence: a.png', 'evidence: b.png'].join('\n'),
    );
    expect(report.findings[0]?.evidence).toEqual(['a.png', 'b.png']);
  });

  it('rejects a met claim with no evidence line rather than trusting it', () => {
    const report = parseAcceptanceReport('C1: met');
    // The finding is dropped, so the goal layer cannot apply it.
    expect(report.findings).toEqual([]);
    expect(report.rejected.length).toBeGreaterThan(0);
    expect(report.rejected[0]?.id).toBe('C1');
  });

  it('ignores a criterion the goal does not contain', () => {
    const report = parseAcceptanceReport(['C1: met', 'evidence: x', 'C9: met', 'evidence: y'].join('\n'), GOAL);
    expect(report.findings.map((finding) => finding.id)).toEqual(['C1']);
    expect(report.rejected.map((entry) => entry.id)).toContain('C9');
  });

  it('drops a malformed verdict line instead of guessing', () => {
    const report = parseAcceptanceReport(['C1: probably fine'].join('\n'), GOAL);
    expect(report.findings).toEqual([]);
    expect(report.rejected.length).toBeGreaterThan(0);
  });

  it('returns no findings for an empty reply', () => {
    const report = parseAcceptanceReport('', GOAL);
    expect(report.findings).toEqual([]);
  });
});

describe('ACCEPTOR_SYSTEM_PROMPT', () => {
  it('tells the agent to exercise the result, not read the code', () => {
    expect(ACCEPTOR_SYSTEM_PROMPT).toMatch(/exercise|run|start/iu);
  });

  it('forbids trusting the workers', () => {
    expect(ACCEPTOR_SYSTEM_PROMPT).toMatch(/did not write|independent|do not trust/iu);
  });
});