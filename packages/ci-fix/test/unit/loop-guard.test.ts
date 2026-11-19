import { describe, expect, it } from "vitest";
import {
  CI_FIX_MARKER,
  buildCiFixCommitMessage,
  countCiFixAttempts,
  evaluateLoopGuard,
  isCiFixCommitMessage,
} from "../../src/loop-guard.js";

describe("loop guard", () => {
  it("recognizes fix commits by their marker", () => {
    expect(isCiFixCommitMessage(`fix(ci): something\n\n${CI_FIX_MARKER} automated fix`)).toBe(true);
    expect(isCiFixCommitMessage("fix(ci): something else")).toBe(false);
  });

  it("counts consecutive fix commits from the head of the chain", () => {
    expect(
      countCiFixAttempts([
        `fix(ci): second\n\n${CI_FIX_MARKER}`,
        `fix(ci): first\n\n${CI_FIX_MARKER}`,
        "feat: unrelated",
      ]),
    ).toBe(2);
    expect(countCiFixAttempts(["feat: unrelated", `fix(ci): old\n\n${CI_FIX_MARKER}`])).toBe(1);
  });

  it("refuses to run on top of a fix commit", () => {
    const decision = evaluateLoopGuard({
      headCommitMessage: `fix(ci): earlier\n\n${CI_FIX_MARKER}`,
      commitChain: [`fix(ci): earlier\n\n${CI_FIX_MARKER}`],
      maxAttempts: 2,
    });
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain(CI_FIX_MARKER);
  });

  it("enforces the attempt budget across the whole chain", () => {
    const chain = [
      `fix(ci): second\n\n${CI_FIX_MARKER}`,
      `fix(ci): first\n\n${CI_FIX_MARKER}`,
    ];
    expect(evaluateLoopGuard({ headCommitMessage: "feat: x", commitChain: chain, maxAttempts: 2 }).run)
      .toBe(false);
    const oneFix = [`fix(ci): only one\n\n${CI_FIX_MARKER}`];
    expect(
      evaluateLoopGuard({ headCommitMessage: "feat: x", commitChain: oneFix, maxAttempts: 2 }).run,
    ).toBe(true);
  });

  it("runs on a clean head within budget", () => {
    const decision = evaluateLoopGuard({
      headCommitMessage: "feat: feature",
      commitChain: ["feat: feature", "chore: deps"],
      maxAttempts: 2,
    });
    expect(decision).toEqual({ run: true });
  });

  it("builds a Conventional Commits subject with the marker in the body", () => {
    const message = buildCiFixCommitMessage("fix failing CI command: npm test");
    expect(message.subject).toBe("fix(ci): fix failing CI command: npm test");
    expect(message.body).toContain(CI_FIX_MARKER);
  });
});
