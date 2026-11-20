/**
 * `UltraFlow` backs `/ultra`.
 *
 * The flow is the TUI's view of the same `.alran/ultra/` state the CLI writes,
 * so these tests assert the two properties that matter: it never invents a run
 * that is not on disk, and every subcommand agrees with what `RunStore` records.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ledger, RunStore } from '@alran/ultra';
import type { Component } from '../../../../../src/tui/rendering/component.js';
import { UltraFlow } from '../../../../../src/tui/features/ultra/ultra-flow.js';

let dir: string;
let notices: string[];
let panel: Component | undefined;

/**
 * Makes `dir` a git repository, so the flow's start guard has something to
 * judge. Without this the guard sees "not a git repo" and waves everything
 * through, which is not the case the tests are about.
 */
function gitInit(): void {
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'ultra@example.invalid'],
    ['config', 'user.name', 'Ultra Test'],
  ]) {
    spawnSync('git', args, { cwd: dir });
  }
  writeFileSync(path.join(dir, 'a.txt'), 'committed\n');
  spawnSync('git', ['add', 'a.txt'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'alran-ultra-flow-'));
  notices = [];
  panel = undefined;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function createFlow(extra: Partial<ConstructorParameters<typeof UltraFlow>[0]> = {}): UltraFlow {
  return new UltraFlow({
    workspaceDir: dir,
    appendNotice: (content, kind) => {
      notices.push(kind ? `[${kind}] ${content}` : content);
    },
    showPanel: (shown) => {
      panel = shown;
    },
    // The real host drops its panel reference on close; mirror that here so a
    // closed board is observable.
    closePanel: () => {
      panel = undefined;
      return true;
    },
    requestRender: () => undefined,
    // Fixed so the board's elapsed time does not depend on the clock, and no
    // repaint timer unless a test asks for one.
    now: () => new Date('2026-11-20T09:05:00.000Z'),
    refreshMs: 0,
    ...extra,
  });
}

function newRun(id: string, over: Partial<RunStore> = {}): RunStore {
  const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
    runId: id,
    goal: 'Build the widget',
    budgetUsd: 2,
    now: new Date('2026-11-20T09:00:00.000Z'),
  });
  store.setPackets([
    { id: 'p1', title: 'Extract types', status: 'done' },
    { id: 'p2', title: 'Client wrapper', status: 'pending' },
  ]);
  store.setWorkers(4);
  void over;
  return store;
}

describe('UltraFlow with no runs', () => {
  it('says how to start one instead of opening an empty panel', async () => {
    const flow = createFlow();
    await flow.show('');
    expect(panel).toBeUndefined();
    expect(notices.join('\n')).toMatch(/no Ultra runs/iu);
    expect(notices.join('\n')).toContain('alran ultra');
  });

  it('reports unknown run ids by naming the runs that do exist', async () => {
    newRun('run-a');
    const flow = createFlow();
    await flow.show('board run-zzz');
    const text = notices.join('\n');
    expect(text).toMatch(/unknown Ultra run "run-zzz"/iu);
    expect(text).toContain('run-a');
  });
});

describe('UltraFlow board', () => {
  it('opens a panel on the newest run', async () => {
    newRun('run-a');
    newRun('run-b');
    const flow = createFlow();
    await flow.show('');
    expect(panel).toBeDefined();
    const rendered = panel!.render(100).join('\n');
    // `run-b` sorts after `run-a`, and ids start with a sortable timestamp.
    expect(rendered).toContain('run-b');
  });

  it('opens the board on an explicit run id', async () => {
    newRun('run-a');
    newRun('run-b');
    const flow = createFlow();
    await flow.show('board run-a');
    expect(panel!.render(100).join('\n')).toContain('run-a');
  });

  it('shows the run cost from the ledger and the worker cap', async () => {
    const store = newRun('run-a');
    store.setWorkers(3);
    const flow = createFlow();
    await flow.show('board');
    const text = panel!.render(120).join('\n');
    expect(text).toContain('workers=3');
    expect(text).toContain('$0.00 / $2.00');
  });

  it('freezes the elapsed time for a finished run', async () => {
    const store = newRun('run-a');
    store.transition('running');
    store.transition('integrating');
    store.transition('succeeded');
    const flow = createFlow();
    await flow.show('board');
    // The injected clock is five minutes after creation, but a finished run must
    // not keep counting, so the board shows the run's own span and its verdict.
    const text = panel!.render(120).join('\n');
    expect(text).toContain('succeeded');
    expect(text).toContain('00:00');
  });
});

