import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeUltraArgv,
  registerUltraCommand,
} from '../../src/cli/ultra-command.js';
import { createUltraExecAdapters, createUltraIntegrateAdapters } from '../../src/cli/ultra-exec-adapters.js';
import type { ExecutePorts, IntegratePorts, PlanRunResult, UltraPlanPorts } from '@alran/ultra';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-cli-'));
  dirs.push(dir);
  return dir;
}

function gitRepo(): string {
  const dir = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'ultra@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Ultra Test'], { cwd: dir });
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Run directories only; `.alran/ultra/.gitignore` is a file, not a run. */
function runDirs(repo: string): string[] {
  // A command that refused to start leaves no state directory at all; that is
  // an empty list, not an error.
  if (!existsSync(path.join(repo, '.alran', 'ultra'))) return [];
  return readdirSync(path.join(repo, '.alran', 'ultra'))
    .filter((name) => name.startsWith('run-'))
    .sort();
}

interface Harness {
  readonly program: Command;
  readonly output: () => string;
  readonly exitCodes: number[];
}

function harness(cwd: string, extra: Parameters<typeof registerUltraCommand>[1] = {}): Harness {
  const chunks: string[] = [];
  const exitCodes: number[] = [];
  const program = new Command()
    .name('alran')
    .exitOverride()
    .configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerUltraCommand(program, {
    cwd,
    write: (text) => chunks.push(text),
    exit: (code) => exitCodes.push(code),
    now: () => new Date('2026-11-19T12:00:00Z'),
    execAdapters: fakeExecAdapters(),
    integrateAdapters: fakeIntegrateAdapters(),
    // A goal-driven run needs a goal document and a first plan; without an
    // injected pair it would call a model. Tests that do not care about the
    // goal path get a minimal, deterministic one.
    goalBuilder: async ({ task }) => ({
      goal: task,
      criteria: [
        { id: 'C1', priority: 'must' as const, verification: 'scenario' as const, description: 'It works', status: 'unmet' as const, evidence: [] },
      ],
      amendments: [],
    }),
    specTestAuthor: async () => ({ files: [{ file: 'tests/spec/c1.spec.ts', content: '// generated\n' }] }),
    goalPlanner: async () => ({
      packets: [
        { id: 'p1', title: 'Only', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] },
      ],
    }),
    sleep: async () => {},
    // A test that runs a plan is a test whose user accepted it. Tests about the
    // confirmation itself pass their own `confirm`.
    confirm: async () => true,
    ...extra,
    // Merged last so a test's own `goalLoop` entries win, while an unset
    // `accept` still defaults: without it a goal test would reach for a model.
    goalLoop: {
      accept: async () => ({ findings: [] }),
      ...extra.goalLoop,
    },
  });
  return { program, output: () => chunks.join(''), exitCodes };
}

/** Deterministic stand-ins so the CLI never shells out during a unit test. */
function fakeExecAdapters(): Omit<ExecutePorts, 'store' | 'ledger' | 'evidence'> {
  return {
    worktree: {
      create: async (input) => ({ dir: `/tmp/wt/${input.packetId}` }),
      reset: async () => {},
      remove: async () => {},
      diff: async () => '',
      changedFiles: async (input) => [`src/${input.packetId}/x.ts`],
    },
    worker: { run: async () => ({ ok: true, summary: 'done', costUsd: 0.01, tokensUsed: 5 }) },
    gate: {
      run: async (input) => ({
        ok: true,
        commands: input.commands.map((cmd) => ({ cmd, exitCode: 0, output: 'ok' })),
      }),
    },
    verifier: { verify: async () => ({ pass: true, reasons: [], costUsd: 0.01 }) },
  };
}

/** A clean integrate: every done packet merges, the suite and the review pass. */
function fakeIntegrateAdapters(overrides: Partial<IntegratePorts> = {}): IntegratePorts {
  const branches = new Set<string>();
  return {
    git: {
      // A real integrate creates the run branch before merging into it; the fake
      // has to model that, or the merge step has nothing to merge into.
      createRunBranch: async ({ branch }) => {
        branches.add(branch);
      },
      merge: async (input) => {
        if (!branches.has(input.branch)) {
          return { ok: false, conflicts: [], output: `branch ${input.branch} does not exist` };
        }
        return { ok: true, conflicts: [], output: 'merged' };
      },
      abortMerge: async () => {},
      diff: async () => '',
      tag: async () => {},
    },
    gates: { run: async () => ({ ok: true, commands: [{ cmd: 'pnpm test', exitCode: 0, output: 'ok' }] }) },
    review: { review: async () => ({ ok: true, problems: [] }) },
    ...overrides,
  };
}

const fakePorts: UltraPlanPorts = {
  scope: async () => ({ ok: true, reason: 'big' }),
  explore: async (brief) => ({ role: brief.role, text: 'x', costUsd: 0.01 }),
  plan: async () => ({
    packets: [{ id: 'p1', title: 'Only', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] }],
    costUsd: 0.02,
  }),
  critique: async () => ({ ok: true, problems: [], costUsd: 0.01 }),
  readGateSources: async () => ({ packageJson: { scripts: { test: 'vitest' } } }),
};

