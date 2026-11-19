/**
 * Command safety for the CI Fixer.
 *
 * The failing command normally comes from the repository's own detection or
 * from .alran/ci.yml. When the adapter extracts a command from CI logs, that
 * string is untrusted input: a malicious log must never be able to smuggle a
 * shell pipeline into the fixer. `isSafeProjectCommand` accepts only plain
 * project commands (letters, digits, spaces, quotes and a conservative set of
 * option characters) and rejects every shell metacharacter.
 */

const UNSAFE_PATTERN = /[|;&$`><(){}[\]*?!\\%\n\r^]/u;

/** Maximum accepted command length; longer strings are almost certainly logs. */
export const MAX_PROJECT_COMMAND_LENGTH = 500;

/**
 * True when the command is a plain project command that can be run through a
 * shell without risking injection. Quotes are allowed (e.g.
 * `pytest -k "not slow"`); pipes, redirects, substitutions and separators are
 * not.
 */
export function isSafeProjectCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_COMMAND_LENGTH) return false;
  if (UNSAFE_PATTERN.test(trimmed)) return false;
  // A bare word like `npm` is technically safe but never a full command.
  return /\s/u.test(trimmed) || /^[A-Za-z0-9._:=-]+$/u.test(trimmed);
}