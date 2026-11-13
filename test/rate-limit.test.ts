import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limiterFor, type TenantLimiter } from "../src/limiter";
import { chat, createKey, hello } from "./helpers";

describe("token bucket", () => {
  it("allows a burst up to the limit, then refills over time", async () => {
    const stub = limiterFor(env.TENANT_LIMITER, "bucket-unit");
    await runInDurableObject(stub, (obj: TenantLimiter) => {
      const t0 = 1_000_000;
      for (let i = 0; i < 6; i++) expect(obj.take(6, t0).allowed).toBe(true);
      const denied = obj.take(6, t0);
      expect(denied).toMatchObject({ allowed: false, remaining: 0, retryAfterSec: 10 });
      expect(obj.take(6, t0 + 10_000).allowed).toBe(true); // 6/min = one every 10s
      expect(obj.take(6, t0 + 10_000).allowed).toBe(false);
    });
  });
});

describe("rate limiting through the gateway", () => {
  it("returns 429 with retry-after once a tenant is over its limit", async () => {
    const key = await createKey({ requestsPerMinute: 2 });
    const ok1 = await SELF.fetch(chat(key, hello()));
    expect(ok1.status).toBe(200);
    expect(ok1.headers.get("x-ratelimit-remaining-requests")).toBe("1");
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(200);
    const limited = await SELF.fetch(chat(key, hello()));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ error: { type: "rate_limit_error" } });
  });

  it("shares one limit across all keys of a tenant", async () => {
    const a = await createKey({ tenant: "shared-team", requestsPerMinute: 1 });
    const b = await createKey({ tenant: "shared-team", requestsPerMinute: 1 });
    expect((await SELF.fetch(chat(a, hello()))).status).toBe(200);
    expect((await SELF.fetch(chat(b, hello()))).status).toBe(429);
  });

  it("does not let one tenant use up another's limit", async () => {
    const noisy = await createKey({ requestsPerMinute: 1 });
    const quiet = await createKey({ requestsPerMinute: 1 });
    await SELF.fetch(chat(noisy, hello()));
    expect((await SELF.fetch(chat(noisy, hello()))).status).toBe(429);
    expect((await SELF.fetch(chat(quiet, hello()))).status).toBe(200);
  });
});
