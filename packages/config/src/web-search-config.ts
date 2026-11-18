// Bring-your-own-key web search, set in `config.yaml` instead of the shell.
//
// `export BRAVE_API_KEY=…` works, but it is shell state: it has to be repeated for every shell, it
// is invisible to anyone who did not write it, and on Windows it needs a different syntax. This
// block is the same configuration in one place a person can find:
//
//   webSearch:
//     braveApiKey: "…"          # Brave Search API — free tier covers thousands of queries a month
//     serperApiKey: "…"
//     tavilyApiKey: "…"
//     searxngUrl: "http://127.0.0.1:8080"
//     searxngApiKey: "…"        # only when the instance sits behind a key-checking gateway
//
// The environment still wins. `webSearchEnvFromConfig` only fills in what the environment leaves
// empty, so a CI job can override a checked-in `config.yaml` without editing it, and a key pasted
// into a shell for one run never has to be written to disk.
//
// The keys are stored in plain text, exactly like `provider.options.apiKey` already is. Anyone who
// can read `~/.alran/config.yaml` can read them.

/** The settings a person can write under `webSearch:` in `config.yaml`. */
export interface WebSearchConfig {
  braveApiKey?: string;
  serperApiKey?: string;
  tavilyApiKey?: string;
  searxngUrl?: string;
  searxngApiKey?: string;
}

/** Every key the block understands, in documentation order. */
const KNOWN_KEYS = [
  'braveApiKey',
  'serperApiKey',
  'tavilyApiKey',
  'searxngUrl',
  'searxngApiKey',
] as const satisfies readonly (keyof WebSearchConfig)[];

/** The environment names the provider chain reads, paired with the config key that fills them. */
const CONFIG_KEY_TO_ENV: Readonly<Record<keyof WebSearchConfig, string>> = Object.freeze({
  braveApiKey: 'BRAVE_API_KEY',
  serperApiKey: 'SERPER_API_KEY',
  tavilyApiKey: 'TAVILY_API_KEY',
  searxngUrl: 'SEARXNG_URL',
  searxngApiKey: 'SEARXNG_API_KEY',
});

export const WEB_SEARCH_CONFIG_DEFAULTS: Readonly<WebSearchConfig> = Object.freeze({});

export interface WebSearchConfigParseResult {
  readonly config: WebSearchConfig;
  /** What was wrong in the file and what was used instead. A wrong value never stops startup. */
  readonly warnings: readonly string[];
}

/**
 * Read `webSearch:` from the parsed `config.yaml`.
 *
 * A value that is not a string is reported and skipped rather than thrown on: a typo in one key
 * should not stop Alran Code from starting, the same rule the `retry:` block follows.
 */
export function parseWebSearchConfig(raw: unknown): WebSearchConfigParseResult {
  if (raw === undefined || raw === null) {
    return { config: { ...WEB_SEARCH_CONFIG_DEFAULTS }, warnings: [] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      config: { ...WEB_SEARCH_CONFIG_DEFAULTS },
      warnings: ['webSearch: must be a mapping of provider settings; ignoring it'],
    };
  }

  const input = raw as Record<string, unknown>;
  const config: WebSearchConfig = {};
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      warnings.push(`webSearch.${key}: unknown setting; ignoring it`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      warnings.push(`webSearch.${key}: expected a string; ignoring it`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    config[key as keyof WebSearchConfig] = trimmed;
  }

  return { config, warnings };
}

/**
 * Turn the config block into the environment names the provider chain already reads.
 *
 * Only configured values are emitted, so spreading the result over `process.env` leaves every real
 * environment variable untouched — that is what keeps env higher priority than the file.
 */
export function webSearchEnvFromConfig(config: WebSearchConfig = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of KNOWN_KEYS) {
    const value = config[key];
    if (value === undefined) continue;
    out[CONFIG_KEY_TO_ENV[key]] = value;
  }
  return out;
}

/**
 * Overlay `webSearch:` onto an environment without ever replacing a real variable.
 *
 * A blank environment entry counts as unset, the same way the provider chain treats a whitespace
 * key as missing. That makes `BRAVE_API_KEY="" braveApiKey: "…"` resolve to the config value, while
 * a real `BRAVE_API_KEY=…` always wins over the file.
 */
export function webSearchEnvWithConfig(
  config: WebSearchConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  for (const [name, value] of Object.entries(webSearchEnvFromConfig(config))) {
    const existing = merged[name];
    if (existing === undefined || existing.trim().length === 0) {
      merged[name] = value;
    }
  }
  return merged;
}
