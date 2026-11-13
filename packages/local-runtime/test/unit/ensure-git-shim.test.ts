/**
 * The commit-attribution `git` shim, against a real git: every commit the agent makes carries the trailer
 * once, however the command is spelled, and everything else is git untouched.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalBashTool } from '@alran/agent-tools/desktop';
import { commitTrailerFor } from '@alran/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_SHIM_CONTENT, ensureGitShim, resolveGitShimDir } from '../../src/infra/ensure-git-shim.js';
import { resolveAgentBashEnvPolicy } from '../../src/infra/ensure-rm-shim.js';

const TRAILER = 'Co-Authored-By: Alran Code using Werk 1.1 <noreply@alran.dev>';
const posix = process.platform !== 'win32';
const describePosix = posix ? describe : describe.skip;

let dataDir: string;
let repo: string;
let home: string;
let savedEnv: NodeJS.ProcessEnv;

function realGit(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

/** Runs `command` in bash with the shim ahead of PATH, the way the agent's Bash does. */
function sh(command: string, env: NodeJS.ProcessEnv = {}, cwd: string = repo) {
  const shim = resolveGitShimDir(dataDir);
  const result = spawnSync('bash', ['-c', command], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, ...env },
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const message = () => realGit('log', '-1', '--format=%B').replace(/\n+$/u, '');

beforeEach(() => {
  savedEnv = { ...process.env };
  dataDir = mkdtempSync(join(tmpdir(), 'git-shim-data-'));
  repo = mkdtempSync(join(tmpdir(), 'git-shim-repo-'));
  home = mkdtempSync(join(tmpdir(), 'git-shim-home-'));
  writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n');
  process.env.HOME = home;
  process.env.GIT_CONFIG_GLOBAL = join(home, '.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  delete process.env.ALRAN_COMMIT_TRAILER;
  realGit('init', '-q', '-b', 'main');
  ensureGitShim(dataDir);
});

afterEach(() => {
  process.env = savedEnv;
  for (const dir of [dataDir, repo, home]) rmSync(dir, { recursive: true, force: true });
});

describe('seeding', () => {
  it('writes an executable shim in its own directory, idempotently, and none on Windows', () => {
    const dir = resolveGitShimDir(dataDir);
    expect(dir).toBe(join(dataDir, 'shims', 'git-attribution'));
    const file = join(dir, 'git');
    expect(readFileSync(file, 'utf8')).toBe(GIT_SHIM_CONTENT);
    expect(ensureGitShim(dataDir)).toBe(dir);
    if (posix) expect(statSync(file).mode & 0o111).not.toBe(0);
    expect(ensureGitShim(mkdtempSync(join(tmpdir(), 'git-shim-win-')), 'win32')).toBeUndefined();
  });

  it('repairs a shim that lost its execute bit or its content', () => {
    const file = join(resolveGitShimDir(dataDir), 'git');
    if (posix) chmodSync(file, 0o644);
    writeFileSync(file, '#!/bin/bash\nexit 1\n');
    ensureGitShim(dataDir);
    expect(readFileSync(file, 'utf8')).toBe(GIT_SHIM_CONTENT);
    if (posix) expect(statSync(file).mode & 0o100).not.toBe(0);
  });
});

describePosix('git commit through the shim', () => {
  it('adds the trailer to a -m message, once, after the message', () => {
    const r = sh('git commit --allow-empty -q -m "Fix the thing" -m "More detail."', { ALRAN_COMMIT_TRAILER: TRAILER });
    expect(r.code).toBe(0);
    expect(message()).toBe(`Fix the thing\n\nMore detail.\n\n${TRAILER}`);
  });

  it('leaves the message alone without the variable (commit attribution switched off)', () => {
    expect(sh('git commit --allow-empty -q -m "Plain"').code).toBe(0);
    expect(message()).toBe('Plain');
    expect(sh('git commit --allow-empty -q -m "Empty value"', { ALRAN_COMMIT_TRAILER: '' }).code).toBe(0);
    expect(message()).toBe('Empty value');
  });

  it('does not repeat a trailer the model already wrote, wherever it put it', () => {
    sh(`git commit --allow-empty -q -m "Subject" -m "${TRAILER}"`, { ALRAN_COMMIT_TRAILER: TRAILER });
    expect(message().split(TRAILER).length - 1).toBe(1);
    // Written as the model would: both trailers in the last paragraph, the Alran one not last.
    sh(`git commit --allow-empty -q -m "Second" -m "${TRAILER}
Signed-off-by: Test <test@example.invalid>"`, { ALRAN_COMMIT_TRAILER: TRAILER });
    expect(message().split(TRAILER).length - 1).toBe(1);
    expect(message()).toContain('Signed-off-by: Test <test@example.invalid>');
  });

  it('keeps other trailers and puts the Alran line with them', () => {
    sh('git commit --allow-empty -q -m "Subject" -m "Signed-off-by: Test <test@example.invalid>"', { ALRAN_COMMIT_TRAILER: TRAILER });
    expect(message()).toBe(`Subject\n\nSigned-off-by: Test <test@example.invalid>\n${TRAILER}`);
  });

  it('works with a heredoc message, -F, --amend, and git options before the subcommand', () => {
    const env = { ALRAN_COMMIT_TRAILER: TRAILER };
    expect(sh(`git commit --allow-empty -q -m "$(cat <<'EOF'\nHeredoc subject\n\nBody line.\nEOF\n)"`, env).code).toBe(0);
    expect(message()).toBe(`Heredoc subject\n\nBody line.\n\n${TRAILER}`);

    writeFileSync(join(repo, 'msg.txt'), 'From a file\n');
    expect(sh('git commit --allow-empty -q -F msg.txt', env).code).toBe(0);
    expect(message()).toBe(`From a file\n\n${TRAILER}`);

    expect(sh('git commit --amend --no-edit --allow-empty -q', env).code).toBe(0);
    expect(message()).toBe(`From a file\n\n${TRAILER}`);

    expect(sh(`git -C "${repo}" -c core.abbrev=8 commit --allow-empty -q -m "Elsewhere"`, env, tmpdir()).code).toBe(0);
    expect(message()).toBe(`Elsewhere\n\n${TRAILER}`);
    expect(sh(`git --no-pager --git-dir="${repo}/.git" --work-tree="${repo}" commit --allow-empty -q -m "Dir options"`, env, tmpdir()).code).toBe(0);
    expect(message()).toBe(`Dir options\n\n${TRAILER}`);
  });

  it('works through an alias that expands to commit, and not through one that does not', () => {
    const env = { ALRAN_COMMIT_TRAILER: TRAILER };
    realGit('config', 'alias.ci', 'commit -q --allow-empty');
    realGit('config', 'alias.st', 'status --short');
    realGit('config', 'alias.say', '!echo shell-alias');
    expect(sh('git ci -m "Via alias"', env).code).toBe(0);
    expect(message()).toBe(`Via alias\n\n${TRAILER}`);
    expect(sh('git st', env).code).toBe(0);
    expect(sh('git say', env).out).toBe('shell-alias\n');
  });

  it('passes every other command through untouched, with its output and exit status', () => {
    const env = { ALRAN_COMMIT_TRAILER: TRAILER };
    sh('git commit --allow-empty -q -m "One"', env);
    expect(sh('git log --format=%s', env).out).toBe('One\n');
    expect(sh('git rev-parse --is-inside-work-tree', env).out).toBe('true\n');
    expect(sh('git --version', env).out).toMatch(/^git version /u);
    expect(sh('git status --porcelain', env).code).toBe(0);
    // A commit with nothing to commit fails the way git fails it.
    const failed = sh('git commit -q -m "Nothing"', env);
    expect(failed.code).toBe(1);
    expect(message()).toBe(`One\n\n${TRAILER}`);
    expect(sh('git definitely-not-a-command', env).code).toBe(1);
    // Whatever git says to a dry run, it says the same with and without the trailer.
    const dry = sh('git commit --dry-run -q -m x', env);
    expect({ code: dry.code, out: dry.out }).toEqual({ code: sh('git commit --dry-run -q -m x').code, out: sh('git commit --dry-run -q -m x').out });
  });

  it('puts a message that mentions "commit" or looks like a command through unchanged', () => {
    const env = { ALRAN_COMMIT_TRAILER: TRAILER };
    sh(`git commit --allow-empty -q -m "git commit -m inside the message" -m "commit"`, env);
    expect(message()).toBe(`git commit -m inside the message\n\ncommit\n\n${TRAILER}`);
    expect(sh('git log --grep=commit --format=%s', env).code).toBe(0);
  });

  it('ignores a trailer that is not one line, and never fails the commit over it', () => {
    expect(sh('git commit --allow-empty -q -m "Two lines"', { ALRAN_COMMIT_TRAILER: 'Co-Authored-By: a\nSigned-off-by: b' }).code).toBe(0);
    expect(message()).toBe('Two lines');
  });

  it('runs a git too old for commit --trailer unchanged', () => {
    const fake = join(mkdtempSync(join(tmpdir(), 'git-shim-old-')), 'bin');
    mkdirSync(fake);
    const log = join(fake, 'args.log');
    writeFileSync(
      join(fake, 'git'),
      `#!/bin/bash\nif [ "$1" = "--version" ]; then echo "git version 2.30.2"; exit 0; fi\nprintf '%s\\n' "$*" >> "${log}"\nexit 0\n`,
      { mode: 0o755 },
    );
    const shim = resolveGitShimDir(dataDir);
    const result = spawnSync('bash', ['-c', 'git commit -m "old"'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shim}:${fake}:/usr/bin:/bin`, ALRAN_COMMIT_TRAILER: TRAILER },
    });
    expect(result.status).toBe(0);
    expect(readFileSync(log, 'utf8').trim()).toBe('commit -m old');
    rmSync(join(fake, '..'), { recursive: true, force: true });
  });

  it('finds the real git even when the shim directory is spelled another way, and never runs itself', () => {
    const shim = resolveGitShimDir(dataDir);
    const alias = join(dataDir, 'alias-to-shims');
    spawnSync('ln', ['-s', shim, alias]);
    const result = spawnSync('bash', ['-c', 'git commit --allow-empty -q -m "Aliased PATH"'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${alias}:${shim}/:${process.env.PATH}`, ALRAN_COMMIT_TRAILER: TRAILER },
    });
    expect(result.status).toBe(0);
    expect(message()).toBe(`Aliased PATH\n\n${TRAILER}`);
    expect(existsSync(alias)).toBe(true);
  });

  it('signs a commit made by a script the agent started, and keeps itself off the PATH of git hooks', () => {
    const env = { ALRAN_COMMIT_TRAILER: TRAILER };
    writeFileSync(join(repo, 'release.sh'), '#!/bin/bash\ngit commit --allow-empty -q -m "From a script"\n', { mode: 0o755 });
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    const seen = join(repo, 'hook-path.txt');
    writeFileSync(join(repo, '.git', 'hooks', 'post-commit'), `#!/bin/bash\nprintf '%s' "$PATH" > "${seen}"\n`, { mode: 0o755 });
    expect(sh('./release.sh', env).code).toBe(0);
    expect(message()).toBe(`From a script\n\n${TRAILER}`);
    // Documented limit: what git starts does not find the shim.
    expect(readFileSync(seen, 'utf8')).not.toContain(resolveGitShimDir(dataDir));
  });

  it('does not loop with another git wrapper that finds the real git by searching PATH', () => {
    // Like a low-priority dispatcher or a version manager's shim: it removes its own directory from PATH
    // and runs the first `git` it then finds. Without this shim's directory also off that PATH, the
    // two would call each other for ever.
    const wrapperDir = mkdtempSync(join(tmpdir(), 'git-shim-wrapper-'));
    writeFileSync(
      join(wrapperDir, 'git'),
      `#!/bin/bash
SEARCH="$(printf '%s' "$PATH" | awk -v RS=: -v ORS=: -v skip="${wrapperDir}" '$0 != skip && length {print}' | sed 's/:$//')"
REAL="$(PATH="$SEARCH" command -v git)"
exec "$REAL" "$@"
`,
      { mode: 0o755 },
    );
    const shim = resolveGitShimDir(dataDir);
    const result = spawnSync('bash', ['-c', 'git commit --allow-empty -q -m "Behind a wrapper"'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 20_000,
      // A PATH of its own: other wrappers on the machine running the test (a dispatcher in /usr/local/bin) would
      // loop with this one without involving the shim at all.
      env: { ...process.env, PATH: `${shim}:${wrapperDir}:/usr/bin:/bin`, ALRAN_COMMIT_TRAILER: TRAILER },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(message()).toBe(`Behind a wrapper\n\n${TRAILER}`);
    rmSync(wrapperDir, { recursive: true, force: true });
  });

  it('reports a missing git the way a shell does', () => {
    const shim = resolveGitShimDir(dataDir);
    const result = spawnSync('/bin/bash', ['-c', 'git status'], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: shim },
    });
    expect(result.status).toBe(127);
    expect(result.stderr).toContain('git: command not found');
  });
});

