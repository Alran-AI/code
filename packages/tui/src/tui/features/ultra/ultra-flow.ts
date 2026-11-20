/**
 * `UltraFlow` backs the `/ultra` slash command.
 *
 * `/ultra` and `/ultra board [run-id]` open the live board; `status`, `report`,
 * `pause`, `kill` and `resume` mirror the CLI subcommands. Everything the flow
 * does goes through `@alran/ultra`'s core over `.alran/ultra/<run-id>/`, so the
 * TUI and the CLI read one state and can never disagree about a run.
 *
 * Starting a *new* run is deliberately not here. A run needs a planner, a
 * worktree per packet, a budget and a confirmation step; the flow would be a
 * second, drifting implementation of `alran ultra run`. The board follows runs
 * and controls them; the CLI starts them.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as ultra from '@alran/ultra';
import type { Component } from '../../rendering/component.js';
import { UltraBoard, type UltraBoardActions, type UltraBoardSnapshot } from './ultra-board.js';
import { UltraWizard, type UltraStartRequest } from './ultra-wizard.js';
import { UltraLogPanel } from './ultra-log-panel.js';

type AppendNotice = (content: string, kind?: 'warning' | 'error') => void;

export interface UltraFlowOptions {
  readonly workspaceDir: string;
  readonly appendNotice: AppendNotice;
  readonly showPanel: (panel: Component) => void;
  readonly closePanel: (panel?: Component) => boolean;
  readonly requestRender: () => void;
  /** Injected so the board's elapsed time is deterministic in tests. */
  readonly now?: () => Date;
  /** Repaint interval while the board is open; 0 or undefined disables the timer. */
  readonly refreshMs?: number;
  /**
   * Re-runs the unfinished packets of a paused or killed run. Injected because
   * the real one needs the runtime adapters; without it `/ultra resume` says so
   * rather than pretending to resume.
   */
  readonly resume?: (input: { readonly store: ultra.RunStore; readonly runId: string }) => Promise<string>;
  /**
   * Starts a run in the background and returns as soon as it is launched.
   * Without it `/ultra <task>` and the wizard can still explain the syntax but
   * cannot start anything.
   */
  readonly start?: (input: UltraStartRequest) => Promise<{ readonly runId: string; readonly detail: string }>;
}

/**
 * A cheap change signature for a file the panel only reads: `(mtime, size)`.
 * A missing file has its own signature so a file that appears is noticed too.
 */
function fileSignature(file: string): string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

/** Runs git in the workspace and returns its trimmed stdout, or '' on failure. */
function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

/** Whether a ref resolves in this repository. */
function gitRef(cwd: string, ref: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.status === 0;
}

/** How often the open board repaints itself. */
const DEFAULT_REFRESH_MS = 1000;

/** Subcommands `/ultra` understands; anything else is a task to run. */
const ULTRA_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'board',
  'attach',
  'status',
  'report',
  'runs',
  'pause',
  'kill',
  'resume',
]);

const STATE_DIR = ultra.ULTRA_STATE_DIR;

/** Run statuses a board can no longer change; used to freeze its elapsed time. */
const TERMINAL: ReadonlySet<ultra.RunStatus> = new Set([
  'succeeded',
  'partial',
  'failed',
  'killed',
  'stalled',
]);

export class UltraFlow {
  private panel: Component | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly caches: {
    plan?: { readonly signature: string; readonly value: unknown };
    goal?: { readonly signature: string; readonly value: unknown };
  } = {};
  private ledgerCache: { readonly signature: string; readonly ledger: ultra.Ledger } | undefined;

  constructor(private readonly options: UltraFlowOptions) {}

  private get stateDir(): string {
    return path.join(this.options.workspaceDir, STATE_DIR);
  }

