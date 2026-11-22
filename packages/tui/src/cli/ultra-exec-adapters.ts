/**
 * Runtime adapters for Ultra execution.
 *
 * The `@alran/ultra` core decides *what* happens — scheduling, scope, repair,
 * backoff, skip. This file supplies *how*: git worktrees, a headless `alran
 * exec` worker and verifier, and shell gate commands. Keeping every side effect
 * here is what lets the core stay pure and lets a future cloud runner swap this
 * file for another adapter.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as ultra from '@alran/ultra';
import { normalizeLLMError, toLLMRetryDecision } from '@alran/shared/llm-error-classifier';
import { isInterruptedRun } from './ultra-headless.js';

export interface UltraExecAdapterContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Where packet worktrees live; defaults to `<cwd>/.alran/worktrees`. */
  readonly worktreesDir?: string;
  /** Command that starts Alran Code; defaults to the running CLI entry. */
  readonly alranCommand?: readonly string[];
  readonly gateTimeoutMs?: number;
  readonly workerTimeoutMs?: number;
  /** Per-repository recipe files (spec §8). */
  readonly recipeOverrides?: ultra.RecipeOverrides;
}

export interface UltraExecAdapters {
  readonly worktree: ultra.ExecutePorts['worktree'];
  readonly worker: ultra.ExecutePorts['worker'];
  readonly gate: ultra.ExecutePorts['gate'];
  readonly verifier: ultra.ExecutePorts['verifier'];
}

export interface UltraIntegrateAdapters {
  readonly git: ultra.IntegratePorts['git'];
  readonly gates: ultra.IntegratePorts['gates'];
  readonly review: ultra.IntegratePorts['review'];
}

interface SpawnResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  /** The signal that killed the child, when a signal killed it. */
  readonly signal: string | null;
}

function runSpawn(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly input?: string;
    readonly timeoutMs?: number;
  } = {},
): SpawnResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
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
    signal: result.signal ?? null,
  };
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = runSpawn('git', args, { cwd, env });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

/** How many paths one `git add` may carry. */
const MAX_ADD_PATHS = 100;

/**
 * Splits the approved paths into chunks git can take.
 *
 * A packet that touches hundreds of files would otherwise produce a command
 * line longer than the operating system allows. Every path is written as a
 * literal pathspec, so a file called `report[1].md` is that file and not a
 * wildcard that happens to match it.
 */
function chunkPaths(paths: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  for (const file of paths) {
    const current = chunks[chunks.length - 1];
    if (!current || current.length >= MAX_ADD_PATHS) {
      chunks.push([]);
    }
    chunks[chunks.length - 1].push(`:(literal)${file}`);
  }
  return chunks;
}

function alranCommandFor(context: UltraExecAdapterContext): readonly string[] {
  if (context.alranCommand) return context.alranCommand;
  const entry = process.argv[1];
  if (entry && /cli\.[cm]?js$/u.test(entry)) return [process.execPath, entry];
  return ['alran'];
}

/** Runs a gate command string in the worktree through the platform shell. */
function runShell(command: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): SpawnResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error !== undefined && result.status === null,
    signal: result.signal ?? null,
  };
}

/**
 * True when a failed headless run was caused by upstream throttling. Reuses the
 * shared classifier so Ultra agrees with the rest of the product about what a
 * 429 is, instead of matching strings itself.
 */
export function isRateLimited(result: SpawnResult, parsed: unknown): boolean {
  const status =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { status?: number } }).error?.status
      : undefined;
  const message =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { message?: string } }).error?.message
      : result.stderr;
  const normalized = normalizeLLMError({
    ...(typeof status === 'number' ? { statusCode: status } : {}),
    ...(message ? { errorMessage: message } : {}),
  });
  const decision = toLLMRetryDecision(normalized);
  return decision.retryable && (decision.reason === 'rate_limited' || decision.reason === 'tpm_rate_limited');
}

interface HeadlessResult {
  readonly ok: boolean;
  readonly text: string;
  readonly tokensUsed: number;
  readonly costUsd?: number;
  readonly rateLimited: boolean;
  /** The run was cut short by an interrupt; it did not fail on its own. */
  readonly interrupted?: boolean;
  readonly error?: string;
}

