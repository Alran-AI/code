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

/** Capabilities shared by the six external (gateway-routed) models. */
const ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES: ModelCapabilitiesConfig = {
  max_image_bytes_inline: 10_485_760,
  max_video_bytes_inline: 52_428_800,
  max_request_body_bytes: 67_108_864,
  max_attachments_count: 4,
  max_images_per_request: 20,
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
    limit: { context: 1000000, output: 512000 },
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
    limit: { context: 1000000, output: 256000 },
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
    limit: { context: 256000, output: 32000 },
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
    limit: { context: 256000, output: 64000 },
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

  // External models, all routed through the Ottili AI Gateway (ottili-gateway)
  // which forwards to OpenRouter. No direct Anthropic or OpenAI key is used.
  // All six are public-only (max_data_class: 'public').
  //
  // Model ids are the gateway family/id (e.g. `anthropic/sonnet-5.5`); the
  // wire id resolved by resolveOttiliModelId prefixes them with `ottili/`
  // (e.g. `ottili/anthropic/sonnet-5.5`).

  // Claude Sonnet 5.5 -> ottili/anthropic/sonnet-5.5
  "anthropic/sonnet-5.5": {
    name: "Claude Sonnet 5.5",
    family: "anthropic",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
    thinking_config: { mode: "always_on" },
    variants: {
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // Claude Opus 5.5 -> ottili/anthropic/opus-5.5
  "anthropic/opus-5.5": {
    name: "Claude Opus 5.5",
    family: "anthropic",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
    thinking_config: { mode: "always_on" },
    variants: {
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // Claude Fable 5.1 -> ottili/anthropic/fable-5.1
  "anthropic/fable-5.1": {
    name: "Claude Fable 5.1",
    family: "anthropic",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 4096 },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // GPT-6 Astra -> ottili/openai/gpt-6-astra (no none-thinking variant)
  "openai/gpt-6-astra": {
    name: "GPT-6 Astra",
    family: "openai",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // GPT-6.1 Sol -> ottili/openai/gpt-6.1-sol
  "openai/gpt-6.1-sol": {
    name: "GPT-6.1 Sol",
    family: "openai",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 200000, output: 4096 },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // GPT-6.1 Terra -> ottili/openai/gpt-6.1-terra
  "openai/gpt-6.1-terra": {
    name: "GPT-6.1 Terra",
    family: "openai",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 200000, output: 4096 },
    thinking_config: { mode: "switchable", default_value: "true" },
    variants: {
      "none-thinking": { thinking: { type: "disabled" } },
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },
};