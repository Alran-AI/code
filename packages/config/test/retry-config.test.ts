import { describe, expect, it } from "vitest";
import {
  RETRY_CONFIG_DEFAULTS,
  RETRY_REASONS,
  parseRetryConfig,
  retryPolicyFromConfig,
} from "../src/retry-config.js";

describe("retry config (`retry:` in config.yaml)", () => {
  it("is the framework's own policy when nothing is set", () => {
    const { config, warnings } = parseRetryConfig(undefined);
    expect(warnings).toEqual([]);
    expect(config).toEqual(RETRY_CONFIG_DEFAULTS);
    expect(retryPolicyFromConfig(config)).toEqual({
      maxRetries: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      maxRetryElapsedMs: 120_000,
      retryReasons: [...RETRY_REASONS],
    });
  });

  it("takes every setting a person can write", () => {
    const { config, warnings } = parseRetryConfig({
      maxRetries: 3,
      initialDelayMs: 2_000,
      maxDelayMs: 20_000,
      maxElapsedMs: 60_000,
      retryOn: ["network", "timeout", "overloaded"],
    });
    expect(warnings).toEqual([]);
    expect(config).toEqual({
      maxRetries: 3,
      initialDelayMs: 2_000,
      maxDelayMs: 20_000,
      maxElapsedMs: 60_000,
      retryOn: ["network", "timeout", "overloaded"],
    });
  });

  it("lets a person turn retrying off", () => {
    expect(parseRetryConfig({ maxRetries: 0 }).config.maxRetries).toBe(0);
  });

  it("corrects a wrong value and says so, instead of refusing to start", () => {
    const { config, warnings } = parseRetryConfig({
      maxRetries: "many",
      initialDelayMs: 5,
      maxDelayMs: 500,
      maxElapsedMs: 99_999_999,
      colour: "blue",
    });
    expect(config.maxRetries).toBe(RETRY_CONFIG_DEFAULTS.maxRetries);
    expect(config.initialDelayMs).toBe(100);
    expect(config.maxDelayMs).toBe(500);
    expect(config.maxElapsedMs).toBe(3_600_000);
    expect(warnings.join("\n")).toMatch(/retry\.maxRetries must be a whole number/);
    expect(warnings.join("\n")).toMatch(/retry\.initialDelayMs must be between 100 and 60000; using 100/);
    expect(warnings.join("\n")).toMatch(/retry\.maxElapsedMs must be between/);
    expect(warnings.join("\n")).toMatch(/retry\.colour is not a setting/);
  });

  it("never lets the longest wait be shorter than the first", () => {
    const { config, warnings } = parseRetryConfig({ initialDelayMs: 4_000, maxDelayMs: 1_000 });
    expect(config.maxDelayMs).toBe(4_000);
    expect(warnings.join("\n")).toMatch(/retry\.maxDelayMs \(1000\) is below retry\.initialDelayMs \(4000\)/);
  });

  it("accepts only the categories that can be retried, and keeps the two rate-limit kinds together", () => {
    const { config, warnings } = parseRetryConfig({ retryOn: ["rate_limited", "auth", "Network", "network", "credits_exhausted"] });
    expect(config.retryOn).toEqual(["rate_limited", "network", "tpm_rate_limited"]);
    expect(warnings.join("\n")).toMatch(/"auth" is not a category that can be retried/);
    expect(warnings.join("\n")).toMatch(/"credits_exhausted" is not a category that can be retried/);
  });

  it("falls back to all categories for a retryOn that is not a list, and to the defaults for a block that is not a mapping", () => {
    expect(parseRetryConfig({ retryOn: "network" }).config.retryOn).toEqual([...RETRY_REASONS]);
    const bad = parseRetryConfig(["x"]);
    expect(bad.config).toEqual(RETRY_CONFIG_DEFAULTS);
    expect(bad.warnings.join("\n")).toMatch(/retry must be a mapping/);
  });
});
