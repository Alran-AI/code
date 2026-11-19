import { describe, expect, it, vi } from "vitest";
import { runCiFix, countDiffLines, changedFilesFromDiff, planRetrigger } from "../../src/fixer.js";
import { DEFAULT_CI_FIX_CONFIG, CI_FIX_MARKER } from "../../src/config.js";
import { parseGitHubRemote } from "../../src/detect-repo.js";
import type { CiFixPorts, CiFixRequest } from "../../src/ports.js";

const repo = parseGitHubRemote("https://github.com/ottili/alran-code")!;

const GOOD_DIFF = [
  "diff --git a/src/add.ts b/src/add.ts",
  "--- a/src/add.ts",
  "+++ b/src/add.ts",
  "@@ -1,3 +1,3 @@",
  "-  return a - b;",
  "+  return a + b;",
].join("\n");

function createPorts(overrides: Partial<CiFixPorts> = {}): CiFixPorts {
  let execCalls = 0;
  return {
    // First call reproduces the failure; the verification call passes, so a
    // correct fix reaches the commit step.
    exec: vi.fn(async () => {
      execCalls += 1;
      return execCalls === 1
        ? { code: 1, stdout: "", stderr: "boom" }
        : { code: 0, stdout: "ok", stderr: "" };
    }),
    agent: vi.fn(async () => ({ ok: true, diff: GOOD_DIFF, tokensUsed: 100 })),
    git: {
      headMessage: vi.fn(async () => "feat: feature"),
      commitChain: vi.fn(async () => ["feat: feature"]),
      diff: vi.fn(async () => GOOD_DIFF),
      commit: vi.fn(async () => undefined),
      createBranch: vi.fn(async () => undefined),
      push: vi.fn(async () => undefined),
      createPullRequest: vi.fn(async () => 7),
      pullRequestNumberForHead: vi.fn(async () => undefined),
      changedFiles: vi.fn(async () => ["src/add.ts"]),
    },
    report: { comment: vi.fn(async () => undefined) },
    rateLimit: { runsToday: vi.fn(async () => 0) },
    ...overrides,
  };
}

function createRequest(overrides: Partial<CiFixRequest> = {}): CiFixRequest {
  return {
    config: DEFAULT_CI_FIX_CONFIG,
    repo,
    headRepository: "ottili/alran-code",
    branch: "feat/x",
    headSha: "abc123",
    pullRequestNumber: 5,
    baseBranchKind: "pull_request",
    failingCommand: "npm test",
    failedLogExcerpt: "Error: expected 3 received 4\nsk_live_deadbeef1234",
    workspaceDir: "/tmp/fixture",
    apiKey: "test-key",
    ...overrides,
  };
}

describe("runCiFix security gates", () => {
  it("refuses forks before doing any work", async () => {
    const ports = createPorts();
    const outcome = await runCiFix(
      createRequest({ headRepository: "someone/alran-code" }),
      ports,
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasons[0]).toContain("fork");
    expect(ports.exec).not.toHaveBeenCalled();
    expect(ports.agent).not.toHaveBeenCalled();
    expect(ports.git.commit).not.toHaveBeenCalled();
  });

  it("refuses to run on top of a fix commit", async () => {
    const ports = createPorts({
      git: {
        ...createPorts().git,
        headMessage: vi.fn(async () => `fix(ci): earlier\n\n${CI_FIX_MARKER}`),
      },
    });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasons[0]).toContain(CI_FIX_MARKER);
  });

  it("refuses when the chain spent its attempts", async () => {
    const ports = createPorts({
      git: {
        ...createPorts().git,
        commitChain: vi.fn(async () => [
          `fix(ci): second\n\n${CI_FIX_MARKER}`,
          `fix(ci): first\n\n${CI_FIX_MARKER}`,
        ]),
      },
    });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasons[0]).toContain("budget exhausted");
  });

  it("refuses when the daily run budget is spent", async () => {
    const ports = createPorts({ rateLimit: { runsToday: vi.fn(async () => 10) } });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasons[0]).toContain("daily limit");
  });

  it("reports no-change when the command passes locally", async () => {
    const ports = createPorts({ exec: vi.fn(async () => ({ code: 0, stdout: "ok", stderr: "" })) });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("no-change");
    expect(ports.agent).not.toHaveBeenCalled();
  });
});

