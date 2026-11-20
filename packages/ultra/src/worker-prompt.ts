/**
 * Worker prompt construction.
 *
 * The worker must be able to act without seeing the plan, the run goal, its
 * siblings, or any prior conversation. Everything it needs is assembled here
 * from the packet alone: goal, writable scope, readonly paths, the acceptance
 * commands that will be run verbatim, and the constraints it must respect.
 *
 * The prompt is also where "local tools only, no network, never push" is made
 * explicit, because the headless runner has no per-tool allow-list flag.
 */

import type { PlanPacket, RepairFailure } from './types.js';

export interface WorkerPromptInput {
  readonly packet: PlanPacket;
  /** Absolute worktree path the worker must confine itself to. */
  readonly worktreeDir: string;
  /** Zero-based attempt: 0 is the first try, 1..n are repairs. */
  readonly attempt: number;
  /** Present on every repair attempt; the previous failure verbatim. */
  readonly failure?: RepairFailure;
}

const FAILURE_HEADING: Record<RepairFailure['kind'], string> = {
  gate: 'The gate command failed on the previous attempt. Its output was:',
  verifier: 'An independent reviewer rejected the previous attempt for this reason:',
  scope: 'The previous attempt changed files it was not allowed to touch:',
};

/** The stable system prompt; carries the boundary, never packet specifics. */
export function buildWorkerSystemPrompt(): string {
  return [
    'You are one worker in a larger, planned change. Another agent will run the',
    'acceptance commands and an independent reviewer will inspect your diff, so',
    'only real, working changes count.',
    '',
    'Constraints:',
    '- Work only inside the worktree directory you are given. Local tools only:',
    '  read and edit files, and run shell commands inside that directory.',
    '- No network access. You cannot browse, fetch, or call external services.',
    '- Never run `git push`, and never touch any remote. Do not commit either;',
    '  the harness reads the working tree diff.',
    '- Change only files inside the scope you are given, and never change a',
    '  read-only path.',
    '- Do not delete, skip, or weaken tests and do not silence errors to make a',
    '  command pass. A fake fix is rejected and costs a repair attempt.',
  ].join('\n');
}

/**
 * Builds the packet-specific user prompt. Deliberately self-contained: no run
 * goal, no sibling ids, no plan structure leaks in.
 */
export function buildWorkerPrompt(input: WorkerPromptInput): string {
  const { packet, worktreeDir, attempt, failure } = input;
  const accept = (packet.accept ?? []).map((entry) => `  - ${entry.cmd}`);
  const readonly = packet.readonly ?? [];

  const lines: string[] = [
    `Attempt ${attempt + 1}.`,
    '',
    `Packet: ${packet.title}`,
    '',
    'Goal:',
    packet.goal,
    '',
    `Work in this directory: ${worktreeDir}`,
    '',
    'You may only change files matching:',
    ...packet.scope.map((glob) => `  - ${glob}`),
  ];

  if (readonly.length > 0) {
    lines.push(
      '',
      'These paths are read-only. Read them freely; any change to them is',
      'rejected:',
      ...readonly.map((glob) => `  - ${glob}`),
    );
  }

  if (accept.length > 0) {
    lines.push(
      '',
      'When you are done these commands must exit 0. They are run verbatim, so',
      'do not change them:',
      ...accept,
    );
  }

  if (failure) {
    lines.push('', FAILURE_HEADING[failure.kind], '', '---', failure.output.trim(), '---');
    lines.push('', 'Fix the cause. Do not work around it by weakening tests or checks.');
  } else {
    lines.push('', 'Make the change, then stop. The harness runs the commands above.');
  }

  return lines.join('\n');
}
