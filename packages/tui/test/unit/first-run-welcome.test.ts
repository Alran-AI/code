import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";

import {
  firstRunWelcomeSeen,
  markFirstRunWelcomeSeen,
} from "../../src/tui/features/auth/first-run.js";
import { TuiWelcomePicker } from "../../src/tui/features/auth/welcome-picker.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "alran-first-run-"));
  dirs.push(dir);
  return dir;
};

describe("first-run welcome memory", () => {
  it("is unseen in a fresh data directory, and seen once marked", () => {
    const dir = tempDir();
    expect(firstRunWelcomeSeen(dir)).toBe(false);
    markFirstRunWelcomeSeen(dir, () => new Date("2026-11-15T12:00:00Z"));
    expect(firstRunWelcomeSeen(dir)).toBe(true);
    const written = JSON.parse(readFileSync(path.join(dir, "first-run-welcome.json"), "utf8"));
    expect(written).toEqual({ shown_at: "2026-11-15T12:00:00.000Z" });
  });

  it("creates the data directory when it does not exist yet", () => {
    const dir = path.join(tempDir(), "not", "there", "yet");
    markFirstRunWelcomeSeen(dir);
    expect(existsSync(path.join(dir, "first-run-welcome.json"))).toBe(true);
  });

  it("never throws when the mark cannot be written", () => {
    // A file where the directory should be: mkdir fails, and the start goes on.
    const dir = tempDir();
    markFirstRunWelcomeSeen(dir);
    expect(() => markFirstRunWelcomeSeen(path.join(dir, "first-run-welcome.json", "x"))).not.toThrow();
  });
});

describe("TuiWelcomePicker", () => {
  const strip = (lines: readonly string[]): string =>
    lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

  it("offers the ways in and a way to skip, in that order", () => {
    const picker = new TuiWelcomePicker(() => undefined, () => undefined);
    const text = strip(picker.renderViewport(100, 24));
    const order = ["Sign in with Ottili", "Use an API key", "Use my own provider", "Skip for now"].map(
      (label) => text.indexOf(label),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Welcome to Alran Code");
    expect(text).toContain("Esc skip");
  });

  it("answers the highlighted choice on Enter and cancels on Esc", () => {
    const chosen: string[] = [];
    let cancelled = 0;
    const picker = new TuiWelcomePicker((choice) => chosen.push(choice), () => {
      cancelled += 1;
    });
    picker.handleInput("\r");
    picker.handleInput("\u001b[B");
    picker.handleInput("\r");
    picker.handleInput("\u001b");
    expect(chosen).toEqual(["platform", "api-key"]);
    expect(cancelled).toBe(1);
  });
});
