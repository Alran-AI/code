/**
 * The commit trailer reaches every way Bash can run a command: it rides on the execution plan, and the
 * host's env policy turns it into the variable the `git` shim reads.
 */
import { resolveBashEnvPolicy } from '@alran/agent-core/bash-subprocess-env';
import { describe, expect, it, vi } from 'vitest';

import { LocalBashTool } from '../../src/desktop/local-pi-tools.js';
import {
  copyWithPermissionExecutionPlan,
  readPermissionExecutionPlan,
  withCommitTrailer,
  type LocalPermissionExecutionPlan,
} from '../../src/desktop/permission-execution.js';

const TRAILER = 'Co-Authored-By: Alran Code using Werk 1.1 <noreply@alran.dev>';
const context = { sessionId: 'sess', turnId: 'turn', canConsumeBackgroundBashOutput: true };

/** The host's policy in miniature: the plan's trailer becomes ALRAN_COMMIT_TRAILER. */
const policy = (plan?: LocalPermissionExecutionPlan) =>
  resolveBashEnvPolicy({
    mode: 'off',
    ...(plan?.commitTrailer ? { extraEnv: { ALRAN_COMMIT_TRAILER: plan.commitTrailer } } : {}),
  });

describe('withCommitTrailer', () => {
  it('adds a single printable line to the plan and keeps what the plan already says', () => {
    expect(withCommitTrailer(undefined, TRAILER)).toEqual({ commitTrailer: TRAILER });
    expect(withCommitTrailer({ nativeDelete: true }, TRAILER)).toEqual({ nativeDelete: true, commitTrailer: TRAILER });
  });

  it('leaves the plan alone for no trailer, or one that is not a single printable line', () => {
    const plan = { nativeDelete: true };
    expect(withCommitTrailer(plan, undefined)).toBe(plan);
    expect(withCommitTrailer(undefined, undefined)).toBeUndefined();
    for (const unsafe of ['', 'two\nlines', 'cr\rhere', 'tab\there', '\u001b[31mred', 'x'.repeat(201)]) {
      expect(withCommitTrailer(plan, unsafe)).toBe(plan);
    }
  });
});

describe('LocalBashTool and the commit trailer', () => {
  it('runs a foreground command with the trailer in its environment', async () => {
    const tool = new LocalBashTool(process.cwd(), undefined, policy, undefined, undefined, () => TRAILER);
    const result = await tool.execute(context, { command: 'printf %s "$ALRAN_COMMIT_TRAILER"' });
    expect(result.isError).toBeFalsy();
    expect(result.text).toContain(TRAILER);
  });

  it('sets nothing when the host has no trailer for this call (commits switched off)', async () => {
    const tool = new LocalBashTool(process.cwd(), undefined, policy, undefined, undefined, () => undefined);
    const result = await tool.execute(context, { command: 'printf "[%s]" "${ALRAN_COMMIT_TRAILER:-unset}"' });
    expect(result.text).toContain('[unset]');
    const plain = new LocalBashTool(process.cwd(), undefined, policy);
    expect((await plain.execute(context, { command: 'printf "[%s]" "${ALRAN_COMMIT_TRAILER:-unset}"' })).text).toContain('[unset]');
  });

  it('asks the host per call, with the call context, so a turn on another model gets its own line', async () => {
    const seen: string[] = [];
    const tool = new LocalBashTool(process.cwd(), undefined, policy, undefined, undefined, (ctx) => {
      seen.push(ctx.turnId ?? '');
      return ctx.turnId === 'turn-b' ? 'Co-Authored-By: Alran Code using Opus 5.5 <noreply@alran.dev>' : TRAILER;
    });
    const a = await tool.execute({ ...context, turnId: 'turn-a' }, { command: 'printf %s "$ALRAN_COMMIT_TRAILER"' });
    const b = await tool.execute({ ...context, turnId: 'turn-b' }, { command: 'printf %s "$ALRAN_COMMIT_TRAILER"' });
    expect(a.text).toContain('using Werk 1.1');
    expect(b.text).toContain('using Opus 5.5');
    expect(seen).toEqual(['turn-a', 'turn-b']);
  });

  it('keeps an execution plan the permission layer attached, and adds the trailer to it', async () => {
    const plans: unknown[] = [];
    const tool = new LocalBashTool(process.cwd(), undefined, (plan) => {
      plans.push(plan);
      return policy(plan);
    }, undefined, undefined, () => TRAILER);
    const input = copyWithPermissionExecutionPlan({ command: 'true' }, { nativeDelete: true });
    await tool.execute(context, input);
    expect(plans.at(-1)).toEqual({ nativeDelete: true, commitTrailer: TRAILER });
  });

  it('hands the trailer to the background paths on the plan they already receive', async () => {
    const startBackground = vi.fn(async () => ({ status: 'started' as const, taskId: 'task' }));
    const runManagedForeground = vi.fn(async () => ({ status: 'completed' as const, taskId: 'task', text: 'ok' }));
    const tool = new LocalBashTool(process.cwd(), { startBackground, runManagedForeground }, policy, undefined, undefined, () => TRAILER);

    await tool.execute(context, { command: 'sleep 1', run_in_background: true });
    expect(readPermissionExecutionPlan(startBackground.mock.calls[0]?.[1])).toEqual({ commitTrailer: TRAILER });

    await tool.execute(context, { command: 'echo managed' });
    expect(readPermissionExecutionPlan(runManagedForeground.mock.calls[0]?.[1])).toEqual({ commitTrailer: TRAILER });
  });

  it('does not put a plan on the input when there is no trailer and no plan', async () => {
    const startBackground = vi.fn(async () => ({ status: 'started' as const, taskId: 'task' }));
    const tool = new LocalBashTool(process.cwd(), { startBackground }, policy, undefined, undefined, () => undefined);
    await tool.execute(context, { command: 'sleep 1', run_in_background: true });
    expect(readPermissionExecutionPlan(startBackground.mock.calls[0]?.[1])).toBeUndefined();
  });
});

describe('the env policy keeps the trailer out of the sanitizers', () => {
  it('sets it after the secret scrub, whatever the mode', async () => {
    const { sanitizeBashSubprocessEnv } = await import('@alran/agent-core/bash-subprocess-env');
    for (const mode of ['off', 'scrub', 'strict'] as const) {
      const { env } = sanitizeBashSubprocessEnv(
        { PATH: '/usr/bin', OPENAI_API_KEY: 'secret' },
        resolveBashEnvPolicy({ mode, extraEnv: { ALRAN_COMMIT_TRAILER: TRAILER } }),
      );
      expect(env.ALRAN_COMMIT_TRAILER).toBe(TRAILER);
      if (mode !== 'off') expect(env.OPENAI_API_KEY).toBeUndefined();
    }
  });
});
