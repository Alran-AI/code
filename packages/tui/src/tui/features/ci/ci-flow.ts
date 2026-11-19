/**
 * `CiFlow` backs the `/ci` slash command.
 *
 * `/ci` (or `/ci init`) opens the setup wizard; `/ci status`, `/ci doctor`
 * and `/ci disable` mirror the CLI subcommands. Detection and file writes go
 * through the shared facts module and the @alran/ci-fix core, so the TUI and
 * the CLI can never drift apart.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as ciFix from '@alran/ci-fix';
import {
  detectCommands,
  detectRepo,
  listWorkflows,
  readConfig,
  writeConfig,
} from '../../../cli/ci-facts.js';
import type { Component } from '../../rendering/component.js';
import { CiWizard, type CiWizardAnswers } from './ci-wizard.js';

type AppendNotice = (content: string, kind?: 'warning' | 'error') => void;

export interface CiFlowOptions {
  readonly workspaceDir: string;
  readonly appendNotice: AppendNotice;
  readonly showPanel: (panel: Component) => void;
  readonly closePanel: (panel?: Component) => boolean;
  readonly requestRender: () => void;
}

export class CiFlow {
  private panel: Component | undefined;

  constructor(private readonly options: CiFlowOptions) {}

  async show(args: string): Promise<void> {
    const sub = args.trim().split(/\s+/u)[0] ?? 'init';
    try {
      if (sub === 'status') {
        this.showStatus();
        return;
      }
      if (sub === 'doctor') {
        this.showDoctor();
        return;
      }
      if (sub === 'disable') {
        this.disable();
        return;
      }
      this.startWizard();
    } catch (error) {
      this.options.appendNotice((error as Error).message, 'error');
    }
  }

  stop(): void {
    this.close();
  }

  private startWizard(): void {
    const cwd = this.options.workspaceDir;
    const repo = detectRepo(cwd);
    const detected = detectCommands(cwd);
    const workflows = listWorkflows(cwd);
    this.options.appendNotice(
      `CI Fix setup for ${repo.fullName}. Test command: ${detected.test.join(' | ') || 'not detected'}.`,
    );
    const panel = new CiWizard({
      detectedWorkflows: workflows,
      requestRender: this.options.requestRender,
      onCancel: () => {
        this.close(panel);
        this.options.appendNotice('CI Fix setup cancelled.');
      },
      onComplete: (answers) => this.install(answers, repo.fullName, detected.test[0]),
    });
    this.panel = panel;
    this.options.showPanel(panel);
  }

  private install(answers: CiWizardAnswers, repoName: string, detectedTest: string | undefined): void {
    const cwd = this.options.workspaceDir;
    const repo = detectRepo(cwd);
    const plan = ciFix.planCiFixInit({
      repo,
      workflows: answers.workflows.length > 0 ? answers.workflows : ['CI'],
      pullRequestMode: answers.pullRequestMode,
      mainMode: answers.mainMode,
      limits: { max_attempts: answers.maxAttempts },
    });
    for (const file of plan.files) {
      const target = path.join(cwd, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    this.close(this.panel);
    this.panel = undefined;
    this.options.appendNotice(
      `Wrote ${plan.files.map((file) => file.path).join(' and ')} for ${repoName}. ` +
        `Monitored workflows: ${plan.config.trigger.workflows.join(', ')}. ` +
        `Detected test command: ${detectedTest ?? 'none'}.`,
    );
    this.options.appendNotice(
      'Next: commit both files and open a pull request. Set the model API key as the ' +
        `${plan.secretName} repository secret (Settings → Secrets → Actions).`,
    );
  }

  private showStatus(): void {
    const cwd = this.options.workspaceDir;
    const repo = detectRepo(cwd);
    const detected = detectCommands(cwd);
    const config = readConfig(cwd);
    const lines = [
      `Repository: ${repo.fullName}`,
      `Test: ${detected.test.join(' | ') || 'not detected'}`,
      `Lint: ${detected.lint.join(' | ') || 'not detected'}`,
      `Build: ${detected.build.join(' | ') || 'not detected'}`,
      `Workflows in repo: ${listWorkflows(cwd).join(', ') || 'none'}`,
    ];
    if (!config) {
      lines.push('CI Fix is not set up yet; run /ci to start the wizard.');
    } else {
      lines.push(`enabled: ${config.config.enabled}`);
      lines.push(`mode: pull_request=${config.config.mode.pull_request}, main=${config.config.mode.main}`);
      lines.push(`limits: max_attempts=${config.config.limits.max_attempts}, max_diff_lines=${config.config.limits.max_diff_lines}`);
      lines.push(`model: ${config.config.model.name} via ${config.config.model.base_url}`);
      lines.push(`monitored: ${config.config.trigger.workflows.join(', ')}`);
      lines.push(`workflow installed: ${existsSync(path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH)) ? 'yes' : 'no'}`);
      if (config.problems.length > 0) lines.push(`problems: ${config.problems.join('; ')}`);
    }
    this.options.appendNotice(lines.join('\n'));
  }

  private showDoctor(): void {
    const cwd = this.options.workspaceDir;
    const config = readConfig(cwd);
    const ghReady = isGhAvailable();
    const fork = ghReady ? ghJson<{ isFork?: boolean }>(['repo', 'view', '--json', 'isFork']) : undefined;
    const secrets = ghReady ? ghText(['secret', 'list']) ?? '' : '';
    const checks = ciFix.runDoctorChecks({
      ghAuthenticated: ghReady,
      secretPresent: /ALRAN_API_KEY/u.test(secrets),
      workflowInstalled: existsSync(path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH)),
      workflowPermissions: ['contents: write', 'pull-requests: write', 'actions: read'],
      isFork: fork?.isFork === true,
      repositoryWorkflows: listWorkflows(cwd),
      monitoredWorkflows: config?.config.trigger.workflows ?? [],
      pushTokenSecretPresent: /ALRAN_CI_PUSH_TOKEN/u.test(secrets),
      configEnabled: config?.config.enabled ?? false,
      configProblems: config?.problems ?? ['no .alran/ci.yml; run /ci to set up'],
    });
    const lines = checks.map((check) => {
      const mark = check.ok ? 'ok ' : check.severity === 'warning' ? 'warn' : 'FAIL';
      return `${mark} ${check.id}: ${check.detail}${check.hint ? ` — ${check.hint}` : ''}`;
    });
    this.options.appendNotice(lines.join('\n'));
  }

  private disable(): void {
    const cwd = this.options.workspaceDir;
    const config = readConfig(cwd);
    if (!config) {
      this.options.appendNotice('CI Fix is not set up; nothing to disable.');
      return;
    }
    writeConfig(cwd, ciFix.renderCiFixConfig({ ...config.config, enabled: false }));
    const workflowFile = path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH);
    if (existsSync(workflowFile)) {
      rmSync(workflowFile);
    }
    this.options.appendNotice('CI Fix is off: enabled: false and the workflow was removed.');
  }

  private close(panel?: Component): void {
    this.options.closePanel(panel ?? this.panel ?? undefined);
    this.panel = undefined;
  }
}

function isGhAvailable(): boolean {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  return result.status === 0;
}

function ghText(args: readonly string[]): string | undefined {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : undefined;
}

function ghJson<T>(args: readonly string[]): T | undefined {
  const out = ghText(args);
  if (!out) return undefined;
  try {
    return JSON.parse(out) as T;
  } catch {
    return undefined;
  }
}