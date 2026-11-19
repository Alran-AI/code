import { describe, expect, it, vi } from "vitest";
import { CiWizard, type CiWizardAnswers } from "../../../../../src/tui/features/ci/ci-wizard.js";

function createWizard(detectedWorkflows: string[] = ["CI", "Rust"]) {
  const onComplete = vi.fn<(answers: CiWizardAnswers) => void>();
  const onCancel = vi.fn();
  const wizard = new CiWizard({ detectedWorkflows, onComplete, onCancel, requestRender: () => undefined });
  return { wizard, onComplete, onCancel };
}

function press(wizard: CiWizard, ...keys: string[]): void {
  for (const key of keys) wizard.handleInput(key);
}

describe("CiWizard", () => {
  it("renders the first step with the detected defaults", () => {
    const { wizard } = createWizard();
    const frame = wizard.render(100).join("\n");
    expect(frame).toContain("Pull request mode");
    expect(frame).toContain("1/5");
  });

  it("walks through every step and completes with the answers", () => {
    const { wizard, onComplete, onCancel } = createWizard(["CI", "Rust"]);
    press(wizard, "2"); // fix-pr
    press(wizard, "3"); // comment-only for main
    press(wizard, "3"); // 3 attempts
    press(wizard, "n", "\u001b[B", " "); // clear, move to Rust, select it
    press(wizard, "\r"); // workflows done
    expect(wizard.render(100).join("\n")).toContain("Confirm");
    press(wizard, "\r"); // install
    expect(onCancel).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toEqual({
      pullRequestMode: "fix-pr",
      mainMode: "comment-only",
      maxAttempts: 3,
      workflows: ["Rust"],
    });
  });

  it("keeps all detected workflows when none are toggled", () => {
    const { wizard, onComplete } = createWizard(["CI"]);
    press(wizard, "\r", "\r", "\r", "\r", "\r");
    expect(onComplete.mock.calls[0][0].workflows).toEqual(["CI"]);
  });

  it("cancels on escape", () => {
    const { wizard, onCancel, onComplete } = createWizard();
    press(wizard, "\u001b");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });
});