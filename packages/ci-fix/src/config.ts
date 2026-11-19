/**
 * CI Fixer configuration (.alran/ci.yml).
 *
 * The schema is deliberately small: trigger, mode, limits, guards, model.
 * Everything the fixer needs is versioned in the repository so a run is
 * reproducible and reviewable. Parsing is strict about enums and ranges and
 * reports every problem instead of silently guessing.
 */

import yaml from 'js-yaml';

export const CI_FIX_CONFIG_VERSION = 1;
export const CI_FIX_CONFIG_PATH = '.alran/ci.yml';
export const CI_FIX_WORKFLOW_PATH = '.github/workflows/alran-ci-fix.yml';
export const CI_FIX_MARKER = '[alran-ci-fix]';
export const CI_FIX_SECRET_NAME = 'ALRAN_API_KEY';
export const CI_FIX_PUSH_TOKEN_SECRET = 'ALRAN_CI_PUSH_TOKEN';

export type CiFixPullRequestMode = 'push-to-branch' | 'fix-pr' | 'comment-only';
export type CiFixMainMode = 'fix-pr' | 'push' | 'comment-only';

export const CI_FIX_PULL_REQUEST_MODES: readonly CiFixPullRequestMode[] = [
  'push-to-branch',
  'fix-pr',
  'comment-only',
];
export const CI_FIX_MAIN_MODES: readonly CiFixMainMode[] = ['fix-pr', 'push', 'comment-only'];

export interface CiFixTriggerConfig {
  readonly workflows: readonly string[];
}

export interface CiFixModeConfig {
  readonly pull_request: CiFixPullRequestMode;
  readonly main: CiFixMainMode;
}

export interface CiFixLimitsConfig {
  readonly max_attempts: number;
  readonly max_diff_lines: number;
  readonly timeout_minutes: number;
  readonly max_runs_per_day: number;
  readonly max_tokens: number;
}

export interface CiFixGuardsConfig {
  readonly deny_paths: readonly string[];
  readonly forbid_test_weakening: boolean;
}

export interface CiFixModelConfig {
  readonly base_url: string;
  readonly name: string;
  readonly api_key_secret: string;
}

export interface CiFixConfig {
  readonly version: number;
  readonly enabled: boolean;
  readonly trigger: CiFixTriggerConfig;
  readonly mode: CiFixModeConfig;
  readonly limits: CiFixLimitsConfig;
  readonly guards: CiFixGuardsConfig;
  readonly model: CiFixModelConfig;
}

export const DEFAULT_CI_FIX_LIMITS: CiFixLimitsConfig = {
  max_attempts: 2,
  max_diff_lines: 300,
  timeout_minutes: 15,
  max_runs_per_day: 10,
  max_tokens: 200_000,
};

export const DEFAULT_CI_FIX_GUARDS: CiFixGuardsConfig = {
  deny_paths: [
    '.github/workflows/**',
    '.alran/ci.yml',
    '**/.env',
    '**/.env.*',
    '**/*.pem',
    '**/*.key',
    '**/*.p12',
    '**/secrets/**',
  ],
  forbid_test_weakening: true,
};

export const DEFAULT_CI_FIX_MODE: CiFixModeConfig = {
  pull_request: 'push-to-branch',
  main: 'fix-pr',
};

export const DEFAULT_CI_FIX_MODEL: CiFixModelConfig = {
  base_url: 'https://ai.ottili.one/v1',
  name: 'ottili/werk-1.1',
  api_key_secret: CI_FIX_SECRET_NAME,
};

export const DEFAULT_CI_FIX_CONFIG: CiFixConfig = {
  version: CI_FIX_CONFIG_VERSION,
  enabled: true,
  trigger: { workflows: ['CI'] },
  mode: { pull_request: 'push-to-branch', main: 'fix-pr' },
  limits: DEFAULT_CI_FIX_LIMITS,
  guards: DEFAULT_CI_FIX_GUARDS,
  model: DEFAULT_CI_FIX_MODEL,
};

