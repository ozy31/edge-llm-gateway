import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { describe, expect, it } from "vitest";
import { createKey } from "./helpers";

describe("routing", () => {
  it("answers health checks", async () => {
    const res = await SELF.fetch("https://gw.test/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", gateway: "edge-llm-gateway" });
  });

  it("returns OpenAI-shaped 404s", async () => {
    const res = await SELF.fetch("https://gw.test/nope");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe("not_found_error");
  });

  it("allows only GET on the read-only routes, and marks answers uncacheable", async () => {
    const key = await createKey();
    const res = await SELF.fetch("https://gw.test/v1/models", { method: "DELETE", headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const ok = await SELF.fetch("https://gw.test/v1/models", { headers: { authorization: `Bearer ${key}` } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("reports unhealthy when the configuration does not load", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://gw.test/healthz"), { ...env, GATEWAY_CONFIG: '{"upstreams": {}}' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/invalid GATEWAY_CONFIG: config needs "upstreams" and "models"/);
  });
});
