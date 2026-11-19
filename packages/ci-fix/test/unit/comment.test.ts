import { describe, expect, it } from "vitest";
import { buildCiFixComment } from "../../src/comment.js";

const base = {
  status: "fixed" as const,
  repo: "ottili/alran-code",
  branch: "feat/ci-fixer",
  headSha: "abcdef1234567890",
  pullRequestNumber: 5,
  failingCommand: "npm test",
  summary: "the command failed and passed again after 1 file(s) changed",
  changedFiles: ["src/add.ts"],
  diffLines: 2,
  attempts: 1,
  maxAttempts: 2,
  tokensUsed: 1234,
  costUsd: 0.0123,
  mode: "push-to-branch",
  dryRun: false,
};

describe("comment builder", () => {
  it("documents a fixed run end to end", () => {
    const comment = buildCiFixComment(base);
    expect(comment).toContain("Alran CI Fix — fixed");
    expect(comment).toContain("ottili/alran-code");
    expect(comment).toContain("`npm test`");
    expect(comment).toContain("src/add.ts");
    expect(comment).toContain("2 changed lines");
    expect(comment).toContain("1 of 2");
    expect(comment).toContain("1,234");
    expect(comment).toContain("$0.0123");
  });

  it("lists guard violations with reasons", () => {
    const comment = buildCiFixComment({
      ...base,
      status: "blocked",
      violations: ["src/add.test.ts:12: adds a skip/only marker (it.skip)"],
      changedFiles: [],
    });
    expect(comment).toContain("Why this was not committed");
    expect(comment).toContain("skip/only marker");
  });

  it("explains skipped runs and dry runs", () => {
    expect(buildCiFixComment({ ...base, status: "skipped", reason: "fork" })).toContain("fork");
    expect(buildCiFixComment({ ...base, dryRun: true })).toContain(
      "nothing was committed, pushed or posted",
    );
    expect(buildCiFixComment({ ...base, changedFiles: [] })).toContain("No files were changed.");
  });
});
