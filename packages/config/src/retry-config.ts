// How Alran Code retries a model request that failed before the first token.
//
// The retry loop itself (exponential backoff with jitter, `Retry-After`, no retry once output has started,
// no retry of a permanent failure) lives in `@alran/agent-core`. This is the part a person can set, in
// `config.yaml`:
//
//   retry:
//     maxRetries: 3          # 0 turns retrying off
//     initialDelayMs: 2000   # the first wait; every later wait doubles, with jitter
//     maxDelayMs: 20000      # the longest single wait (a provider's Retry-After is capped by it too)
//     maxElapsedMs: 60000    # stop retrying when the waits would take longer than this
//     retryOn: [network, timeout, rate_limited, overloaded]
//
// What can never be set: an invalid key, an empty balance, a used-up plan or a content refusal is not
// retried, whatever `retryOn` says — a retry cannot change the answer and may bill the same request again.

/** The categories of failure that can be retried (the permanent ones are not on the list on purpose). */
export const RETRY_REASONS = ['timeout', 'network', 'rate_limited', 'tpm_rate_limited', 'overloaded'] as const;
export type RetryReason = (typeof RETRY_REASONS)[number];

export interface RetryConfig {
  /** Retries after the first request. 0 turns retrying off. */
  maxRetries: number;
  /** The first wait, in milliseconds. Each later wait doubles, with jitter, up to `maxDelayMs`. */
  initialDelayMs: number;
  /** The longest single wait. A provider's `Retry-After` is honoured but never above this. */
  maxDelayMs: number;
  /** The retries stop when the next wait would push the whole retry window past this many milliseconds. */
  maxElapsedMs: number;
  /** The failures worth a retry. */
  retryOn: readonly RetryReason[];
}

export interface PartialRetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxElapsedMs?: number;
  retryOn?: readonly string[];
}

export const RETRY_CONFIG_DEFAULTS: Readonly<RetryConfig> = Object.freeze({
  maxRetries: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxElapsedMs: 120_000,
  retryOn: Object.freeze([...RETRY_REASONS]) as readonly RetryReason[],
});

export const RETRY_CONFIG_LIMITS = Object.freeze({
  maxRetries: { min: 0, max: 20 },
  initialDelayMs: { min: 100, max: 60_000 },
  maxDelayMs: { min: 100, max: 600_000 },
  maxElapsedMs: { min: 1_000, max: 3_600_000 },
});

export interface RetryConfigParseResult {
  readonly config: RetryConfig;
  /** What was wrong in the file and what was used instead. A wrong value never stops Alran Code from starting. */
  readonly warnings: readonly string[];
}

const KNOWN_KEYS = new Set(['maxRetries', 'initialDelayMs', 'maxDelayMs', 'maxElapsedMs', 'retryOn']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerInRange(
  value: unknown,
  key: keyof typeof RETRY_CONFIG_LIMITS,
  fallback: number,
  warnings: string[],
): number {
  if (value === undefined || value === null) return fallback;
  const { min, max } = RETRY_CONFIG_LIMITS[key];
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(number)) {
    warnings.push(`retry.${key} must be a whole number; using ${fallback}.`);
    return fallback;
  }
  if (number < min || number > max) {
    const clamped = Math.min(max, Math.max(min, number));
    warnings.push(`retry.${key} must be between ${min} and ${max}; using ${clamped}.`);
    return clamped;
  }
  return number;
}

/**
 * Read the `retry:` block of the config file. Everything is optional; a missing or invalid value falls back to
 * the default and is reported in `warnings` instead of failing the start.
 */
export function parseRetryConfig(raw: unknown): RetryConfigParseResult {
  const warnings: string[] = [];
  if (raw === undefined || raw === null) return { config: structuredClone(RETRY_CONFIG_DEFAULTS) as RetryConfig, warnings };
  if (!isRecord(raw)) {
    return {
      config: structuredClone(RETRY_CONFIG_DEFAULTS) as RetryConfig,
      warnings: ['retry must be a mapping (maxRetries, initialDelayMs, maxDelayMs, maxElapsedMs, retryOn); using the defaults.'],
    };
  }
  for (const key of Object.keys(raw)) if (!KNOWN_KEYS.has(key)) warnings.push(`retry.${key} is not a setting; ignored.`);

  const maxRetries = integerInRange(raw.maxRetries, 'maxRetries', RETRY_CONFIG_DEFAULTS.maxRetries, warnings);
  const initialDelayMs = integerInRange(raw.initialDelayMs, 'initialDelayMs', RETRY_CONFIG_DEFAULTS.initialDelayMs, warnings);
  let maxDelayMs = integerInRange(raw.maxDelayMs, 'maxDelayMs', RETRY_CONFIG_DEFAULTS.maxDelayMs, warnings);
  if (maxDelayMs < initialDelayMs) {
    warnings.push(`retry.maxDelayMs (${maxDelayMs}) is below retry.initialDelayMs (${initialDelayMs}); using ${initialDelayMs}.`);
    maxDelayMs = initialDelayMs;
  }
  const maxElapsedMs = integerInRange(raw.maxElapsedMs, 'maxElapsedMs', RETRY_CONFIG_DEFAULTS.maxElapsedMs, warnings);

  let retryOn: readonly RetryReason[] = RETRY_CONFIG_DEFAULTS.retryOn;
  if (raw.retryOn !== undefined && raw.retryOn !== null) {
    if (!Array.isArray(raw.retryOn)) {
      warnings.push(`retry.retryOn must be a list of ${RETRY_REASONS.join(', ')}; using all of them.`);
    } else {
      const known: RetryReason[] = [];
      for (const entry of raw.retryOn) {
        const name = typeof entry === 'string' ? entry.trim().toLowerCase().replace(/-/g, '_') : '';
        if ((RETRY_REASONS as readonly string[]).includes(name)) {
          if (!known.includes(name as RetryReason)) known.push(name as RetryReason);
        } else {
          warnings.push(`retry.retryOn: "${String(entry)}" is not a category that can be retried (${RETRY_REASONS.join(', ')}); ignored.`);
        }
      }
      // `rate_limited` and `tpm_rate_limited` are one idea to a person: allowing one allows the other.
      if (known.includes('rate_limited') && !known.includes('tpm_rate_limited')) known.push('tpm_rate_limited');
      retryOn = Object.freeze(known);
    }
  }

  return { config: { maxRetries, initialDelayMs, maxDelayMs, maxElapsedMs, retryOn }, warnings };
}

/** The shape the retry loop of `@alran/agent-core` takes (`LLMRetryPolicy`), without importing it. */
export interface RetryPolicyForRuntime {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryElapsedMs: number;
  retryReasons: readonly RetryReason[];
}

/** The retry loop's policy for a configuration. */
export function retryPolicyFromConfig(config: RetryConfig | undefined): RetryPolicyForRuntime {
  const effective = config ?? RETRY_CONFIG_DEFAULTS;
  return {
    maxRetries: effective.maxRetries,
    baseDelayMs: effective.initialDelayMs,
    maxDelayMs: effective.maxDelayMs,
    maxRetryElapsedMs: effective.maxElapsedMs,
    retryReasons: effective.retryOn,
  };
}