export interface CiFixConfigProblem {
  readonly path: string;
  readonly message: string;
}

export interface CiFixConfigParseResult {
  readonly config: CiFixConfig;
  readonly problems: readonly CiFixConfigProblem[];
}

const MODE_PULL_REQUEST_VALUES = new Set<string>(CI_FIX_PULL_REQUEST_MODES);
const MODE_MAIN_VALUES = new Set<string>(CI_FIX_MAIN_MODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown, path: string, problems: CiFixConfigProblem[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    problems.push({ path, message: `expected an array of strings at ${path}` });
    return [];
  }
  return [...(value as string[])];
}

function readNumber(
  value: unknown,
  path: string,
  fallback: number,
  minimum: number,
  problems: CiFixConfigProblem[],
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push({ path, message: `expected a number at ${path}` });
    return fallback;
  }
  if (value < minimum) {
    problems.push({ path, message: `value at ${path} must be at least ${minimum}` });
    return fallback;
  }
  return value;
}

function readBoolean(
  value: unknown,
  path: string,
  fallback: boolean,
  problems: CiFixConfigProblem[],
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    problems.push({ path, message: `expected a boolean at ${path}` });
    return fallback;
  }
  return value;
}

function readMode<T extends string>(
  value: unknown,
  path: string,
  allowed: ReadonlySet<string>,
  fallback: T,
  problems: CiFixConfigProblem[],
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.has(value)) {
    problems.push({
      path,
      message: `expected one of ${[...allowed].map((entry) => `"${entry}"`).join(', ')} at ${path}`,
    });
    return fallback;
  }
  return value as T;
}

/**
 * Parses and validates a .alran/ci.yml document. Unknown keys are ignored so a
 * future field never breaks older readers; every known field falls back to its
 * documented default when missing or invalid.
 */
export function parseCiFixConfig(input: string): CiFixConfigParseResult {
  const problems: CiFixConfigProblem[] = [];
  let raw: unknown;
  try {
    raw = input.trim().length === 0 ? {} : yaml.load(input);
  } catch (error) {
    problems.push({ path: '', message: `invalid YAML: ${(error as Error).message}` });
    raw = {};
  }
  if (!isRecord(raw)) {
    problems.push({ path: '', message: 'expected a YAML mapping at the top level' });
    raw = {};
  }

  const version = readNumber(raw.version, 'version', CI_FIX_CONFIG_VERSION, 1, problems);
  if (version !== CI_FIX_CONFIG_VERSION) {
    problems.push({
      path: 'version',
      message: `unsupported config version ${version}; this Alran Code builds version ${CI_FIX_CONFIG_VERSION}`,
    });
  }

  const triggerRaw = isRecord(raw.trigger) ? raw.trigger : {};
  const trigger: CiFixTriggerConfig = {
    workflows:
      triggerRaw.workflows === undefined
        ? [...DEFAULT_CI_FIX_CONFIG.trigger.workflows]
        : readStringArray(triggerRaw.workflows, 'trigger.workflows', problems),
  };

  const modeRaw = isRecord(raw.mode) ? raw.mode : {};
  const mode: CiFixModeConfig = {
    pull_request: readMode(
      modeRaw.pull_request,
      'mode.pull_request',
      MODE_PULL_REQUEST_VALUES,
      DEFAULT_CI_FIX_MODE.pull_request,
      problems,
    ),
    main: readMode(modeRaw.main, 'mode.main', MODE_MAIN_VALUES, DEFAULT_CI_FIX_MODE.main, problems),
  };

  const limitsRaw = isRecord(raw.limits) ? raw.limits : {};
  const limits: CiFixLimitsConfig = {
    max_attempts: readNumber(limitsRaw.max_attempts, 'limits.max_attempts', 2, 1, problems),
    max_diff_lines: readNumber(limitsRaw.max_diff_lines, 'limits.max_diff_lines', 300, 1, problems),
    timeout_minutes: readNumber(
      limitsRaw.timeout_minutes,
      'limits.timeout_minutes',
      15,
      1,
      problems,
    ),
    max_runs_per_day: readNumber(
      limitsRaw.max_runs_per_day,
      'limits.max_runs_per_day',
      10,
      0,
      problems,
    ),
    max_tokens: readNumber(limitsRaw.max_tokens, 'limits.max_tokens', 200_000, 1, problems),
  };

  const guardsRaw = isRecord(raw.guards) ? raw.guards : {};
  const guards: CiFixGuardsConfig = {
    deny_paths:
      guardsRaw.deny_paths === undefined
        ? [...DEFAULT_CI_FIX_CONFIG.guards.deny_paths]
        : readStringArray(guardsRaw.deny_paths, 'guards.deny_paths', problems),
    forbid_test_weakening: readBoolean(
      guardsRaw.forbid_test_weakening,
      'guards.forbid_test_weakening',
      true,
      problems,
    ),
  };

  const modelRaw = isRecord(raw.model) ? raw.model : {};
  const model: CiFixModelConfig = {
    base_url: typeof modelRaw.base_url === 'string' ? modelRaw.base_url : DEFAULT_CI_FIX_MODEL.base_url,
    name: typeof modelRaw.name === 'string' ? modelRaw.name : DEFAULT_CI_FIX_MODEL.name,
    api_key_secret:
      typeof modelRaw.api_key_secret === 'string'
        ? modelRaw.api_key_secret
        : DEFAULT_CI_FIX_MODEL.api_key_secret,
  };

  const config: CiFixConfig = {
    version: CI_FIX_CONFIG_VERSION,
    enabled: readBoolean(raw.enabled, 'enabled', true, problems),
    trigger,
    mode,
    limits,
    guards,
    model,
  };
  return { config, problems };
}

