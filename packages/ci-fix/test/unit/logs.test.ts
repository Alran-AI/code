import { describe, expect, it } from "vitest";
import { maskCiLog, maskSecrets, maskSecretAssignments, truncateLog } from "../../src/logs.js";

const LONG_LOG = Array.from({ length: 600 }, (_, index) => `line ${index}`).join("\n");

describe("log truncation", () => {
  it("keeps small logs untouched", () => {
    const result = truncateLog("short log");
    expect(result.text).toBe("short log");
    expect(result.truncated).toBe(false);
    expect(result.droppedLines).toBe(0);
  });

  it("keeps head and tail with a visible omission marker", () => {
    const result = truncateLog(LONG_LOG, { maxLines: 100, headLines: 20, tailLines: 10 });
    expect(result.truncated).toBe(true);
    expect(result.droppedLines).toBe(570);
    expect(result.text).toContain("line 0");
    expect(result.text).toContain("line 19");
    expect(result.text).toContain("line 599");
    expect(result.text).toContain("570 log lines omitted");
    expect(result.text).not.toContain("line 300");
  });

  it("also caps total characters", () => {
    const result = truncateLog("x".repeat(10_000), { maxChars: 100 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(150);
    expect(result.droppedChars).toBeGreaterThan(0);
  });
});

describe("secret masking", () => {
  it("replaces known secret values", () => {
    const masked = maskSecrets("token sk_live_abcdef123456 leaked", ["sk_live_abcdef123456"]);
    expect(masked).toBe("token *** leaked");
    expect(masked).not.toContain("sk_live");
  });

  it("ignores values too short to be secrets", () => {
    expect(maskSecrets("a=ab", ["ab"])).toBe("a=ab");
  });

  it("masks NAME=value assignments for secret names", () => {
    expect(maskSecretAssignments("ALRAN_API_KEY=abc123xyz", ["ALRAN_API_KEY"])).toBe(
      "ALRAN_API_KEY=***",
    );
    expect(maskSecretAssignments("export GITHUB_TOKEN=ghp_x", ["GITHUB_TOKEN"])).toBe(
      "export GITHUB_TOKEN=***",
    );
  });

  it("combines values and names in one pass", () => {
    const input = "key=supersecretvalue\nALRAN_API_KEY=supersecretvalue";
    const masked = maskCiLog(input, { values: ["supersecretvalue"], names: ["ALRAN_API_KEY"] });
    expect(masked).not.toContain("supersecretvalue");
    expect(masked).toContain("***");
  });
});
