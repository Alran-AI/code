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

/** Capabilities shared by the partner models (Claude, routed by the Ottili AI Gateway). */
const ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES: ModelCapabilitiesConfig = {
  max_image_bytes_inline: 10_485_760,
  max_video_bytes_inline: 52_428_800,
  max_request_body_bytes: 67_108_864,
  max_attachments_count: 4,
  max_images_per_request: 20,
};

/**
 * The three models Alran Code offers through the Ottili AI Gateway.
 *
 *   Alran-Werk                     -> ottili/werk-1.1             included: the welcome credit pays
 *   anthropic/claude-sonnet-5.5    -> anthropic/claude-sonnet-5.5 partner model: paid credit only
 *   anthropic/claude-opus-5.5      -> anthropic/claude-opus-5.5   partner model: paid credit only
 *
 * The gateway serves nothing else today: Fels, Kern and Werk Pro are planned or retired there and
 * answer `model_not_available`, so they are not offered. A persisted default that names a model no
 * longer in this catalogue is replaced by the default (`replaceStaleOfficialDefaultModel`).
 * The partner models' token prices are Anthropic's list prices; the gateway adds a 4.5 % service fee
 * as a separate line and refuses them with `free_credit_model_restricted` when only the welcome
 * credit is left. Third-party providers (bring your own key) are configured separately and are
 * called directly, never through the gateway.
 */
export const ALRAN_MODELS: Record<string, ModelConfig> = {
  // Werk -> ottili/werk-1.1. The default model, and the one the welcome credit pays for.
  "Alran-Werk": {
    name: "Ottili Werk 1.1",
    family: "coding",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: true,
    // The upstream model reads text and images. It does not read video, and the CLI must not offer to
    // send one: the request would be refused after the person attached it.
    modalities: { input: ["text", "image"], output: ["text"] },
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

  // Claude Sonnet 5.5 (Anthropic, through the Ottili AI Gateway -> OpenRouter)
  "anthropic/claude-sonnet-5.5": {
    name: "Claude Sonnet 5.5",
    family: "anthropic",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 128000 },
    // Claude 5.5 always reasons — the upstream refuses `effort: none` ("Reasoning is mandatory for
    // this endpoint") — but the *level* is the customer's choice: the gateway maps low/medium/high/
    // xhigh onto the levels Anthropic's API takes. Without these options the CLI showed no reasoning
    // selector for the two partner models at all, while the gateway was accepting an effort for them.
    thinking: {
      effortOptions: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
    },
    thinking_config: { mode: "always_on" },
    variants: {
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },

  // Claude Opus 5.5 (Anthropic, through the Ottili AI Gateway -> OpenRouter)
  "anthropic/claude-opus-5.5": {
    name: "Claude Opus 5.5",
    family: "anthropic",
    attachment: true,
    reasoning: true,
    tool_call: true,
    temperature: false,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 128000 },
    // Claude 5.5 always reasons — the upstream refuses `effort: none` ("Reasoning is mandatory for
    // this endpoint") — but the *level* is the customer's choice: the gateway maps low/medium/high/
    // xhigh onto the levels Anthropic's API takes. Without these options the CLI showed no reasoning
    // selector for the two partner models at all, while the gateway was accepting an effort for them.
    thinking: {
      effortOptions: ["low", "medium", "high", "xhigh"],
      defaultEffort: "medium",
    },
    thinking_config: { mode: "always_on" },
    variants: {
      thinking: { thinking: { type: "adaptive" } },
    },
    max_data_class: "public",
    capabilities: ALRAN_EXTERNAL_ATTACHMENT_CAPABILITIES,
  },
};
