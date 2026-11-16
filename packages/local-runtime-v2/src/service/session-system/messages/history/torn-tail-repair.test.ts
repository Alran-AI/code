import { readFile, readdir, rm, stat, utimes, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readJsonl, repairTornJsonlTail } from '../../../../infra/file/jsonl.js';
import type { SessionRecord } from '../../sessions/repo/contract.js';
import { createSessionSystemCanonicalHistoryProvider } from './canonical-history-provider.js';
import { resolveSessionHistoryPaths, utcSessionHistoryRelativeDir } from './session-history-paths.js';

const OLD = new Date('2020-01-01T00:00:00Z');
const identity = (value: unknown): unknown => value;

async function age(path: string): Promise<void> {
  await utimes(path, OLD, OLD);
}

describe('repairTornJsonlTail', () => {
  let directory: string;
  let file: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'alran-torn-tail-'));
    file = join(directory, 'messages.jsonl');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('cuts an unterminated final line that is not JSON and keeps those bytes beside the file', async () => {
    await writeFile(file, '{"a":1}\n{"b":2}\n{"c":3,"d":"cut o');
    await age(file);

    const repaired = await repairTornJsonlTail(file);

    expect(repaired?.removedBytes).toBe('{"c":3,"d":"cut o'.length);
    expect(await readFile(file, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
    expect(await readFile(repaired?.backupPath ?? '', 'utf8')).toBe('{"c":3,"d":"cut o');
    expect(await readJsonl(file, identity)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('cuts a file that holds only a torn first record down to empty', async () => {
    await writeFile(file, '{"a":');
    await age(file);

    expect((await repairTornJsonlTail(file))?.removedBytes).toBe(5);
    expect((await stat(file)).size).toBe(0);
  });

  it.each([
    ['a file that ends with a newline', '{"a":1}\n{"b":2}\n'],
    ['an empty file', ''],
    ['an unterminated final line that is complete JSON', '{"a":1}\n{"b":2}'],
    ['a malformed line in the middle, which stays an error', '{"a":1}\n{bad}\n{"b":2}\n'],
    ['a malformed line that is terminated', '{"a":1}\n{bad}\n'],
  ])('leaves %s alone', async (_name, content) => {
    await writeFile(file, content);
    await age(file);

    expect(await repairTornJsonlTail(file)).toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe(content);
    expect(await readdir(directory)).toEqual(['messages.jsonl']);
  });

  it('leaves a recently written tail alone because its writer may still be finishing', async () => {
    await writeFile(file, '{"a":1}\n{"b":');

    expect(await repairTornJsonlTail(file)).toBeUndefined();
    expect(await readFile(file, 'utf8')).toBe('{"a":1}\n{"b":');
  });

  it('does nothing for a file that does not exist', async () => {
    expect(await repairTornJsonlTail(join(directory, 'absent.jsonl'))).toBeUndefined();
  });
});

describe('a session whose history ends in a torn line', () => {
  let dataDir: string;
  let session: SessionRecord;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'alran-torn-session-'));
    session = {
      sessionId: 'torn-session',
      agentName: 'test',
      workspaceDir: dataDir,
      runtime: 'pi-agent',
      sessionType: 'root',
      sessionKind: 'conversation',
      archived: false,
      status: 'idle',
      createdAtMs: 0,
      updatedAtMs: 0,
      historyRelativeDir: utcSessionHistoryRelativeDir('torn-session', 0),
    };
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const change = (id: string, text: string) => ({
    sessionId: 'torn-session',
    turnId: id,
    reason: 'messageDelta' as const,
    operation: { id, kind: 'append' },
    messages: [{ role: 'user', timestamp: 1, content: [{ type: 'text', text }] }],
  });

  it('reads and appends again after the interrupted write is cut off, instead of failing for ever', async () => {
    const provider = createSessionSystemCanonicalHistoryProvider({
      dataDir,
      sessions: { get: async () => session },
    });
    await provider.append(change('one', 'first'));
    const path = resolveSessionHistoryPaths(dataDir, session).messages;
    const committed = await readFile(path, 'utf8');
    await writeFile(path, `${committed}{"message_id":"msg-user-v1-torn","turn_id":"two","mess`);
    await age(path);

    const read = await provider.readActive(session.sessionId);
    expect(read.messages).toHaveLength(1);

    const appended = await provider.append(change('two', 'second'));
    expect(appended.messages).toHaveLength(2);
    const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
    const siblings = await readdir(join(path, '..'));
    expect(siblings.some((name) => name.startsWith('messages.jsonl.torn-'))).toBe(true);
  });

  it('still refuses a history with a malformed line in the middle', async () => {
    const provider = createSessionSystemCanonicalHistoryProvider({
      dataDir,
      sessions: { get: async () => session },
    });
    await provider.append(change('one', 'first'));
    const path = resolveSessionHistoryPaths(dataDir, session).messages;
    const committed = await readFile(path, 'utf8');
    await writeFile(path, `{bad}\n${committed}`);
    await age(path);

    await expect(provider.readActive(session.sessionId)).rejects.toThrow(/Malformed JSONL/u);
    expect(await readFile(path, 'utf8')).toBe(`{bad}\n${committed}`);
  });
});