describe("runCiFix core flow", () => {
  it("commits and pushes only after verification turns green", async () => {
    const ports = createPorts();
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("fixed");
    expect(ports.exec).toHaveBeenCalledTimes(2); // reproduce + verify
    expect(ports.git.commit).toHaveBeenCalledTimes(1);
    const [subject, body] = ports.git.commit.mock.calls[0];
    expect(subject).toMatch(/^fix\(ci\): /);
    expect(body).toContain(CI_FIX_MARKER);
    expect(ports.git.push).toHaveBeenCalledTimes(1);
    expect(ports.report.comment).toHaveBeenCalledTimes(1);
    expect(outcome.comment).toContain("What was red");
    expect(outcome.committed).toBe(true);
  });

  it("blocks a fix whose diff trips the guard and explains it in a comment", async () => {
    const weakening = [
      "diff --git a/src/add.test.ts b/src/add.test.ts",
      "--- a/src/add.test.ts",
      "+++ b/src/add.test.ts",
      "@@ -1,3 +1,3 @@",
      "-test('adds', () => {});",
      "+it.skip('adds', () => {});",
    ].join("\n");
    const ports = createPorts({ agent: vi.fn(async () => ({ ok: true, diff: weakening, tokensUsed: 5 })) });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("blocked");
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(ports.git.push).not.toHaveBeenCalled();
    expect(ports.report.comment).toHaveBeenCalledTimes(1);
    expect(outcome.comment).toContain("Why this was not committed");
    expect(outcome.violations.length).toBeGreaterThan(0);
  });

  it("blocks a fix that blows the token budget", async () => {
    const ports = createPorts({
      agent: vi.fn(async () => ({ ok: true, diff: GOOD_DIFF, tokensUsed: 5_000 })),
    });
    const outcome = await runCiFix(
      createRequest({ config: { ...DEFAULT_CI_FIX_CONFIG, limits: { ...DEFAULT_CI_FIX_CONFIG.limits, max_tokens: 1_000 } } }),
      ports,
    );
    expect(outcome.status).toBe("blocked");
    expect(outcome.reasons[0]).toContain("token budget exceeded");
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(outcome.comment).toContain("token budget exceeded");
  });

  it("blocks oversized diffs", async () => {
    const ports = createPorts();
    const outcome = await runCiFix(
      createRequest({ config: { ...DEFAULT_CI_FIX_CONFIG, limits: { ...DEFAULT_CI_FIX_CONFIG.limits, max_diff_lines: 1 } } }),
      ports,
    );
    expect(outcome.status).toBe("blocked");
    expect(outcome.reasons[0]).toContain("diff too large");
    expect(ports.git.commit).not.toHaveBeenCalled();
  });

  it("never commits when verification stays red", async () => {
    // Both reproduce and verify exit 1, so the run must stop before any commit.
    const ports = createPorts({
      exec: vi.fn(async () => ({ code: 1, stdout: "", stderr: "still red" })),
    });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("failed");
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(outcome.comment).toContain("verification failed");
  });

  it("reports agent failures", async () => {
    const ports = createPorts({
      agent: vi.fn(async () => ({ ok: false, diff: "", tokensUsed: 0, error: "model 500" })),
    });
    const outcome = await runCiFix(createRequest(), ports);
    expect(outcome.status).toBe("failed");
    expect(outcome.reasons[0]).toContain("model 500");
  });

  it("comment-only mode verifies but never commits", async () => {
    const ports = createPorts();
    const outcome = await runCiFix(
      createRequest({ config: { ...DEFAULT_CI_FIX_CONFIG, mode: { ...DEFAULT_CI_FIX_CONFIG.mode, pull_request: "comment-only" } } }),
      ports,
    );
    expect(outcome.status).toBe("fixed");
    expect(outcome.committed).toBe(false);
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(ports.git.push).not.toHaveBeenCalled();
    expect(ports.report.comment).toHaveBeenCalledTimes(1);
  });

  it("dry runs show the diff but never commit, push or comment", async () => {
    const ports = createPorts();
    const outcome = await runCiFix(createRequest({ dryRun: true }), ports);
    expect(outcome.status).toBe("fixed");
    expect(outcome.dryRun).toBe(true);
    expect(outcome.diff).toBe(GOOD_DIFF);
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(ports.git.push).not.toHaveBeenCalled();
    expect(ports.git.createPullRequest).not.toHaveBeenCalled();
    expect(ports.report.comment).not.toHaveBeenCalled();
    expect(outcome.comment).toContain("Dry run");
  });

  it("masks secrets before the log reaches the model prompt", async () => {
    const ports = createPorts();
    await runCiFix(createRequest(), ports);
    const request = ports.agent.mock.calls[0][0];
    expect(request.userPrompt).not.toContain("sk_live_deadbeef1234");
    expect(request.userPrompt).toContain("***");
    expect(request.allowedToolIntent).toEqual(["read files", "edit files", "run project commands"]);
    expect(request.maxTokens).toBe(DEFAULT_CI_FIX_CONFIG.limits.max_tokens);
    expect(request.timeoutMs).toBe(DEFAULT_CI_FIX_CONFIG.limits.timeout_minutes * 60_000);
  });
});

describe("retrigger planning and diff helpers", () => {
  it("prefers a token push, falls back to dispatch, and stays silent without a commit", () => {
    expect(planRetrigger({ committed: true, pushTokenAvailable: true, mode: "push-to-branch" }).action).toBe(
      "push-with-token",
    );
    expect(planRetrigger({ committed: true, pushTokenAvailable: false, mode: "fix-pr" }).action).toBe(
      "workflow-dispatch",
    );
    expect(planRetrigger({ committed: false, pushTokenAvailable: true, mode: "fix-pr" }).action).toBe(
      "none",
    );
  });

  it("counts changed lines and lists changed files", () => {
    expect(countDiffLines(GOOD_DIFF)).toBe(2);
    expect(changedFilesFromDiff(GOOD_DIFF)).toEqual(["src/add.ts"]);
    expect(changedFilesFromDiff("")).toEqual([]);
  });
});
