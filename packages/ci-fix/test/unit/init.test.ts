import { describe, expect, it } from "vitest";
import { buildSecretSetupInstructions, inspectCiFixConfig, planCiFixInit } from "../../src/init.js";
import { parseGitHubRemote } from "../../src/detect-repo.js";
import { CI_FIX_CONFIG_PATH, CI_FIX_WORKFLOW_PATH } from "../../src/config.js";

const repo = parseGitHubRemote("https://github.com/ottili/alran-code")!;

describe("init planner", () => {
  it("plans both files with the documented baseline", () => {
    const plan = planCiFixInit({ repo, workflows: ["CI"] });
    expect(plan.files.map((file) => file.path)).toEqual([CI_FIX_CONFIG_PATH, CI_FIX_WORKFLOW_PATH]);
    expect(plan.configYaml).toContain("version: 1");
    expect(plan.configYaml).toContain("workflows:");
    expect(plan.configYaml).toContain("- CI");
    expect(plan.workflowYaml).toContain("name: Alran CI Fix");
    expect(plan.secretName).toBe("ALRAN_API_KEY");
  });

  it("carries answers into the config", () => {
    const plan = planCiFixInit({
      repo,
      workflows: ["CI", "Rust"],
      pullRequestMode: "fix-pr",
      mainMode: "comment-only",
      limits: { max_attempts: 3, max_diff_lines: 120 },
      model: { base_url: "https://gw.example.test/v1", name: "gpt-x", api_key_secret: "MY_KEY" },
    });
    expect(plan.config.mode.pull_request).toBe("fix-pr");
    expect(plan.config.mode.main).toBe("comment-only");
    expect(plan.config.limits.max_attempts).toBe(3);
    expect(plan.config.limits.max_diff_lines).toBe(120);
    expect(plan.config.model.base_url).toBe("https://gw.example.test/v1");
    expect(plan.configYaml).toContain("MY_KEY");
    expect(plan.workflowYaml).toContain('- "Rust"');
  });

  it("inspects an existing config and reports problems", () => {
    expect(inspectCiFixConfig("version: 1\n").problems).toEqual([]);
    expect(inspectCiFixConfig("foo: [1, 2\n").problems.length).toBeGreaterThan(0);
  });
});

describe("secret setup instructions", () => {
  it("names the secret and the settings path when gh is not signed in", () => {
    const text = buildSecretSetupInstructions({ repo, ghAvailable: false });
    expect(text).toContain("ALRAN_API_KEY");
    expect(text).toContain("https://github.com/ottili/alran-code/settings/secrets/actions");
    expect(text).toContain("never written to the repository");
    expect(text).toContain("gh secret set");
  });

  it("still shows the gh command when signed in", () => {
    const text = buildSecretSetupInstructions({ repo, ghAvailable: true });
    expect(text).toContain("gh secret set ALRAN_API_KEY --repo ottili/alran-code");
  });
});
