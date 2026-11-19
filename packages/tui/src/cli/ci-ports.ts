/**
 * GitHub adapter for the CI Fixer core.
 *
 * Implements the ports in @alran/ci-fix with the `gh` and `git` CLIs plus a
 * headless `alran exec` run. This is the only place that knows about GitHub
 * specifics; the core stays portable so a future GitHub App can reuse it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CiFixAgentRequest,
  CiFixAgentResult,
  CiFixExecResult,
  CiFixGitPort,
  CiFixPorts,
} from '@alran/ci-fix';

export interface CiFixAdapterContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Command that starts Alran Code; defaults to the running CLI entry. */
  readonly alranCommand?: readonly string[];
}

interface SpawnOptions {
  readonly input?: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

function spawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
): CiFixExecResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs,
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error !== undefined && result.status === null,
  };
}

/** Runs a project command string through the platform shell. */
function spawnShell(
  command: string,
  options: SpawnOptions & { readonly cwd?: string },
): CiFixExecResult {
  const result = spawnSync(command, {
    cwd: options.cwd,
    shell: true,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeoutMs,
    env: options.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error !== undefined && result.status === null,
  };
}

function alranCommandFor(context: CiFixAdapterContext): readonly string[] {
  if (context.alranCommand) return context.alranCommand;
  const entry = process.argv[1];
  if (entry && /cli\.[cm]?js$/u.test(entry)) return [process.execPath, entry];
  return ['alran'];
}

function git(context: CiFixAdapterContext, args: readonly string[]): string {
  const result = spawn('git', args, { env: context.env });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

function gh(context: CiFixAdapterContext, args: readonly string[], input?: string): string {
  const result = spawn('gh', args, { env: context.env, input });
  if (result.code !== 0) {
    throw new Error(`gh ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

function isGhAuthenticated(context: CiFixAdapterContext): boolean {
  const result = spawn('gh', ['auth', 'status'], { env: context.env });
  return result.code === 0;
}

export function createCiFixPorts(context: CiFixAdapterContext): CiFixPorts {
  const alran = alranCommandFor(context);

  const exec: CiFixPorts['exec'] = (command, cwd, timeoutMs) => {
    const result = spawnShell(command, { env: context.env, cwd, timeoutMs });
    return Promise.resolve(result);
  };

  const agent = async (request: CiFixAgentRequest): Promise<CiFixAgentResult> => {
    const dir = mkdtempSync(path.join(tmpdir(), 'alran-ci-fix-'));
    const systemFile = path.join(dir, 'system-prompt.txt');
    writeFileSync(systemFile, request.systemPrompt);
    const minutes = Math.max(1, Math.ceil(request.timeoutMs / 60_000));
    const result = spawn(
      alran[0],
      [
        ...alran.slice(1),
        'exec',
        '--input',
        '-',
        '--input-format',
        'text',
        '--permission',
        'full',
        '--timeout',
        `${minutes}m`,
        '--output-format',
        'json',
        '--system-prompt-file',
        systemFile,
        '--cwd',
        context.cwd,
        ...(request.model ? ['--model', request.model] : []),
      ],
      {
        input: request.userPrompt,
        timeoutMs: request.timeoutMs + 30_000,
        env: { ...context.env, ALRAN_API_KEY: request.apiKey },
      },
    );
    rmSync(dir, { recursive: true, force: true });
    let tokensUsed = 0;
    let error: string | undefined;
    try {
      const parsed = JSON.parse(result.stdout) as {
        status?: string;
        usage?: { totalTokens?: number };
        error?: { message?: string };
      };
      tokensUsed = parsed.usage?.totalTokens ?? 0;
      if (parsed.status !== 'succeeded') {
        error = parsed.error?.message ?? `headless run status: ${parsed.status ?? 'unknown'}`;
      }
    } catch {
      error = result.stderr.trim() || 'headless run produced no JSON result';
    }
    if (result.code !== 0 && !error) {
      error = result.stderr.trim() || `headless run exited with ${result.code}`;
    }
    const ok = error === undefined;
    return {
      ok,
      diff: ok ? git(context, ['diff']) : '',
      tokensUsed,
      error,
    };
  };

  const gitPort: CiFixGitPort = {
    headMessage: () => Promise.resolve(git(context, ['log', '-1', '--pretty=%B']).trim()),
    commitChain: (limit) =>
      Promise.resolve(
        git(context, ['log', `-${limit}`, '--pretty=%B%x00'])
          .split('\0')
          .filter((message) => message.trim() !== ''),
      ),
    diff: () => Promise.resolve(git(context, ['diff'])),
    commit: (subject, body) => {
      git(context, ['commit', '-m', subject, '-m', body]);
      return Promise.resolve();
    },
    createBranch: (name) => {
      git(context, ['checkout', '-b', name]);
      return Promise.resolve();
    },
    push: () => {
      const token = context.env.ALRAN_CI_PUSH_TOKEN;
      const args =
        token && token.length > 0
          ? ['-c', `http.extraHeader=Authorization: Bearer ${token}`, 'push', 'origin', 'HEAD']
          : ['push', 'origin', 'HEAD'];
      git(context, args);
      return Promise.resolve();
    },
    createPullRequest: (title, body, base, head) => {
      const url = gh(context, [
        'pr',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--base',
        base,
        '--head',
        head,
      ]).trim();
      const match = /\/pull\/(\d+)/u.exec(url);
      return Promise.resolve(match ? Number(match[1]) : 0);
    },
    pullRequestNumberForHead: (headSha) => {
      try {
        const out = gh(context, [
          'pr',
          'list',
          '--head',
          headSha,
          '--state',
          'open',
          '--json',
          'number',
          '--limit',
          '1',
        ]);
        const parsed = JSON.parse(out) as Array<{ number: number }>;
        return Promise.resolve(parsed[0]?.number);
      } catch {
        return Promise.resolve(undefined);
      }
    },
    changedFiles: () =>
      Promise.resolve(
        git(context, ['diff', '--name-only'])
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
  };

  const report: CiFixPorts['report'] = {
    comment: (pullRequestNumber, body) => {
      gh(context, ['pr', 'comment', String(pullRequestNumber), '--body-file', '-'], body);
      return Promise.resolve();
    },
  };

  const rateLimit: CiFixPorts['rateLimit'] = {
    runsToday: () => {
      try {
        const out = gh(context, [
          'run',
          'list',
          '--workflow',
          'alran-ci-fix.yml',
          '--limit',
          '100',
          '--json',
          'createdAt',
        ]);
        const parsed = JSON.parse(out) as Array<{ createdAt: string }>;
        const today = new Date().toISOString().slice(0, 10);
        return Promise.resolve(
          parsed.filter((run) => run.createdAt.slice(0, 10) === today).length,
        );
      } catch {
        // Without gh access the limit cannot be counted; fail open.
        return Promise.resolve(0);
      }
    },
  };

  return { exec, agent, git: gitPort, report, rateLimit };
}

export { isGhAuthenticated };