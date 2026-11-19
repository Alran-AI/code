import { describe, expect, it } from "vitest";
import { guardFixDiff, parseUnifiedDiff } from "../../src/diff-guard.js";
import { DEFAULT_CI_FIX_CONFIG } from "../../src/config.js";

function buildDiff(
  file: string,
  added: string[] = [],
  removed: string[] = [],
  options: { deleted?: boolean } = {},
): string {
  const lines = [
    `diff --git a/${file} b/${file}`,
    ...(options.deleted ? ["deleted file mode 100644"] : []),
    `--- a/${file}`,
    options.deleted ? "+++ /dev/null" : `+++ b/${file}`,
    "@@ -1,3 +1,3 @@",
    ...removed.map((text) => `-${text}`),
    ...added.map((text) => `+${text}`),
  ];
  return `${lines.join("\n")}\n`;
}

function guard(diff: string, overrides: { forbidTestWeakening?: boolean } = {}) {
  return guardFixDiff({
    diff,
    denyPaths: DEFAULT_CI_FIX_CONFIG.guards.deny_paths,
    forbidTestWeakening: overrides.forbidTestWeakening ?? true,
  });
}

describe("diff guard", () => {
  it("passes a clean minimal fix", () => {
    const result = guard(
      buildDiff("src/add.ts", ["  return a + b;"], ["  return a - b;"]),
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes context-only and empty diffs", () => {
    expect(guard("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n context\n").ok).toBe(
      true,
    );
    expect(guard("").ok).toBe(true);
  });

  it("blocks every edit to a protected path", () => {
    const workflow = guard(buildDiff(".github/workflows/ci.yml", ["- run: npm test"]));
    expect(workflow.violations[0].code).toBe("denied-path");
    expect(guard(buildDiff(".alran/ci.yml", ["+ limits: {}"])).violations[0].code).toBe(
      "denied-path",
    );
    expect(guard(buildDiff(".env", ["+ SECRET=1"])).violations[0].code).toBe("denied-path");
    expect(guard(buildDiff("apps/web/.env.local", ["+ SECRET=1"])).violations[0].code).toBe(
      "denied-path",
    );
    expect(guard(buildDiff("deploy/secrets/prod.json", ["+ {}"])).violations[0].code).toBe(
      "denied-path",
    );
  });

  it("blocks deleted test files", () => {
    const result = guard(buildDiff("src/add.test.ts", [], [], { deleted: true }));
    expect(result.violations.map((v) => v.code)).toEqual(["test-file-deleted"]);
  });

  it("allows deleting a non-test file", () => {
    expect(guard(buildDiff("src/old-helper.ts", [], [], { deleted: true })).ok).toBe(true);
  });

  it("blocks removed test definitions", () => {
    const result = guard(
      buildDiff(
        "src/add.test.ts",
        ["  // TODO"],
        ['test("adds numbers", () => {', "  expect(add(1, 2)).toBe(3);", "});"],
      ),
    );
    expect(result.violations.some((v) => v.code === "test-removed")).toBe(true);
  });

  it("allows a test that is edited, not removed", () => {
    const result = guard(
      buildDiff(
        "src/add.test.ts",
        ['test("adds numbers", () => {', "  expect(add(1, 2)).toBe(4);", "});"],
        ['test("adds numbers", () => {', "  expect(add(1, 2)).toBe(3);", "});"],
      ),
    );
    expect(result.violations.filter((v) => v.code === "test-removed")).toEqual([]);
  });

  it("blocks every skip or focus marker", () => {
    const markers = [
      "it.skip('adds', () => {}",
      "describe.skip('math', () => {}",
      "xit('adds', () => {}",
      "xdescribe('math', () => {}",
      "fdescribe('math', () => {}",
      "fit('adds', () => {}",
      "@pytest.mark.skip",
      "@pytest.mark.skipif(sys.version_info < (3, 8))",
      "@Ignore",
      "QSKIP('broken')",
      "pytest.skip('later')",
      "skipTest('later')",
      "@Test(enabled = false)",
      "test.skip('adds', () => {}",
    ];
    for (const marker of markers) {
      const result = guard(buildDiff("src/add.test.ts", [marker], []));
      expect(result.violations.some((v) => v.code === "test-weakened"), marker).toBe(true);
    }
  });

  it("blocks assertions that vanish inside a hunk", () => {
    const result = guard(
      buildDiff(
        "src/add.ts",
        ["  return a + b;"],
        ["  expect(result).toBe(3);"],
      ),
    );
    expect(result.violations.some((v) => v.code === "assertion-removed")).toBe(true);
  });

  it("allows an assertion replaced inside the same hunk", () => {
    const result = guard(
      buildDiff(
        "src/add.ts",
        ["  expect(result).toBe(4);"],
        ["  expect(result).toBe(3);"],
      ),
    );
    expect(result.violations.filter((v) => v.code === "assertion-removed")).toEqual([]);
  });

  it("blocks assertions that can never fail", () => {
    expect(guard(buildDiff("src/add.test.ts", ["  expect(true).toBe(true);"], [])).violations.some(
      (v) => v.code === "trivial-assertion",
    )).toBe(true);
    expect(guard(buildDiff("src/add.test.ts", ["  assert(true);"], [])).violations.some(
      (v) => v.code === "trivial-assertion",
    )).toBe(true);
  });

  it("blocks lowered coverage and lint thresholds", () => {
    const lowered = guard(
      buildDiff(
        "vitest.config.ts",
        ["  lines: 60,"],
        ["  lines: 90,"],
      ),
    );
    expect(lowered.violations.some((v) => v.code === "coverage-threshold-lowered")).toBe(true);
    expect(
      guard(buildDiff("config.yaml", ["  threshold: 85"], ["  threshold: 90"])).violations.some(
        (v) => v.code === "coverage-threshold-lowered",
      ),
    ).toBe(true);
    const raised = guard(buildDiff("vitest.config.ts", ["  lines: 95,"], ["  lines: 90,"]));
    expect(raised.ok).toBe(true);
  });

  it("blocks dropped coverage collection", () => {
    const result = guard(buildDiff("package.json", ['    "test": "jest"'], ['    "test": "jest --coverage"']));
    expect(result.violations.some((v) => v.code === "coverage-threshold-lowered")).toBe(true);
  });

  it("blocks disabled or bypassed checks", () => {
    const disableLines = [
      "      continue-on-error: true",
      "    if: false",
      "  npm test || true",
      "  ; true",
      "  set +e",
      "  exit 0",
      "  mvn verify -DskipTests",
      '  test: "echo ok"',
      '  "test": ""',
      "  cargo build --no-verify",
    ];
    for (const line of disableLines) {
      const result = guard(buildDiff("package.json", [line], []));
      expect(result.violations.some((v) => v.code === "check-disabled"), line).toBe(true);
    }
  });

  it("still protects paths when test weakening is switched off", () => {
    const relaxed = guard(buildDiff(".github/workflows/ci.yml", ["+ run: true"]), {
      forbidTestWeakening: false,
    });
    expect(relaxed.violations[0].code).toBe("denied-path");
    expect(guard(buildDiff("src/add.test.ts", ["it.skip('x', () => {})"], []), {
      forbidTestWeakening: false,
    }).ok).toBe(true);
  });

  it("collects violations from every file in one diff", () => {
    const combined = [
      buildDiff(".github/workflows/ci.yml", ["+ run: true"], []),
      buildDiff("src/add.test.ts", ["it.skip('x', () => {})"], []),
    ].join("\n");
    const result = guard(combined);
    expect(new Set(result.violations.map((v) => v.file))).toEqual(
      new Set([".github/workflows/ci.yml", "src/add.test.ts"]),
    );
  });

  it("blocks renames out of protected paths and deletions of protected files", () => {
    const renamed = [
      "diff --git a/.github/workflows/ci.yml b/docs/ci.yml",
      "similarity index 90%",
      "rename from .github/workflows/ci.yml",
      "rename to docs/ci.yml",
    ].join("\n");
    expect(guard(renamed).violations[0].code).toBe("denied-path");

    const deletedSecret = [
      "diff --git a/.env b/.env",
      "deleted file mode 100644",
      "--- a/.env",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-SECRET=1",
    ].join("\n");
    expect(guard(deletedSecret).violations[0].code).toBe("denied-path");
  });

  it("records line numbers for added lines", () => {
    const parsed = parseUnifiedDiff(buildDiff("src/a.ts", ["+ it.skip('x', () => {})"], []));
    expect(parsed[0].hunks[0].added[0].line).toBe(1);
  });
});
