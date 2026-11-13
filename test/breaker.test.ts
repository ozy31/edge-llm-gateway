import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { breakerFor, type UpstreamBreaker } from "../src/breaker";
import { chat, createKey, upstreamCalls } from "./helpers";

const policy = { threshold: 3, cooldownMs: 1000 };

describe("breaker state machine", () => {
  it("opens after consecutive failures, half-opens after the cooldown, closes on success", async () => {
    await runInDurableObject(breakerFor(env.UPSTREAM_BREAKER, "unit"), (b: UpstreamBreaker) => {
      const t = 5_000_000;
      b.record(false, policy, t);
      b.record(true, policy, t); // a success resets the count
      for (let i = 0; i < 3; i++) b.record(false, policy, t);
      expect(b.state(policy, t)).toBe("open");
      expect(b.allow(policy, t + 500)).toBe(false);
      expect(b.allow(policy, t + 1000)).toBe(true); // the probe
      expect(b.allow(policy, t + 1001)).toBe(false); // only one probe at a time
      expect(b.record(false, policy, t + 1200)).toBe("open"); // probe failed: open again
      expect(b.allow(policy, t + 2200)).toBe(true);
      expect(b.record(true, policy, t + 2300)).toBe("closed");
    });
  });
});

describe("breaker in the request path", () => {
  it("stops calling a failing upstream, then probes it again after the cooldown", async () => {
    const key = await createKey();
    const fail = () => chat(key, { model: "flaky-then-backup", messages: [{ role: "user", content: "fail:503" }] });

    for (let i = 0; i < 3; i++) {
      const res = await SELF.fetch(fail());
      expect(res.headers.get("x-gateway-attempts")).toBe("flaky=503,backup=200");
    }
    // breaker writes happen in waitUntil; wait until it is open
    const stub = breakerFor(env.UPSTREAM_BREAKER, "flaky");
    for (let i = 0; i < 50 && (await stub.state({ threshold: 3, cooldownMs: 200 })) === "closed"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const req = fail();
    const skipped = await SELF.fetch(req);
    expect(skipped.status).toBe(200);
    expect(skipped.headers.get("x-gateway-attempts")).toBe("flaky=circuit_open,backup=200");
    expect((await upstreamCalls(req)).map((c) => c.host)).toEqual(["backup"]);

    await new Promise((r) => setTimeout(r, 250)); // cooldown passes
    const probe = await SELF.fetch(chat(key, { model: "flaky-then-backup", messages: [{ role: "user", content: "ok now" }] }));
    expect(probe.headers.get("x-gateway-attempts")).toBe("flaky=200");
  });
});
