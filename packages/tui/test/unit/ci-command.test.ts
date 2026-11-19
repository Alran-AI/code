import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerCiCommand, type CiCommandOptions } from "../../src/cli/ci-command.js";

let fixture: string;
let output: string;
let exitCode: number | undefined;

function createProgram(options: Partial<CiCommandOptions> = {}): Command {
  const program = new Command();
  program.exitOverride();
  registerCiCommand(program, {
    cwd: fixture,
    env: { PATH: process.env.PATH, HOME: process.env.HOME } as NodeJS.ProcessEnv,
    write: (text) => { output += text; },
    prompt: async (_question, fallback) => fallback ?? "",
    exit: (code) => { exitCode = code; },
    ...options,
  });
  return program;
}

async function run(args: string[], options: Partial<CiCommandOptions> = {}): Promise<void> {
  output = "";
  exitCode = undefined;
  await createProgram(options).parseAsync(["node", "alran", ...args]);
}

beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "alran-ci-cli-"));
  mkdirSync(path.join(fixture, ".github/workflows"), { recursive: true });
  writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    name: "fixture",
    scripts: { test: "node test.js", lint: "eslint .", build: "tsc" },
  }));
  writeFileSync(path.join(fixture, "test.js"), "console.log('ok');\n");
  writeFileSync(path.join(fixture, ".github/workflows/CI.yml"), "name: CI\n");
  // The committer identity is passed on the commit itself: CI runners have no global git identity.
  for (const args of [
    ["init"],
    ["add", "."],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "feat: fixture"],
    ["remote", "add", "origin", "https://github.com/ottili/fixture.git"],
  ]) {
    const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${result.stderr}`);
  }
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("alran ci CLI", () => {
  it("init --yes writes both files and prints secret instructions", async () => {
    await run(["ci", "init", "--yes"]);
    expect(output).toContain("Wrote .alran/ci.yml and .github/workflows/alran-ci-fix.yml");
    const config = readFileSync(path.join(fixture, ".alran/ci.yml"), "utf8");
    expect(config).toContain("version: 1");
    expect(config).toContain("max_attempts: 2");
    const workflow = readFileSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"), "utf8");
    expect(workflow).toContain("workflow_run:");
    expect(output).toContain("ALRAN_API_KEY");
  });

  it("init honors flags for mode, limits and workflows", async () => {
    await run([
      "ci", "init", "--yes",
      "--workflows", "CI,Rust",
      "--pull-request-mode", "fix-pr",
      "--main-mode", "comment-only",
      "--max-attempts", "3",
      "--test", "npm test",
      "--model", "gpt-x",
      "--base-url", "https://gw.example.test/v1",
    ]);
    const config = readFileSync(path.join(fixture, ".alran/ci.yml"), "utf8");
    expect(config).toContain("pull_request: fix-pr");
    expect(config).toContain("main: comment-only");
    expect(config).toContain("max_attempts: 3");
    expect(config).toContain("gpt-x");
    const workflow = readFileSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"), "utf8");
    expect(workflow).toContain('- "Rust"');
  });

  it("status reports the configuration and detection", async () => {
    await run(["ci", "status"]);
    expect(output).toContain("CI Fix is not set up yet");
    await run(["ci", "init", "--yes"]);
    await run(["ci", "status"]);
    expect(output).toContain("Repository: ");
    expect(output).toContain("Test: npm run test");
    expect(output).toContain("enabled: true");
    expect(output).toContain("Workflow installed: yes");
  });

  it("doctor checks the installation and reports failures", async () => {
    await run(["ci", "doctor"]);
    expect(output).toContain("gh-login");
    expect(output).toContain("api-key-secret");
    expect(output).toContain("workflow-permissions");
    expect(exitCode).toBe(1);
    await run(["ci", "init", "--yes"]);
    await run(["ci", "doctor"]);
    expect(output).toContain("monitored-workflows");
  });

  it("disable turns the fixer off and removes the workflow", async () => {
    await run(["ci", "init", "--yes"]);
    expect(existsSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"))).toBe(true);
    await run(["ci", "disable"]);
    expect(existsSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"))).toBe(false);
    const config = readFileSync(path.join(fixture, ".alran/ci.yml"), "utf8");
    expect(config).toContain("enabled: false");
  });

  it("fix --dry-run refuses without an API key and never touches history", async () => {
    await run(["ci", "init", "--yes"]);
    const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" });
    await expect(run(["ci", "fix", "--dry-run"])).rejects.toThrow(/ALRAN_API_KEY/);
    const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture, encoding: "utf8" });
    expect(headAfter).toBe(headBefore);
  });

  it("fix --dry-run without setup fails with a clear message", async () => {
    await expect(run(["ci", "fix", "--dry-run"])).rejects.toThrow(/alran ci init/);
  });
});