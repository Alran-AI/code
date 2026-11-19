import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCiFix } from "../../src/fixer.js";
import { planCiFixInit } from "../../src/init.js";
import { parseGitHubRemote } from "../../src/detect-repo.js";
import { DEFAULT_CI_FIX_CONFIG, CI_FIX_MARKER } from "../../src/config.js";
import type { CiFixPorts } from "../../src/ports.js";

/**
 * Integration tests against a real fixture repository on disk. All GitHub
 * behavior is faked through ports: nothing here touches the network, the
 * gh CLI or a real remote. Git itself runs for real, so commit behavior is
 * what users will see.
 */

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "alran-ci-fix-fixture-"));
  mkdirSync(path.join(fixture, ".github/workflows"), { recursive: true });
  writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    name: "fixture",
    scripts: { test: "node test.js" },
  }));
  writeFileSync(path.join(fixture, "test.js"), "throw new Error('broken');\n");
  writeFileSync(
    path.join(fixture, ".github/workflows/CI.yml"),
    "name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n",
  );
  const repo = parseGitHubRemote("https://github.com/ottili/fixture")!;
  const plan = planCiFixInit({ repo, workflows: ["CI"] });
  for (const file of plan.files) {
    const target = path.join(fixture, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  // The committer identity is passed on every commit: CI runners have no global git identity.
  for (const args of [
    ["init"],
    ["add", "."],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "feat: fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${result.stderr}`);
  }
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function git(args: readonly string[]): string {
  const identity = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test"];
  return execFileSync("git", [...identity, ...args], { cwd: fixture, encoding: "utf8" });
}

function fakePorts(overrides: Partial<CiFixPorts> = {}): CiFixPorts {
  let calls = 0;
  return {
    exec: (() => {
      calls += 1;
      // First call reproduces the failure, later calls pass: the "fix" works.
      return Promise.resolve({ code: calls === 1 ? 1 : 0, stdout: "", stderr: calls === 1 ? "boom" : "" });
    }) as CiFixPorts["exec"],
    agent: vi.fn((() =>
      Promise.resolve({
        ok: true,
        diff: [
          "diff --git a/test.js b/test.js",
          "--- a/test.js",
          "+++ b/test.js",
          "@@ -1 +1 @@",
          "-throw new Error('broken');",
          "+console.log('ok');",
        ].join("\n"),
        tokensUsed: 42,
        costUsd: 0.001,
      })) as unknown as CiFixPorts["agent"]),
    git: {
      headMessage: (() => Promise.resolve(git(["log", "-1", "--pretty=%B"]))) as CiFixPorts["git"]["headMessage"],
      commitChain: ((limit: number) =>
        Promise.resolve(
          git(["log", `-${limit}`, "--pretty=%B%x00"])
            .split("\0")
            .filter((message) => message.trim() !== ""),
        )) as CiFixPorts["git"]["commitChain"],
      diff: (() => Promise.resolve(git(["diff"]))) as CiFixPorts["git"]["diff"],
      commit: vi.fn((subject: string, body: string) => {
        writeFileSync(path.join(fixture, ".git-ci-fix-subject"), `${subject}\n${body}`);
        return Promise.resolve(git(["commit", "--allow-empty", "-m", subject, "-m", body]));
      }) as unknown as CiFixPorts["git"]["commit"],
      createBranch: ((name: string) => Promise.resolve(git(["checkout", "-b", name]))) as CiFixPorts["git"]["createBranch"],
      push: vi.fn(async () => undefined),
      createPullRequest: vi.fn(async () => 12),
      pullRequestNumberForHead: vi.fn(async () => undefined),
      changedFiles: (() => Promise.resolve(["test.js"])) as CiFixPorts["git"]["changedFiles"],
    },
    report: { comment: vi.fn(async () => undefined) },
    rateLimit: { runsToday: vi.fn(async () => 0) },
    ...overrides,
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    config: DEFAULT_CI_FIX_CONFIG,
    repo: parseGitHubRemote("https://github.com/ottili/fixture")!,
    headRepository: "ottili/fixture",
    branch: "feat/fixture",
    headSha: "0000000000000000000000000000000000000000",
    pullRequestNumber: 3,
    baseBranchKind: "pull_request" as const,
    failingCommand: "node test.js",
    failedLogExcerpt: "Error: broken\nat test.js:1:7",
    workspaceDir: fixture,
    apiKey: "test-key",
    ...overrides,
  } as Parameters<typeof runCiFix>[0];
}

describe("fix flow against a fixture repository", () => {
  it("reproduces, fixes, verifies and commits with the marker", async () => {
    const ports = fakePorts();
    const outcome = await runCiFix(makeRequest(), ports);
    expect(outcome.status).toBe("fixed");
    expect(outcome.committed).toBe(true);
    expect(ports.git.commit).toHaveBeenCalledTimes(1);
    const [subject, body] = ports.git.commit.mock.calls[0];
    expect(subject).toMatch(/^fix\(ci\): /);
    expect(body).toContain(CI_FIX_MARKER);
    expect(ports.git.push).toHaveBeenCalledTimes(1);
    expect(ports.report.comment).toHaveBeenCalledTimes(1);
    expect(ports.report.comment.mock.calls[0][1]).toContain("What was red");
    expect(git(["log", "-1", "--pretty=%B"])).toContain(CI_FIX_MARKER);
  });

  it("dry-run leaves the repository untouched", async () => {
    const headBefore = git(["rev-parse", "HEAD"]);
    const ports = fakePorts();
    const outcome = await runCiFix(makeRequest({ dryRun: true }), ports);
    expect(outcome.status).toBe("fixed");
    expect(outcome.diff).toContain("test.js");
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(ports.git.push).not.toHaveBeenCalled();
    expect(ports.git.createPullRequest).not.toHaveBeenCalled();
    expect(ports.report.comment).not.toHaveBeenCalled();
    expect(git(["rev-parse", "HEAD"])).toBe(headBefore);
    expect(outcome.comment).toContain("Dry run");
  });

  it("refuses a weakening fix even when the agent claims success", async () => {
    const weakening = [
      "diff --git a/test.js b/test.js",
      "--- a/test.js",
      "+++ b/test.js",
      "@@ -1 +1 @@",
      "-throw new Error('broken');",
      "+it.skip('broken', () => {});",
    ].join("\n");
    const ports = fakePorts({
      agent: (() => Promise.resolve({ ok: true, diff: weakening, tokensUsed: 3 })) as CiFixPorts["agent"],
    });
    const outcome = await runCiFix(makeRequest(), ports);
    expect(outcome.status).toBe("blocked");
    expect(ports.git.commit).not.toHaveBeenCalled();
    expect(ports.git.push).not.toHaveBeenCalled();
    expect(outcome.comment).toContain("Why this was not committed");
    expect(git(["log", "-1", "--pretty=%B"])).not.toContain(CI_FIX_MARKER);
  });

  it("counts prior fix attempts across the real commit chain", async () => {
    git(["commit", "--allow-empty", "-m", "fix(ci): earlier", "-m", `${CI_FIX_MARKER} automated`]);
    git(["commit", "--allow-empty", "-m", "feat: later change"]);
    const ports = fakePorts();
    const outcome = await runCiFix(
      makeRequest({
        config: { ...DEFAULT_CI_FIX_CONFIG, limits: { ...DEFAULT_CI_FIX_CONFIG.limits, max_attempts: 1 } },
      }),
      ports,
    );
    expect(outcome.status).toBe("skipped");
    expect(outcome.reasons[0]).toContain("budget exhausted");
    expect(ports.agent).not.toHaveBeenCalled();
  });
});
