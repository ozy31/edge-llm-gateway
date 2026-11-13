import { env } from "cloudflare:test";
import { sha256Hex, type Tenant } from "../src/auth";

let n = 0;

// Creates a key in the test KV namespace and returns the plaintext key.
export async function createKey(overrides: Partial<Tenant> = {}): Promise<string> {
  n += 1;
  const key = `sk-gw-test-${n}-${crypto.randomUUID()}`;
  const tenant: Tenant = {
    tenant: `tenant-${n}`,
    keyName: "test",
    models: "*",
    requestsPerMinute: 1000,
    monthlyTokenBudget: 1_000_000,
    ...overrides,
  };
  await env.TENANT_KEYS.put(`key:${await sha256Hex(key)}`, JSON.stringify(tenant));
  return key;
}

export function chat(key: string | undefined, body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}), ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const hello = (model = "chat-small", extra: Record<string, unknown> = {}) => ({
  model,
  messages: [{ role: "user", content: "hello" }],
  ...extra,
});