/** Serializes a config back to .alran/ci.yml in the documented key order. */
export function renderCiFixConfig(config: CiFixConfig): string {
  const document = {
    version: config.version,
    enabled: config.enabled,
    trigger: { workflows: [...config.trigger.workflows] },
    mode: { pull_request: config.mode.pull_request, main: config.mode.main },
    limits: {
      max_attempts: config.limits.max_attempts,
      max_diff_lines: config.limits.max_diff_lines,
      timeout_minutes: config.limits.timeout_minutes,
      max_runs_per_day: config.limits.max_runs_per_day,
      max_tokens: config.limits.max_tokens,
    },
    guards: {
      deny_paths: [...config.guards.deny_paths],
      forbid_test_weakening: config.guards.forbid_test_weakening,
    },
    model: {
      base_url: config.model.base_url,
      name: config.model.name,
      api_key_secret: config.model.api_key_secret,
    },
  };
  return `${yaml.dump(document, { lineWidth: 120, noRefs: true, sortKeys: false })}`;
}

/**
 * Matches a repository-relative path against a deny-path pattern. Patterns
 * support `*` (within one segment) and `**` (across segments), anchored at the
 * repository root, e.g. `.github/workflows/**` or `*.env`.
 */
export function matchesDenyPath(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  // A leading `**/` also matches at the repository root.
  if (pattern.startsWith('**/')) {
    const rest = pattern.slice(3);
    if (rest.length > 0 && matchesDenyPath(rest, path)) return true;
  }
  let regex = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        regex += '.*';
        index += 1;
      } else {
        regex += '[^/]*';
      }
    } else if ('.+^$|?*()[]{}'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  const anchored = `^${regex}$`;
  if (new RegExp(anchored, 'u').test(path)) return true;
  // A pattern without a slash also matches any path suffix segment.
  if (!pattern.includes('/')) {
    return new RegExp(`(^|/)${regex}$`, 'u').test(path);
  }
  return false;
}

/** True when the path is protected and the fix agent must never touch it. */
export function isDeniedPath(path: string, denyPaths: readonly string[]): boolean {
  return denyPaths.some((pattern) => matchesDenyPath(pattern, path));
}
