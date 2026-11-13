// Test routing. *.upstream.test hostnames are answered by the fake upstream in
// vitest.config.ts, so tests exercise real outbound fetches from workerd.
export const TEST_CONFIG = {
  upstreams: {
    primary: { baseUrl: "https://primary.upstream.test/v1", auth: { type: "bearer", secret: "PRIMARY_KEY" }, timeoutMs: 2000 },
    backup: { baseUrl: "https://backup.upstream.test/v1", auth: { type: "none" }, timeoutMs: 2000 },
  },
  models: {
    "chat-small": {
      targets: [
        { upstream: "primary", model: "llama-8b" },
        { upstream: "backup", model: "backup-small" },
      ],
    },
    "backup-only": { targets: [{ upstream: "backup", model: "backup-small" }] },
  },
  limits: { maxBodyBytes: 20000, maxTokensCap: 1024 },
};
