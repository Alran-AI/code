/**
 * What a run produced, for the CLI and the TUI board.
 *
 * The last thing a user does with an Ultra run is read it: look at the diff,
 * look at the report, decide whether to merge. The board has had a `d` key for
 * that for a while; the CLI had no way to do the same thing, so the review step
 * that matters most was one surface away from the other.
 *
 * Both surfaces call this one function, so they cannot drift: the same refs,
 * the same stat, the same command for the full patch.
 *
 * Like `ci-facts.ts`, this is a pure reader — it runs git and prints what it
 * finds, and changes nothing.
 */

import { spawnSync } from 'node:child_process';
import * as ultra from '@alran/ultra';

/** One ref to compare against HEAD, and what to call it in the output. */
export interface UltraDiffRef {
  readonly ref: string;
  readonly label: string;
}

/** Runs git in the repository; injected so a test needs no repository. */
export type UltraGitRunner = (args: readonly string[]) => { readonly status: number; readonly stdout: string };

export interface UltraDiffOptions {
  readonly cwd: string;
  readonly runId: string;
  /** The run's packets with their status, so only finished work is shown. */
  readonly packets: readonly { readonly id: string; readonly status: string }[];
  /** Whether the run branch exists; when it does, it is the one thing to read. */
  readonly runBranchExists?: boolean;
  /** Injected in tests; defaults to a real `git` in `cwd`. */
  readonly git?: UltraGitRunner;
}

/** The default git runner: a real `git`, with a timeout so it cannot hang. */
export function defaultUltraGitRunner(cwd: string): UltraGitRunner {
  return (args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000 });
    return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim() };
  };
}

/**
 * The refs to compare: the run branch when it exists, otherwise the branch of
 * every finished packet.
 *
 * The run branch is the integrated result, so it is the honest thing to read.
 * A run that never reached integrate still has packet branches, and their diffs
 * are what the user is looking for.
 */
export function ultraDiffRefs(options: UltraDiffOptions): UltraDiffRef[] {
  const done = options.packets.filter((packet) => packet.status === 'done');
  if (options.runBranchExists) {
    return [{ ref: ultra.runBranchFor(options.runId), label: `branch ${ultra.runBranchFor(options.runId)}` }];
  }
  return done.map((packet) => ({
    ref: ultra.packetBranchFor(options.runId, packet.id),
    label: packet.id,
  }));
}

/**
 * Renders the diff of everything the run produced.
 *
 * `--stat` is bounded and fast whatever the size of the change, and the full
 * patch is one command away — the command is printed, so the reader never has
 * to guess how to get it.
 */
export function renderUltraRunDiff(options: UltraDiffOptions): string {
  const git = options.git ?? defaultUltraGitRunner(options.cwd);
  const done = options.packets.filter((packet) => packet.status === 'done');
  if (done.length === 0) {
    return 'No packet has finished yet, so there is nothing to diff.';
  }
  const refs = ultraDiffRefs(options);
  if (refs.length === 0) {
    return 'No packet has finished yet, so there is nothing to diff.';
  }
  const sections: string[] = [];
  for (const { ref, label } of refs) {
    const stat = git(['diff', '--stat', `HEAD..${ref}`]);
    const text = stat.status === 0 ? stat.stdout : '';
    sections.push(`--- ${label} ---`, text.length > 0 ? text : '(no changes against HEAD)');
  }
  sections.push('', `Full patch: git diff HEAD..${refs[0]!.ref}`);
  return sections.join('\n');
}

/**
 * Whether a ref resolves in the repository.
 *
 * A missing run branch is not an error: it means the run has not integrated
 * yet, and the packet branches are the thing to read instead.
 */
export function ultraRefExists(cwd: string, ref: string, git?: UltraGitRunner): boolean {
  const runner = git ?? defaultUltraGitRunner(cwd);
  return runner(['rev-parse', '--verify', '--quiet', ref]).status === 0;
}

/** The change a review is about: the diff and the files it touches. */
export interface UltraDiffContent {
  readonly diff: string;
  readonly truncated: boolean;
  readonly files: readonly string[];
  /** The ref the diff was taken against, when there is one. */
  readonly ref?: string;
}

/**
 * The full diff of what the run produced, for a reviewer to read.
 *
 * The diff is bounded: a reviewer that is handed a megabyte of patch does not
 * review it, it summarises it. When the diff is cut, the review says so —
 * a truncated review that does not admit it is worse than no review.
 */
export function ultraRunDiffContent(
  options: UltraDiffOptions & { readonly maxChars?: number },
): UltraDiffContent {
  const git = options.git ?? defaultUltraGitRunner(options.cwd);
  const maxChars = options.maxChars ?? 40_000;
  const refs = ultraDiffRefs(options);
  if (refs.length === 0) {
    return { diff: '', truncated: false, files: [] };
  }
  const ref = refs[0]!.ref;
  const diffResult = git(['diff', `HEAD..${ref}`]);
  const full = diffResult.status === 0 ? diffResult.stdout : '';
  const nameResult = git(['diff', '--name-only', `HEAD..${ref}`]);
  const files =
    nameResult.status === 0
      ? nameResult.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
      : [];
  const truncated = full.length > maxChars;
  return {
    diff: truncated ? `${full.slice(0, maxChars)}\n… (diff truncated)` : full,
    truncated,
    files,
    ref,
  };
}
