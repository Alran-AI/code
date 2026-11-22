/**
 * One headless `alran exec` call.
 *
 * Every Ultra role that talks to a model goes through here: the explorers, the
 * planner, the critic, the goal author, the spec tester, the acceptor, and now
 * the review fleet. One implementation means one place where the timeout, the
 * cost accounting and the error handling are decided — and one place to look
 * when a role starts behaving differently from the others.
 *
 * The cost is an estimate, because the runtime reports tokens rather than a
 * price. A price the runtime does report wins over the estimate, so a runtime
 * that starts reporting real prices is picked up with no change here.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeLLMError, toLLMRetryDecision } from '@alran/shared/llm-error-classifier';
import * as ultra from '@alran/ultra';

export interface UltraHeadlessContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Command that starts Alran Code; defaults to the running CLI entry. */
  readonly alranCommand?: readonly string[];
}

export interface HeadlessResult {
  readonly ok: boolean;
  readonly text: string;
  readonly tokensUsed: number;
  /** Estimated USD for this call; see `ultra.usdForTokens`. */
  readonly costUsd?: number;
  readonly rateLimited: boolean;
  readonly error?: string;
}

/** The command that starts Alran Code, resolved from the running entry point. */
export function alranCommandFor(context?: UltraHeadlessContext): readonly string[] {
  if (context?.alranCommand) return context.alranCommand;
  const entry = process.argv[1];
  if (entry && /cli\.[cm]?js$/u.test(entry)) return [process.execPath, entry];
  return ['alran'];
}

/** One headless `alran exec` call with a system prompt file and a text answer. */
export function runHeadless(
  context: UltraHeadlessContext,
  input: {
    readonly systemPrompt: string;
    readonly prompt: string;
    readonly workspaceDir: string;
    readonly model: string;
    readonly timeoutMs: number;
    readonly permission: 'smart' | 'off';
  },
): HeadlessResult {
  const alran = alranCommandFor(context);
  const dir = mkdtempSync(path.join(tmpdir(), 'alran-ultra-headless-'));
  const systemFile = path.join(dir, 'system-prompt.txt');
  writeFileSync(systemFile, input.systemPrompt);
  try {
    const minutes = Math.max(1, Math.ceil(input.timeoutMs / 60_000));
    const result = spawnSync(
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
      {
        input: input.prompt,
        timeout: input.timeoutMs + 30_000,
        env: context.env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      parsed = undefined;
    }
    const rateLimited = result.status !== 0 && isRateLimited(result, parsed);
    if (result.status !== 0) {
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? ((parsed as { error?: { message?: string } }).error?.message ?? (result.stderr ?? '').trim())
          : (result.stderr ?? '').trim();
      return {
        ok: false,
        text: '',
        tokensUsed: 0,
        rateLimited,
        error: message || `headless run exited with ${String(result.status)}`,
      };
    }

    const usage =
      parsed && typeof parsed === 'object' && 'usage' in parsed
        ? ((parsed as { usage?: { totalTokens?: number } }).usage?.totalTokens ?? 0)
        : 0;
    // Every model call is real spend: a budget that only counted workers would
    // understate the run from the first minute. A price the runtime reports
    // still wins over the estimate.
    const costUsd = readReportedCost(parsed) ?? ultra.usdForTokens(usage);
    const text =
      parsed && typeof parsed === 'object' && 'output' in parsed
        ? typeof (parsed as { output?: unknown }).output === 'string'
          ? String((parsed as { output?: unknown }).output)
          : JSON.stringify((parsed as { output?: unknown }).output ?? '')
        : (result.stdout ?? '');
    return { ok: true, text, tokensUsed: usage, costUsd, rateLimited: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A price the headless run reported, when it reports one; otherwise undefined. */
export function readReportedCost(parsed: unknown): number | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const usage = (parsed as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const cost = (usage as { costUsd?: unknown }).costUsd;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/** Whether a failed headless run was a rate limit rather than a real error. */
export function isRateLimited(
  result: { readonly stderr?: string | null },
  parsed: unknown,
): boolean {
  const status =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { status?: number } }).error?.status
      : undefined;
  const message =
    parsed && typeof parsed === 'object' && 'error' in parsed
      ? (parsed as { error?: { message?: string } }).error?.message
      : (result.stderr ?? '');
  const normalized = normalizeLLMError({
    ...(typeof status === 'number' ? { statusCode: status } : {}),
    ...(message ? { errorMessage: message } : {}),
  });
  const decision = toLLMRetryDecision(normalized);
  return decision.retryable && (decision.reason === 'rate_limited' || decision.reason === 'tpm_rate_limited');
}
