import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isExpired, sha256Hex } from "../src/auth";
import { chat, createKey, hello } from "./helpers";

const models = (key: string) =>
  SELF.fetch("https://gw.test/v1/models", { headers: { authorization: `Bearer ${key}` } });

describe("authentication", () => {
  it("requires a bearer token", async () => {
    const res = await SELF.fetch(chat(undefined, hello()));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("rejects unknown and malformed keys the same way", async () => {
    for (const k of ["sk-gw-does-not-exist", "sk-openai-style-key"]) {
      const res = await SELF.fetch(chat(k, hello()));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { message: "invalid API key" } });
    }
  });

  it("rejects disabled keys with 403", async () => {
    const key = await createKey({ disabled: true });
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(403);
  });

  it("stores only the hash of a key", async () => {
    const key = await createKey();
    const listed = await env.TENANT_KEYS.list({ prefix: "key:" });
    expect(listed.keys.some((k) => k.name.includes(key))).toBe(false);
    expect(await env.TENANT_KEYS.get(`key:${await sha256Hex(key)}`)).not.toBeNull();
  });

  it("limits a key to its allowed models", async () => {
    const key = await createKey({ models: ["backup-only"] });
    const list = (await (await models(key)).json()) as { data: { id: string }[] };
    expect(list.data.map((m) => m.id)).toEqual(["backup-only"]);
    const res = await SELF.fetch(chat(key, hello("chat-small")));
    expect(res.status).toBe(403);
  });

  it("health checks need no key", async () => {
    expect((await SELF.fetch("https://gw.test/healthz")).status).toBe(200);
  });
});

describe("key expiry", () => {
  it("accepts a key before its expiry and rejects it after", async () => {
    const future = await createKey({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await SELF.fetch(chat(future, hello()))).status).toBe(200);

    const past = await createKey({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const res = await SELF.fetch(chat(past, hello()));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("API key has expired");
  });

  it("fails closed on an expiry it cannot parse", () => {
    expect(isExpired({ tenant: "t", keyName: "k", models: "*", requestsPerMinute: 1, monthlyTokenBudget: 1, expiresAt: "next tuesday" })).toBe(true);
    expect(isExpired({ tenant: "t", keyName: "k", models: "*", requestsPerMinute: 1, monthlyTokenBudget: 1 })).toBe(false);
  });
});
