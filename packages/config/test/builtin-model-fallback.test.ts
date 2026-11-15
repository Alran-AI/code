import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_PRESETS,
  getConfig,
  resetConfig,
} from "../src/config.js";
import { resolveModelAvailability } from "../src/model-availability.js";

const modelId = "Alran-Werk";
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(join(os.tmpdir(), "alran-model-fallback-"));
  vi.stubEnv("ALRAN_DATA_DIR", dataDir);
  vi.stubEnv("__ALRAN_RUNTIME_DATA_DIR", dataDir);
  vi.stubEnv("__ALRAN_RUNTIME_MANAGED", "1");
  vi.stubEnv("__ALRAN_RUNTIME_DISABLE_GIT_AUTO_CONFIG", "1");
  vi.stubEnv("ALRAN_REGION", "en");
  vi.stubEnv("ALRAN_BUILD_ENV", "prod");
  resetConfig();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfig();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("built-in model fallback", () => {
  it("seeds the coding model before a remote snapshot exists and preserves it on reload", () => {
    const config = getConfig();
    const model = config.provider.alran?.models?.[modelId];
    expect(model).toMatchObject({
      name: "Ottili Werk 1.1",
      family: "coding",
      attachment: true,
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 1000000, output: 256000 },
      thinking: {
        effortOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "medium",
      },
      thinking_config: { mode: "switchable", default_value: "true" },
      variants: { thinking: { thinking: { type: "adaptive" } } },
      capabilities: {
        max_image_bytes_inline: 10_485_760,
        max_video_bytes_inline: 52_428_800,
        max_request_body_bytes: 67_108_864,
        max_attachments_count: 4,
      },
    });
    expect(config.defaultModel).toBe("alran/Alran-Werk");
    resetConfig();
    expect(getConfig().provider.alran?.models?.[modelId]).toEqual(model);
  });

  it("makes the fallback model available in every managed preset", () => {
    for (const preset of Object.keys(DEFAULT_MODEL_PRESETS) as Array<
      keyof typeof DEFAULT_MODEL_PRESETS
    >) {
      expect(
        resolveModelAvailability({
          config: DEFAULT_MODEL_PRESETS[preset],
          providerId: "alran",
          modelId,
          preset,
          source: "explicit_request",
        }),
      ).toEqual({ available: true, route: "alran_api_key" });
    }
  });

  it("replaces a default model the official catalog no longer contains", () => {
    fs.writeFileSync(
      join(dataDir, "config.yaml"),
      yaml.dump({
        defaultModel: "alran/Alran-M3.1-Flash",
        defaultModelVariant: "thinking",
        defaultModelContextWindow: 1_000_000,
        alranModelSource: "alran_api_key",
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = getConfig();
    expect(config.defaultModel).toBe("alran/Alran-Werk");
    expect(config.defaultModelVariant).toBeUndefined();
    expect(config.defaultModelContextWindow).toBeUndefined();
    expect(
      resolveModelAvailability({
        config,
        providerId: "alran",
        modelId: "Alran-Werk",
        preset: "en-prod",
        source: "config_default",
      }),
    ).toEqual({ available: true, route: "alran_api_key" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("alran/Alran-M3.1-Flash"),
    );
  });

  it("keeps a default model that the official catalog still offers", () => {
    fs.writeFileSync(
      join(dataDir, "config.yaml"),
      yaml.dump({
        defaultModel: "alran/Alran-Werk",
        defaultModelVariant: "thinking",
      }),
    );
    const config = getConfig();
    expect(config.defaultModel).toBe("alran/Alran-Werk");
    expect(config.defaultModelVariant).toBe("thinking");
  });

  it("keeps an existing managed snapshot authoritative instead of adding fallback models", () => {
    const models = { "Alran-M3": { name: "Ottili Werk 1.1 Pro" } };
    fs.writeFileSync(
      join(dataDir, "config.yaml"),
      yaml.dump({
        provider: {
          alran: {
            options: {
              authMode: "api-key",
              baseURL: "https://api.ottili.one/v1",
            },
            models,
          },
        },
      }),
    );
    expect(getConfig().provider.alran?.models).toEqual(models);
  });
});
