import { describe, expect, it, vi } from "vitest";
import { executeRetrigger } from "../../src/cli/ci-retrigger.js";

describe("executeRetrigger", () => {
  it("does nothing unless the plan asks for a dispatch", () => {
    const runGh = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    expect(executeRetrigger({ action: "push-with-token", reason: "x" }, ["CI"], "feat/x", runGh)).toEqual({
      executed: 0,
      failed: [],
    });
    expect(executeRetrigger({ action: "none", reason: "x" }, ["CI"], "feat/x", runGh)).toEqual({
      executed: 0,
      failed: [],
    });
    expect(runGh).not.toHaveBeenCalled();
  });

  it("dispatches every monitored workflow on the fix branch", () => {
    const runGh = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = executeRetrigger({ action: "workflow-dispatch", reason: "fallback" }, ["CI", "Rust"], "feat/x", runGh);
    expect(result).toEqual({ executed: 2, failed: [] });
    expect(runGh.mock.calls.map((call) => call[0])).toEqual([
      ["workflow", "run", "CI", "--ref", "feat/x"],
      ["workflow", "run", "Rust", "--ref", "feat/x"],
    ]);
  });

  it("reports workflows that failed to dispatch", () => {
    const runGh = vi.fn((args: readonly string[]) =>
      args[2] === "CI" ? { status: 0, stdout: "", stderr: "" } : { status: 1, stdout: "", stderr: "boom" },
    );
    const result = executeRetrigger({ action: "workflow-dispatch", reason: "fallback" }, ["CI", "Rust"], "main", runGh);
    expect(result.executed).toBe(1);
    expect(result.failed).toEqual(["Rust: boom"]);
  });
});