/**
 * `alran ci …` — the CI Fixer command surface.
 *
 * init | status | doctor | disable | fix [--dry-run | --workflow-run].
 * Everything GitHub-specific goes through the adapter in ci-ports.ts; the
 * decisions come from the @alran/ci-fix core.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import * as ciFix from '@alran/ci-fix';
import { createCiFixPorts, isGhAuthenticated } from './ci-ports.js';
import { executeRetrigger } from './ci-retrigger.js';
import {
  detectCommands,
  detectRepo,
  gitText,
  listWorkflows,
  readConfig,
  writeConfig,
} from './ci-facts.js';

export interface CiCommandOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: (text: string) => void;
  readonly prompt?: (question: string, fallback?: string) => Promise<string>;
  readonly exit?: (code: number) => void;
}

async function defaultPrompt(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(fallback ? `${question} (${fallback}): ` : `${question}: `);
    return answer.trim() || fallback || '';
  } finally {
    rl.close();
  }
}

export function registerCiCommand(program: Command, options: CiCommandOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const prompt = options.prompt ?? defaultPrompt;
  const ports = () => createCiFixPorts({ cwd, env });

  const ci = program
    .command('ci')
    .description('CI Fixer: set up and run automatic repair of red CI');

  ci.command('init')
    .description('Detect the repo, ask for mode and limits, and write .alran/ci.yml plus the workflow')
    .option('--yes', 'accept the detected defaults without asking')
    .option('--workflows <names>', 'comma-separated workflow names to monitor')
    .option('--pull-request-mode <mode>', 'push-to-branch, fix-pr or comment-only')
    .option('--main-mode <mode>', 'fix-pr, push or comment-only')
    .option('--max-attempts <count>', 'fix attempts per failure chain', '2')
    .option('--test <command>', 'command that reproduces the red CI run')
    .option('--model <name>', 'model name for the fix runs')
    .option('--base-url <url>', 'OpenAI-compatible base URL for the fix runs')
    .action(async (commandOptions: Record<string, string | boolean | undefined>) => {
      const repo = detectRepo(cwd);
      const detected = detectCommands(cwd);
      const detectedWorkflows = listWorkflows(cwd);
      const ask = async (question: string, fallback?: string): Promise<string> =>
        commandOptions.yes === true ? fallback ?? '' : prompt(question, fallback);

      const workflows = String(commandOptions.workflows ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      const pullRequestMode = (commandOptions.pullRequestMode as ciFix.CiFixPullRequestMode | undefined) ??
        ((await ask(
          'Pull request mode (push-to-branch, fix-pr, comment-only)',
          'push-to-branch',
        )) as ciFix.CiFixPullRequestMode);
      const mainMode = (commandOptions.mainMode as ciFix.CiFixMainMode | undefined) ??
        ((await ask('Main branch mode (fix-pr, push, comment-only)', 'fix-pr')) as ciFix.CiFixMainMode);
      const testCommand = String(commandOptions.test ?? '') ||
        (await ask('Command that reproduces the red CI run', detected.test[0])) || detected.test[0] || '';
      const modelName = String(commandOptions.model ?? '') ||
        (await ask('Model name', ciFix.DEFAULT_CI_FIX_MODEL.name));
      const baseUrl = String(commandOptions.baseUrl ?? '') ||
        (await ask('OpenAI-compatible base URL', ciFix.DEFAULT_CI_FIX_MODEL.base_url));
      const maxAttempts = Number(commandOptions.maxAttempts ?? 2);

      if (testCommand.length === 0) {
        throw new Error(
          'no test command detected and none given; pass --test <command> or add a test script',
        );
      }
      if (workflows.length === 0 && detectedWorkflows.length === 0 && !commandOptions.yes) {
        const answer = await ask('Workflow names to monitor (comma separated)', 'CI');
        workflows.push(...answer.split(',').map((name) => name.trim()).filter(Boolean));
      }
      const plan = ciFix.planCiFixInit({
        repo,
        workflows: workflows.length > 0 ? workflows : detectedWorkflows.length > 0 ? detectedWorkflows : ['CI'],
        pullRequestMode,
        mainMode,
        limits: { max_attempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 2 },
        model: { name: modelName, base_url: baseUrl },
      });
      for (const file of plan.files) {
        const target = path.join(cwd, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.content);
      }
      write(`Wrote ${plan.files.map((file) => file.path).join(' and ')}.\n`);
      write(`Monitored workflows: ${plan.config.trigger.workflows.join(', ')}\n`);
      write(`Detected commands — test: ${detected.test.join(' | ') || 'none'}, lint: ${detected.lint.join(' | ') || 'none'}, build: ${detected.build.join(' | ') || 'none'}\n`);
      const ghReady = isGhAuthenticated({ cwd, env });
      if (ghReady && env.ALRAN_API_KEY && env.ALRAN_API_KEY.length > 0) {
        const secret = spawnSync(
          'gh',
          ['secret', 'set', plan.secretName, '--repo', repo.fullName, '--body', env.ALRAN_API_KEY],
          { cwd, encoding: 'utf8' },
        );
        write(
          secret.status === 0
            ? `Set the ${plan.secretName} secret via gh.\n`
            : `Could not set the ${plan.secretName} secret via gh: ${(secret.stderr ?? '').trim()}\n`,
        );
      } else {
        write(`\n${ciFix.buildSecretSetupInstructions({ secretName: plan.secretName, repo, ghAvailable: ghReady })}\n`);
      }
      write('\nCommit both files, then open a pull request to activate CI Fix.\n');
    });

  ci.command('status')
    .description('Show the CI Fixer configuration, detection results and recent fix commits')
    .action(() => {
      const repo = detectRepo(cwd);
      const detected = detectCommands(cwd);
      const config = readConfig(cwd);
      write(`Repository: ${repo.fullName}\n`);
      write(`Test: ${detected.test.join(' | ') || 'not detected'}\n`);
      write(`Lint: ${detected.lint.join(' | ') || 'not detected'}\n`);
      write(`Build: ${detected.build.join(' | ') || 'not detected'}\n`);
      write(`Monitored workflows in repo: ${listWorkflows(cwd).join(', ') || 'none'}\n`);
      if (!config) {
        write('CI Fix is not set up yet; run `alran ci init`.\n');
        return;
      }
      write(`\nConfig (${ciFix.CI_FIX_CONFIG_PATH}):\n`);
      write(`  enabled: ${config.config.enabled}\n`);
      write(`  mode: pull_request=${config.config.mode.pull_request}, main=${config.config.mode.main}\n`);
      write(`  limits: max_attempts=${config.config.limits.max_attempts}, max_diff_lines=${config.config.limits.max_diff_lines}, timeout_minutes=${config.config.limits.timeout_minutes}\n`);
      write(`  model: ${config.config.model.name} via ${config.config.model.base_url}\n`);
      write(`  monitored: ${config.config.trigger.workflows.join(', ')}\n`);
      if (config.problems.length > 0) {
        write(`  problems: ${config.problems.join('; ')}\n`);
      }
      write(`Workflow installed: ${existsSync(path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH)) ? 'yes' : 'no'}\n`);
      const chain = gitText(cwd, ['log', '-20', '--pretty=%B%x00'])?.split('\0') ?? [];
      const attempts = ciFix.countCiFixAttempts(chain.filter((message) => message.trim() !== ''));
      write(`Fix commits in the last 20: ${attempts}\n`);
    });

  ci.command('doctor')
    .description('Check gh login, secret, workflow permissions, fork state and monitored workflows')
    .action(() => {
      const config = readConfig(cwd);
      const monitored = config?.config.trigger.workflows ?? [];
      const ghReady = isGhAuthenticated({ cwd, env });
      let isFork = false;
      let secretPresent = false;
      let pushTokenPresent = false;
      if (ghReady) {
        try {
          const repoJson = spawnSync('gh', ['repo', 'view', '--json', 'isFork'], { cwd, encoding: 'utf8' });
          if (repoJson.status === 0) {
            isFork = (JSON.parse(repoJson.stdout) as { isFork: boolean }).isFork === true;
          }
          const secretJson = spawnSync('gh', ['secret', 'list'], { cwd, encoding: 'utf8' });
          if (secretJson.status === 0) {
            secretPresent = /ALRAN_API_KEY/u.test(secretJson.stdout);
            pushTokenPresent = /ALRAN_CI_PUSH_TOKEN/u.test(secretJson.stdout);
          }
        } catch {
          // Facts stay at their defaults; the checks below report the gaps.
        }
      }
      const workflowFile = path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH);
      const workflowInstalled = existsSync(workflowFile);
      let permissions: string[] = [];
      if (workflowInstalled) {
        const text = readFileSync(workflowFile, 'utf8');
        const block = text.split('permissions:\n')[1]?.split('\njobs:')[0] ?? '';
        permissions = block
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.includes(':'));
      }
      const checks = ciFix.runDoctorChecks({
        ghAuthenticated: ghReady,
        secretPresent,
        workflowInstalled,
        workflowPermissions: permissions,
        isFork,
        repositoryWorkflows: listWorkflows(cwd),
        monitoredWorkflows: monitored,
        pushTokenSecretPresent: pushTokenPresent,
        configEnabled: config?.config.enabled ?? false,
        configProblems: config?.problems ?? ['no .alran/ci.yml; run `alran ci init`'],
      });
      for (const check of checks) {
        const mark = check.ok ? 'ok ' : check.severity === 'warning' ? 'warn' : 'FAIL';
        write(`${mark} ${check.id}: ${check.detail}\n`);
        if (!check.ok && check.hint) write(`     hint: ${check.hint}\n`);
      }
      if (!ciFix.doctorIsHealthy(checks)) {
        (options.exit ?? ((code: number) => { process.exitCode = code; }))(1);
      }
    });

  ci.command('disable')
    .description('Turn CI Fix off: enabled: false in the config and remove the workflow')
    .action(() => {
      const config = readConfig(cwd);
      if (!config) {
        write('CI Fix is not set up; nothing to disable.\n');
        return;
      }
      writeConfig(cwd, ciFix.renderCiFixConfig({ ...config.config, enabled: false }));
      const workflowFile = path.join(cwd, ciFix.CI_FIX_WORKFLOW_PATH);
      if (existsSync(workflowFile)) {
        rmSync(workflowFile);
        write(`Removed ${ciFix.CI_FIX_WORKFLOW_PATH}.\n`);
      }
      write(`Set enabled: false in ${ciFix.CI_FIX_CONFIG_PATH}. CI Fix is off.\n`);
    });

  const fix = ci
    .command('fix')
    .description('Run one fix attempt; --dry-run never commits, --workflow-run is the Action entry');
  fix
    .option('--dry-run', 'reproduce, fix and verify locally; show the diff but commit nothing')
    .option('--workflow-run', 'internal: run from the installed GitHub Action workflow')
    .option('--command <command>', 'command to reproduce; defaults to the detected test command')
    .action(async (commandOptions: { dryRun?: boolean; workflowRun?: boolean; command?: string }) => {
      const config = readConfig(cwd);
      if (!config) {
        throw new Error(`no ${ciFix.CI_FIX_CONFIG_PATH}; run \`alran ci init\` first`);
      }
      if (config.problems.length > 0) {
        throw new Error(`invalid ${ciFix.CI_FIX_CONFIG_PATH}: ${config.problems.join('; ')}`);
      }
      const failingCommand = commandOptions.command || detectCommands(cwd).test[0];
      if (!failingCommand) {
        throw new Error('no failing command; pass --command <command>');
      }
      const branch = gitText(cwd, ['branch', '--show-current']) ?? '';
      const headSha = gitText(cwd, ['rev-parse', 'HEAD']) ?? '';

      if (commandOptions.workflowRun === true) {
        const repo = detectRepo(cwd);
        let runId = env.ALRAN_CI_RUN_ID ?? '';
        let logs = '';
        if (runId) {
          const result = spawnSync('gh', ['run', 'view', runId, '--log-failed'], {
            cwd,
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
          });
          logs = result.stdout ?? '';
        } else {
          // Without the event's run id (manual dispatch), take the latest
          // failed run of the first monitored workflow.
          const monitored = config.config.trigger.workflows[0];
          const list = spawnSync(
            'gh',
            ['run', 'list', '--workflow', monitored, '--status', 'failure', '--limit', '1', '--json', 'databaseId'],
            { cwd, encoding: 'utf8' },
          );
          if (list.status === 0) {
            try {
              const parsed = JSON.parse(list.stdout) as Array<{ databaseId: number }>;
              runId = parsed[0] ? String(parsed[0].databaseId) : '';
            } catch {
              runId = '';
            }
          }
          if (runId) {
            const result = spawnSync('gh', ['run', 'view', runId, '--log-failed'], {
              cwd,
              encoding: 'utf8',
              maxBuffer: 64 * 1024 * 1024,
            });
            logs = result.stdout ?? '';
          }
        }
        const truncated = ciFix.truncateLog(logs, { maxChars: 40_000 });
        const pullRequestNumber = await ports().git.pullRequestNumberForHead(branch);
        const outcome = await ciFix.runCiFix(
          {
            config: config.config,
            repo,
            headRepository: repo.fullName,
            branch,
            headSha,
            pullRequestNumber,
            baseBranchKind: pullRequestNumber ? 'pull_request' : 'main',
            failingCommand: ciFix.extractFailedCommand(truncated.text) ?? failingCommand,
            failedLogExcerpt: truncated.text,
            workspaceDir: cwd,
            apiKey: env.ALRAN_API_KEY ?? '',
            pushTokenAvailable: Boolean(env.ALRAN_CI_PUSH_TOKEN),
          },
          ports(),
        );
        const retrigger = executeRetrigger(
          outcome.retrigger,
          config.config.trigger.workflows,
          branch,
          (args) => {
            const result = spawnSync('gh', args, { cwd, encoding: 'utf8' });
            return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
          },
        );
        write(`${JSON.stringify({ status: outcome.status, reasons: outcome.reasons, committed: outcome.committed, pushed: outcome.pushed, commented: outcome.commented, retrigger: outcome.retrigger, dispatched: retrigger.executed, dispatchFailures: retrigger.failed }, null, 2)}\n`);
        return;
      }

      const repo = detectRepo(cwd);
      const apiKey = env.ALRAN_API_KEY ?? '';
      if (!apiKey) {
        throw new Error(
          `ALRAN_API_KEY is not set in the environment; export it to run \`alran ci fix --dry-run\` locally`,
        );
      }
      const outcome = await ciFix.runCiFix(
        {
          config: config.config,
          repo,
          headRepository: repo.fullName,
          branch,
          headSha,
          baseBranchKind: 'pull_request',
          failingCommand,
          failedLogExcerpt: '',
          workspaceDir: cwd,
          apiKey,
          dryRun: true,
        },
        ports(),
      );
      write(`Status: ${outcome.status}\n`);
      for (const reason of outcome.reasons) write(`- ${reason}\n`);
      if (outcome.diff.length > 0) {
        write(`\nProposed diff (not applied to history):\n${outcome.diff}\n`);
      }
      if (outcome.violations.length > 0) {
        write(`\nDiff guard violations:\n${outcome.violations.map((v) => `- ${v}`).join('\n')}\n`);
      }
      write('\nDry run: nothing was committed, pushed or commented.\n');
    });
}