import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});
