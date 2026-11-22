import { describe, expect, it } from 'vitest';
import { buildReviewerPrompt, buildVerifierPrompt } from '../../src/cli/ultra-review-adapters.js';
import type { ReviewTarget } from '@alran/ultra';

const target: ReviewTarget = {
  runId: 'run-1',
  description: 'the auth refactor',
  branch: 'ultra/run-1',
  baseRef: 'HEAD',
  changedFiles: ['src/auth/login.ts'],
  diff: '--- a/src/auth/login.ts\n+++ b/src/auth/login.ts',
  truncated: false,
};

describe('buildReviewerPrompt', () => {
  it('gives the reviewer its lens and nothing else', () => {
    const prompt = buildReviewerPrompt({
      lens: {
        id: 'safety',
        title: 'Safety and data',
        focus: 'harm to data or users',
      },
      target,
    });

    expect(prompt).toContain('Your lens: Safety and data');
    expect(prompt).toContain('harm to data or users');
    // The reviewer has to know what changed.
    expect(prompt).toContain('src/auth/login.ts');
    expect(prompt).toContain('the auth refactor');
    expect(prompt).toContain('ultra/run-1');
  });

  it('names the files and shows the diff', () => {
    const prompt = buildReviewerPrompt({
      lens: { id: 'correctness', title: 'Correctness', focus: 'logic that does not do what it says' },
      target,
    });
    expect(prompt).toContain('Files the change touches:');
    expect(prompt).toContain('- src/auth/login.ts');
    expect(prompt).toContain('+++ b/src/auth/login.ts');
  });

  it('says so when there is no diff to show', () => {
    const prompt = buildReviewerPrompt({
      lens: { id: 'tests', title: 'Tests', focus: 'coverage' },
      target: { ...target, diff: '', changedFiles: [] },
    });
    expect(prompt).toContain('(no diff was captured)');
    expect(prompt).toContain('(none listed)');
  });
});

describe('buildVerifierPrompt', () => {
  it('gives the verifier the claim and the code to check it against', () => {
    const prompt = buildVerifierPrompt({
      finding: {
        severity: 'major',
        title: 'The token is never checked',
        detail: 'It is used before the expiry check.',
        file: 'src/auth/login.ts',
        line: 42,
        evidence: 'const claims = decode(token);',
      },
      target,
    });

    expect(prompt).toContain('The token is never checked');
    expect(prompt).toContain('src/auth/login.ts:42');
    expect(prompt).toContain('const claims = decode(token);');
    expect(prompt).toContain('src/auth/login.ts');
  });

  it('does not hide a finding that names no file', () => {
    const prompt = buildVerifierPrompt({
      finding: { severity: 'minor', title: 'Something smells', detail: 'No location.' },
      target,
    });
    expect(prompt).toContain('Something smells');
    expect(prompt).not.toContain('Claimed location:');
  });
});
