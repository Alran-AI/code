import type { ModelCapabilitiesConfig, ModelConfig } from "./config.js";

/**
 * Shared first-run catalog; an existing remote snapshot remains authoritative.
 *
 * The keys are the CLI's internal model identities. They own thinking modes,
 * effort levels, and context-window selection. The Ottili AI Platform model id
 * for each entry is resolved at the request boundary by `resolveOttiliModelId`.
 */
const ALRAN_ATTACHMENT_CAPABILITIES: ModelCapabilitiesConfig = {
  max_image_bytes_inline: 10_485_760,
  max_video_bytes_inline: 52_428_800,
  max_request_body_bytes: 67_108_864,
  max_attachments_count: 4,
};

export const ALRAN_MODELS: Record<string, ModelConfig> = {
  // Premium tier -> ottili/werk-1.1-pro
  "Alran-Werk-Pro": {
    name: "Ottili Werk 1.1 Pro",
    family: "premium",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text", "image", "video"], output: ["text"] },
    limit: { context: 1000000, output: 128000 },
    contextWindowOptions: [1000000],
    options: { reasoningSummary: "auto" },
    thinking: {
      effortOptions: ["low", "high", "max"],
      defaultEffort: "high",
    },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
    capabilities: ALRAN_ATTACHMENT_CAPABILITIES,
  },

  // Smart / Coding tier -> ottili/werk-1.1
  "Alran-Werk": {
    name: "Ottili Werk 1.1",
    family: "coding",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text", "image", "video"], output: ["text"] },
    limit: { context: 512000, output: 128000 },
    contextWindowOptions: [512000, 1000000],
    contextWindowOptionHints: { "1000000": "higher_usage" },
    options: { reasoningSummary: "auto" },
    thinking: {
      effortOptions: ["minimal", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "medium",
    },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
    capabilities: ALRAN_ATTACHMENT_CAPABILITIES,
  },

  // Standard tier -> ottili/fels-1.1
  "Alran-Fels": {
    name: "Ottili Fels 1.1",
    family: "standard",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 200000, output: 128000 },
    thinking: {
      effortOptions: ["low", "medium", "xhigh"],
      defaultEffort: "medium",
    },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
  },

  // Router tier -> ottili/kern-1.1
  "Alran-Kern": {
    name: "Ottili Kern 1.1",
    family: "standard",
    attachment: false,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 200000, output: 128000 },
    thinking: {
      effortOptions: ["low", "medium", "high"],
      defaultEffort: "medium",
    },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
  },
};