/**
 * Reading a runner's log while it is being written.
 *
 * A background run writes to `runner.log` for as long as it lives, and the two
 * things a human wants are "what just happened" (attach) and "what happened
 * lately" (the board's tail). Both are bounded reads: a long run's log is not
 * something to pull into memory whole, and the last few kilobytes hold what a
 * reader is looking for.
 *
 * Everything here is filesystem-only and side-effect free apart from reading, so
 * the CLI's follow loop and the TUI's log panel share one implementation.
 */

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

/** How much of the end of a log one tail reads, whatever the file's size. */
export const MAX_TAIL_BYTES = 64 * 1024;

/** How much one follow step reads, so a sudden burst cannot flood the caller. */
export const MAX_CHUNK_BYTES = 64 * 1024;

/**
 * The last `maxLines` non-empty lines of a log, or `[]` when it does not exist.
 *
 * Reads from the end rather than the start, so the cost does not grow with the
 * log. When the read began mid-line, that partial line is dropped: it is the
 * half of a line the previous reader already saw.
 */
export function tailRunnerLog(file: string, maxLines = 20): string[] {
  if (!Number.isFinite(maxLines) || maxLines <= 0) return [];
  if (!existsSync(file)) return [];
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return [];
  }
  if (size === 0) return [];

  const readBytes = Math.min(size, MAX_TAIL_BYTES);
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(readBytes);
    // `readSync` returns the count; it is not an object to destructure.
    const bytesRead = readSync(fd, buffer, 0, readBytes, size - readBytes);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    // A read that did not start at byte 0 begins inside a line; drop it.
    const first = size > readBytes ? 1 : 0;
    // A trailing newline yields a final empty element, which is not a line.
    const last = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
    return lines.slice(first, last).filter((line) => line.length > 0).slice(-maxLines);
  } finally {
    closeSync(fd);
  }
}

export interface RunnerLogChunk {
  /** New text since `offset`, without the bytes already read. */
  readonly text: string;
  /** Where to read from next. */
  readonly offset: number;
  /** True when the file was truncated or replaced underneath the reader. */
  readonly restarted: boolean;
}

/**
 * Reads what has been appended to a log since `offset`.
 *
 * A log that shrank was truncated or replaced (a new attempt writing the same
 * file), so the reader starts over rather than reporting a negative range. The
 * partial line at the end is kept in `text` only when it is complete; a
 * half-written line is not something to print mid-word.
 */
export function readRunnerLogChunk(file: string, offset: number, maxBytes = MAX_CHUNK_BYTES): RunnerLogChunk {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    // Deleted or not yet created: nothing new, and the caller keeps its offset.
    return { text: '', offset, restarted: false };
  }
  const from = offset > size ? 0 : Math.max(0, offset);
  if (size === from) return { text: '', offset: size, restarted: offset > size };

  const length = Math.min(size - from, Math.max(1, maxBytes));
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, from);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return { text, offset: from + bytesRead, restarted: offset > size };
  } finally {
    closeSync(fd);
  }
}

/** The log tail plus the offset a follow loop should start from. */
export function runnerLogTail(file: string, maxLines = 20): { readonly lines: readonly string[]; readonly offset: number } {
  const lines = tailRunnerLog(file, maxLines);
  let offset = 0;
  try {
    offset = existsSync(file) ? statSync(file).size : 0;
  } catch {
    offset = 0;
  }
  return { lines, offset };
}