/**
 * Reading a runner's log while it is being written.
 *
 * The cases that matter are the ones a live reader hits: the file does not exist
 * yet, the writer is mid-line, the file was truncated between two reads, and a
 * tail that starts inside a line must not print half of it.
 */

import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRunnerLogChunk, runnerLogTail, tailRunnerLog } from '../../src/runner-log.js';

const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ultra-log-'));
  dirs.push(dir);
  return path.join(dir, 'runner.log');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('tailRunnerLog', () => {
  it('returns nothing when the log does not exist yet', () => {
    expect(tailRunnerLog(path.join('/tmp', 'definitely-not-here-8f2a.log'))).toEqual([]);
  });

  it('returns nothing for an empty log', () => {
    const file = tempFile();
    writeFileSync(file, '');
    expect(tailRunnerLog(file)).toEqual([]);
  });

  it('returns the last lines in order', () => {
    const file = tempFile();
    writeFileSync(file, 'one\ntwo\nthree\n');
    expect(tailRunnerLog(file, 2)).toEqual(['two', 'three']);
  });

  it('ignores a trailing newline instead of showing an empty line', () => {
    const file = tempFile();
    writeFileSync(file, 'one\ntwo\n');
    expect(tailRunnerLog(file, 5)).toEqual(['one', 'two']);
  });

  it('drops a partial first line when the read started mid-file', () => {
    const file = tempFile();
    // A tail that begins inside "second" must not show "econd".
    writeFileSync(file, `${'x'.repeat(70_000)}\nsecond\nthird\n`);
    const lines = tailRunnerLog(file, 5);
    expect(lines).toEqual(['second', 'third']);
  });

  it('returns fewer lines than asked when there are fewer', () => {
    const file = tempFile();
    writeFileSync(file, 'only\n');
    expect(tailRunnerLog(file, 20)).toEqual(['only']);
  });
});

describe('readRunnerLogChunk', () => {
  it('reads what was appended since the offset', () => {
    const file = tempFile();
    writeFileSync(file, 'first\n');
    const first = readRunnerLogChunk(file, 0);
    expect(first.text).toBe('first\n');
    expect(first.offset).toBe(6);

    appendFileSync(file, 'second\n');
    const second = readRunnerLogChunk(file, first.offset);
    expect(second.text).toBe('second\n');
    expect(second.restarted).toBe(false);
  });

  it('reports no change when nothing was written', () => {
    const file = tempFile();
    writeFileSync(file, 'first\n');
    const first = readRunnerLogChunk(file, 0);
    expect(readRunnerLogChunk(file, first.offset).text).toBe('');
  });

  it('starts over when the file was truncated between reads', () => {
    const file = tempFile();
    writeFileSync(file, 'a long first attempt that will be truncated away\n');
    const first = readRunnerLogChunk(file, 0);
    // A new attempt rewrites the same path.
    writeFileSync(file, 'new\n');
    const next = readRunnerLogChunk(file, first.offset);
    expect(next.restarted).toBe(true);
    expect(next.text).toBe('new\n');
  });

  it('restarts from the beginning when the offset is past the end', () => {
    const file = tempFile();
    writeFileSync(file, 'abc\n');
    // An offset beyond EOF means the reader lost its place: the whole file is
    // new to it, and the flag says so.
    const chunk = readRunnerLogChunk(file, 99);
    expect(chunk.restarted).toBe(true);
    expect(chunk.text).toBe('abc\n');
    expect(chunk.offset).toBe(4);
  });

  it('reports nothing when the file is gone', () => {
    const file = tempFile();
    const chunk = readRunnerLogChunk(file, 0);
    expect(chunk).toEqual({ text: '', offset: 0, restarted: false });
  });
});

describe('runnerLogTail', () => {
  it('returns the tail and the offset to follow from', () => {
    const file = tempFile();
    writeFileSync(file, 'one\ntwo\n');
    const tail = runnerLogTail(file, 10);
    expect(tail.lines).toEqual(['one', 'two']);
    // Following continues after what the tail already showed.
    expect(tail.offset).toBe(8);
    appendFileSync(file, 'three\n');
    expect(readRunnerLogChunk(file, tail.offset).text).toBe('three\n');
  });

  it('starts at zero for a log that does not exist', () => {
    expect(runnerLogTail('/tmp/nope-8f2a.log')).toEqual({ lines: [], offset: 0 });
  });
});
