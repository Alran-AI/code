import { describe, expect, it } from "vitest";
import {
  CI_FIX_CONFIG_PATH,
  DEFAULT_CI_FIX_CONFIG,
  parseCiFixConfig,
  renderCiFixConfig,
  isDeniedPath,
  matchesDenyPath,
} from "../../src/config.js";

describe("default fix model", () => {
  // The fixer passes `model.name` to `alran exec --model`. The id is the Ottili
  // AI Platform gateway id (docs/MODELS.md). The exec parser
  // (packages/tui/src/headless/model-selection.ts) maps a gateway id to the
  // first-party `alran` provider, so naming it here is what actually runs on the
  // platform -- not a local provider called `ottili`. This pins the id so a
  // future edit cannot silently swap it for the internal catalog key, which
  // would work but is a less readable value to carry in a repo config.
  it("uses the Ottili AI Platform gateway id", () => {
    expect(DEFAULT_CI_FIX_CONFIG.model.name).toBe("ottili/werk-1.1");
  });
});

describe("ci fix config parser", () => {
  it("falls back to the documented baseline on an empty document", () => {
    const { config, problems } = parseCiFixConfig("");
    expect(problems).toEqual([]);
    expect(config).toEqual(DEFAULT_CI_FIX_CONFIG);
  });

  it("reads the documented example config", () => {
    const { config, problems } = parseCiFixConfig(`
version: 1
trigger: { workflows: ["CI"] }
mode: { pull_request: push-to-branch, main: fix-pr }
limits: { max_attempts: 2, max_diff_lines: 300, timeout_minutes: 15, max_runs_per_day: 10 }
guards: { deny_paths: [".github/workflows/**"], forbid_test_weakening: true }
model: { base_url: "https://ai.ottili.one/v1", name: "ottili/werk-1.1", api_key_secret: "ALRAN_API_KEY" }
`);
    expect(problems).toEqual([]);
    expect(config.trigger.workflows).toEqual(["CI"]);
    expect(config.mode.pull_request).toBe("push-to-branch");
    expect(config.mode.main).toBe("fix-pr");
    expect(config.limits.max_attempts).toBe(2);
    expect(config.model.name).toBe("ottili/werk-1.1");
    expect(config.guards.deny_paths).toEqual([".github/workflows/**"]);
  });

  it("accepts every documented mode and rejects invented ones", () => {
    const pullRequest = parseCiFixConfig("mode: { pull_request: comment-only, main: comment-only }");
    expect(pullRequest.problems).toEqual([]);
    expect(pullRequest.config.mode.pull_request).toBe("comment-only");

    const bad = parseCiFixConfig("mode: { pull_request: force-push, main: deploy }");
    expect(bad.problems.map((problem) => problem.path)).toEqual([
      "mode.pull_request",
      "mode.main",
    ]);
    expect(bad.config.mode.pull_request).toBe("push-to-branch");
    expect(bad.config.mode.main).toBe("fix-pr");
  });

  it("clamps invalid limits back to the defaults and reports them", () => {
    const { config, problems } = parseCiFixConfig(
      "limits: { max_attempts: 0, max_diff_lines: -5, timeout_minutes: 0, max_runs_per_day: -1, max_tokens: 0 }",
    );
    expect(problems.map((problem) => problem.path)).toEqual([
      "limits.max_attempts",
      "limits.max_diff_lines",
      "limits.timeout_minutes",
      "limits.max_runs_per_day",
      "limits.max_tokens",
    ]);
    expect(config.limits).toEqual(DEFAULT_CI_FIX_CONFIG.limits);
  });

  it("rejects a wrong version and invalid YAML", () => {
    const version = parseCiFixConfig("version: 9");
    expect(version.problems.some((problem) => problem.path === "version")).toBe(true);
    expect(version.config.version).toBe(1);

    const broken = parseCiFixConfig(":::\n  - [");
    expect(broken.problems.some((problem) => problem.message.startsWith("invalid YAML"))).toBe(true);
  });

  it("ignores unknown keys instead of failing", () => {
    const { config, problems } = parseCiFixConfig("future_field: 42\nenabled: true");
    expect(problems).toEqual([]);
    expect(config.enabled).toBe(true);
  });

  it("renders and re-parses without drift", () => {
    const { config } = parseCiFixConfig("mode: { pull_request: fix-pr, main: push }");
    const roundTrip = parseCiFixConfig(renderCiFixConfig(config));
    expect(roundTrip.config).toEqual(config);
    expect(roundTrip.problems).toEqual([]);
    expect(CI_FIX_CONFIG_PATH).toBe(".alran/ci.yml");
  });

  it("keeps a custom base_url, model name and secret name", () => {
    const { config } = parseCiFixConfig(
      'model: { base_url: "https://gw.example.test/v1", name: "gpt-x", api_key_secret: "MY_KEY" }',
    );
    expect(config.model.base_url).toBe("https://gw.example.test/v1");
    expect(config.model.name).toBe("gpt-x");
    expect(config.model.api_key_secret).toBe("MY_KEY");
  });
});

describe("deny-path matching", () => {
  it("anchors patterns at the repository root", () => {
    expect(matchesDenyPath(".github/workflows/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matchesDenyPath(".github/workflows/**", "src/ci.yml")).toBe(false);
    expect(matchesDenyPath(".alran/ci.yml", ".alran/ci.yml")).toBe(true);
    expect(matchesDenyPath(".alran/ci.yml", ".alran/other.yml")).toBe(false);
  });

  it("matches single-segment globs inside any folder", () => {
    expect(matchesDenyPath("*.env", ".env")).toBe(true);
    expect(matchesDenyPath("*.env", "apps/web/.env")).toBe(true);
    expect(matchesDenyPath("*.env", ".env.local")).toBe(false);
    expect(matchesDenyPath("**/secrets/**", "a/secrets/b.json")).toBe(true);
    expect(matchesDenyPath("**/secrets/**", "secrets.json")).toBe(false);
  });

  it("protects the default paths", () => {
    expect(isDeniedPath(".github/workflows/ci.yml", DEFAULT_CI_FIX_CONFIG.guards.deny_paths)).toBe(
      true,
    );
    expect(isDeniedPath(".alran/ci.yml", DEFAULT_CI_FIX_CONFIG.guards.deny_paths)).toBe(true);
    expect(isDeniedPath(".env", DEFAULT_CI_FIX_CONFIG.guards.deny_paths)).toBe(true);
    expect(isDeniedPath("app/.env.production", DEFAULT_CI_FIX_CONFIG.guards.deny_paths)).toBe(true);
    expect(isDeniedPath("src/index.ts", DEFAULT_CI_FIX_CONFIG.guards.deny_paths)).toBe(false);
  });
});
