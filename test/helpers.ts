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

// Each request gets its own cf-ray (the request id the gateway propagates), so
// a test can find exactly its own upstream calls even with files in parallel.
export function chat(key: string | undefined, body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request("https://gw.test/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-ray": crypto.randomUUID(),
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const hello = (model = "chat-small", extra: Record<string, unknown> = {}) => ({
  model,
  messages: [{ role: "user", content: "hello" }],
  ...extra,
});

export interface Seen {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// What the fake upstreams received for one gateway request.
export async function upstreamCalls(req: Request): Promise<Seen[]> {
  const id = req.headers.get("cf-ray");
  const all = (await (await fetch("https://control.upstream.test/")).json()) as Seen[];
  return all.filter((c) => c.headers["x-request-id"] === id);
}
