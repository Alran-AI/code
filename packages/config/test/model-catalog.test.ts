import { describe, expect, it } from "vitest";
import { ALRAN_MODELS } from "../src/alran-model-catalog.js";
import {
  ALRAN_MODEL_TO_GATEWAY_ID,
  resolveOttiliModelId,
} from "../src/ottili-model-map.js";

const INTERNAL_MODELS = [
  "Alran-Werk-Pro",
  "Alran-Werk",
  "Alran-Fels",
  "Alran-Kern",
] as const;

const EXTERNAL_MODELS = [
  "anthropic/sonnet-5.5",
  "anthropic/opus-5.5",
  "anthropic/fable-5.1",
  "openai/gpt-6-astra",
  "openai/gpt-6.1-sol",
  "openai/gpt-6.1-terra",
] as const;

describe("ALRAN_MODELS catalog", () => {
  it("contains exactly the ten supported models (four internal + six external)", () => {
    expect(Object.keys(ALRAN_MODELS).sort()).toEqual(
      [...INTERNAL_MODELS, ...EXTERNAL_MODELS].sort(),
    );
  });

  it("keeps the four internal Ottili models unchanged", () => {
    expect(ALRAN_MODELS["Alran-Werk-Pro"]!.name).toBe("Ottili Werk 1.1 Pro");
    expect(ALRAN_MODELS["Alran-Werk"]!.name).toBe("Ottili Werk 1.1");
    expect(ALRAN_MODELS["Alran-Fels"]!.name).toBe("Ottili Fels 1.1");
    expect(ALRAN_MODELS["Alran-Kern"]!.name).toBe("Ottili Kern 1.1");
  });

  it("marks all six external models max_data_class: 'public'", () => {
    for (const id of EXTERNAL_MODELS) {
      expect(ALRAN_MODELS[id]!.max_data_class).toBe("public");
    }
  });

  it("excludes Haiku and GPT-6 Luna", () => {
    for (const id of Object.keys(ALRAN_MODELS)) {
      expect(id).not.toMatch(/Haiku|Luna/i);
    }
  });

  it("gateway-id map covers every catalog model with no orphans", () => {
    for (const id of Object.keys(ALRAN_MODELS)) {
      expect(ALRAN_MODEL_TO_GATEWAY_ID).toHaveProperty(id);
    }
    // No gateway-id entry without a catalog model.
    for (const id of Object.keys(ALRAN_MODEL_TO_GATEWAY_ID)) {
      expect(ALRAN_MODELS).toHaveProperty(id);
    }
  });
});

describe("resolveOttiliModelId", () => {
  const expected: Record<string, string> = {
    "Alran-Werk-Pro": "ottili/werk-1.1-pro",
    "Alran-Werk": "ottili/werk-1.1",
    "Alran-Fels": "ottili/fels-1.1",
    "Alran-Kern": "ottili/kern-1.1",
    "anthropic/sonnet-5.5": "ottili/anthropic/sonnet-5.5",
    "anthropic/opus-5.5": "ottili/anthropic/opus-5.5",
    "anthropic/fable-5.1": "ottili/anthropic/fable-5.1",
    "openai/gpt-6-astra": "ottili/openai/gpt-6-astra",
    "openai/gpt-6.1-sol": "ottili/openai/gpt-6.1-sol",
    "openai/gpt-6.1-terra": "ottili/openai/gpt-6.1-terra",
  };

  it("resolves all ten internal names to their gateway ids", () => {
    for (const [internal, gateway] of Object.entries(expected)) {
      expect(resolveOttiliModelId(internal)).toBe(gateway);
    }
  });

  it("passes through already-qualified gateway ids unchanged", () => {
    expect(resolveOttiliModelId("ottili/werk-1.1")).toBe("ottili/werk-1.1");
    expect(resolveOttiliModelId("ottili/anthropic/sonnet-5.5")).toBe(
      "ottili/anthropic/sonnet-5.5",
    );
  });

  it("throws on a missing route instead of falling back to Alran-Werk", () => {
    expect(() => resolveOttiliModelId("Alran-M3.1-Flash")).toThrow(
      /gateway route/,
    );
    expect(() => resolveOttiliModelId("unknown-model")).toThrow(/gateway route/);
    expect(() => resolveOttiliModelId("Alran-Haiku")).toThrow(/gateway route/);
  });

  it("returns the default route for empty input", () => {
    expect(resolveOttiliModelId(undefined)).toBe("ottili/werk-1.1");
    expect(resolveOttiliModelId("")).toBe("ottili/werk-1.1");
  });
});
