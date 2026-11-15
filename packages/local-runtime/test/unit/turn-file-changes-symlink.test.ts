import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyLocalTurnDiffSnapshotMutation,
  LocalTurnFileChangeCaptureService,
} from '../../src/turns/file-changes.js';
import type { LocalTurnDiffRecord, LocalTurnDiffSnapshotEntry } from '../../src/persistence/ports.js';

describe('turn diff and symlinks that leave the workspace', () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alran-turn-diff-links-')));
    workspace = path.join(root, 'workspace');
    outside = path.join(root, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function capturedBefore(file: string): Promise<LocalTurnDiffSnapshotEntry[]> {
    const created: LocalTurnDiffSnapshotEntry[][] = [];
    const store = {
      getPendingTurn: async () => ({
        turnId: 'turn-1',
        sessionId: 'session-1',
        agentName: 'agent',
        workspaceDir: workspace,
      }),
      createToolCapture: async (input: { before: LocalTurnDiffSnapshotEntry[] }) => {
        created.push(input.before);
        return true;
      },
    };
    const service = new LocalTurnFileChangeCaptureService(store as never, {
      nowMs: () => 0,
      makeId: (prefix) => `${prefix}-1`,
    });
    await service.captureToolUseStart({
      sessionId: 'session-1',
      agentName: 'agent',
      turnId: 'turn-1',
      toolName: 'write',
      toolCallId: 'call-1',
      toolArgs: { file_path: file },
    });
    return created[0] ?? [];
  }

  it('records the content of a file the agent wrote inside the workspace', async () => {
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'inside');

    expect(await capturedBefore('notes.txt')).toEqual([
      expect.objectContaining({ file: 'notes.txt', exists: true, content: 'inside' }),
    ]);
  });

  it('does not copy the content of an outside file into the stored diff when a link leads there', async () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(workspace, 'link'));

    const [entry] = await capturedBefore('link');

    expect(entry).toEqual({ file: 'link', exists: false });
  });

  it('does not follow a link to a directory outside the workspace either', async () => {
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
    fs.symlinkSync(outside, path.join(workspace, 'shared'));

    const [entry] = await capturedBefore('shared/secret.txt');

    expect(entry).toEqual({ file: 'shared/secret.txt', exists: false });
  });

  it('keeps a link that stays inside the workspace', async () => {
    fs.writeFileSync(path.join(workspace, 'real.txt'), 'inside');
    fs.symlinkSync(path.join(workspace, 'real.txt'), path.join(workspace, 'alias'));

    const [entry] = await capturedBefore('alias');

    expect(entry).toMatchObject({ file: 'alias', exists: true, content: 'inside' });
  });

  describe('reverting and re-applying a recorded change', () => {
    const entry = (content: string): LocalTurnDiffSnapshotEntry => ({
      file: 'link',
      exists: true,
      content,
      sizeBytes: Buffer.byteLength(content),
      hash: createHash('sha256').update(content).digest('hex'),
    });

    function record(): LocalTurnDiffRecord {
      return {
        workspaceDir: workspace,
        undoable: true,
        undo: [{ file: 'link', before: entry('before'), after: entry('after') }],
      } as unknown as LocalTurnDiffRecord;
    }

    it('refuses to write through a link that leads outside the workspace', async () => {
      const target = path.join(outside, 'target.txt');
      fs.writeFileSync(target, 'after');
      fs.symlinkSync(target, path.join(workspace, 'link'));

      const result = await applyLocalTurnDiffSnapshotMutation(record(), 'revert');

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(fs.readFileSync(target, 'utf8')).toBe('after');
    });

    it('refuses to create a file elsewhere through a dangling link', async () => {
      const target = path.join(outside, 'new.txt');
      fs.symlinkSync(target, path.join(workspace, 'link'));
      const undo = record();
      undo.undo![0]!.after = { file: 'link', exists: false };

      const result = await applyLocalTurnDiffSnapshotMutation(undo, 'revert');

      expect(result).toEqual({ success: false, reason: 'unsafe_path' });
      expect(fs.existsSync(target)).toBe(false);
    });
  });
});
