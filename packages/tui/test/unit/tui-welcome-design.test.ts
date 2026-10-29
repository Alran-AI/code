import { describe, expect, it } from "vitest";
import {
  ALRAN_CODE_WELCOME_DESIGN,
  ALRAN_CODE_WELCOME_TAGLINE,
} from "../../src/tui/shell/welcome/design.js";

function allDesignStrings(): string[] {
  const strings: string[] = [];
  for (const layout of ["wide", "stacked", "compact"] as const) {
    strings.push(...ALRAN_CODE_WELCOME_DESIGN[layout].tips);
    strings.push(...ALRAN_CODE_WELCOME_DESIGN[layout].news);
  }
  strings.push(ALRAN_CODE_WELCOME_TAGLINE);
  return strings;
}

describe("ALRAN_CODE_WELCOME_DESIGN", () => {
  it("contains no /checkin reference in any welcome string", () => {
    for (const string of allDesignStrings()) {
      expect(string.toLowerCase()).not.toContain("checkin");
    }
  });

  it("kept the tagline text unchanged", () => {
    expect(ALRAN_CODE_WELCOME_TAGLINE).toBe("Powered by Ottili AI Platform");
  });

  it("expresses the follow-up as one consistent fact across layouts", () => {
    const wide = ALRAN_CODE_WELCOME_DESIGN.wide.news[0];
    const stacked = ALRAN_CODE_WELCOME_DESIGN.stacked.news[0];
    const compact = ALRAN_CODE_WELCOME_DESIGN.compact.news[0];

    expect(wide).toBe("Send follow-ups while Alran works — they queue until the turn ends.");
    expect(stacked).toBe("Send follow-ups while Alran works — they queue until the turn ends.");
    expect(compact).toBe("Follow-ups queue while Alran works.");

    // Every layout agrees that follow-ups queue / wait until the turn ends.
    for (const statement of [wide, stacked, compact]) {
      expect(statement.toLowerCase()).toMatch(/queue|wait/);
      expect(statement.toLowerCase()).toContain("alran works");
    }
  });

  it("verification tip references real behaviour (diff inspection is a real Alran behaviour)", () => {
    const verification = ALRAN_CODE_WELCOME_DESIGN.wide.tips[0];
    expect(verification).toBe(
      "Every change shows a diff — verify it before it applies.",
    );
    // Diff inspection and verification are real Alran behaviours (README:
    // "Edit and verify code ... inspect diffs"). The tip references neither
    // /checkin nor a fabricated capability.
    expect(verification.toLowerCase()).not.toContain("checkin");
    expect(verification.toLowerCase()).toMatch(/diff|verif/);
  });
});
