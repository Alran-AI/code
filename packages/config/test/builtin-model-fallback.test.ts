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

const modelId = "Alran-M3.1-Flash";
let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(join(os.tmpdir(), "alran-model-fallback-"));
  vi.stubEnv("ALRAN_DATA_DIR", dataDir);
  vi.stubEnv("__MAVIS_RUNTIME_DATA_DIR", dataDir);
  vi.stubEnv("__MAVIS_RUNTIME_MANAGED", "1");
  vi.stubEnv("__MAVIS_RUNTIME_DISABLE_GIT_AUTO_CONFIG", "1");
  vi.stubEnv("MAVIS_REGION", "en");
  vi.stubEnv("MAVIS_BUILD_ENV", "prod");
  resetConfig();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfig();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("built-in model fallback", () => {
  it("seeds M3.1 Flash before a remote snapshot exists and preserves it on reload", () => {
    const config = getConfig();
    const model = config.provider.alran?.models?.[modelId];
    expect(model).toMatchObject({
      name: "M3.1-Flash",
      attachment: true,
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limit: { context: 512000, output: 128000 },
      contextWindowOptions: [512000, 1000000],
      contextWindowOptionHints: { "1000000": "higher_usage" },
      thinking: {
        effortOptions: ["default", "low", "medium", "high", "xhigh", "max"],
        defaultEffort: "default",
      },
      thinking_config: { mode: "forced_on" },
      variants: { thinking: { thinking: { type: "adaptive" } } },
      capabilities: {
        support_files_api: true,
        files_api_upload_endpoint: "/v1/files/upload",
        max_image_bytes_inline: 10_485_760,
        max_video_bytes_inline: 52_428_800,
        max_request_body_bytes: 67_108_864,
        max_attachments_count: 4,
      },
    });
    expect(config.defaultModel).toBe("alran/Alran-M3.1-Flash");
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
      ).toEqual({ available: true, route: "managed_token_plan" });
    }
  });

  it("keeps an existing managed snapshot authoritative instead of adding fallback models", () => {
    const models = { "Alran-M3": { name: "Alran-M3" } };
    fs.writeFileSync(
      join(dataDir, "config.yaml"),
      yaml.dump({
        provider: {
          alran: {
            options: {
              authMode: "managed-login",
              baseURL: "https://api.ottili.one/mavis/api/v1/llm/v1",
            },
            models,
          },
        },
      }),
    );
    expect(getConfig().provider.alran?.models).toEqual(models);
  });
});