  /**
   * Run ids under `.alran/ultra`, newest first. `RunStore` ids start with a
   * sortable timestamp, so a plain reverse sort is chronological.
   */
  private runIds(): string[] {
    if (!existsSync(this.stateDir)) return [];
    return readdirSync(this.stateDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
      .reverse();
  }

  /**
   * Opens a run, defaulting to the newest one when no id is given.
   *
   * Deliberately stateless: a flow that remembered the last board it showed
   * would let `/ultra pause` act on a run the user is no longer looking at.
   */
  private open(runId?: string): ultra.RunStore {
    if (!existsSync(this.stateDir)) {
      throw new Error(`no Ultra runs in ${STATE_DIR}; start one with \`alran ultra "<task>"\``);
    }
    const id = runId ?? this.runIds()[0];
    if (!id) {
      throw new Error(`no Ultra runs in ${STATE_DIR}; start one with \`alran ultra "<task>"\``);
    }
    if (!existsSync(path.join(this.stateDir, id, 'state.json'))) {
      const known = this.runIds();
      throw new Error(
        known.length === 0
          ? `no Ultra runs in ${STATE_DIR}`
          : `unknown Ultra run "${id}"; known runs: ${known.join(', ')}`,
      );
    }
    return ultra.RunStore.open(this.stateDir, id);
  }

  async show(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/u).filter((part) => part.length > 0);
    const sub = parts[0];
    const rest = parts.slice(1);
    try {
      // A task is not a subcommand. Anything that is not one of the known
      // subcommands is the task to run, so `/ultra build a drawing app` works.
      if (sub !== undefined && !ULTRA_SUBCOMMANDS.has(sub)) {
        // The git check comes first: a run refuses to start on a dirty tree, and
        // the reader should hear that before answering six questions.
        if (this.refuseIfTreeIsDirty()) return;
        await this.startRun(args.trim());
        return;
      }

      switch (sub) {
        case undefined:
          // With no task there is nothing to run yet: offer the wizard, and
          // fall back to the board when this host cannot start runs.
          if (this.options.start) {
            // Checked before the wizard, not after: the guard is a property of
            // the repository, not of the answers, and making the reader fill in
            // a form only to refuse at the end is the wrong order.
            if (this.refuseIfTreeIsDirty()) return;
            this.showWizard();
            return;
          }
          this.showBoard(rest[0]);
          return;
        case 'board':
          this.showBoard(rest[0]);
          return;
        case 'attach':
          this.attach(rest[0]);
          return;
        case 'status':
          this.showStatus(rest[0]);
          return;
        case 'report':
          this.showReport(rest[0]);
          return;
        case 'pause':
          this.pause(rest[0]);
          return;
        case 'kill':
          this.kill(rest[0]);
          return;
        case 'resume':
          await this.resume(rest[0]);
          return;
        case 'runs':
          this.showRuns();
          return;
        default:
          this.options.appendNotice(
            `Unknown /ultra subcommand "${sub}". Use board, status, report, runs, pause, kill or resume.`,
            'warning',
          );
      }
    } catch (error) {
      this.options.appendNotice(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  /** `/ultra attach [run-id]`: the runner's log, live. */
  private attach(runId?: string): void {
    const store = this.open(runId);
    const panel = new UltraLogPanel({
      view: () => this.logViewFor(store),
      requestRender: this.options.requestRender,
      onClose: () => this.close(),
    });
    this.panel = panel;
    this.options.showPanel(panel);
    this.options.requestRender();
    // The same repaint timer the board uses, so a written log appears on its own.
    this.startTimer();
  }

  private logViewFor(store: ultra.RunStore) {
    const state = store.state;
    const runner = ultra.readRunner(store.paths);
    const classification = ultra.classifyRunner({
      record: runner,
      runStatus: state.status,
    });
    return {
      runId: state.runId,
      status: state.status,
      detail: classification.detail,
      lines: ultra.tailRunnerLog(store.paths.runnerLog, 24),
      live: classification.status === 'running',
    };
  }

/**
 * Spec 3.1: the cheap git check before anything is asked or started.
 *
 * Only the paths that *start* work call this. Reading a board, a log or a report
 * has to keep working on a dirty tree, because that is exactly when a reader
 * wants to look at one.
 *
 * No `--stash` here: a detached run that stashed the tree would leave the
 * reader's changes hidden inside a process they cannot see.
 */
  private refuseIfTreeIsDirty(): boolean {
    const decision = ultra.evaluateStartGuard({
      ...ultra.probeWorkingTree(this.options.workspaceDir),
      stash: false,
    });
    if (decision.ok) return false;
    for (const problem of decision.problems) this.options.appendNotice(problem, 'error');
    this.options.appendNotice(
      'Commit or stash your changes first, then run /ultra again.',
      'warning',
    );
    return true;
  }

  private showWizard(): void {
    const wizard = new UltraWizard({
      onStart: (request) => {
        this.close();
        void this.startRunFromWizard(request);
      },
      onCancel: () => {
        this.close();
        this.options.appendNotice('Ultra run cancelled.');
      },
      requestRender: this.options.requestRender,
    });
    this.panel = wizard;
    this.options.showPanel(wizard);
    this.options.requestRender();
  }

  private async startRunFromWizard(request: UltraStartRequest): Promise<void> {
    try {
      if (!this.options.start) {
        this.options.appendNotice(
          'This host cannot start an Ultra run; use `alran ultra "<task>"` in the CLI.',
          'warning',
        );
        return;
      }
      const started = await this.options.start(request);
      this.options.appendNotice(started.detail);
      // Follow the run that was just started rather than whatever is newest.
      this.showBoard(started.runId);
    } catch (error) {
      this.options.appendNotice(
        `Could not start the Ultra run: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }

  /** `/ultra <task>`: start with the documented defaults, then follow the run. */
  private async startRun(task: string): Promise<void> {
    if (!task) {
      this.options.appendNotice('Usage: /ultra <task>');
      return;
    }
    await this.startRunFromWizard({
      task,
      mode: 'run',
      budgetUsd: 2,
      workers: 4,
      recipe: 'auto',
    });
  }

  stop(): void {
    this.stopTimer();
    this.options.closePanel(this.panel ?? undefined);
    this.panel = undefined;
  }

  private showRuns(): void {
    const ids = this.runIds();
    if (ids.length === 0) {
      this.options.appendNotice(`No Ultra runs in ${STATE_DIR}.`);
      return;
    }
    const lines = ids.map((id) => {
      try {
        const store = ultra.RunStore.open(this.stateDir, id);
        const done = store.state.packets.filter((packet) => packet.status === 'done').length;
        return `${id}  ${store.state.status}  ${done}/${store.state.packets.length} packets`;
      } catch {
        return `${id}  (unreadable state)`;
      }
    });
    this.options.appendNotice(lines.join('\n'));
  }

  private showStatus(runId?: string): void {
    const store = this.open(runId);
    const state = store.state;
    const lines = [
      `${state.runId}  ${state.status}  budget=${
        state.budgetUsd === null ? 'unlimited' : `$${state.budgetUsd.toFixed(2)}`
      }  workers=${state.workers ?? 4}`,
      `Goal: ${state.goal}`,
    ];
    if (existsSync(store.paths.goal)) {
      try {
        const goal = ultra.parseGoalDocument(this.readGoal(store));
        const counts = ultra.goalCounts(goal);
        lines.push(
          `Criteria: ${counts.met}/${counts.total} met  must=${counts.must} ` +
            `needs_human=${counts.needsHuman} regressed=${counts.regressed}`,
        );
      } catch {
        // A malformed goal file must not hide the packet table.
      }
    }
    for (const packet of state.packets) {
      lines.push(`  ${packet.id}  ${packet.status.padEnd(10)} ${packet.title}`);
    }
    const resumable = store.resumablePacketIds();
    if (resumable.length > 0) lines.push(`Resumable: ${resumable.join(', ')}`);
    this.options.appendNotice(lines.join('\n'));
  }

  private showReport(runId?: string): void {
    this.options.appendNotice(this.reportText(this.open(runId)));
  }

  /**
   * The report text, rebuilding the file when it is missing. Split out from
   * `showReport` because the board shows the report itself: going through
   * `showReport` as well printed every report twice.
   */
  private reportText(store: ultra.RunStore): string {
    if (!existsSync(store.paths.report)) {
      writeFileSync(
        store.paths.report,
        ultra.buildReport({
          state: store.state,
          ledger: this.ledgerFor(store),
          ...this.planOf(store),
          ...(existsSync(store.paths.goal)
            ? { goal: ultra.parseGoalDocument(JSON.parse(readFileSync(store.paths.goal, 'utf8'))) }
            : {}),
        }),
      );
    }
    return readFileSync(store.paths.report, 'utf8').trimEnd();
  }

  /**
   * Why this run must not be killed, or `undefined` when it can be.
   *
   * `RunStore` only guards the transition *into* `succeeded`, so killing a
   * finished run would relabel a success as `killed` and lose the verdict the
   * report was written from.
   */
  private killRefusal(store: ultra.RunStore): string | undefined {
    const status = store.state.status;
    if (status === 'killed') return `Run ${store.state.runId} is already killed.`;
    if (TERMINAL.has(status)) {
      return `Run ${store.state.runId} already finished as ${status}; there is nothing left to kill.`;
    }
    return undefined;
  }

  /**
   * Why this run must not be resumed, or `undefined` when it can be.
   *
   * Resuming a finished run would merge it a second time, and resuming a
   * running one would start a second execute pass over the same worktrees.
   */
  private resumeRefusal(store: ultra.RunStore): string | undefined {
    const status = store.state.status;
    if (status === 'paused' || status === 'killed') return undefined;
    if (status === 'running') {
      return `Run ${store.state.runId} is already running; pause it first.`;
    }
    return `Run ${store.state.runId} is ${status}; only a paused or killed run can be resumed.`;
  }

  /**
   * Reads a JSON file, re-parsing only when it changed on disk.
   *
   * The board redraws on a timer, and a long run writes to `plan.json` and the
   * ledger behind the panel's back. Re-reading both on every frame would parse
   * the same bytes many times a second; the `(mtime, size)` signature is cheap
   * and changes whenever the content can have changed.
   */
  private readJsonCached<T>(file: string, cacheKey: 'plan' | 'goal'): T | undefined {
    const signature = fileSignature(file);
    const cached = this.caches[cacheKey];
    if (cached && cached.signature === signature) return cached.value as T;
    let value: T | undefined;
    try {
      value = JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      value = undefined;
    }
    this.caches[cacheKey] = { signature, value };
    return value;
  }

  /** The frozen goal document, cached like the plan. Throws when it is malformed. */
  private readGoal(store: ultra.RunStore): ultra.GoalDocument {
    const goal = this.readJsonCached<ultra.GoalDocument>(store.paths.goal, 'goal');
    if (!goal) throw new Error(`could not read the goal document at ${store.paths.goal}`);
    return goal;
  }

  private planOf(store: ultra.RunStore): { plan?: ultra.UltraPlan } {
    const plan = this.readJsonCached<ultra.UltraPlan>(store.paths.plan, 'plan');
    return plan ? { plan } : {};
  }

  /** The ledger, re-read only when the file grew or changed. */
  private ledgerFor(store: ultra.RunStore): ultra.Ledger {
    const signature = fileSignature(store.paths.ledger);
    if (this.ledgerCache?.signature === signature) return this.ledgerCache.ledger;
    const ledger = ultra.Ledger.open(store.paths.ledger);
    this.ledgerCache = { signature, ledger };
    return ledger;
  }

  private pause(runId?: string): void {
    const store = this.open(runId);
    if (store.state.status !== 'running') {
      this.options.appendNotice(
        `Run ${store.state.runId} is ${store.state.status}, not running; there is nothing to pause.`,
        'warning',
      );
      return;
    }
    store.transition('paused');
    this.options.appendNotice(
      `Paused ${store.state.runId}. Resume it with /ultra resume ${store.state.runId}.`,
    );
  }

  private kill(runId?: string): void {
    const store = this.open(runId);
    store.transition('killed');
    this.options.appendNotice(
      `Killed ${store.state.runId}. Its worktrees and ledger are kept for inspection.`,
    );
  }

  private async resume(runId?: string): Promise<void> {
    const store = this.open(runId);
    if (!this.options.resume) {
      this.options.appendNotice(
        'This host cannot resume a run; use `alran ultra resume <run-id>` in the CLI.',
        'warning',
      );
      return;
    }
    const message = await this.options.resume({ store, runId: store.state.runId });
    this.options.appendNotice(message);
  }

  private showBoard(runId?: string): void {
    const store = this.open(runId);
    const actions = this.actionsFor(store);
    const board = new UltraBoard({
      snapshot: () => this.snapshotOf(store),
      actions,
      requestRender: this.options.requestRender,
      onClose: () => this.close(),
      showNotice: (text, kind) =>
        this.options.appendNotice(text, kind === 'warning' ? 'warning' : kind === 'error' ? 'error' : undefined),
    });
    this.panel = board;
    this.options.showPanel(board);
    this.options.requestRender();
    this.startTimer();
  }

  private actionsFor(store: ultra.RunStore): UltraBoardActions {
    return {
      pause: () => {
        if (store.state.status !== 'running') {
          return `Run ${store.state.runId} is ${store.state.status}, not running; nothing to pause.`;
        }
        store.transition('paused');
        this.options.requestRender();
        return `Paused ${store.state.runId}.`;
      },
      kill: () => {
        const refused = this.killRefusal(store);
        if (refused) return refused;
        store.transition('killed');
        this.options.requestRender();
        return `Killed ${store.state.runId}; worktrees and ledger are kept.`;
      },
      resume: () => {
        if (!this.options.resume) {
          return 'This host cannot resume a run; use `alran ultra resume <run-id>` in the CLI.';
        }
        const refused = this.resumeRefusal(store);
        if (refused) return refused;
        return this.options.resume({ store, runId: store.state.runId });
      },
      workers: (delta) => {
        const current = store.state.workers ?? 4;
        const next = store.setWorkers(current + delta);
        this.options.requestRender();
        if (next === current && delta !== 0) {
          return `Worker cap is already ${String(next)} (the range is 1-8).`;
        }
        return `Worker cap for the next pass: ${String(next)} (was ${String(current)}).`;
      },
      diff: () => this.diffOf(store),
      log: () => {
        this.attach(store.state.runId);
        return `${store.state.runId}: opened the log.`;
      },
      goal: () => this.goalOf(store),
      report: () => this.reportOf(store),
    };
  }

  /** The board's data, read fresh on every frame so it stays live. */
  private snapshotOf(store: ultra.RunStore): UltraBoardSnapshot | undefined {
    const state = store.state;
    if (state.packets.length === 0) return undefined;
    const plan = this.planOf(store).plan;
    let criteria: ultra.Criterion[] | undefined;
    if (existsSync(store.paths.goal)) {
      try {
        criteria = ultra.parseGoalDocument(this.readGoal(store)).criteria;
      } catch {
        criteria = undefined;
      }
    }
    const rounds = (plan?.packets ?? []).map((packet) => packet.round ?? 1);
    const ledger = this.ledgerFor(store);
    const entries = ledger.entries();
    const last = entries.length > 0 ? entries[entries.length - 1]?.at : undefined;
    const started = Date.parse(state.createdAt);
    const end = TERMINAL.has(state.status)
      ? Date.parse(last ?? state.createdAt)
      : (this.options.now?.() ?? new Date()).getTime();
    return {
      runId: state.runId,
      goal: state.goal,
      state,
      packets: plan?.packets ?? [],
      ...(criteria ? { criteria } : {}),
      costUsd: ledger.totalCostUsd(),
      ...(rounds.length > 0 ? { round: Math.max(...rounds) } : {}),
      elapsedMs: Number.isFinite(started) && Number.isFinite(end) ? end - started : undefined,
      workers: state.workers ?? 4,
      // A glance at what the run is doing, without opening the log.
      logTail: ultra.tailRunnerLog(store.paths.runnerLog, 3),
    };
  }

  /**
   * A real `git diff --stat` of what the run produced.
   *
   * Printing the command instead of running it made the `d` key a reminder
   * rather than a view. `--stat` is bounded and fast whatever the diff size; the
   * full patch is one command away, and the notice says which.
   */
  private diffOf(store: ultra.RunStore): string {
    const done = store.state.packets.filter((packet) => packet.status === 'done');
    if (done.length === 0) return 'No packet has finished yet, so there is nothing to diff.';

    const runBranch = `ultra/${store.state.runId}`;
    const refs = gitRef(this.options.workspaceDir, runBranch)
      ? [{ ref: runBranch, label: `branch ${runBranch}` }]
      : done.map((packet) => ({
          ref: `ultra/${store.state.runId}/${packet.id}`,
          label: packet.id,
        }));

    const sections: string[] = [];
    for (const { ref, label } of refs) {
      const stat = git(this.options.workspaceDir, ['diff', '--stat', `HEAD..${ref}`]);
      sections.push(`--- ${label} ---`, stat || '(no changes against HEAD)');
    }
    sections.push('', `Full patch: git diff HEAD..${refs[0]!.ref}`);
    return sections.join('\n');
  }

  private logOf(store: ultra.RunStore): string {
    const entries = this.ledgerFor(store).entries();
    if (entries.length === 0) return 'The ledger is empty; the run has not recorded a step yet.';
    const tail = entries.slice(-25);
    return tail
      .map((entry) => {
        const at = entry.at ?? '';
        const role = entry.role ? ` ${entry.role}` : '';
        const packet = entry.packetId ? ` ${entry.packetId}` : '';
        const status = entry.status ? ` ${entry.status}` : '';
        const cost = typeof entry.costUsd === 'number' ? ` $${entry.costUsd.toFixed(2)}` : '';
        const note = entry.note ? ` ${entry.note}` : '';
        return `${at}${role}${packet}${status}${cost}${note}`.trimEnd();
      })
      .join('\n');
  }

  private goalOf(store: ultra.RunStore): string {
    if (!existsSync(store.paths.goal)) {
      return 'This run has no goal document; it was started as a single-round run.';
    }
    const goal = ultra.parseGoalDocument(this.readGoal(store));
    const lines = [goal.goal, ''];
    for (const criterion of goal.criteria) {
      lines.push(
        `${criterion.id}  ${criterion.status.padEnd(12)} (${criterion.priority}) ${criterion.description}`,
      );
    }
    return lines.join('\n');
  }

  private reportOf(store: ultra.RunStore): string {
    return this.reportText(store);
  }

  private close(): void {
    this.stopTimer();
    this.options.closePanel(this.panel ?? undefined);
    this.panel = undefined;
  }

  private startTimer(): void {
    this.stopTimer();
    // A monitor that never repaints is not a monitor. A host that genuinely
    // wants a static board passes 0.
    const ms = this.options.refreshMs ?? DEFAULT_REFRESH_MS;
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => this.options.requestRender(), ms);
  }

  private stopTimer(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}