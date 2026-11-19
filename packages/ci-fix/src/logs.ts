/**
 * CI log handling: truncation and secret masking.
 *
 * Failure logs are untrusted input that ends up in the model context and in PR
 * comments. They are cut to a bounded size (head + tail, so both the failing
 * step start and the final error survive) and every known secret value or
 * secret-shaped assignment is masked before anything else sees the text.
 */

export interface TruncateLogOptions {
  readonly maxChars?: number;
  readonly maxLines?: number;
  readonly headLines?: number;
  readonly tailLines?: number;
}

export interface TruncatedLog {
  readonly text: string;
  readonly truncated: boolean;
  readonly droppedLines: number;
  readonly droppedChars: number;
}

export const DEFAULT_TRUNCATE_LOG_OPTIONS: Required<TruncateLogOptions> = {
  maxChars: 50_000,
  maxLines: 500,
  headLines: 50,
  tailLines: 50,
};

export function truncateLog(input: string, options: TruncateLogOptions = {}): TruncatedLog {
  const opts = { ...DEFAULT_TRUNCATE_LOG_OPTIONS, ...options };
  const lines = input.split('\n');
  const overLines = lines.length > opts.maxLines;
  const overChars = input.length > opts.maxChars;
  if (!overLines && !overChars) {
    return { text: input, truncated: false, droppedLines: 0, droppedChars: 0 };
  }

  let text = input;
  let droppedLines = 0;
  if (overLines) {
    const head = lines.slice(0, opts.headLines);
    const tail = lines.slice(-opts.tailLines);
    droppedLines = Math.max(0, lines.length - head.length - tail.length);
    text = [
      ...head,
      `... [alran-ci-fix] ${droppedLines} log lines omitted ...`,
      ...tail,
    ].join('\n');
  }

  let droppedChars = 0;
  if (text.length > opts.maxChars) {
    const half = Math.floor(opts.maxChars / 2);
    const head = text.slice(0, half);
    const tail = text.slice(-half);
    const marker = '\n... [alran-ci-fix] log truncated ...\n';
    droppedChars = text.length - head.length - tail.length - marker.length;
    text = `${head}${marker}${tail}`;
  }
  return { text, truncated: true, droppedLines, droppedChars };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Replaces every occurrence of the given secret values with `***`. */
export function maskSecrets(input: string, secretValues: readonly string[]): string {
  let output = input;
  for (const value of secretValues) {
    if (value.length < 4) continue; // never mask one-char "secrets" into noise
    output = output.replaceAll(value, '***');
  }
  return output;
}

/** Shapes of well-known credential formats, masked even without a known value. */
const TOKEN_PATTERN =
  /\b(?:sk_live_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,})\b/gu;

/** Masks credential-shaped tokens (OpenAI, GitHub, AWS, Slack, GitLab, Google). */
export function maskTokenPatterns(input: string): string {
  return input.replace(TOKEN_PATTERN, '***');
}

/** Masks `NAME=value` assignments for the given secret variable names. */
export function maskSecretAssignments(input: string, secretNames: readonly string[]): string {
  let output = input;
  for (const name of secretNames) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) continue;
    output = output.replace(new RegExp(`\\b(${name})\\s*=\\s*\\S+`, 'gu'), '$1=***');
  }
  return output;
}

/** Masks known secret values, credential-shaped tokens and assignments in one pass. */
export function maskCiLog(
  input: string,
  options: { readonly values?: readonly string[]; readonly names?: readonly string[] } = {},
): string {
  const masked = maskTokenPatterns(maskSecrets(input, options.values ?? []));
  return maskSecretAssignments(masked, options.names ?? []);
}
