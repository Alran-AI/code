import { describe, expect, it } from "vitest";
import { TuiWelcome } from "../../src/tui/shell/welcome/component.js";
import { renderTuiWelcomeHero } from "../../src/tui/shell/welcome/hero.js";
import {
  ALRAN_CODE_TERMINAL_MEDIUM_WORDMARK,
  ALRAN_CODE_TERMINAL_WORDMARK,
  ALRAN_CODE_WELCOME_TAGLINE,
} from "../../src/tui/shell/welcome/design.js";
import { stripAnsi } from "../../src/tui/rendering/text.js";

const shell: { version: string; workspace: string; runtimeStatus: "ready" } = {
  version: "0.1.0",
  workspace: "/workspace",
  runtimeStatus: "ready",
};

function renderWelcome(width: number): string {
  return stripAnsi(new TuiWelcome(shell).render(width).join("\n"));
}

describe("TuiWelcome layouts", () => {
  it("renders no /checkin in any layout", () => {
    for (const width of [40, 60, 100]) {
      expect(renderWelcome(width).toLowerCase()).not.toContain("checkin");
    }
  });

  it("renders no tips or news in any layout", () => {
    for (const width of [40, 60, 100]) {
      const rendered = renderWelcome(width);
      expect(rendered).not.toContain("Tips");
      expect(rendered).not.toContain("What's new");
      expect(rendered).not.toContain("diff");
      expect(rendered).not.toContain("follow-up");
      expect(rendered).not.toContain("/init");
      expect(rendered).not.toContain("/context");
      expect(rendered).not.toContain("/feedback");
    }
  });

  it("produces stable snapshots for the three layouts", () => {
    expect(renderWelcome(100)).toMatchSnapshot();
    expect(renderWelcome(60)).toMatchSnapshot();
    expect(renderWelcome(40)).toMatchSnapshot();
  });

  it("renders the tagline centered under the full wordmark (wide layout only)", () => {
    const hero = renderTuiWelcomeHero(100);
    const taglineLine = stripAnsi(hero[hero.length - 1]);
    expect(taglineLine).toContain(ALRAN_CODE_WELCOME_TAGLINE);
    expect(taglineLine.length).toBe(100);
    const left = taglineLine.indexOf(ALRAN_CODE_WELCOME_TAGLINE);
    const right = taglineLine.length - left - ALRAN_CODE_WELCOME_TAGLINE.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("renders ALRAN block art without CODE on medium terminals", () => {
    const hero = stripAnsi(renderTuiWelcomeHero(60).join("\n"));
    for (const line of ALRAN_CODE_TERMINAL_MEDIUM_WORDMARK) {
      expect(hero).toContain(line.trim());
    }
    expect(hero).not.toContain(ALRAN_CODE_TERMINAL_WORDMARK[0]);
    expect(hero).not.toContain("ALRAN");
    expect(hero).not.toContain("Alran");
  });

  it("does not render the tagline in narrow layouts", () => {
    const stacked = stripAnsi(new TuiWelcome(shell).render(60).join("\n"));
    const compact = stripAnsi(new TuiWelcome(shell).render(40).join("\n"));
    expect(stacked).not.toContain(ALRAN_CODE_WELCOME_TAGLINE);
    expect(compact).not.toContain(ALRAN_CODE_WELCOME_TAGLINE);
  });

  it("renders no border box characters in any layout", () => {
    const boxChars = ["╭", "│", "├", "╰"];
    for (const width of [40, 60, 100]) {
      const rendered = renderWelcome(width);
      for (const char of boxChars) {
        expect(rendered).not.toContain(char);
      }
    }
  });
});
