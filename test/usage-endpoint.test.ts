import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chat, createKey, hello } from "./helpers";

const usage = (key?: string) =>
  SELF.fetch("https://gw.test/v1/usage", {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

describe("GET /v1/usage", () => {
  it("shows a key its own tenant's budget, usage and limits", async () => {
    const key = await createKey({
      tenant: "usage-endpoint",
      monthlyTokenBudget: 500,
      requestsPerMinute: 7,
    });
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(200); // fake upstream reports 20 tokens

    let body: {
      tokens: { used: number; remaining: number; budget: number };
    } & Record<string, unknown> = {
      tokens: { used: 0, remaining: 0, budget: 0 },
    };
    for (let i = 0; i < 50 && body.tokens.used < 20; i++) {
      body = await (await usage(key)).json();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(body).toMatchObject({
      tenant: "usage-endpoint",
      tokens: { budget: 500, used: 20, remaining: 480 },
      requests_per_minute: 7,
      expires_at: null,
    });
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it("needs a key", async () => {
    expect((await usage()).status).toBe(401);
  });
});
