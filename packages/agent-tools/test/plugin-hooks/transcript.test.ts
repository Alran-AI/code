import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PluginHookTranscript,
  type PluginHookTranscriptStorageOptions,
} from '../../src/plugin-hooks/transcript.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

const temporaryRoots: string[] = [];

async function makeStorage(): Promise<PluginHookTranscriptStorageOptions> {
  const root = await mkdtemp(join(tmpdir(), 'alran-transcript-test-'));
  temporaryRoots.push(root);
  return { directory: join(root, 'transcripts') };
}

function userMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: 1_700_000_000_000,
  } as AgentMessage;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('PluginHookTranscript projection writes', () => {
  it('recreates a managed transcript directory removed between create and apply', async () => {
    const storage = await makeStorage();
    const transcript = await PluginHookTranscript.create({
      sessionId: 'missing-directory-session',
      messages: [],
      cwd: '/tmp',
      storage,
    });

    await rm(storage.directory!, { recursive: true, force: true });
    await expect(
      transcript.apply({
        sessionId: 'missing-directory-session',
        turnId: 'turn-1',
        reason: 'append',
        messages: [userMessage('hello')],
      }),
    ).resolves.toBeUndefined();

    const rows = (await readFile(transcript.path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'user' });
    await expect(stat(transcript.codexPath)).resolves.toBeDefined();
  });

  it('recreates a projection file removed by external cleanup', async () => {
    const storage = await makeStorage();
    const transcript = await PluginHookTranscript.create({
      sessionId: 'missing-file-session',
      messages: [],
      cwd: '/tmp',
      storage,
    });

    await rm(transcript.path, { force: true });
    await transcript.apply({
      sessionId: 'missing-file-session',
      turnId: 'turn-1',
      reason: 'append',
      messages: [userMessage('hello')],
    });

    await expect(stat(transcript.path)).resolves.toBeDefined();
  });
});
