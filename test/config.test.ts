import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config";
import { TEST_CONFIG } from "./fixtures/config";

describe("config", () => {
  it("parses the test config and strips trailing slashes", () => {
    const c = parseConfig({ ...TEST_CONFIG, upstreams: { ...TEST_CONFIG.upstreams, primary: { ...TEST_CONFIG.upstreams.primary, baseUrl: "https://primary.upstream.test/v1/" } } });
    expect(c.upstreams.primary!.baseUrl).toBe("https://primary.upstream.test/v1");
    expect(c.models["chat-small"]!.targets).toHaveLength(2);
    expect(c.limits.maxTokensCap).toBe(1024);
  });

  it.each([
    [{ upstreams: {}, models: { m: { targets: [{ upstream: "missing", model: "x" }] } } }, /unknown upstream/],
    [{ upstreams: { u: { baseUrl: "http://plain.example.com" } }, models: {} }, /must be https/],
    [{ upstreams: { u: { baseUrl: "https://a.example.com", auth: { type: "bearer" } } }, models: {} }, /needs "secret"/],
    [{ upstreams: {}, models: { m: { targets: [] } } }, /at least one target/],
    // A typo here used to pass through and break limits at request time.
    [{ upstreams: { u: { baseUrl: "https://a.example.com", timeoutMs: "30s" } }, models: {} }, /timeoutMs must be a positive integer/],
    [{ upstreams: { u: { baseUrl: "https://a.example.com", breaker: { threshold: 0 } } }, models: {} }, /breaker.threshold must be a positive integer/],
    [{ upstreams: {}, models: {}, limits: { maxTokensCap: -1 } }, /limits.maxTokensCap must be a positive integer/],
    [{ upstreams: {}, models: {}, limits: { maxBodyBytes: "1MB" } }, /limits.maxBodyBytes must be a positive integer/],
  ])("rejects bad config %#", (raw, msg) => {
    expect(() => parseConfig(raw)).toThrow(ConfigError);
    expect(() => parseConfig(raw)).toThrow(msg);
  });
});
