import { describe, expect, it } from "vitest";
import { ALRAN_MODELS } from "../src/alran-model-catalog.js";
import {
  ALRAN_MODEL_TO_GATEWAY_ID,
  isPaidOnlyOttiliModel,
  resolveOttiliCatalogModelId,
  resolveOttiliModelId,
} from "../src/ottili-model-map.js";

describe("ALRAN_MODELS catalog", () => {
  it("offers exactly the three models the Ottili AI Gateway serves", () => {
    expect(Object.keys(ALRAN_MODELS).sort()).toEqual(
      ["Alran-Werk", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5"].sort(),
    );
    expect(ALRAN_MODELS["Alran-Werk"]!.name).toBe("Ottili Werk 1.1");
    expect(ALRAN_MODELS["anthropic/claude-sonnet-5.5"]!.name).toBe("Claude Sonnet 5.5");
    expect(ALRAN_MODELS["anthropic/claude-opus-5.5"]!.name).toBe("Claude Opus 5.5");
  });

  it("gives the partner models the context and output limits the gateway publishes", () => {
    for (const id of ["anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"]) {
      expect(ALRAN_MODELS[id]!.limit).toEqual({ context: 1_000_000, output: 128_000 });
      expect(ALRAN_MODELS[id]!.max_data_class).toBe("public");
    }
  });

  it("gateway-id map covers every catalog model with no orphans", () => {
    for (const id of Object.keys(ALRAN_MODELS)) expect(ALRAN_MODEL_TO_GATEWAY_ID).toHaveProperty(id);
    for (const id of Object.keys(ALRAN_MODEL_TO_GATEWAY_ID)) expect(ALRAN_MODELS).toHaveProperty(id);
  });
});

describe("gateway routing", () => {
  it("routes Werk and the partner models to the ids the gateway serves", () => {
    expect(resolveOttiliModelId("Alran-Werk")).toBe("ottili/werk-1.1");
    expect(resolveOttiliModelId("werk")).toBe("ottili/werk-1.1");
    expect(resolveOttiliModelId(undefined)).toBe("ottili/werk-1.1");
    expect(resolveOttiliModelId("anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(resolveOttiliModelId("anthropic/claude-opus-5.5")).toBe("anthropic/claude-opus-5.5");
    expect(resolveOttiliModelId("ottili/werk-1.1")).toBe("ottili/werk-1.1");
  });

  it("never falls back to Werk for an unknown model", () => {
    expect(() => resolveOttiliModelId("openai/gpt-6-astra")).toThrow(/No Ottili AI Platform gateway route/u);
  });

  it("knows the short names and which models need paid credit", () => {
    expect(resolveOttiliCatalogModelId("sonnet")).toBe("anthropic/claude-sonnet-5.5");
    expect(resolveOttiliCatalogModelId("Werk")).toBe("Alran-Werk");
    expect(isPaidOnlyOttiliModel("anthropic/claude-opus-5.5")).toBe(true);
    expect(isPaidOnlyOttiliModel("opus")).toBe(true);
    expect(isPaidOnlyOttiliModel("werk")).toBe(false);
  });
});
