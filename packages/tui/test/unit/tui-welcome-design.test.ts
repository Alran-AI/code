import { describe, expect, it } from "vitest";
import {
  ALRAN_CODE_WELCOME_DESIGN,
  ALRAN_CODE_WELCOME_TAGLINE,
} from "../../src/tui/shell/welcome/design.js";

describe("ALRAN_CODE_WELCOME_DESIGN", () => {
  it("contains no /checkin reference", () => {
    const design = JSON.stringify(ALRAN_CODE_WELCOME_DESIGN);
    expect(design.toLowerCase()).not.toContain("checkin");
  });

  it("kept the tagline text unchanged", () => {
    expect(ALRAN_CODE_WELCOME_TAGLINE).toBe("Powered by Ottili AI Platform");
  });

  it("has no tips or news sections in the design", () => {
    expect(ALRAN_CODE_WELCOME_DESIGN).not.toHaveProperty("wide");
    expect(ALRAN_CODE_WELCOME_DESIGN).not.toHaveProperty("stacked");
    expect(ALRAN_CODE_WELCOME_DESIGN).not.toHaveProperty("compact");
    expect(ALRAN_CODE_WELCOME_DESIGN).not.toHaveProperty("sectionTitles");
    expect(ALRAN_CODE_WELCOME_DESIGN).toHaveProperty("hero");
  });
});
