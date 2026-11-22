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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as ultra from '@alran/ultra';
import type { Component } from '../../rendering/component.js';
import { renderUltraRunDiff, ultraRefExists } from '../../../cli/ultra-diff.js';
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
  /**
   * Reviews what a run produced. Injected because the review needs the runtime
   * adapters; without it `/ultra review` says so rather than pretending.
   */
  readonly review?: (input: { readonly store: ultra.RunStore; readonly runId: string }) => Promise<string>;
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

/** How often the open board repaints itself. */
const DEFAULT_REFRESH_MS = 1000;

/** Subcommands `/ultra` understands; anything else is a task to run. */
const ULTRA_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'board',
  'attach',
  'status',
  'report',
  'runs',
  'diff',
  'review',
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
        case 'diff':
          this.options.appendNotice(this.diffOf(this.open(rest[0])));
          return;
        case 'review':
          await this.review(rest[0]);
          return;
        default:
          this.options.appendNotice(
            `Unknown /ultra subcommand "${sub}". Use board, status, report, runs, diff, review, pause, kill or resume.`,
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
    // The same listing the CLI's `alran ultra runs` prints: one vocabulary for
    // "which run was that?", whichever surface the reader is on.
    const listing = ultra.listUltraRuns(this.stateDir);
    this.options.appendNotice(ultra.renderRunList(listing));
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
    // The project-wide gates: the commands the merge will be checked against.
    // Detection is a guess about a repository, so the reader is better off
    // seeing it than wondering what the run will consider green.
    const gates = this.planGates(store);
    if (gates) {
      const commands = [...gates.test, ...gates.lint, ...gates.build];
      lines.push(
        commands.length > 0
          ? `Project-wide gates: ${commands.join(' · ')}`
          : 'Project-wide gates: none detected',
      );
    }
    const resumable = store.resumablePacketIds();
    if (resumable.length > 0) lines.push(`Resumable: ${resumable.join(', ')}`);
    // What to do next, so the status is the end of the answer and not the
    // beginning of another question.
    const step = ultra.nextStepFor(state);
    if (step.kind === 'resume') {
      lines.push(`Next: resume it with /ultra resume ${state.runId}`);
    } else if (step.kind === 'merge') {
      lines.push(`Next: review the branch, then merge it with \`git merge ${step.branch}\``);
    }
    this.options.appendNotice(lines.join('\n'));
  }

  /** The plan's project-wide gates, or `undefined` when there is no plan yet. */
  private planGates(store: ultra.RunStore): ultra.UltraGates | undefined {
    if (!existsSync(store.paths.plan)) return undefined;
    try {
      const plan = JSON.parse(readFileSync(store.paths.plan, 'utf8')) as ultra.UltraPlan;
      return plan.gates;
    } catch {
      // A malformed plan file must not hide the packet table.
      return undefined;
    }
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
   * Why this run must not be resumed, or `undefined` when it can be.
   *
   * The rule lives in the core, because the CLI applies the same one: the two
   * surfaces read the same state directory, and a rule that differs between
   * them is a rule one of them gets wrong.
   */
  private resumeRefusal(store: ultra.RunStore): string | undefined {
    // The same driver check the CLI applies: a run whose process died is not
    // "already running", it is a run waiting to be picked up again.
    const classification = ultra.classifyRunner({
      record: ultra.readRunner(store.paths),
      runStatus: store.state.status,
    });
    return ultra.resumeRefusal(
      store.state,
      ultra.driverFromRunnerStatus(classification.status),
    );
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

  /**
   * Decides what a stop request means for this run.
   *
   * The same rule the CLI applies, from the same core function: the run's
   * state file belongs to the process that drives the run, so a request from
   * this process travels through a file of its own and the driver stops at its
   * next safe point.
   */
  private stopDecision(
    store: ultra.RunStore,
    request: ultra.UltraControlRequest,
  ): ultra.UltraControlDecision {
    const classification = ultra.classifyRunner({
      record: ultra.readRunner(store.paths),
      runStatus: store.state.status,
    });
    return ultra.decideControl({
      request,
      runStatus: store.state.status,
      driver: ultra.driverFromRunnerStatus(classification.status),
    });
  }
  private pause(runId?: string): void {
    const store = this.open(runId);
    const decision = this.stopDecision(store, 'pause');
    if (decision.refusal) {
      this.options.appendNotice(`Run ${store.state.runId}: ${decision.refusal}.`, 'warning');
      return;
    }
    if (decision.request) ultra.writeControl(store.paths, 'pause');
    if (decision.apply) store.transition('paused');
    this.options.appendNotice(
      decision.request && decision.apply
        ? `Paused ${store.state.runId}. A process that is still driving it stops at the next safe point; resume it with /ultra resume ${store.state.runId}.`
        : decision.request
          ? `Pause requested for ${store.state.runId}. The run stops at the next safe point.`
          : `Paused ${store.state.runId}. Resume it with /ultra resume ${store.state.runId}.`,
    );
  }

  private kill(runId?: string): void {
    const store = this.open(runId);
    const decision = this.stopDecision(store, 'kill');
    if (decision.refusal) {
      this.options.appendNotice(`Run ${store.state.runId}: ${decision.refusal}.`, 'warning');
      return;
    }
    if (decision.request) ultra.writeControl(store.paths, 'kill');
    if (decision.apply) store.transition('killed');
    this.options.appendNotice(
      decision.request && decision.apply
        ? `Killed ${store.state.runId}. A process that is still driving it stops at the next safe point; its worktrees and ledger are kept for inspection.`
        : decision.request
          ? `Stop requested for ${store.state.runId}. The run stops at the next safe point; its worktrees and ledger are kept for inspection.`
          : `Killed ${store.state.runId}. Its worktrees and ledger are kept for inspection.`,
    );
  }

  /** `/ultra review [run-id]`: the review fleet over what the run produced. */
  private async review(runId?: string): Promise<void> {
    const store = this.open(runId);
    if (!this.options.review) {
      this.options.appendNotice(
        'This host cannot review a run; use `alran ultra review <run-id>` in the CLI.',
        'warning',
      );
      return;
    }
    try {
      const message = await this.options.review({ store, runId: store.state.runId });
      this.options.appendNotice(message);
    } catch (error) {
      this.options.appendNotice(
        `Could not review the run: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
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
    // The same rule the CLI applies: a run with a verdict is not continued,
    // and a run that is still running is not continued either.
    const refused = this.resumeRefusal(store);
    if (refused) {
      this.options.appendNotice(refused, 'warning');
      return;
    }
    // A run that never got a plan has nothing to execute. Saying so is more
    // useful than the parse error the host port would raise.
    if (!existsSync(store.paths.plan)) {
      this.options.appendNotice(
        `Run ${store.state.runId} has no plan yet, so there is nothing to execute: it stopped before the plan was written.`,
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
        const decision = this.stopDecision(store, 'pause');
        if (decision.refusal) return `Run ${store.state.runId}: ${decision.refusal}.`;
        if (decision.request) ultra.writeControl(store.paths, 'pause');
        if (decision.apply) store.transition('paused');
        this.options.requestRender();
        return decision.request
          ? `Pause requested for ${store.state.runId}; the run stops at the next safe point.`
          : `Paused ${store.state.runId}.`;
      },
      kill: () => {
        const decision = this.stopDecision(store, 'kill');
        if (decision.refusal) return `Run ${store.state.runId}: ${decision.refusal}.`;
        if (decision.request) ultra.writeControl(store.paths, 'kill');
        if (decision.apply) store.transition('killed');
        this.options.requestRender();
        return decision.request
          ? `Stop requested for ${store.state.runId}; the run stops at the next safe point.`
          : `Killed ${store.state.runId}; worktrees and ledger are kept.`;
      },
      resume: () => {
        if (!this.options.resume) {
          return 'This host cannot resume a run; use `alran ultra resume <run-id>` in the CLI.';
        }
        const refused = this.resumeRefusal(store);
        if (refused) return refused;
        if (!existsSync(store.paths.plan)) {
          return `Run ${store.state.runId} has no plan yet, so there is nothing to execute: it stopped before the plan was written.`;
        }
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
    const runBranch = ultra.runBranchFor(store.state.runId);
    return renderUltraRunDiff({
      cwd: this.options.workspaceDir,
      runId: store.state.runId,
      packets: store.state.packets,
      runBranchExists: ultraRefExists(this.options.workspaceDir, runBranch),
    });
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