describe('alran ultra CLI', () => {
  it('routes a bare task to run, executes the packets and integrates the run branch', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'a big task'], { from: 'user' });
    // Execution really ran, and integrate merged the done packet.
    expect(output()).toMatch(/Packets: 1 done/iu);
    expect(output()).toMatch(/Integrate: succeeded/iu);
    expect(output()).toMatch(/git merge ultra\//u);
    // The report is written from the ledger, and its cost is the ledger's sum.
    const report = readFileSync(path.join(dir, '.alran', 'ultra', runDirs(dir)[0]!, 'report.md'), 'utf8');
    expect(report).toContain('## Packets');
    expect(report).toContain('p1');
  });

  it('records the planning cost in the ledger, so the report counts it (ULT-12)', async () => {
    const dir = gitRepo();
    const { program } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'a big task'], { from: 'user' });
    const ledgerFile = path.join(dir, '.alran', 'ultra', runDirs(dir)[0]!, 'ledger.jsonl');
    const planning = readFileSync(ledgerFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { role?: string; costUsd?: number })
      .filter((entry) => entry.role === 'planning');
    // Three explorers, the planner and the critic: all of it is real spend, and
    // a budget that only counted workers would understate the run from minute one.
    expect(planning).toHaveLength(1);
    expect(planning[0]!.costUsd).toBeCloseTo(0.06, 10);
  });

  it('writes the report and exits non-zero when integrate ends partial', async () => {
    const dir = gitRepo();
    const { program, output, exitCodes } = harness(dir, {
      planPorts: fakePorts,
      integrateAdapters: fakeIntegrateAdapters({
        git: {
          createRunBranch: async () => {},
          merge: async () => ({ ok: false, conflicts: ['src/a.ts'], output: 'CONFLICT' }),
          abortMerge: async () => {},
          diff: async () => '',
          tag: async () => {},
        },
      }),
    });
    await program.parseAsync(['ultra', 'a big task'], { from: 'user' });
    expect(output()).toMatch(/Integrate: partial/iu);
    expect(output()).toMatch(/unmerged/iu);
    expect(exitCodes).toContain(1);
  });

  it('lists its subcommands', () => {
    const { program } = harness(tempDir());
    const names = program.commands.find((c) => c.name() === 'ultra')?.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(['plan', 'run', 'goal', 'status', 'board', 'pause', 'kill', 'resume', 'report']),
    );
  });

  it('freezes the authored criteria in goal.json and charges the authoring turn', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      // No `goalBuilder`: this test exercises the real authoring wiring.
      goalBuilder: undefined,
      goalAuthor: async ({ goal }) => ({
        goal: {
          goal,
          criteria: [
            { id: 'C1', priority: 'must' as const, verification: 'scenario' as const, description: 'Layers work', status: 'unmet' as const, evidence: [] },
            { id: 'C2', priority: 'could' as const, verification: 'manual' as const, description: 'It feels smooth', status: 'unmet' as const, evidence: [] },
          ],
          amendments: [],
        },
        costUsd: 0.03,
      }),
      goalLoop: { accept: async () => ({ findings: [] }) },
      goalPlanner: async () => ({
        packets: [
          { id: 'p1', title: 'Only', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] },
        ],
      }),
    });
    await program.parseAsync(['ultra', 'goal', 'build a drawing app'], { from: 'user' });

    const runId = runDirs(dir)[0]!;
    const root = path.join(dir, '.alran', 'ultra', runId);
    const goal = JSON.parse(readFileSync(path.join(root, 'goal.json'), 'utf8')) as {
      criteria: { id: string; priority: string; status: string }[];
    };
    // The criteria on disk are the ones the run is judged against, with the
    // priorities the author chose — not "everything is a must".
    expect(goal.criteria.map((criterion) => criterion.priority)).toEqual(['must', 'could']);
    expect(goal.criteria.every((criterion) => criterion.status === 'unmet')).toBe(true);
    // The authoring turn is real spend and appears in the ledger and the printout.
    expect(output()).toContain('C1 (must) Layers work');
    const ledger = readFileSync(path.join(root, 'ledger.jsonl'), 'utf8');
    expect(ledger).toContain('"role":"goal author"');
    expect(ledger).toContain('"costUsd":0.03');
    // The checks are frozen on a branch the packets start from, so the gate can
    // run them and no worker can edit one.
    expect(output()).toContain('frozen on ultra/run-');
    const frozen = execFileSync('git', ['ls-tree', '-r', '--name-only', `ultra/${runId}-spec-tests`], {
      cwd: dir,
      encoding: 'utf8',
    });
    expect(frozen).toContain('tests/spec/c1.spec.ts');
  });

  it('authors the spec tests before any worker starts and records them (ULT-13)', async () => {
    const dir = gitRepo();
    const authored: string[] = [];
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      specTestAuthor: async ({ goal }) => {
        // No worker has run yet: this is the first thing the goal command does.
        authored.push(...goal.criteria.map((criterion) => criterion.id));
        return {
          files: [
            { file: 'tests/spec/c1.spec.ts', content: '// generated\n' },
          ],
        };
      },
    });
    await program.parseAsync(['ultra', 'goal', 'build the widget'], { from: 'user' });

    expect(authored).toContain('C1');
    expect(output()).toMatch(/Spec tests: 1 file\(s\) authored/iu);
    const runId = runDirs(dir)[0]!;
    const written = path.join(dir, '.alran', 'ultra', runId, 'spec-tests', 'tests/spec/c1.spec.ts');
    expect(readFileSync(written, 'utf8')).toContain('generated');
  });

  it('stops the run when the spec tests cannot be authored', async () => {
    const dir = gitRepo();
    const { program, output, exitCodes } = harness(dir, {
      planPorts: fakePorts,
      specTestAuthor: async () => {
        throw new Error('spec-test authoring failed: model unreachable');
      },
      // A worker must never start when there are no acceptance checks.
      execAdapters: {
        ...fakeExecAdapters(),
        worker: {
          run: async () => {
            throw new Error('a worker ran without spec tests');
          },
        },
      },
    });
    await program.parseAsync(['ultra', 'goal', 'build the widget'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/Spec-test authoring failed/iu);
    expect(output()).toMatch(/No workers were started/iu);
  });

  it('runs an interim audit every audit-every rounds (spec 13.4)', async () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    execFileSync('git', ['add', 'package.json'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add package.json'], { cwd: dir });

    let audits = 0;
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      // Keep the run going for several rounds so an audit is actually due.
      goalLoop: {
        accept: async () => ({ findings: [] }),
        planNextRound: async () => ({
          packets: [
            { id: 'p1', title: 'Only', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] },
          ],
        }),
      },
      goalAudit: async () => {
        audits += 1;
        return {
          findings: [
            {
              round: 3,
              kind: 'drift' as const,
              severity: 'high' as const,
              text: 'The storage choice cannot express undo',
              rework: 'Rework the storage interface',
            },
          ],
        };
      },
    });
    await program.parseAsync(
      ['ultra', 'goal', 'build the widget', '--max-rounds', '3', '--stall-rounds', '99', '--audit-every', '3'],
      { from: 'user' },
    );

    expect(audits).toBe(1);
    expect(output()).toMatch(/Round 3/iu);
    // The audit was recorded in the ledger with its findings.
    const runId = runDirs(dir)[0]!;
    const ledgerText = readFileSync(
      path.join(dir, '.alran', 'ultra', runId, 'ledger.jsonl'),
      'utf8',
    );
    expect(ledgerText).toMatch(/"role":"audit"/u);
    expect(ledgerText).toMatch(/1 finding/u);
  });

  it('runs a goal-driven task through the outer loop and writes goal.json', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'goal', 'build the widget'], { from: 'user' });

    const runId = runDirs(dir)[0]!;
    const root = path.join(dir, '.alran', 'ultra', runId);
    // The goal document is durable state, so a later round can read it.
    const goal = JSON.parse(readFileSync(path.join(root, 'goal.json'), 'utf8')) as {
      criteria: { id: string; status: string }[];
    };
    expect(goal.criteria.length).toBeGreaterThan(0);
    // The loop ran at least one round and reported its outcome.
    expect(output()).toMatch(/Round 1/iu);
    expect(output()).toMatch(/goal:/iu);
  });

  it('stops a goal-driven run at the round cap with work outstanding', async () => {
    const dir = gitRepo();
    // Integrate runs the project-wide gate on the merged tree and fails closed
    // with none, so this repo needs a real one for the loop to reach round 2.
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } }),
    );
    // Committed, or the start guard would (correctly) refuse the dirty tree.
    execFileSync('git', ['add', 'package.json'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add package.json'], { cwd: dir });
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      // The acceptor never marks anything met and gap analysis always finds more
      // work, so the round cap is what has to stop the run — not stagnation and
      // not "nothing left to plan".
      goalLoop: {
        accept: async () => ({ findings: [] }),
        planNextRound: async () => {
          return {
            packets: [
              { id: 'p1', title: 'Only', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] },
            ],
          };
        },
      },
    });
    await program.parseAsync(
      ['ultra', 'goal', 'build the widget', '--max-rounds', '2', '--stall-rounds', '99'],
      { from: 'user' },
    );
    expect(output()).toMatch(/Round 1/iu);
    expect(output()).toMatch(/Round 2/iu);
    expect(output()).toMatch(/round cap of 2/iu);
  });

  it('refuses to plan on a dirty tree without --stash', async () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'a.txt'), 'dirty\n');
    const { program, output, exitCodes } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'plan', 'do a thing'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/uncommitted changes/iu);
  });

  it('creates a run and reports honestly when the planner cannot be reached', async () => {
    const dir = gitRepo();
    // A plan phase that throws (a real runtime adapter with no reachable model)
    // must leave the run failed and exit non-zero, not pretend a plan was made.
    const { program, output, exitCodes } = harness(dir, {
      planPhase: async () => {
        throw new Error('headless run exited with 1');
      },
    });
    await program.parseAsync(['ultra', 'plan', 'do a thing'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/headless run exited with 1/iu);
    expect(runDirs(dir)).toHaveLength(1);
  });

  it('writes a valid plan and stops before execution', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'plan', 'do a thing'], { from: 'user' });
    expect(output()).toContain('Parallel waves: p1');
    expect(output()).toMatch(/nothing has been changed/iu);
    expect(output()).toContain('npm run test');
  });

  it('records failed state when the plan has overlapping scopes', async () => {
    const dir = gitRepo();
    const ports: UltraPlanPorts = {
      ...fakePorts,
      plan: async () => ({
        packets: [
          { id: 'p1', title: 'A', goal: 'A', scope: ['src/x/**'], depends_on: [] },
          { id: 'p2', title: 'B', goal: 'B', scope: ['src/x/y.ts'], depends_on: [] },
        ],
      }),
    };
    const { program, output, exitCodes } = harness(dir, { planPorts: ports });
    await program.parseAsync(['ultra', 'plan', 'do a thing'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/overlap/iu);
  });

  it('reports status for the only run when no id is given', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const status = harness(dir);
    await status.program.parseAsync(['ultra', 'status'], { from: 'user' });
    expect(status.output()).toContain('awaiting_confirm');
    expect(status.output()).toContain('p1');
  });

  it('resumes a paused run and executes only the unfinished packet', async () => {
    const dir = gitRepo();
    const twoPacketPorts: UltraPlanPorts = {
      ...fakePorts,
      plan: async () => ({
        packets: [
          { id: 'p1', title: 'First', goal: 'a', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'test p1' }] },
          { id: 'p2', title: 'Second', goal: 'b', scope: ['src/p2/**'], depends_on: [], accept: [{ cmd: 'test p2' }] },
        ],
        costUsd: 0.02,
      }),
    };
    const planning = harness(dir, { planPorts: twoPacketPorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const { RunStore } = await import('@alran/ultra');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    store.transition('running');
    // p1 already finished before the pause; p2 must be the only work left.
    store.setPacketStatus('p1', 'verifying');
    store.setPacketStatus('p1', 'done');

    const pause = harness(dir);
    await pause.program.parseAsync(['ultra', 'pause', runId], { from: 'user' });
    expect(pause.output()).toContain('Paused');

    const resume = harness(dir);
    await resume.program.parseAsync(['ultra', 'resume', runId], { from: 'user' });
    expect(resume.output()).toContain('Resuming');
    expect(resume.output()).toContain('Pending packets: p2');
    // Resume executed p2 and did not re-run the finished p1; both end `done`
    // and the already-done packet is reported as done, not `pending`.
    expect(resume.output()).toMatch(/p1\s+done/iu);
    expect(resume.output()).toMatch(/p2\s+done/iu);
    expect(resume.output()).toMatch(/Packets: 2 done/iu);
    const reopened = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    expect(reopened.state.packets.find((packet) => packet.id === 'p1')?.status).toBe('done');
    expect(reopened.state.packets.find((packet) => packet.id === 'p2')?.status).toBe('done');
  });

  it('rejects several runs without an explicit id', async () => {
    const dir = gitRepo();
    for (const task of ['one', 'two']) {
      const created = harness(dir, { planPorts: fakePorts });
      await created.program.parseAsync(['ultra', 'plan', task], { from: 'user' });
    }
    const status = harness(dir);
    await expect(status.program.parseAsync(['ultra', 'status'], { from: 'user' })).rejects.toThrow(
      /several Ultra runs/iu,
    );
  });

  it('shows goal criteria progress in status for a goal-driven run', async () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    execFileSync('git', ['add', 'package.json'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add package.json'], { cwd: dir });

    // Audits and acceptance are off/injected: with no injected pair a due audit
    // or acceptance call would reach for a model.
    const run = harness(dir, {
      planPorts: fakePorts,
      goalAudit: async () => ({ findings: [] }),
      goalLoop: { accept: async () => ({ findings: [] }) },
    });
    await run.program.parseAsync(
      ['ultra', 'goal', 'build the widget', '--audit-every', '0'],
      { from: 'user' },
    );
    const runId = runDirs(dir)[0]!;

    // Decided by the injected probe, not by this machine's process table.
    const status = harness(dir, { isAlive: () => false });
    await status.program.parseAsync(['ultra', 'status', runId], { from: 'user' });
    const text = status.output();
    expect(text).toMatch(/C1/iu);
    expect(text).toMatch(/must/iu);
  });

  it('reports a goal run as partial when a must criterion is unmet', async () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    execFileSync('git', ['add', 'package.json'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'add package.json'], { cwd: dir });

    const { program, output, exitCodes } = harness(dir, {
      planPorts: fakePorts,
      goalLoop: {
        accept: async () => ({ findings: [] }),
        planNextRound: async () => ({ packets: [] }),
      },
    });
    await program.parseAsync(['ultra', 'goal', 'build the widget'], { from: 'user' });
    // Nothing was met and there is no more work, so this cannot be success.
    expect(output()).toMatch(/partial/iu);
    expect(exitCodes).toContain(1);
  });

  it('accepts --budget none for a single-round run without a NaN cap', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'plan', 'a task', '--budget', 'none'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const { RunStore } = await import('@alran/ultra');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    // `none` means no cap, represented as null — never as NaN, which would both
    // disable the cap and print as $NaN.
    expect(store.state.budgetUsd).toBeNull();
    expect(output()).not.toMatch(/\$NaN/u);
  });

  it('rejects a budget that is not a number instead of running uncapped', async () => {
    const dir = gitRepo();
    const { program, output, exitCodes } = harness(dir, { planPorts: fakePorts });
    // A typo must fail loudly. `Number('two')` is NaN, which would silently
    // disable the cap and print $NaN.
    await program.parseAsync(['ultra', 'plan', 'a task', '--budget', 'two'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/invalid budget/iu);
  });

  it('rejects an unknown recipe instead of planning with a typo', async () => {
    const dir = gitRepo();
    const { program, output, exitCodes } = harness(dir, { planPorts: fakePorts });
    // A typo that survived would label the plan a migration and silently drop
    // the recipe's ordering rules and extra verifier checks.
    await program.parseAsync(['ultra', 'plan', 'a task', '--recipe', 'migrat'], { from: 'user' });
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/unknown recipe "migrat"/iu);
  });

  it('starts a detached run instead of planning in the foreground', async () => {
    const dir = gitRepo();
    const launched: Record<string, unknown>[] = [];
    // Planning must not run in the parent at all: that is the child's job.
    const planning = vi.fn(async () => {
      throw new Error('the parent must not plan a detached run');
    });
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      planPhase: planning as never,
      startBackground: ((request: Record<string, unknown>) => {
        launched.push(request);
        return { runId: 'run-detached', pid: 4242, logPath: '/tmp/runner.log' };
      }) as never,
    });
    await program.parseAsync(['ultra', 'run', 'a task', '--detach'], { from: 'user' });

    expect(planning).not.toHaveBeenCalled();
    expect(output()).toContain('started in the background');
    expect(output()).toContain('pid 4242');
    expect(launched).toHaveLength(1);
    expect(launched[0]).toMatchObject({ mode: 'run', task: 'a task', budgetUsd: 2 });
  });

  it('refuses to start when the tree is dirty, before launching anything', async () => {
    const dir = gitRepo();
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    const launched: unknown[] = [];
    const { program, output, exitCodes } = harness(dir, {
      planPorts: fakePorts,
      startBackground: ((request: unknown) => {
        launched.push(request);
        return { runId: 'run-x', pid: 1, logPath: 'l' };
      }) as never,
    });
    await program.parseAsync(['ultra', 'run', 'a task', '--detach'], { from: 'user' });
    // A detached run is not a way around the start guard.
    expect(launched).toHaveLength(0);
    expect(exitCodes).toEqual([1]);
    expect(output()).toMatch(/dirty|working tree/iu);
  });

  it('passes the goal-only options to a detached goal run', async () => {
    const dir = gitRepo();
    const launched: Record<string, unknown>[] = [];
    const { program } = harness(dir, {
      planPorts: fakePorts,
      startBackground: ((request: Record<string, unknown>) => {
        launched.push(request);
        return { runId: 'run-goal', pid: 7, logPath: '/tmp/runner.log' };
      }) as never,
    });
    await program.parseAsync(
      ['ultra', 'goal', 'build it', '--detach', '--max-rounds', '4', '--budget', 'none'],
      { from: 'user' },
    );
    expect(launched[0]).toMatchObject({
      mode: 'goal',
      task: 'build it',
      budgetUsd: null,
      maxRounds: 4,
    });
  });

  it('adopts an existing plan instead of planning a second time', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    const planPath = path.join(dir, '.alran', 'ultra', runId, 'plan.json');
    expect(existsSync(planPath)).toBe(true);

    // The detached child continues this run: same id, no new plan.
    const child = harness(dir, { planPorts: fakePorts });
    await child.program.parseAsync(['ultra', 'run', 'a task', '--adopt', runId], { from: 'user' });
    expect(runDirs(dir)).toEqual([runId]);
    expect(child.output()).toContain('Continuing');
  });

  it('shows the background runner in status', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    writeFileSync(
      path.join(dir, '.alran', 'ultra', runId, 'runner.json'),
      `${JSON.stringify({
        runId,
        mode: 'run',
        pid: 999_999,
        startedAt: '2026-11-20T09:00:00.000Z',
        logPath: 'runner.log',
        task: 'a task',
        budgetUsd: 2,
        recipe: 'auto',
        workers: 4,
      })}\n`,
    );

    // Decided by the injected probe, not by this machine's process table.
    const status = harness(dir, { isAlive: () => false });
    await status.program.parseAsync(['ultra', 'status', runId], { from: 'user' });
    // The pid cannot be alive, and the run never finished: that is a run a user
    // has to be told about, not a silent success.
    expect(status.output()).toContain('Runner:');
    expect(status.output()).toMatch(/interrupted/iu);
    expect(status.output()).toMatch(/resume/iu);
  });

  it('asks for confirmation before executing, and aborts on no', async () => {
    const dir = gitRepo();
    const confirmations: string[] = [];
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      // Answer "no": the run must stop before any worker starts.
      confirm: async () => {
        confirmations.push('asked');
        return false;
      },
    });
    await program.parseAsync(['ultra', 'run', 'a task'], { from: 'user' });
    const text = output();
    expect(confirmations).toHaveLength(1);
    // The plan and the question are shown, and nothing was executed.
    expect(text).toContain('Continue with this plan?');
    expect(text).toContain('Aborted. Nothing was changed');
    expect(text).not.toContain('Executing');
  });

  it('executes without asking when --yes is given', async () => {
    const dir = gitRepo();
    const confirmations: string[] = [];
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      confirm: async () => {
        confirmations.push('asked');
        return true;
      },
    });
    await program.parseAsync(['ultra', 'run', 'a task', '--yes'], { from: 'user' });
    // --yes skips the question, not the budget cap.
    expect(confirmations).toHaveLength(0);
    expect(output()).not.toContain('Continue with this plan?');
  });

  it('shows the goal criteria in the confirmation when there is a goal document', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      confirm: async () => false,
    });
    await program.parseAsync(['ultra', 'run', 'a task'], { from: 'user' });
    const text = output();
    // The confirmation is where a human checks what the run is held to.
    expect(text).toMatch(/packet\(s\)/u);
    expect(text).toContain('Nothing is merged into main');
  });

  it('normalises the bare form so it runs through the single run path', () => {
    // Commander cannot give a subcommand the flags of its parent, so the bare
    // form is rewritten before parsing (spec 2's primary form).
    expect(normalizeUltraArgv(['node', 'alran', 'ultra', 'build a widget'])).toEqual([
      'node',
      'alran',
      'ultra',
      'run',
      'build a widget',
    ]);
    // Subcommands are left alone.
    for (const sub of ['plan', 'status', 'board', 'attach', 'report']) {
      expect(normalizeUltraArgv(['node', 'alran', 'ultra', sub, 'x'])).toEqual([
        'node',
        'alran',
        'ultra',
        sub,
        'x',
      ]);
    }
    // A flag is not a task.
    expect(normalizeUltraArgv(['node', 'alran', 'ultra', '--help'])).toEqual([
      'node',
      'alran',
      'ultra',
      '--help',
    ]);
  });

  it('runs the bare form: alran ultra "<task>" plans, confirms and executes', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, {
      planPorts: fakePorts,
      confirm: async () => true,
    });
    // Exactly what main.ts does with the process argv.
    // `from: 'user'` means the array is the user's words, so there is no node
    // prefix here; main.ts passes the process argv, which the same helper takes.
    await program.parseAsync(normalizeUltraArgv(['ultra', 'build a widget']), { from: 'user' });
    const text = output();
    expect(text).toContain('Continue with this plan?');
    expect(text).toContain('Executing');
    expect(runDirs(dir)).toHaveLength(1);
  });

  it('shows help for a bare alran ultra with no task', async () => {
    const dir = gitRepo();
    const { program } = harness(dir, { planPorts: fakePorts });
    // With no task and no subcommand there is nothing to run. Commander either
    // shows the help or refuses; either way no run may be created.
    try {
      await program.parseAsync(['ultra'], { from: 'user' });
    } catch {
      // Help display and refusal both surface as thrown errors under
      // `exitOverride`; neither is a failure here.
    }
    expect(runDirs(dir)).toHaveLength(0);
  });

  it('carries a known recipe into the plan', async () => {
    const dir = gitRepo();
    const { program, output } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'plan', 'a task', '--recipe', 'migrate'], { from: 'user' });
    expect(output()).toContain('Recipe: migrate');
  });

  it('still parses a numeric budget for a single-round run', async () => {
    const dir = gitRepo();
    const { program } = harness(dir, { planPorts: fakePorts });
    await program.parseAsync(['ultra', 'plan', 'a task', '--budget', '3.5'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const { RunStore } = await import('@alran/ultra');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    expect(store.state.budgetUsd).toBe(3.5);
  });

  it('raises the budget cap on resume so a paused run can continue', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const { RunStore } = await import('@alran/ultra');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    // The run spent its 2.00 cap and paused.
    store.transition('running');
    store.transition('paused');

    const resume = harness(dir);
    await resume.program.parseAsync(['ultra', 'resume', runId, '--budget', '5'], { from: 'user' });

    const reopened = RunStore.open(path.join(dir, '.alran', 'ultra'), runId);
    // The cap is raised for the resumed pass, not silently left at the old one.
    expect(reopened.state.budgetUsd).toBe(5);
  });

  it('rejects an invalid budget on resume', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const resume = harness(dir);
    await resume.program.parseAsync(['ultra', 'resume', runId, '--budget', 'lots'], { from: 'user' });
    expect(resume.output()).toMatch(/invalid budget/iu);
  });

  it('prints the full report for a run that has one', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    // A run that has finished execution has a report on disk; `report` must show
    // it rather than only the cost line.
    const root = path.join(dir, '.alran', 'ultra', runId);
    writeFileSync(
      path.join(root, 'report.md'),
      '# Ultra report: run-1\n\n- Result: **partial**\n\n## Packets\n\n| p1 | done |\n',
    );

    const report = harness(dir);
    await report.program.parseAsync(['ultra', 'report', runId], { from: 'user' });
    const text = report.output();
    expect(text).toContain('## Packets');
    expect(text).toContain('partial');
    // The plan phase really spent 0.06 (three explorers, planner, critic), and
    // the cost line reports the ledger rather than a per-run counter.
    expect(text).toContain('Cost: $0.06');
  });

  it('rebuilds the report for a run that has none yet', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    const root = path.join(dir, '.alran', 'ultra', runId);
    rmSync(path.join(root, 'report.md'), { force: true });

    const report = harness(dir);
    await report.program.parseAsync(['ultra', 'report', runId], { from: 'user' });
    // A report is derived from state, so it is rebuilt rather than "not yet".
    expect(report.output()).toMatch(/## Packets/iu);
    expect(existsSync(path.join(root, 'report.md'))).toBe(true);
  });

  it('rebuilds a missing report from the ledger and state', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    const root = path.join(dir, '.alran', 'ultra', runId);
    rmSync(path.join(root, 'report.md'), { force: true });

    const report = harness(dir);
    await report.program.parseAsync(['ultra', 'report', runId], { from: 'user' });
    // The report is regenerated from durable state, not left missing.
    expect(existsSync(path.join(root, 'report.md'))).toBe(true);
    expect(readFileSync(path.join(root, 'report.md'), 'utf8')).toContain('## Packets');
  });

  it('renders the board from the run state and the ledger', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const board = harness(dir);
    await board.program.parseAsync(['ultra', 'board', runId], { from: 'user' });
    const text = board.output();
    // The board is a snapshot of durable state: the run, its packets and its cost.
    expect(text).toContain(`ULTRA ${runId}`);
    expect(text).toContain('Goal: a task');
    // The board's cost comes from the ledger, which now carries the plan phase.
    expect(text).toMatch(/\$0\.06 \/ \$2\.00/u);
    // A snapshot has no keys to offer, so it must not advertise interaction.
    expect(text).not.toContain('[p]ause');
  });

  it('keeps the board inside the requested width', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const board = harness(dir);
    await board.program.parseAsync(['ultra', 'board', runId, '--width', '50'], { from: 'user' });
    for (const line of board.output().trimEnd().split('\n')) {
      expect(line.length).toBeLessThanOrEqual(50);
    }
  });

  it('rejects a board width that is not a number', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;

    const board = harness(dir);
    await board.program.parseAsync(['ultra', 'board', runId, '--width', 'wide'], { from: 'user' });
    expect(board.output()).toMatch(/invalid width/iu);
  });

  it('attaches to a run and prints what it has logged so far', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    writeFileSync(
      path.join(dir, '.alran', 'ultra', runId, 'runner.log'),
      '12:00:01 planning\n12:00:04 packet p1 done\n',
    );

    const attach = harness(dir);
    await attach.program.parseAsync(['ultra', 'attach', runId, '--no-follow'], { from: 'user' });
    const text = attach.output();
    expect(text).toContain(`Attached to ${runId}`);
    expect(text).toContain('12:00:01 planning');
    expect(text).toContain('12:00:04 packet p1 done');
  });

  it('stops following when the runner is gone and says what to do next', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    const runDir = path.join(dir, '.alran', 'ultra', runId);
    writeFileSync(path.join(runDir, 'runner.log'), '12:00:01 planning\n');
    writeFileSync(
      path.join(runDir, 'runner.json'),
      `${JSON.stringify({
        runId,
        mode: 'run',
        pid: 424242,
        startedAt: '2026-11-20T09:00:00.000Z',
        logPath: 'runner.log',
        task: 'a task',
        budgetUsd: 2,
        recipe: 'auto',
        workers: 4,
      })}\n`,
    );

    // The run never finished and the process is gone: that is the case a reader
    // must be told to resume rather than left watching a dead log.
    const attach = harness(dir, { isAlive: () => false });
    await attach.program.parseAsync(['ultra', 'attach', runId, '--interval', '10'], { from: 'user' });
    const text = attach.output();
    expect(text).toMatch(/Detached: interrupted/iu);
    expect(text).toContain(`alran ultra resume ${runId}`);
    // Once: the classification already carries the hint.
    expect(text.match(/alran ultra resume/gu)).toHaveLength(1);
  });

  it('prints the cost summary from the ledger', async () => {
    const dir = gitRepo();
    const planning = harness(dir, { planPorts: fakePorts });
    await planning.program.parseAsync(['ultra', 'plan', 'a task'], { from: 'user' });
    const runId = runDirs(dir)[0]!;
    const report = harness(dir);
    await report.program.parseAsync(['ultra', 'report', runId], { from: 'user' });
    expect(report.output()).toContain('Cost: $0.06');
    expect(report.output()).toContain('planning: $0.06');
    expect(report.output()).toMatch(/## Packets/iu);
  });
});

