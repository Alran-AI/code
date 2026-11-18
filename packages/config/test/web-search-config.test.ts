import { describe, expect, it } from "vitest";

import {
  WEB_SEARCH_CONFIG_DEFAULTS,
  parseWebSearchConfig,
  webSearchEnvFromConfig,
  webSearchEnvWithConfig,
} from "../src/web-search-config.js";

describe("web search config (`webSearch:` in config.yaml)", () => {
  it("is empty when nothing is set", () => {
    const { config, warnings } = parseWebSearchConfig(undefined);
    expect(warnings).toEqual([]);
    expect(config).toEqual(WEB_SEARCH_CONFIG_DEFAULTS);
  });

  it("takes every provider the environment also accepts", () => {
    const { config, warnings } = parseWebSearchConfig({
      braveApiKey: "brave-key",
      serperApiKey: "serper-key",
      tavilyApiKey: "tavily-key",
      searxngUrl: "http://127.0.0.1:8080",
      searxngApiKey: "gateway-key",
    });

    expect(warnings).toEqual([]);
    expect(config).toEqual({
      braveApiKey: "brave-key",
      serperApiKey: "serper-key",
      tavilyApiKey: "tavily-key",
      searxngUrl: "http://127.0.0.1:8080",
      searxngApiKey: "gateway-key",
    });
  });

  it("drops blank values instead of treating them as configured", () => {
    const { config } = parseWebSearchConfig({ braveApiKey: "   ", searxngUrl: "" });

    expect(config.braveApiKey).toBeUndefined();
    expect(config.searxngUrl).toBeUndefined();
  });

  it("ignores an unknown key but says so", () => {
    const { config, warnings } = parseWebSearchConfig({ braveApiKey: "k", nonsense: "x" });

    expect(config.braveApiKey).toBe("k");
    expect(warnings.some((w) => w.includes("nonsense"))).toBe(true);
  });

  it("warns about a non-string value rather than failing to start", () => {
    const { config, warnings } = parseWebSearchConfig({ braveApiKey: 42 });

    expect(config.braveApiKey).toBeUndefined();
    expect(warnings.some((w) => w.includes("braveApiKey"))).toBe(true);
  });
});

describe("webSearchEnvFromConfig", () => {
  it("maps config keys onto the environment names the provider chain reads", () => {
    expect(
      webSearchEnvFromConfig({
        braveApiKey: "b",
        serperApiKey: "s",
        tavilyApiKey: "t",
        searxngUrl: "http://127.0.0.1:8080",
        searxngApiKey: "g",
      }),
    ).toEqual({
      BRAVE_API_KEY: "b",
      SERPER_API_KEY: "s",
      TAVILY_API_KEY: "t",
      SEARXNG_URL: "http://127.0.0.1:8080",
      SEARXNG_API_KEY: "g",
    });
  });

  it("emits nothing for an empty config so the environment stays in charge", () => {
    expect(webSearchEnvFromConfig(WEB_SEARCH_CONFIG_DEFAULTS)).toEqual({});
  });

  it("leaves a real environment value in place when the config is silent", () => {
    const merged = {
      BRAVE_API_KEY: "from-env",
      ...webSearchEnvFromConfig({}),
    };

    expect(merged.BRAVE_API_KEY).toBe("from-env");
  });
});

describe("webSearchEnvWithConfig", () => {
  it("fills only variables that are absent or blank in the environment", () => {
    const merged = webSearchEnvWithConfig(
      {
        braveApiKey: "from-config",
        serperApiKey: "serper-from-config",
        tavilyApiKey: "tavily-from-config",
      },
      { BRAVE_API_KEY: "from-env", SERPER_API_KEY: "   ", PATH: "/bin" },
    );

    expect(merged.BRAVE_API_KEY).toBe("from-env");
    expect(merged.SERPER_API_KEY).toBe("serper-from-config");
    expect(merged.TAVILY_API_KEY).toBe("tavily-from-config");
    expect(merged.PATH).toBe("/bin");
  });

  it("does not mutate the environment it was given", () => {
    const env = { BRAVE_API_KEY: "" };
    const merged = webSearchEnvWithConfig({ braveApiKey: "k" }, env);

    expect(env.BRAVE_API_KEY).toBe("");
    expect(merged.BRAVE_API_KEY).toBe("k");
  });

  it("returns a copy even for an empty config", () => {
    const env = { SEARXNG_URL: "http://localhost:8080" };
    const merged = webSearchEnvWithConfig({}, env);

    expect(merged).toEqual(env);
    expect(merged).not.toBe(env);
  });
});
