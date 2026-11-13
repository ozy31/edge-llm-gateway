import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chat, createKey, upstreamCalls } from "./helpers";

const say = (content: string, model = "chat-small") => ({ model, messages: [{ role: "user", content }] });

describe("fallback between upstreams", () => {
  it.each([500, 502, 503, 504, 429])("falls back when the primary answers %i", async (status) => {
    const key = await createKey();
    const req = chat(key, say(`fail:${status}`));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-upstream")).toBe("backup");
    expect(res.headers.get("x-gateway-attempts")).toBe(`primary=${status},backup=200`);
    const calls = await upstreamCalls(req);
    expect(calls.map((c) => [c.host, c.body.model])).toEqual([["primary", "llama-8b"], ["backup", "backup-small"]]);
  });

  it("falls back when the primary times out", async () => {
    const key = await createKey();
    const req = chat(key, say("slow:2500"));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-attempts")).toMatch(/^primary=timeout,backup=200$/);
  });

  it("does not retry client errors elsewhere", async () => {
    const key = await createKey();
    const req = chat(key, say("fail:400"));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
    expect((await upstreamCalls(req)).map((c) => c.host)).toEqual(["primary"]);
  });

  it("returns 502 with the attempt list when every upstream fails", async () => {
    const key = await createKey();
    const req = chat(key, { model: "primary-only", messages: [{ role: "user", content: "fail:503" }] });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-gateway-attempts")).toBe("primary=503");
    expect(await res.json()).toMatchObject({ error: { type: "upstream_error" } });
  });
});
