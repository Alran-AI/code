import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Component } from "../../../../../src/tui/rendering/component.js";
import { CiFlow } from "../../../../../src/tui/features/ci/ci-flow.js";

let fixture: string;
let notices: string[];
let panel: Component | undefined;

beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "alran-ci-flow-"));
  notices = [];
  panel = undefined;
  mkdirSync(path.join(fixture, ".github/workflows"), { recursive: true });
  writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node test.js" } }));
  writeFileSync(path.join(fixture, "test.js"), "console.log('ok');\n");
  writeFileSync(path.join(fixture, ".github/workflows/CI.yml"), "name: CI\n");
  for (const args of [
    ["init"],
    ["add", "."],
    ["-c", "user.name", "Fixture"],
    ["-c", "user.email", "fixture@example.test"],
    ["commit", "-m", "feat: fixture"],
    ["remote", "add", "origin", "https://github.com/ottili/fixture.git"],
  ]) {
    spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
  }
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function createFlow(): CiFlow {
  return new CiFlow({
    workspaceDir: fixture,
    appendNotice: (content) => { notices.push(content); },
    showPanel: (shown) => { panel = shown; },
    closePanel: () => true,
    requestRender: () => undefined,
  });
}

function press(...keys: string[]): void {
  const handle = (panel as unknown as { handleInput(data: string): void }).handleInput.bind(panel);
  for (const key of keys) handle(key);
}

describe("CiFlow", () => {
  it("opens the wizard and installs the files on completion", async () => {
    const flow = createFlow();
    await flow.show("init");
    expect(panel).toBeDefined();
    expect(notices.join("\n")).toContain("CI Fix setup for ottili/fixture");
    press("\r", "\r", "\r", "\r", "\r"); // accept all defaults
    expect(existsSync(path.join(fixture, ".alran/ci.yml"))).toBe(true);
    expect(existsSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"))).toBe(true);
    expect(notices.join("\n")).toContain("Wrote .alran/ci.yml");
  });

  it("status reports the installation", async () => {
    const flow = createFlow();
    await flow.show("init");
    press("\r", "\r", "\r", "\r", "\r");
    notices = [];
    await flow.show("status");
    const text = notices.join("\n");
    expect(text).toContain("Repository: ottili/fixture");
    expect(text).toContain("enabled: true");
    expect(text).toContain("Test: npm run test");
  });

  it("disable removes the workflow and flips the config", async () => {
    const flow = createFlow();
    await flow.show("init");
    press("\r", "\r", "\r", "\r", "\r");
    await flow.show("disable");
    expect(existsSync(path.join(fixture, ".github/workflows/alran-ci-fix.yml"))).toBe(false);
    expect(readFileSync(path.join(fixture, ".alran/ci.yml"), "utf8")).toContain("enabled: false");
  });

  it("reports an error notice for a non-GitHub repository", async () => {
    rmSync(path.join(fixture, ".git"), { recursive: true, force: true });
    const flow = createFlow();
    await flow.show("status");
    expect(notices.join("\n")).toContain("not a GitHub repository");
  });
});