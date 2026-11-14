import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  expandHookPlaceholders,
  hookShellDialect,
  resolveHookCommandInvocation,
} from '../src/command-invocation.js';

describe('hookShellDialect', () => {
  it('tells argv, POSIX shells, PowerShell and cmd.exe apart', () => {
    expect(hookShellDialect({ command: 'node', args: ['x.js'], shell: false })).toBe('none');
    expect(hookShellDialect({ command: 'sh', args: ['-c', 'echo'], shell: false })).toBe('posix');
    expect(hookShellDialect({ command: 'C:\\Git\\bin\\bash.exe', args: ['-c', 'echo'], shell: false })).toBe('posix');
    expect(hookShellDialect({ command: 'pwsh', args: ['-Command', 'x'], shell: false })).toBe('powershell');
    expect(hookShellDialect({ command: 'echo', args: [], shell: true })).toBe(
      process.platform === 'win32' ? 'cmd' : 'posix',
    );
  });
});

describe('expandHookPlaceholders', () => {
  const env = { ALRAN_PROJECT_DIR: '/work/app', ALRAN_PLUGIN_ROOT: '/plugins/x y' };

  it('writes inert values in place, in every position', () => {
    const command = 'cd ${ALRAN_PROJECT_DIR} && "${ALRAN_PLUGIN_ROOT}/run.sh" \'${ALRAN_PROJECT_DIR}\'';
    expect(expandHookPlaceholders(command, env, 'posix', 'linux')).toBe(
      'cd /work/app && "/plugins/x y/run.sh" \'/work/app\'',
    );
  });

  it('leaves a value with shell syntax to the shell, which expands it without parsing it', () => {
    const hostile = { ALRAN_PROJECT_DIR: '/tmp/proj$(touch pwned)`id`;x' };
    expect(expandHookPlaceholders('cd ${ALRAN_PROJECT_DIR}', hostile, 'posix', 'linux')).toBe(
      'cd ${ALRAN_PROJECT_DIR}',
    );
    expect(expandHookPlaceholders('cd ${ALRAN_PROJECT_DIR}', hostile, 'powershell', 'linux')).toBe(
      'cd ${env:ALRAN_PROJECT_DIR}',
    );
  });

  it('refuses a value cmd.exe could misread rather than guess an escape', () => {
    expect(() =>
      expandHookPlaceholders('cd ${ALRAN_PROJECT_DIR}', { ALRAN_PROJECT_DIR: 'a&calc' }, 'cmd', 'win32'),
    ).toThrow(/cmd\.exe/);
    expect(
      expandHookPlaceholders('cd ${ALRAN_PROJECT_DIR}', { ALRAN_PROJECT_DIR: 'C:\\Users\\me\\app' }, 'cmd', 'win32'),
    ).toBe('cd C:\\Users\\me\\app');
  });

  it('writes any value into an argv, where nothing parses it', () => {
    expect(expandHookPlaceholders('${ALRAN_PROJECT_DIR}', { ALRAN_PROJECT_DIR: '$(x) y' }, 'none')).toBe('$(x) y');
  });

  it('leaves unknown placeholders alone', () => {
    expect(expandHookPlaceholders('echo ${NOPE}', env, 'posix', 'linux')).toBe('echo ${NOPE}');
  });

  it.skipIf(process.platform === 'win32')('does not run code hidden in the workspace directory name', () => {
    const root = mkdtempSync(join(tmpdir(), 'hook-inject-'));
    try {
      // The payload has no slash, so the directory is a single entry; run from `root`, a `touch`
      // that gets executed would leave `pwned` next to it.
      const marker = join(root, 'pwned');
      const hostile = join(root, 'proj$(touch pwned)');
      mkdirSync(hostile);
      const environment = { PATH: process.env.PATH ?? '', ALRAN_PROJECT_DIR: hostile };
      const run = (raw: string) => {
        const dialect = hookShellDialect(resolveHookCommandInvocation({ command: raw, sourceFormat: 'CLAUDE' }));
        const command = expandHookPlaceholders(raw, environment, dialect);
        const invocation = resolveHookCommandInvocation({ command, sourceFormat: 'CLAUDE' });
        return spawnSync(invocation.command, [...invocation.args], { cwd: root, env: environment, encoding: 'utf8' });
      };
      // The quoted form plugins are written in: the shell expands the variable, as data.
      expect(run('cd "${ALRAN_PROJECT_DIR}" && pwd').stdout.trim()).toBe(hostile);
      expect(existsSync(marker)).toBe(false);
      // Unquoted, the odd name may fail the command, but it still is not run.
      run('cd ${ALRAN_PROJECT_DIR}');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