describePosix('the whole chain: LocalBashTool, the host env policy, the shim, git', () => {
  const tool = (config?: { commits?: boolean }) =>
    new LocalBashTool(
      repo,
      undefined,
      (plan) => resolveAgentBashEnvPolicy(dataDir, process.platform, plan?.nativeDelete === true, plan?.commitTrailer),
      undefined,
      undefined,
      (ctx) => commitTrailerFor(ctx.parentAgentConfig?.model, config),
    );
  const ctx = (modelId: string) =>
    ({ sessionId: 's', turnId: 't', parentAgentConfig: { model: { provider: 'alran', model_id: modelId } } }) as unknown as Parameters<
      ReturnType<typeof tool>['execute']
    >[0];

  it.each([
    ['Alran-Werk', 'Werk 1.1'],
    ['anthropic/claude-sonnet-5.5', 'Sonnet 5.5'],
    ['anthropic/claude-opus-5.5', 'Opus 5.5'],
  ])('a commit made by a turn on %s says "Alran Code using %s"', async (modelId, label) => {
    const result = await tool().execute(ctx(modelId), { command: 'git commit --allow-empty -q -m "Done"' });
    expect(result.isError).toBeFalsy();
    expect(message()).toBe(`Done\n\nCo-Authored-By: Alran Code using ${label} <noreply@alran.dev>`);
  });

  it('adds nothing when the user switched commit attribution off', async () => {
    const result = await tool({ commits: false }).execute(ctx('Alran-Werk'), { command: 'git commit --allow-empty -q -m "Mine"' });
    expect(result.isError).toBeFalsy();
    expect(message()).toBe('Mine');
  });

  it('also when native delete is on (the rm shim directory is off PATH, the git shim is not)', async () => {
    const nativeDelete = copyPlan({ command: 'git commit --allow-empty -q -m "Native delete"' }, { nativeDelete: true });
    await tool().execute(ctx('Alran-Werk'), nativeDelete);
    expect(message()).toBe('Native delete\n\nCo-Authored-By: Alran Code using Werk 1.1 <noreply@alran.dev>');
  });

  it('a user who runs git outside the agent is not touched: the shim is not on their PATH', () => {
    const r = spawnSync('git', ['commit', '--allow-empty', '-q', '-m', 'By hand'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ALRAN_COMMIT_TRAILER: TRAILER } });
    expect(r.status).toBe(0);
    expect(message()).toBe('By hand');
  });
});

import { copyWithPermissionExecutionPlan } from '@alran/agent-tools/desktop';

function copyPlan<T extends Record<string, unknown>>(input: T, plan: { nativeDelete?: boolean }): T {
  return copyWithPermissionExecutionPlan(input, plan);
}
