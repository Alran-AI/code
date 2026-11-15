import { describe, expect, it } from "vitest";

import { displayModelRef } from "../../src/model-display.js";

describe("displayModelRef", () => {
  it("shows the platform's id for the official models, not the CLI's internal key", () => {
    expect(displayModelRef("alran", "Alran-Werk")).toBe("ottili/werk-1.1");
    expect(displayModelRef("alran", "anthropic/claude-sonnet-5.5")).toBe(
      "anthropic/claude-sonnet-5.5",
    );
    expect(displayModelRef("alran", "anthropic/claude-opus-5.5")).toBe(
      "anthropic/claude-opus-5.5",
    );
  });

  it("keeps provider/model for every other provider", () => {
    expect(displayModelRef("openrouter", "deepseek/deepseek-v4")).toBe(
      "openrouter/deepseek/deepseek-v4",
    );
    expect(displayModelRef("custom_provider:acme", "fast-1")).toBe(
      "custom_provider:acme/fast-1",
    );
  });

  it("shows an Ottili model the platform has no route for as it is, instead of failing the picker", () => {
    expect(displayModelRef("alran", "Some-Retired-Model")).toBe("alran/Some-Retired-Model");
  });
});
