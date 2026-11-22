import { describe, expect, it } from 'vitest';
import {
  renderUltraRunDiff,
  ultraDiffRefs,
  ultraRefExists,
  type UltraGitRunner,
} from '../../src/cli/ultra-diff.js';

const runId = 'run-202611191200-a1b2c3d4';

/** A git stub that answers `--stat` with a fixed line and refuses to resolve refs. */
function gitStub(stat = ' src/a.ts | 2 +-', exists = false): UltraGitRunner {
  return (args) => {
    if (args[0] === 'rev-parse') {
      return { status: exists ? 0 : 1, stdout: '' };
    }
    return { status: 0, stdout: stat };
  };
}

describe('ultraDiffRefs', () => {
  it('reads the run branch when it exists: that is the integrated result', () => {
    const refs = ultraDiffRefs({
      cwd: '/repo',
      runId,
      packets: [{ id: 'p1', status: 'done' }],
      runBranchExists: true,
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.ref).toBe(`ultra/${runId}`);
    expect(refs[0]!.label).toContain('ultra/');
  });

  it('falls back to the branch of every finished packet', () => {
    const refs = ultraDiffRefs({
      cwd: '/repo',
      runId,
      packets: [
        { id: 'p1', status: 'done' },
        { id: 'p2', status: 'blocked' },
        { id: 'p3', status: 'done' },
      ],
      runBranchExists: false,
    });
    expect(refs.map((ref) => ref.ref)).toEqual([`ultra/${runId}-p1`, `ultra/${runId}-p3`]);
  });
});

describe('renderUltraRunDiff', () => {
  it('says so when no packet has finished', () => {
    const text = renderUltraRunDiff({
      cwd: '/repo',
      runId,
      packets: [{ id: 'p1', status: 'running' }],
      git: gitStub(),
    });
    expect(text).toMatch(/nothing to diff/iu);
  });

  it('shows the stat and the command for the full patch', () => {
    const text = renderUltraRunDiff({
      cwd: '/repo',
      runId,
      packets: [{ id: 'p1', status: 'done' }],
      runBranchExists: true,
      git: gitStub(),
    });
    expect(text).toMatch(/src\/a\.ts/u);
    expect(text).toMatch(/Full patch: git diff HEAD\.\.ultra\//u);
  });

  it('says so when a ref has no changes against HEAD', () => {
    const text = renderUltraRunDiff({
      cwd: '/repo',
      runId,
      packets: [{ id: 'p1', status: 'done' }],
      runBranchExists: true,
      git: gitStub(''),
    });
    expect(text).toMatch(/no changes against HEAD/iu);
  });

  it('shows one section per finished packet when the run branch is gone', () => {
    const text = renderUltraRunDiff({
      cwd: '/repo',
      runId,
      packets: [
        { id: 'p1', status: 'done' },
        { id: 'p2', status: 'done' },
      ],
      runBranchExists: false,
      git: gitStub(),
    });
    expect(text).toMatch(/--- p1 ---/u);
    expect(text).toMatch(/--- p2 ---/u);
  });
});

describe('ultraRefExists', () => {
  it('is true only when the ref resolves', () => {
    expect(ultraRefExists('/repo', 'ultra/x', gitStub('', true))).toBe(true);
    expect(ultraRefExists('/repo', 'ultra/x', gitStub('', false))).toBe(false);
  });
});