describe('UltraFlow subcommands', () => {
  it('status mirrors the run state', async () => {
    const store = newRun('run-a');
    store.transition('running');
    const flow = createFlow();
    await flow.show('status');
    const text = notices.join('\n');
    expect(text).toContain('run-a  running');
    expect(text).toContain('Goal: Build the widget');
    expect(text).toContain('workers=4');
  });

  it('pause only pauses a running run', async () => {
    const store = newRun('run-a');
    store.transition('running');
    const flow = createFlow();
    await flow.show('pause');
    expect(RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a').state.status).toBe('paused');

    notices = [];
    await flow.show('pause');
    expect(notices.join('\n')).toMatch(/not running/iu);
  });

  it('kill stops a run and keeps its evidence on disk', async () => {
    newRun('run-a').transition('running');
    const flow = createFlow();
    await flow.show('kill');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a');
    expect(store.state.status).toBe('killed');
    expect(existsSync(store.paths.state)).toBe(true);
  });

  it('resume says so when the host has no resume port', async () => {
    newRun('run-a').transition('running');
    const flow = createFlow();
    await flow.show('resume');
    expect(notices.join('\n')).toMatch(/cannot resume/iu);
    expect(notices.join('\n')).toContain('alran ultra resume');
  });

  it('resume delegates to the host port and reports its result', async () => {
    const store = newRun('run-a');
    store.transition('running');
    const seen: string[] = [];
    const flow = createFlow({
      resume: async ({ runId }) => {
        seen.push(runId);
        return `Resumed ${runId}: succeeded.`;
      },
    });
    await flow.show('resume');
    expect(seen).toEqual(['run-a']);
    expect(notices.join('\n')).toContain('Resumed run-a: succeeded.');
  });

  it('report rebuilds a missing report from durable state', async () => {
    const store = newRun('run-a');
    expect(existsSync(store.paths.report)).toBe(false);
    const flow = createFlow();
    await flow.show('report');
    expect(existsSync(store.paths.report)).toBe(true);
    expect(readFileSync(store.paths.report, 'utf8')).toContain('run-a');
  });

  it('runs lists every run with its progress', async () => {
    newRun('run-a');
    newRun('run-b');
    const flow = createFlow();
    await flow.show('runs');
    const text = notices.join('\n');
    expect(text).toContain('run-a');
    expect(text).toContain('run-b');
    expect(text).toContain('1/2 packets');
  });

  it('starts a run from /ultra <task> and follows it', async () => {
    newRun('run-a');
    const started: unknown[] = [];
    const flow = createFlow({
      start: async (request) => {
        started.push(request);
        return {
          runId: 'run-new',
          detail: 'Ultra run run-new started in the background (pid 11).',
        };
      },
    });
    await flow.show('build a drawing app');
    // The task went to the start port with the documented defaults.
    expect(started).toEqual([
      { task: 'build a drawing app', mode: 'run', budgetUsd: 2, workers: 4, recipe: 'auto' },
    ]);
    expect(notices.join('\n')).toContain('started in the background');
  });

  it('checks git before starting, and starts nothing on a dirty tree', async () => {
    gitInit();
    // The repo is dirty on purpose: the check must fire before the start port.
    writeFileSync(path.join(dir, 'a.txt'), 'uncommitted\n');
    const started: unknown[] = [];
    const flow = createFlow({
      start: async (request) => {
        started.push(request);
        return { runId: 'run-x', detail: 'started' };
      },
    });
    await flow.show('build a drawing app');
    expect(started).toHaveLength(0);
    const text = notices.join('\n');
    expect(text).toMatch(/uncommitted changes/iu);
    expect(text).toContain('Commit or stash your changes first');
  });

  it('checks git before opening the wizard, not after it', async () => {
    gitInit();
    writeFileSync(path.join(dir, 'a.txt'), 'uncommitted\n');
    const flow = createFlow({
      start: async () => ({ runId: 'run-x', detail: 'started' }),
    });
    await flow.show('');
    // No wizard: the reader never gets to answer six questions for a run that
    // could not have started.
    expect(panel).toBeUndefined();
    expect(notices.join('\n')).toMatch(/uncommitted changes/iu);
  });

  it('still reads a board on a dirty tree', async () => {
    gitInit();
    newRun('run-a');
    writeFileSync(path.join(dir, 'a.txt'), 'uncommitted\n');
    const flow = createFlow();
    // Watching a run has to keep working exactly when the tree is dirty.
    await flow.show('board');
    expect(panel).toBeDefined();
    expect(panel!.render(120).join('\n')).toContain('run-a');
  });

  it('says so when the host cannot start a run', async () => {
    const flow = createFlow();
    await flow.show('build a drawing app');
    const text = notices.join('\n');
    expect(text).toMatch(/cannot start an Ultra run/iu);
    expect(text).toContain('alran ultra');
  });

  it('reports a failed start instead of opening a board for a run that never ran', async () => {
    const flow = createFlow({
      start: async () => {
        throw new Error('the working tree is dirty');
      },
    });
    await flow.show('build a drawing app');
    expect(notices.join('\n')).toMatch(/Could not start the Ultra run: the working tree is dirty/iu);
    expect(panel).toBeUndefined();
  });

  it('opens the wizard when /ultra is typed with no task', async () => {
    const started: unknown[] = [];
    const flow = createFlow({
      start: async (request) => {
        started.push(request);
        return { runId: 'run-w', detail: 'Ultra run run-w started in the background (pid 12).' };
      },
    });
    await flow.show('');
    // The wizard, not a board: there is nothing to run yet.
    expect(panel).toBeDefined();
    expect(panel!.render(100).join('\n')).toMatch(/What should Ultra do/iu);
    expect(started).toHaveLength(0);
  });

  it('starts a run through the wizard and then shows its board', async () => {
    newRun('run-a');
    const started: Record<string, unknown>[] = [];
    const flow = createFlow({
      start: async (request) => {
        started.push({ ...request });
        // The run the wizard asked for now exists on disk.
        const store = RunStore.create(path.join(dir, '.alran', 'ultra'), {
          runId: 'run-wiz',
          goal: String(request.task),
          budgetUsd: request.budgetUsd as number | null,
        });
        store.setPackets([{ id: 'p1', title: 'First packet', status: 'pending' }]);
        return { runId: 'run-wiz', detail: 'Ultra run run-wiz started in the background (pid 13).' };
      },
    });

    await flow.show('');
    expect(panel).toBeDefined();
    // Fill in the task, then accept every default.
    for (const char of 'build a drawing app') {
      panel!.handleInput(char);
    }
    panel!.handleInput('\r'); // task -> mode
    panel!.handleInput('\r'); // one pass
    panel!.handleInput('\r'); // $1
    panel!.handleInput('\r'); // 1 worker
    panel!.handleInput('\r'); // auto recipe -> confirm
    panel!.handleInput('\r'); // start
    // Starting is asynchronous: the board replaces the wizard once the launch
    // resolves, which happens on a microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ task: 'build a drawing app', mode: 'run' });
    // The wizard closed and the board for the new run opened in its place.
    const board = panel!.render(140).join('\n');
    expect(board).toContain('run-wiz');
    expect(board).toContain('First packet');
  });

  it('falls back to the board when there is no start port and no task', async () => {
    newRun('run-a');
    const flow = createFlow();
    await flow.show('');
    expect(panel!.render(120).join('\n')).toContain('run-a');
  });

});

describe('UltraFlow board actions', () => {
  /**
   * Reads a key off the open panel, the way the terminal would, then lets the
   * action's notice land: an action's result is shown from a microtask, so an
   * assertion that runs immediately after the key would see nothing.
   */
  async function press(key: string): Promise<void> {
    (panel as unknown as { handleInput(data: string): void }).handleInput(key);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('changes the worker cap from the board and persists it', async () => {
    newRun('run-a');
    const flow = createFlow();
    await flow.show('board');
    await press('+');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a');
    // A real change, persisted: a later pass reads this number.
    expect(store.state.workers).toBe(5);
  });

  it('clamps the worker cap instead of running unbounded', async () => {
    newRun('run-a');
    const flow = createFlow();
    await flow.show('board');
    for (let index = 0; index < 12; index += 1) await press('+');
    const store = RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a');
    expect(store.state.workers).toBe(8);
    await press('-');
    expect(RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a').state.workers).toBe(7);
  });

  it('closes the board on escape', async () => {
    newRun('run-a');
    const flow = createFlow();
    await flow.show('board');
    expect(panel).toBeDefined();
    await press('\u001b');
    expect(panel).toBeUndefined();
  });

  it('opens the log panel on l, and shows the diff on d', async () => {
    const store = newRun('run-a');
    store.transition('running');
    store.transition('integrating');
    store.setPacketStatus('p1', 'verifying');
    store.setPacketStatus('p1', 'done');
    // The runner writes the log a reader attaches to.
    writeFileSync(store.paths.runnerLog, '12:00:01 planning\n12:00:04 packet p1 done\n');
    const flow = createFlow();
    await flow.show('board');

    await press('l');
    // The panel is now the log, not the board, and it carries the run's lines.
    const log = panel!.render(120).join('\n');
    expect(log).toContain('Ultra · runner log');
    expect(log).toContain('packet p1 done');

    // Escape returns to nothing; a fresh board is needed for the diff key.
    await press('\u001b');
    await flow.show('board');
    await press('d');
    expect(notices.join('\n')).toContain('ultra/run-a/p1');
  });

  it('shows the newest log lines on the board itself', async () => {
    const store = newRun('run-a');
    writeFileSync(store.paths.runnerLog, '12:00:01 planning\n');
    const flow = createFlow();
    await flow.show('board');
    expect(panel!.render(120).join('\n')).toContain('[log] 12:00:01 planning');
  });

  it('refuses to kill or resume a run that already finished', async () => {
    const store = newRun('run-a');
    store.transition('running');
    store.transition('integrating');
    store.transition('succeeded');
    const resume = vi.fn(async () => 'resumed');
    const flow = createFlow({ resume });
    await flow.show('board');

    await press('k');
    expect(RunStore.open(path.join(dir, '.alran', 'ultra'), 'run-a').state.status).toBe('succeeded');
    expect(notices.join('\n')).toMatch(/already finished as succeeded/iu);

    notices = [];
    await press('s');
    expect(resume).not.toHaveBeenCalled();
    expect(notices.join('\n')).toMatch(/only a paused or killed/iu);
  });

  it('refuses to resume a run that is still running', async () => {
    newRun('run-a').transition('running');
    const resume = vi.fn(async () => 'resumed');
    const flow = createFlow({ resume });
    await flow.show('board');
    await press('s');
    expect(resume).not.toHaveBeenCalled();
    expect(notices.join('\n')).toMatch(/already running; pause it first/iu);
  });

  it('says a run has no packets yet rather than that there is no run', async () => {
    RunStore.create(path.join(dir, '.alran', 'ultra'), {
      runId: 'run-empty',
      goal: 'Still planning',
      budgetUsd: 2,
    });
    const flow = createFlow();
    await flow.show('board');
    const text = panel!.render(100).join('\n');
    expect(text).toContain('no packets yet');
    expect(text).not.toContain('No Ultra run to show');
  });

  it('re-reads the goal document when it changes while the board was open', async () => {
    const store = newRun('run-a');
    // The board shows the criterion count, so the count proves the cached
    // document was dropped rather than replayed.
    const goal = (count: number): string =>
      `${JSON.stringify({
        goal: 'Build the widget',
        criteria: Array.from({ length: count }, (_unused, index) => ({
          id: `C${index + 1}`,
          priority: 'must',
          verification: 'scenario',
          description: `criterion ${index + 1}`,
          status: 'unmet',
          evidence: [],
        })),
        amendments: [],
      })}\n`;
    writeFileSync(store.paths.goal, goal(1));
    const flow = createFlow();
    await flow.show('board');
    expect(panel!.render(140).join('\n')).toContain('0/1 met');

    writeFileSync(store.paths.goal, goal(3));
    expect(panel!.render(140).join('\n')).toContain('0/3 met');
  });

  it('repaints on its own while the board is open', async () => {
    vi.useFakeTimers();
    try {
      newRun('run-a');
      const renders = vi.fn();
      const flow = new UltraFlow({
        workspaceDir: dir,
        appendNotice: () => undefined,
        showPanel: (shown) => {
          panel = shown;
        },
        closePanel: () => {
          panel = undefined;
          return true;
        },
        requestRender: renders,
        now: () => new Date('2026-11-20T09:05:00.000Z'),
      });
      await flow.show('board');
      const afterOpen = renders.mock.calls.length;
      vi.advanceTimersByTime(3000);
      // One repaint per interval: a monitor that never repaints is not one.
      expect(renders.mock.calls.length).toBeGreaterThanOrEqual(afterOpen + 2);
      flow.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops repainting once the board is closed', async () => {
    vi.useFakeTimers();
    try {
      newRun('run-a');
      const renders = vi.fn();
      const flow = new UltraFlow({
        workspaceDir: dir,
        appendNotice: () => undefined,
        showPanel: (shown) => {
          panel = shown;
        },
        closePanel: () => {
          panel = undefined;
          return true;
        },
        requestRender: renders,
        refreshMs: 1000,
      });
      await flow.show('board');
      // Closing is synchronous; going through `press` would wait on a timer
      // that fake timers have not advanced.
      (panel as unknown as { handleInput(data: string): void }).handleInput('\u001b');
      const afterClose = renders.mock.calls.length;
      vi.advanceTimersByTime(5000);
      expect(renders.mock.calls.length).toBe(afterClose);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a real git diff --stat for the run, not just the command', async () => {
    // A real repository: the point of the key is the output, not a reminder.
    const repo = mkdtempSync(path.join(tmpdir(), 'alran-ultra-git-'));
    try {
      for (const args of [
        ['init', '-q'],
        ['config', 'user.email', 'ultra@example.invalid'],
        ['config', 'user.name', 'Ultra Test'],
      ]) {
        spawnSync('git', args, { cwd: repo });
      }
      writeFileSync(path.join(repo, 'a.txt'), 'one\n');
      spawnSync('git', ['add', 'a.txt'], { cwd: repo });
      spawnSync('git', ['commit', '-qm', 'init'], { cwd: repo });

      // The flow runs against the repository, not the bare temp dir.
      const repoFlow = new UltraFlow({
        workspaceDir: repo,
        appendNotice: (content) => notices.push(content),
        showPanel: (shown) => {
          panel = shown;
        },
        closePanel: () => {
          panel = undefined;
          return true;
        },
        requestRender: () => undefined,
        refreshMs: 0,
      });
      const store = RunStore.create(path.join(repo, '.alran', 'ultra'), {
        runId: 'run-git',
        goal: 'g',
        budgetUsd: 2,
      });
      store.setPackets([{ id: 'p1', title: 'A change', status: 'done' }]);

      // The packet's branch, holding one real change.
      spawnSync('git', ['checkout', '-qb', 'ultra/run-git/p1'], { cwd: repo });
      writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
      spawnSync('git', ['commit', '-qam', 'change'], { cwd: repo });
      spawnSync('git', ['checkout', '-q', '-'], { cwd: repo });

      await repoFlow.show('board');
      await press('d');
      const text = notices.join('\n');
      expect(text).toContain('a.txt');
      // `--stat` reports the change, which a bare command reminder cannot.
      expect(text).toMatch(/1 file changed|insertion/iu);
      expect(text).toContain('Full patch: git diff HEAD..');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('writes the goal document into the goal notice', async () => {
    const store = newRun('run-a');
    writeFileSync(
      store.paths.goal,
      `${JSON.stringify({
        goal: 'Build the widget',
        criteria: [
          { id: 'C1', priority: 'must', verification: 'scenario', description: 'It works', status: 'unmet', evidence: [] },
        ],
        amendments: [],
      })}\n`,
    );
    const flow = createFlow();
    await flow.show('board');
    await press('g');
    const text = notices.join('\n');
    expect(text).toContain('Build the widget');
    expect(text).toContain('C1');
  });
});

describe('UltraFlow lifecycle', () => {
  it('stop closes the panel and clears the refresh timer', async () => {
    newRun('run-a');
    const flow = createFlow({ refreshMs: 5 });
    await flow.show('board');
    expect(panel).toBeDefined();
    flow.stop();
    expect(panel).toBeUndefined();
  });
});