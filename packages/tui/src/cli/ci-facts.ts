/**
 * Repository facts shared by the `alran ci` CLI command and the TUI `/ci`
 * wizard: GitHub remote detection, project command detection, workflow names
 * and the installed config. Pure fs/git readers, no side effects.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as ciFix from '@alran/ci-fix';

export function gitText(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return (result.stdout ?? '').trim();
}

export function detectRepo(cwd: string): ciFix.GitHubRepoRef {
  const remote = gitText(cwd, ['remote', 'get-url', 'origin']);
  const repo = remote ? ciFix.parseGitHubRemote(remote) : undefined;
  if (!repo) {
    throw new Error(
      `not a GitHub repository: \`git remote get-url origin\` returned ${remote ? `"${remote}"` : 'nothing'}. CI Fix needs a github.com origin.`,
    );
  }
  return repo;
}

export function detectCommands(cwd: string): ciFix.ProjectCommands {
  const read = (file: string): string | undefined => {
    try {
      return readFileSync(path.join(cwd, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  const packageJson = read('package.json');
  return ciFix.detectProjectCommands({
    ...(packageJson ? { packageJson: JSON.parse(packageJson) as { scripts?: Record<string, string> } } : {}),
    ...(read('pyproject.toml') ? { pyproject: read('pyproject.toml') } : {}),
    ...(read('Cargo.toml') ? { cargo: read('Cargo.toml') } : {}),
    ...(read('go.mod') ? { goMod: read('go.mod') } : {}),
    ...(read('Makefile') ? { makefile: read('Makefile') } : {}),
  });
}

export function listWorkflows(cwd: string): string[] {
  const dir = path.join(cwd, '.github/workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/u.test(file))
    .map((file) => file.replace(/\.ya?ml$/u, ''))
    .sort();
}

export function readConfig(
  cwd: string,
): { config: ciFix.CiFixConfig; problems: readonly string[] } | undefined {
  const file = path.join(cwd, ciFix.CI_FIX_CONFIG_PATH);
  if (!existsSync(file)) return undefined;
  return ciFix.inspectCiFixConfig(readFileSync(file, 'utf8'));
}

export function writeConfig(cwd: string, yaml: string): void {
  const file = path.join(cwd, ciFix.CI_FIX_CONFIG_PATH);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, yaml);
}