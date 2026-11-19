import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_BUILTIN_SKILL_IDS } from "@alran/config";
import { resolveFeatureAwareBuiltinSkillNames } from "../../src/agent/feature-owned-skills.js";

const assetsDir = fileURLToPath(new URL("../../assets/skills/", import.meta.url));

const withTools = (tools: ("bash" | "read" | "write" | "edit")[], skills?: ("ci-fixer" | "code-review")[]) => ({
  persona: { enabled: true },
  tools,
  builtinTools: undefined,
  skills,
  features: { alran: false, delegation: false, webSearch: false },
});

describe("ci-fixer builtin skill", () => {
  it("is a standalone builtin skill id", () => {
    expect(AGENT_BUILTIN_SKILL_IDS).toContain("ci-fixer");
  });

  it("ships a SKILL.md with matching frontmatter and the setup commands", () => {
    const file = path.join(assetsDir, "ci-fixer", "SKILL.md");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(/^---\r?\nname: ci-fixer\r?\n/u);
    expect(text).toContain("alran ci init");
    expect(text).toContain("alran ci doctor");
    expect(text).toContain("alran ci fix --dry-run");
    expect(text).toContain("ALRAN_API_KEY");
    expect(text).toContain("Never commit secrets");
  });

  it("is enabled when bash is available", () => {
    const names = resolveFeatureAwareBuiltinSkillNames(withTools(["bash"]), { cuModeActive: false });
    expect(names).toContain("ci-fixer");
  });

  it("can be disabled through the skills capability list", () => {
    const names = resolveFeatureAwareBuiltinSkillNames(withTools(["bash"], ["code-review"]), {
      cuModeActive: false,
    });
    expect(names).not.toContain("ci-fixer");
  });
});