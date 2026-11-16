import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPathAllowed } from '../../../../src/tools/fs-permission.js';
import type { PathCheckContext } from '../../../../src/types.js';

// A symlink inside the workspace is the workspace's own path only while it points inside it.
describe('workspace paths that reach outside through a symlink', () => {
  let root: string;
  let workspace: string;
  let outside: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alran-fs-symlink-')));
    workspace = path.join(root, 'workspace');
    outside = path.join(root, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'target.txt'), 'outside');
    fs.writeFileSync(path.join(workspace, 'inside.txt'), 'inside');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const context = (overrides: Partial<PathCheckContext> = {}): PathCheckContext => ({
    workingDirectory: workspace,
    dataDir: path.join(root, '.alran'),
    homeDir: path.join(root, 'home'),
    ...overrides,
  });

  const decide = (file: string, tool: string, overrides: Partial<PathCheckContext> = {}): string => {
    const result = isPathAllowed(file, [], context(overrides), tool);
    return result.allowed ? `allow:${result.reason.type}` : `deny:${result.reason.type}`;
  };

  it.each(['write', 'edit'])('does not treat a %s through a link to an outside file as inside', (tool) => {
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(workspace, 'link'));

    expect(decide(path.join(workspace, 'link'), tool)).toBe('deny:workingDirectory');
  });

  it('does not treat a write through a dangling link as inside', () => {
    fs.symlinkSync(path.join(outside, 'not-yet.txt'), path.join(workspace, 'dangling'));

    expect(decide(path.join(workspace, 'dangling'), 'write')).toBe('deny:workingDirectory');
  });

  it('does not treat a new file under a link to an outside directory as inside', () => {
    fs.symlinkSync(outside, path.join(workspace, 'shared'));

    expect(decide(path.join(workspace, 'shared', 'new.txt'), 'write')).toBe(
      'deny:workingDirectory',
    );
    expect(decide(path.join(workspace, 'shared', 'target.txt'), 'edit')).toBe(
      'deny:workingDirectory',
    );
  });

  it('still allows links that stay inside the workspace, and ordinary files', () => {
    fs.symlinkSync(path.join(workspace, 'inside.txt'), path.join(workspace, 'alias'));
    fs.mkdirSync(path.join(workspace, 'sub'));
    fs.symlinkSync(path.join(workspace, 'sub'), path.join(workspace, 'subalias'));

    expect(decide(path.join(workspace, 'alias'), 'write')).toBe('allow:workingDirectory');
    expect(decide(path.join(workspace, 'subalias', 'new.txt'), 'write')).toBe(
      'allow:workingDirectory',
    );
    expect(decide(path.join(workspace, 'inside.txt'), 'edit')).toBe('allow:workingDirectory');
    expect(decide(path.join(workspace, 'new', 'file.txt'), 'write')).toBe('allow:workingDirectory');
  });

  it('allows a workspace that is itself reached through a link', () => {
    const alias = path.join(root, 'workspace-alias');
    fs.symlinkSync(workspace, alias);

    expect(decide(path.join(alias, 'inside.txt'), 'write', { workingDirectory: alias })).toBe(
      'allow:workingDirectory',
    );
    expect(decide(path.join(alias, 'new.txt'), 'write', { workingDirectory: alias })).toBe(
      'allow:workingDirectory',
    );
  });

  it('allows a link into another directory the session was given', () => {
    fs.symlinkSync(path.join(outside, 'target.txt'), path.join(workspace, 'link'));

    expect(
      decide(path.join(workspace, 'link'), 'write', { allowedWorkingPaths: [outside] }),
    ).toBe('allow:workingDirectory');
  });

  it('checks the real file for secrets: a link named like a plain file to an .env file is not a plain file', () => {
    fs.writeFileSync(path.join(workspace, '.env'), 'TOKEN=secret');
    fs.symlinkSync(path.join(workspace, '.env'), path.join(workspace, 'notes.txt'));

    for (const tool of ['read', 'write', 'edit']) {
      expect(decide(path.join(workspace, 'notes.txt'), tool)).toBe('deny:safetyCheck');
    }
  });

  it('leaves a path that is outside the workspace without any link as it was', () => {
    expect(decide(path.join(outside, 'target.txt'), 'write')).toBe('deny:workingDirectory');
  });
});