/**
 * ULT-08: "`main` and all remotes unchanged after any run, including `failed`
 * and `killed`".
 *
 * This is the guarantee the whole design rests on — workers run in worktrees on
 * their own branches and the human merges — so it is worth testing against real
 * git rather than a fake: real worktrees, real merges, a real bare remote, and
 * only the model calls stubbed out. A run that moved `main` or wrote to the
 * remote would be a data-loss bug, not a cosmetic one.
 */
describe('ultra leaves the user’s branches alone (ULT-08)', () => {
  /** A repo on `main` with an `origin` remote that has `main` pushed. */
  function repoWithRemote(): { repo: string; remote: string } {
    const repo = tempDir();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'ultra@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Ultra Test'], { cwd: repo });
    writeFileSync(path.join(repo, 'a.txt'), 'one\n');
    // Integrate refuses to declare success without a project-wide suite, so the
    // fixture has one that passes; `true` keeps it dependency-free. It is part
    // of the initial commit, because Ultra refuses to start on a dirty tree.
    writeFileSync(
      path.join(repo, 'package.json'),
      `${JSON.stringify({ scripts: { test: 'true' } }, null, 2)}\n`,
    );
    execFileSync('git', ['add', 'a.txt', 'package.json'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    const remote = path.join(tempDir(), 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
    execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: repo });
    return { repo, remote };
  }

  /** The refs a run must not move, as `ref sha` lines. */
  function protectedRefs(repo: string, remote: string): string {
    const local = execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/main'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    const onRemote = execFileSync(
      'git',
      ['--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)'],
      { encoding: 'utf8' },
    ).trim();
    return `${local}\n${onRemote}`;
  }

  /**
   * A stand-in `alran` that answers every headless call with `PASS` and a token
   * count: enough for the worker and the verifier to proceed, with no model and
   * no network. The gate is a real shell command, so it still runs.
   */
  function stubAlran(options: { readonly tokens?: number } = {}): readonly string[] {
    const dir = tempDir();
    const script = path.join(dir, 'stub-alran.mjs');
    writeFileSync(
      script,
      [
        'import { appendFileSync } from "node:fs";',
        'process.stdin.resume();',
        'process.stdin.on("data", () => {});',
        '// Each call is one billed step, so a test can count worker runs across a resume.',
        'if (process.env.ULTRA_STUB_COUNTER) appendFileSync(process.env.ULTRA_STUB_COUNTER, "call\\n");',
        `process.stdout.write(JSON.stringify({ output: "PASS", usage: { totalTokens: ${String(options.tokens ?? 120)} } }));`,
        '',
      ].join('\n'),
    );
    return [process.execPath, script];
  }

  /** Two packets, one after the other, and no planning cost to muddy the budget. */
  const sequentialPorts: UltraPlanPorts = {
    scope: async () => ({ ok: true, reason: 'big' }),
    explore: async (brief) => ({ role: brief.role, text: 'x' }),
    plan: async () => ({
      packets: [
        { id: 'p1', title: 'First', goal: 'Do it', scope: ['src/p1/**'], depends_on: [], accept: [{ cmd: 'true' }] },
        {
          id: 'p2',
          title: 'Second',
          goal: 'Then this',
          scope: ['src/p2/**'],
          depends_on: ['p1'],
          accept: [{ cmd: 'true' }],
        },
      ],
    }),
    critique: async () => ({ ok: true, problems: [] }),
    // Integrate refuses to succeed without a project-wide suite.
    readGateSources: async () => ({ packageJson: { scripts: { test: 'true' } } }),
  };

  /** Real adapters; only the model calls are stubbed, git and the gates are real. */
  function realAdapters(cwd: string) {
    const context = { cwd, env: process.env, alranCommand: stubAlran() };
    return {
      execAdapters: createUltraExecAdapters(context),
      integrateAdapters: createUltraIntegrateAdapters(context),
      planPorts: fakePorts,
    };
  }

  it('leaves main and the remote untouched after a successful run', async () => {
    const { repo, remote } = repoWithRemote();
    const before = protectedRefs(repo, remote);

    const { program, output, exitCodes } = harness(repo, realAdapters(repo));
    await program.parseAsync(['ultra', 'a big task'], { from: 'user' });

    writeFileSync('/tmp/ultra-out2.txt', output());
    expect(output()).toMatch(/Integrate: succeeded/iu);
    // `exitCodes` is empty on success; asserting it keeps a silent failure loud.
    expect(exitCodes).toEqual([]);
    expect(protectedRefs(repo, remote)).toBe(before);
  });

  it('pauses at the cap and resumes without repeating finished packets (ULT-04)', async () => {
    const { repo, remote } = repoWithRemote();
    const before = protectedRefs(repo, remote);
    // Counting calls is the point: a resume that redoes a finished packet would
    // show up here as a second worker run for p1.
    const counter = path.join(tempDir(), 'worker-calls.txt');
    const env = { ...process.env, ULTRA_STUB_COUNTER: counter };
    const calls = (): number =>
      existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0;

    const context = { cwd: repo, env, alranCommand: stubAlran({ tokens: 120 }) };
    const adapters = {
      execAdapters: createUltraExecAdapters(context),
      integrateAdapters: createUltraIntegrateAdapters(context),
      planPorts: sequentialPorts,
    };

    // Each model call is 120 tokens = $0.0012, so a $0.002 cap is spent by the
    // first packet's worker and verifier. The next packet must pause, not fail.
    const first = harness(repo, adapters);
    await first.program.parseAsync(['ultra', 'a big task', '--budget', '0.002'], { from: 'user' });
    expect(first.output()).toMatch(/paused/iu);
    const runId = runDirs(repo)[0]!;
    // p1's worker, p1's verifier, and the final review of the partial merge.
    expect(calls()).toBe(3);

    // Resuming with a raised cap finishes the run, and p1 is not redone.
    const second = harness(repo, adapters);
    await second.program.parseAsync(['ultra', 'resume', runId, '--budget', '1'], { from: 'user' });
    expect(second.output()).toMatch(/succeeded/iu);
    // p2's worker, p2's verifier, and the review of the completed run: p1 was
    // not called again, which is the whole point of resuming.
    expect(calls()).toBe(6);
    // The finished packet's work is on the run branch, and nothing touched main.
    expect(protectedRefs(repo, remote)).toBe(before);
  });

  it('leaves main and the remote untouched after a failed run', async () => {
    const { repo, remote } = repoWithRemote();
    const before = protectedRefs(repo, remote);

    // The gate always fails, so every packet ends `blocked` and the run is
    // `partial`: the case where a careless implementation would be most tempted
    // to touch the user's branch to "finish".
    const adapters = realAdapters(repo);
    const { program, output } = harness(repo, {
      ...adapters,
      planPorts: {
        ...adapters.planPorts,
        plan: async () => ({
          packets: [
            {
              id: 'p1',
              title: 'Doomed',
              goal: 'This cannot pass',
              scope: ['src/p1/**'],
              depends_on: [],
              accept: [{ cmd: 'exit 3' }],
              max_repairs: 0,
            },
          ],
          costUsd: 0.02,
        }),
      },
    });
    await program.parseAsync(['ultra', 'a task that fails'], { from: 'user' });

    expect(output()).toMatch(/blocked|partial/iu);
    expect(protectedRefs(repo, remote)).toBe(before);
  });
});

export type { PlanRunResult };
