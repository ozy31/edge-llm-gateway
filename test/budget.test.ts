import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limiterFor, type TenantLimiter } from "../src/limiter";
import { chat, createKey, hello } from "./helpers";

async function usedTokens(tenant: string, expected: number): Promise<number> {
  const stub = limiterFor(env.TENANT_LIMITER, tenant);
  // usage is recorded in waitUntil, after the response; poll briefly
  for (let i = 0; i < 50; i++) {
    const s = await stub.budget(1);
    if (s.used >= expected) return s.used;
    await new Promise((r) => setTimeout(r, 10));
  }
  return (await stub.budget(1)).used;
}

describe("monthly token budgets", () => {
  it("accumulates usage per month in SQLite storage", async () => {
    const stub = limiterFor(env.TENANT_LIMITER, "budget-unit");
    await runInDurableObject(stub, (obj: TenantLimiter) => {
      obj.recordUsage(100, "2026-10");
      obj.recordUsage(50, "2026-11");
      obj.recordUsage(25, "2026-11");
      expect(obj.budget(1000, "2026-11")).toEqual({ month: "2026-11", budget: 1000, used: 75, remaining: 925 });
      expect(obj.budget(1000, "2026-10").used).toBe(100);
      expect(obj.budget(1000, "2026-12").used).toBe(0); // a new month starts at zero
    });
  });

  it("records upstream usage after each completion", async () => {
    const key = await createKey({ tenant: "budget-e2e" });
    const res = await SELF.fetch(chat(key, hello()));
    expect(res.status).toBe(200);
    expect(await usedTokens("budget-e2e", 20)).toBe(20); // fake upstream reports 20 tokens
  });

  it("rejects requests once the budget is used up", async () => {
    const key = await createKey({ tenant: "budget-small", monthlyTokenBudget: 30 });
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(200); // 20 used
    await usedTokens("budget-small", 20);
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(200); // 40 used: one request may overshoot
    await usedTokens("budget-small", 40);
    const res = await SELF.fetch(chat(key, hello()));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { type: "insufficient_quota" } });
  });
});