/** One headless `alran exec` run with a system prompt file and a text answer. */
function runHeadless(
  context: UltraExecAdapterContext,
  input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly workspaceDir: string;
    readonly model: string;
    readonly timeoutMs: number;
    readonly permission: 'smart' | 'off' | 'full';
  },
): HeadlessResult {
  const alran = alranCommandFor(context);
  const dir = mkdtempSync(path.join(tmpdir(), 'alran-ultra-'));
  const systemFile = path.join(dir, 'system-prompt.txt');
  writeFileSync(systemFile, input.systemPrompt);
  try {
    const minutes = Math.max(1, Math.ceil(input.timeoutMs / 60_000));
    const result = runSpawn(
      alran[0]!,
      [
        ...alran.slice(1),
        'exec',
        '--input',
        '-',
        '--input-format',
        'text',
        '--permission',
        input.permission,
        '--timeout',
        `${minutes}m`,
        '--output-format',
        'json',
        '--system-prompt-file',
        systemFile,
        '--cwd',
        input.workspaceDir,
        ...(input.model ? ['--model', input.model] : []),
      ],
      { input: input.prompt, timeoutMs: input.timeoutMs + 30_000, env: context.env },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = undefined;
    }
    const rateLimited = result.code !== 0 && isRateLimited(result, parsed);
    if (result.code !== 0) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? ((parsed as { error?: { message?: string } }).error?.message ?? result.stderr.trim())
          : result.stderr.trim();
      return {
        ok: false,
        text: '',
        tokensUsed: 0,
        rateLimited,
        // An interrupt is not a failure: the scheduler must stop, not repair.
        interrupted: isInterruptedRun(result),
        error: message || `headless run exited with ${String(result.code)}`,
      };
    }
    const usage =
      parsed && typeof parsed === 'object' && 'usage' in parsed
        ? ((parsed as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0)
        : 0;
    // `alran exec` reports tokens and no price. Recording only tokens would
    // leave the ledger at $0 forever, so the cap would never trigger and
    // `--budget` would be decorative on every real run. The estimate is the
    // declared token→USD constant; a provider that does report a price wins.
    const costUsd = readReportedCost(parsed) ?? ultra.usdForTokens(usage);
    const text =
      parsed && typeof parsed === 'object' && 'output' in parsed
        ? typeof (parsed as { output?: unknown }).output === 'string'
          ? String((parsed as { output?: unknown }).output)
          : JSON.stringify((parsed as { output?: unknown }).output ?? '')
        : result.stdout;
    return { ok: true, text, tokensUsed: usage, costUsd, rateLimited: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A price the headless run actually reported, if it reported one.
 *
 * `usage.costUsd` is not produced today, but a runtime that starts reporting a
 * real charge must win over the estimate rather than being ignored, so the field
 * is read defensively and any non-finite or negative value is treated as absent.
 */
function readReportedCost(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const usage = (parsed as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const cost = (usage as { costUsd?: unknown }).costUsd;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/** The fixed verifier checklist, unchanged between packets; only evidence varies. */
const VERIFIER_SYSTEM_PROMPT = [
  'You are an independent reviewer. You did not write this change and you must',
  'not trust the worker. Answer only from the goal, the diff and the gate output.',
  '',
  'Decide one verdict: PASS or FAIL.',
  '',
  'Check, in order:',
  '1. Does the diff do what the goal says, and only that?',
  '2. Fake-fix patterns: deleted or skipped tests, loosened assertions, swallowed',
  '   errors, hard-coded expected values, or mocks replacing real logic.',
  '3. Obvious side effects outside the scope intent.',
  '',
  'Reply with exactly one line first: `PASS` or `FAIL`. Then, for FAIL, one',
  'reason per line beginning with `- `.',
].join('\n');

function parseVerdict(text: string): { pass: boolean; reasons: string[] } {
  const lines = text.split('\n').map((line) => line.trim());
  const verdictLine = lines.find((line) => /^(PASS|FAIL)\b/u.test(line));
  const pass = verdictLine?.toUpperCase().startsWith('PASS') ?? false;
  const reasons = lines
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
  return {
    pass,
    reasons: pass ? [] : reasons.length > 0 ? reasons : ['verifier failed the change without a stated reason'],
  };
}

/** Builds the worktree/worker/gate/verifier ports for the core scheduler. */
export function createUltraExecAdapters(context: UltraExecAdapterContext): UltraExecAdapters {
  const worktreesDir = context.worktreesDir ?? path.join(context.cwd, '.alran', 'worktrees');
  const gateTimeoutMs = context.gateTimeoutMs ?? 15 * 60_000;
  const workerTimeoutMs = context.workerTimeoutMs ?? 30 * 60_000;

  const worktree: ultra.ExecutePorts['worktree'] = {
    async create({ packetId, runId, branch, baseRef }) {
      mkdirSync(worktreesDir, { recursive: true });
      // Keyed by run so two runs never fight over one directory or branch.
      const dir = path.join(worktreesDir, runId, packetId);
      // A previous attempt (or a previous run with the same packet id) leaves a
      // branch and a worktree registration behind. `prune` drops a stale
      // registration, `-B` resets an existing branch to baseRef, so create is
      // idempotent instead of failing with "branch already exists".
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      try {
        git(context.cwd, ['worktree', 'prune'], context.env);
      } catch {
        // Pruning is best effort; add -B below still handles the branch.
      }
      git(context.cwd, ['worktree', 'add', '-B', branch, dir, baseRef], context.env);
      return { dir };
    },
    async reset({ dir, baseRef }) {
      // Return the tree to the packet's base commit, not to HEAD: a worker that
      // committed would otherwise keep its change and hide it from the diff.
      git(dir, ['reset', '--hard', baseRef], context.env);
      // `-x` also removes ignored build output, so one attempt cannot poison
      // the next attempt's gate with stale artifacts.
      git(dir, ['clean', '-fdx'], context.env);
    },
    async remove({ dir }) {
      try {
        git(context.cwd, ['worktree', 'remove', '--force', dir], context.env);
      } catch {
        rmSync(dir, { recursive: true, force: true });
        try {
          git(context.cwd, ['worktree', 'prune'], context.env);
        } catch {
          // Best effort; the directory is already gone.
        }
      }
    },
    async diff({ dir, baseRef }) {
      // Stage everything so new files appear, then diff against the packet's
      // base. `--no-renames` keeps both sides of a rename visible to the scope
      // check, so moving a file out of scope is not hidden behind the target.
      git(dir, ['add', '-A'], context.env);
      return git(dir, ['diff', '--cached', '--no-color', '--no-renames', baseRef], context.env);
    },
    async changedFiles({ dir, baseRef }) {
      git(dir, ['add', '-A'], context.env);
      const output = git(dir, ['diff', '--cached', '--name-only', '--no-renames', baseRef], context.env);
      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    },
    async commit({ dir, message, paths }) {
      // Only the paths the scope guard approved may be committed.
      //
      // The diff port staged everything so that new files would show up in the
      // diff. That staging is thrown away first: a gate that wrote into the
      // worktree (a formatter with `--write`, a test that leaves a fixture
      // behind) added files that no scope check ever saw, and they must not
      // reach the packet's branch.
      //
      // `reset` keeps the working tree — only the index is emptied, so the
      // work is still there to be staged again, path by path.
      git(dir, ['reset'], context.env);
      for (const chunk of chunkPaths(paths)) {
        git(dir, ['add', '-A', '--', ...chunk], context.env);
      }
      const staged = git(dir, ['diff', '--cached', '--name-only'], context.env).trim();
      if (staged.length === 0) {
        // A packet that changed nothing has nothing to commit. An empty commit
        // would only make the merge history lie.
        return { commit: '' };
      }
      try {
        // `--no-verify` skips the user's hooks: the packet's gate commands are
        // the authority for this branch, and the human's hooks run again when
        // they merge the finished run.
        git(dir, ['commit', '--no-verify', '-m', message], context.env);
      } catch (error) {
        // A repository without a configured identity cannot commit. Ultra
        // commits on the user's behalf on a throwaway branch, so it falls back
        // to its own identity rather than failing the packet over a missing
        // `user.email`. The human's own commits keep their own identity.
        try {
          git(
            dir,
            [
              '-c',
              'user.name=Alran Ultra',
              '-c',
              'user.email=ultra@alran.invalid',
              'commit',
              '--no-verify',
              '-m',
              message,
            ],
            context.env,
          );
        } catch {
          throw error;
        }
      }
      return { commit: git(dir, ['rev-parse', 'HEAD'], context.env).trim() };
    },
  };

  const worker: ultra.ExecutePorts['worker'] = {
    async run(input) {
      const result = runHeadless(context, {
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
        workspaceDir: input.worktreeDir,
        model: input.model,
        timeoutMs: workerTimeoutMs,
        // `smart` keeps the permission prompts out of a non-interactive run while
        // still refusing destructive commands; the prompt forbids push and network.
        permission: 'smart',
      });
      return {
        ok: result.ok,
        summary: result.ok ? summarize(result.text) : (result.error ?? 'worker failed'),
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
        tokensUsed: result.tokensUsed,
        model: input.model,
        ...(result.rateLimited ? { rateLimited: true } : {}),
        ...(result.interrupted ? { interrupted: true } : {}),
      };
    },
  };

  const gate: ultra.ExecutePorts['gate'] = {
    async run(input) {
      const commands = input.commands.map((cmd) => {
        const result = runShell(cmd, input.worktreeDir, context.env, gateTimeoutMs);
        const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n');
        return {
          cmd,
          exitCode: result.code,
          output: result.timedOut ? `${output}\n(timed out after ${gateTimeoutMs}ms)` : output,
          ...(result.timedOut ? { timedOut: true } : {}),
        };
      });
      return { ok: commands.every((command) => command.exitCode === 0), commands };
    },
  };

  const verifier: ultra.ExecutePorts['verifier'] = {
    async verify(input) {
      const gateText = input.gate.commands
        .map((command) => `${command.cmd} → exit ${String(command.exitCode)}\n${command.output}`)
        .join('\n\n');
      // The recipe's extra checks (spec 8) are appended, not merged into the
      // fixed checklist: a migration verifier has to look for leftover old-API
      // calls, which the generic fake-fix checklist does not mention.
      const recipeChecks = ultra.recipeVerifierChecks(input.recipe, context.recipeOverrides ?? {});
      const prompt = [
        'Goal:',
        input.packet.goal,
        '',
        'Acceptance commands and their results:',
        gateText.length > 0 ? gateText : '(no commands)',
        '',
        'Diff:',
        '```diff',
        input.diff.length > 0 ? input.diff : '(empty diff)',
        '```',
        '',
        ...(recipeChecks.length > 0
          ? [
              'Checks specific to this kind of work:',
              ...recipeChecks.map((check) => `- ${check}`),
              '',
            ]
          : []),
      ].join('\n');
      const result = runHeadless(context, {
        systemPrompt: VERIFIER_SYSTEM_PROMPT,
        prompt,
        workspaceDir: context.cwd,
        model: input.model,
        timeoutMs: 10 * 60_000,
        permission: 'off',
      });
      // The verifier is a billed step like any other. Dropping its cost here
      // would understate every packet's spend, so the budget would pause later
      // than the money actually ran out.
      const cost = result.costUsd !== undefined ? { costUsd: result.costUsd } : {};
      if (!result.ok) {
        return {
          pass: false,
          reasons: [`verifier failed to run: ${result.error ?? 'unknown error'}`],
          tokensUsed: result.tokensUsed,
          model: input.model,
          ...cost,
          // A throttled verifier is retryable, not a verdict against the change.
          ...(result.rateLimited ? { rateLimited: true } : {}),
        };
      }
      const verdict = parseVerdict(result.text);
      return { ...verdict, tokensUsed: result.tokensUsed, model: input.model, ...cost };
    },
  };

  return { worktree, worker, gate, verifier };
}

/** A short, single-line summary of a worker's final text for the ledger. */
function summarize(text: string): string {
  const line = text.split('\n').find((entry) => entry.trim().length > 0) ?? 'worker finished';
  return line.trim().slice(0, 200);
}

/** The fixed final-review checklist (spec 3.6): the verifier's, plus consistency. */
const REVIEW_SYSTEM_PROMPT = [
  'You are the final reviewer for a combined change built by several agents.',
  'You did not write any of it and you must not trust the individual reports.',
  'Answer only from the goal, the combined diff and the gate output.',
  '',
  'Decide one verdict: PASS or FAIL.',
  '',
  'Check, in order:',
  '1. Does the combined diff do what the goal says, and only that?',
  '2. Fake-fix patterns: deleted or skipped tests, loosened assertions, swallowed',
  '   errors, hard-coded expected values, or mocks replacing real logic.',
  '3. Cross-packet consistency: do the packets agree on shared types, interfaces',
  '   and conventions, or did each one invent its own?',
  '4. Obvious side effects outside the scope intent.',
  '',
  'Reply with exactly one line first: `PASS` or `FAIL`. Then, for FAIL, one',
  'reason per line beginning with `- `.',
].join('\n');

/**
 * Git, gate and review ports for INTEGRATE.
 *
 * The merge strategy is deliberately conservative: each packet branch is merged
 * with `--no-ff` and a conflicted merge is *reported*, never auto-resolved. A
 * silent resolution would be the harness deciding what the author meant, which
 * is exactly the kind of claim the design refuses to make.
 */
export function createUltraIntegrateAdapters(
  context: UltraExecAdapterContext,
): UltraIntegrateAdapters {
  const gateTimeoutMs = context.gateTimeoutMs ?? 15 * 60_000;
  const runDir = path.join(context.worktreesDir ?? path.join(context.cwd, '.alran', 'worktrees'), '_integrate');

  /**
   * Drops the scratch worktree, if a previous pass left one behind.
   *
   * It has to go before the run branch is reset: git refuses to force-update a
   * branch that is checked out somewhere ("cannot force update the branch ...
   * used by worktree at ..."), so a resumed run whose first pass reached
   * integrate could never integrate again. The tree is disposable — it holds
   * only the merge in progress — so removing it loses nothing.
   */
  const removeScratchWorktree = (): void => {
    if (existsSync(runDir)) {
      try {
        git(context.cwd, ['worktree', 'remove', '--force', runDir], context.env);
      } catch {
        // Not registered (or already gone); the rm below still clears the path.
      }
      rmSync(runDir, { recursive: true, force: true });
    }
    try {
      git(context.cwd, ['worktree', 'prune'], context.env);
    } catch {
      // Best effort: a stale registration is harmless once the path is gone.
    }
  };

  const gitPorts: ultra.IntegratePorts['git'] = {
    async createRunBranch({ branch, baseRef }) {
      removeScratchWorktree();
      mkdirSync(runDir, { recursive: true });
      // `-f` resets the branch to the base commit, so a re-run after a failed
      // integrate starts from the packets' real base rather than a half-merge.
      git(context.cwd, ['branch', '-f', branch, baseRef], context.env);
    },
    async merge({ packetId, branch, packetBranch }) {
      // Merge inside a scratch worktree checked out on the run branch, so the
      // user's own working tree is never touched by integrate.
      removeScratchWorktree();
      try {
        git(context.cwd, ['worktree', 'add', runDir, branch], context.env);
      } catch (error) {
        return { ok: false, conflicts: [], output: errorMessage(error) };
      }
      const result = runSpawn(
        'git',
        ['merge', '--no-ff', '--no-edit', '-m', `ultra(${packetId}): merge packet`, packetBranch],
        { cwd: runDir, env: context.env },
      );
      const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n');
      if (result.code !== 0) {
        // Collect the conflicted paths so the report names them.
        const listed = runSpawn('git', ['diff', '--name-only', '--diff-filter=U'], {
          cwd: runDir,
          env: context.env,
        });
        const conflicts = listed.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        return { ok: false, conflicts, output };
      }
      // A clean merge still needs the branch pointer moved for the next packet.
      git(runDir, ['push', '--quiet', '.', `HEAD:refs/heads/${branch}`], context.env);
      return { ok: true, conflicts: [], output };
    },
    async abortMerge() {
      const result = runSpawn('git', ['merge', '--abort'], { cwd: runDir, env: context.env });
      void result;
    },
    async diff({ baseRef }) {
      const result = runSpawn('git', ['diff', '--no-color', '--no-renames', baseRef], {
        cwd: runDir,
        env: context.env,
      });
      return result.stdout;
    },
    async tag({ tag }) {
      // The tag is created in the user's repository, not the scratch worktree,
      // so it is visible to the human and survives integrate's cleanup.
      git(context.cwd, ['tag', '-f', tag], context.env);
    },
  };

  const gates: ultra.IntegratePorts['gates'] = {
    async run({ commands }) {
      // The full suite runs in the merged tree, so what is verified is what the
      // human would merge, not each packet in isolation.
      const results = commands.map((cmd) => {
        // Through a shell, like the packet gate: a project's commands are shell
        // strings ("npm run test", "pnpm -r typecheck"), and spawning them
        // without one looks for a binary literally named "npm run test" — which
        // fails with no exit code at all, so the run ends `failed` on a suite
        // that never ran.
        const result = runShell(cmd, context.cwd, context.env, gateTimeoutMs);
        const output = [result.stdout, result.stderr].filter((part) => part.trim().length > 0).join('\n');
        return {
          cmd,
          exitCode: result.code,
          output: result.timedOut ? `${output}\n(timed out after ${gateTimeoutMs}ms)` : output,
          ...(result.timedOut ? { timedOut: true } : {}),
        };
      });
      return { ok: results.every((entry) => entry.exitCode === 0), commands: results };
    },
  };

  const review: ultra.IntegratePorts['review'] = {
    async review(input) {
      const gateText = input.gate.commands
        .map((command) => `${command.cmd} → exit ${String(command.exitCode)}\n${command.output}`)
        .join('\n\n');
      const prompt = [
        'Goal:',
        input.goal,
        '',
        'Full-suite gate results:',
        gateText.length > 0 ? gateText : '(no commands)',
        '',
        'Combined diff:',
        '```diff',
        input.diff.length > 0 ? input.diff : '(empty diff)',
        '```',
      ].join('\n');
      const result = runHeadless(context, {
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        prompt,
        workspaceDir: context.cwd,
        model: input.model,
        timeoutMs: 10 * 60_000,
        permission: 'off',
      });
      if (!result.ok) {
        return { ok: false, problems: [`final review failed to run: ${result.error ?? 'unknown error'}`] };
      }
      const parsed = parseVerdict(result.text);
      return {
        ok: parsed.pass,
        problems: parsed.reasons,
        tokensUsed: result.tokensUsed,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },
  };

  return { git: gitPorts, gates, review };
}

/**
 * The spec-test author (spec 13.2, ULT-13): turns the goal document's criteria
 * into the frozen checks before any worker starts.
 *
 * It writes into the run directory, not the repository — the files are evidence
 * to review, and placing them into the tree is an explicit later step. That way a
 * malformed reply cannot pollute the working tree, and a plan that reached for
 * `tests/spec/**` has already been rejected before this runs.
 */
export function createUltraSpecTestAdapter(context: UltraExecAdapterContext): {
  author(input: {
    readonly goal: import('@alran/ultra').GoalDocument;
    readonly testCommands?: readonly string[];
  }): Promise<{ readonly files: import('@alran/ultra').SpecTestFile[] }>;
} {
  const author = async (input: {
    readonly goal: import('@alran/ultra').GoalDocument;
    readonly testCommands?: readonly string[];
  }): Promise<{ files: import('@alran/ultra').SpecTestFile[] }> => {
    const prompt = ultra.buildSpecTestPrompt({
      goal: input.goal,
      specTestDir: ultra.SPEC_TEST_DIR,
      ...(input.testCommands ? { testCommands: input.testCommands } : {}),
    });
    const result = runHeadless(context, {
      systemPrompt: [
        'You write executable acceptance tests from written criteria.',
        'You are read-only with respect to the rest of the repository: write only the',
        'files you are asked to write, into the directory you are told to use.',
      ].join('\n'),
      prompt,
      workspaceDir: context.cwd,
      model: '',
      timeoutMs: 15 * 60_000,
      // The agent must not modify the repo while authoring its checks.
      permission: 'off',
    });
    if (!result.ok) {
      throw new Error(`spec-test authoring failed: ${result.error ?? 'unknown error'}`);
    }
    // Fails closed: a file outside tests/spec/ or an empty reply throws.
    return { files: ultra.parseSpecTestReply(result.text, ultra.SPEC_TEST_DIR) };
  };
  return { author };
}

/**
 * The interim auditor (spec 13.4): reviews the whole run against the goal
 * document and reports drift — an early wrong decision every later packet kept
 * building on. It is read-only and returns findings, not a verdict.
 */
export function createUltraAuditAdapter(context: UltraExecAdapterContext): {
  audit(input: {
    readonly round: number;
    readonly goal: import('@alran/ultra').GoalDocument;
    readonly notes: string;
  }): Promise<{
    readonly findings: import('@alran/ultra').AuditFinding[];
    readonly costUsd?: number;
  }>;
} {
  const audit = async (input: {
    readonly round: number;
    readonly goal: import('@alran/ultra').GoalDocument;
    readonly notes: string;
  }): Promise<{ findings: import('@alran/ultra').AuditFinding[]; costUsd?: number }> => {
    const prompt = [
      `Round ${String(input.round)} interim audit.`,
      '',
      'Goal:',
      input.goal.goal,
      '',
      'Criteria:',
      ...input.goal.criteria.map(
        (criterion) =>
          `- ${criterion.id} (${criterion.priority}, ${criterion.status}): ${criterion.description}`,
      ),
      '',
      'Run notes:',
      input.notes.trim().length > 0 ? input.notes.trim() : '(none)',
      '',
      'Review the WHOLE run against the goal. You are looking for drift: a decision',
      'made early that was wrong, and that every later packet kept building on.',
      'Individually green packets can still be building the wrong thing.',
      '',
      'Reply with one line per finding:',
      '`<severity>: <kind>: <what is wrong> :: <what the next round should do>`',
      'where severity is high|medium|low and kind is drift|gap|risk|note.',
      'Say `none` if there is nothing to report.',
    ].join('\n');

    const result = runHeadless(context, {
      systemPrompt: [
        'You audit a long-running multi-agent build against its goal document.',
        'You are read-only. You did not write this software.',
        'Report drift honestly; do not invent problems and do not soften real ones.',
      ].join('\n'),
      prompt,
      workspaceDir: context.cwd,
      model: '',
      timeoutMs: 10 * 60_000,
      permission: 'off',
    });
    if (!result.ok) {
      throw new Error(`auditor failed to run: ${result.error ?? 'unknown error'}`);
    }
    return {
      findings: parseAuditFindings(result.text, input.round),
      ...(result.tokensUsed > 0 ? { tokensUsed: result.tokensUsed } : {}),
    };
  };
  return { audit };
}

/** Parses `<severity>: <kind>: <text> :: <rework>` lines. */
function parseAuditFindings(
  text: string,
  round: number,
): import('@alran/ultra').AuditFinding[] {
  const findings: import('@alran/ultra').AuditFinding[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^[-*]\s*/u, '');
    if (line.length === 0 || /^none\b/iu.test(line)) continue;
    const match = /^(high|medium|low)\s*:\s*(drift|gap|risk|note)\s*:\s*([\s\S]*?)(?:\s*::\s*([\s\S]*))?$/iu.exec(
      line,
    );
    if (!match) continue;
    findings.push({
      round,
      severity: match[1]!.toLowerCase() as import('@alran/ultra').AuditSeverity,
      kind: match[2]!.toLowerCase() as import('@alran/ultra').AuditFindingKind,
      text: (match[3] ?? '').trim(),
      rework: (match[4] ?? '').trim(),
    });
  }
  return findings;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The acceptance agent (spec 13.2): an independent model that exercises the real
 * result against the goal document and reports per criterion.
 *
 * It deliberately receives no worker output — independence is the point — and its
 * reply is parsed fail-closed, so a vague "looks good" cannot mark a criterion met.
 */
export function createUltraAcceptanceAdapter(context: UltraExecAdapterContext): {
  accept(input: {
    readonly round: number;
    readonly goal: import('@alran/ultra').GoalDocument;
  }): Promise<{ readonly findings: import('@alran/ultra').AcceptanceFinding[]; readonly costUsd?: number }>;
} {
  const accept = async (input: {
    readonly round: number;
    readonly goal: import('@alran/ultra').GoalDocument;
  }): Promise<{ findings: import('@alran/ultra').AcceptanceFinding[]; costUsd?: number }> => {
    const prompt = ultra.buildAcceptancePrompt({
      goal: input.goal,
      round: input.round,
      // The checks were frozen on the run's base branch before any worker
      // started; pointing the acceptor at them is what makes them gate the run
      // instead of decorating the repository.
      specTestDir: ultra.SPEC_TEST_DIR,
    });
    const result = runHeadless(context, {
      systemPrompt: ultra.ACCEPTOR_SYSTEM_PROMPT,
      prompt,
      workspaceDir: context.cwd,
      model: '',
      timeoutMs: 15 * 60_000,
      permission: 'off',
    });
    if (!result.ok) {
      // A failed acceptance run is not a pass: report every criterion as unmet so
      // the loop keeps working rather than believing an error message.
      return {
        findings: input.goal.criteria.map((criterion) => ({
          id: criterion.id,
          status: 'unmet' as const,
          evidence: [],
          note: `acceptance failed to run: ${result.error ?? 'unknown error'}`,
        })),
      };
    }
    const parsed = ultra.parseAcceptanceReport(result.text, input.goal);
    return {
      findings: parsed.findings,
      ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    };
  };
  return { accept };
}
