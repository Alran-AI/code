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

  it("references only real commands and behaviour in its Alran-specific tips", () => {
    // /init, /context, and /feedback are real Alran commands; verification of
    // the diff is real behaviour. Every tip must reference a real command or
    // real behaviour, never /checkin.
    const realCommands = ["/init", "/context", "/feedback"];
    for (const layout of ["wide", "stacked", "compact"] as const) {
      for (const tip of ALRAN_CODE_WELCOME_DESIGN[layout].tips) {
        expect(tip.toLowerCase()).not.toContain("checkin");
        const referencesRealCommand = realCommands.some((command) =>
          tip.toLowerCase().includes(command),
        );
        const referencesVerification = tip.toLowerCase().includes("verify")
          || tip.toLowerCase().includes("diff");
        expect(referencesRealCommand || referencesVerification).toBe(true);
      }
    }
  });
});
