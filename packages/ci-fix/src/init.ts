/**
 * Setup planning for `alran ci init`.
 *
 * Turns wizard answers plus detected project facts into the two files the
 * feature needs: `.alran/ci.yml` (the reviewed config) and
 * `.github/workflows/alran-ci-fix.yml` (the installed Action). Pure functions
 * only; callers write the files, so tests and the TUI wizard stay identical.
 */

import {
  CI_FIX_CONFIG_PATH,
  CI_FIX_SECRET_NAME,
  CI_FIX_WORKFLOW_PATH,
  DEFAULT_CI_FIX_CONFIG,
  type CiFixConfig,
  type CiFixLimitsConfig,
  type CiFixMainMode,
  type CiFixModelConfig,
  type CiFixPullRequestMode,
  parseCiFixConfig,
  renderCiFixConfig,
} from './config.js';
import type { GitHubRepoRef } from './detect-repo.js';
import type { ProjectCommands } from './detect-commands.js';
import { renderCiFixWorkflow } from './workflow-template.js';

export interface InitPlanInput {
  readonly repo: GitHubRepoRef;
  /** Workflow names to monitor, e.g. ["CI"]. Empty falls back to ["CI"]. */
  readonly workflows: readonly string[];
  readonly pullRequestMode?: CiFixPullRequestMode;
  readonly mainMode?: CiFixMainMode;
  readonly limits?: Partial<CiFixLimitsConfig>;
  readonly model?: Partial<CiFixModelConfig>;
}

export interface InitPlan {
  readonly config: CiFixConfig;
  readonly configYaml: string;
  readonly workflowYaml: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly secretName: string;
}

/**
 * Builds both files from the answers. Defaults come from the documented
 * baseline, so an empty answer set still yields a working, safe installation.
 */
export function planCiFixInit(input: InitPlanInput): InitPlan {
  const config: CiFixConfig = {
    ...DEFAULT_CI_FIX_CONFIG,
    mode: {
      pull_request: input.pullRequestMode ?? DEFAULT_CI_FIX_CONFIG.mode.pull_request,
      main: input.mainMode ?? DEFAULT_CI_FIX_CONFIG.mode.main,
    },
    trigger: { workflows: input.workflows.length > 0 ? [...input.workflows] : ['CI'] },
    limits: { ...DEFAULT_CI_FIX_CONFIG.limits, ...input.limits },
    model: { ...DEFAULT_CI_FIX_CONFIG.model, ...input.model },
  };
  const configYaml = renderCiFixConfig(config);
  const workflowYaml = renderCiFixWorkflow({ monitoredWorkflows: config.trigger.workflows });
  return {
    config,
    configYaml,
    workflowYaml,
    files: [
      { path: CI_FIX_CONFIG_PATH, content: configYaml },
      { path: CI_FIX_WORKFLOW_PATH, content: workflowYaml },
    ],
    secretName: config.model.api_key_secret,
  };
}

/**
 * Validates an existing config document and reports its problems. Used by
 * `status` and `doctor` to surface a broken .alran/ci.yml without throwing.
 */
export function inspectCiFixConfig(yaml: string): {
  readonly config: CiFixConfig;
  readonly problems: readonly string[];
} {
  const { config, problems } = parseCiFixConfig(yaml);
  return { config, problems: problems.map((problem) => `${problem.path}: ${problem.message}`) };
}

export interface SecretSetupInput {
  readonly secretName?: string;
  readonly repo: GitHubRepoRef;
  readonly ghAvailable: boolean;
}

/**
 * The exact handoff when `gh` is not logged in: the commands to run, in order,
 * so the API key lands only in GitHub Secrets — never in the repository.
 */
export function buildSecretSetupInstructions(input: SecretSetupInput): string {
  const secretName = input.secretName ?? CI_FIX_SECRET_NAME;
  const lines = [
    `The fixer needs its model API key as the GitHub secret ${secretName}.`,
    '',
    'Option A — with gh signed in:',
    `  gh secret set ${secretName} --repo ${input.repo.fullName} --body "$ALRAN_API_KEY"`,
    '',
    'Option B — without gh, in the repository Settings:',
    `  1. Open https://github.com/${input.repo.fullName}/settings/secrets/actions`,
    `  2. New repository secret`,
    `  3. Name: ${secretName}`,
    '  4. Value: your Alran API key',
    '',
    'The key is read by the workflow from secrets only; it is never written to the repository.',
  ];
  return input.ghAvailable
    ? lines.slice(0, 2).concat(lines.slice(2)).join('\n')
    : lines.join('\n');
}
