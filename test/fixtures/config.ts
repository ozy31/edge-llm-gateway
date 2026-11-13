// Test routing. *.upstream.test hostnames are answered by the fake upstream in
// vitest.config.ts, so tests exercise real outbound fetches from workerd.
export const TEST_CONFIG = {
  upstreams: {
    // high breaker threshold: many tests make the primary fail on purpose
    primary: { baseUrl: "https://primary.upstream.test/v1", auth: { type: "bearer", secret: "PRIMARY_KEY" }, timeoutMs: 2000, breaker: { threshold: 1000, cooldownMs: 1000 } },
    // stands in for a third-party provider: prompts are redacted before sending
    backup: { baseUrl: "https://backup.upstream.test/v1", auth: { type: "none" }, timeoutMs: 2000, redact: true },
    // separate upstream (same fake host) so breaker tests do not affect other tests
    flaky: { baseUrl: "https://primary.upstream.test/v1", auth: { type: "bearer", secret: "PRIMARY_KEY" }, timeoutMs: 2000, breaker: { threshold: 3, cooldownMs: 200 } },
  },
  models: {
    "chat-small": {
      targets: [
        { upstream: "primary", model: "llama-8b" },
        { upstream: "backup", model: "backup-small" },
      ],
    },
    "backup-only": { targets: [{ upstream: "backup", model: "backup-small" }] },
    "primary-only": { targets: [{ upstream: "primary", model: "llama-8b" }] },
    "flaky-then-backup": {
      targets: [
        { upstream: "flaky", model: "llama-8b" },
        { upstream: "backup", model: "backup-small" },
      ],
    },
  },
  limits: { maxBodyBytes: 20000, maxTokensCap: 1024 },
};
