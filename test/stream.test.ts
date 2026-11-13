import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { limiterFor } from "../src/limiter";
import { meterStream } from "../src/stream";
import { chat, createKey, hello, upstreamCalls } from "./helpers";

function events(text: string): string[] {
  return text.split("\n\n").filter(Boolean);
}

async function waitForUsage(tenant: string, expected: number): Promise<number> {
  const stub = limiterFor(env.TENANT_LIMITER, tenant);
  for (let i = 0; i < 50; i++) {
    const used = (await stub.budget(1)).used;
    if (used >= expected) return used;
    await new Promise((r) => setTimeout(r, 10));
  }
  return (await stub.budget(1)).used;
}

describe("streaming", () => {
  it("streams SSE through, hides the usage chunk the client did not ask for, and bills it", async () => {
    const key = await createKey({ tenant: "stream-plain" });
    const req = chat(key, hello("chat-small", { stream: true }));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = events(await res.text());
    expect(evs.at(-1)).toBe("data: [DONE]");
    expect(evs.some((e) => e.includes('"usage"'))).toBe(false);
    const content = evs
      .filter((e) => e !== "data: [DONE]")
      .map((e) => JSON.parse(e.slice(6)).choices[0].delta.content ?? "")
      .join("");
    expect(content).toBe("hello from primary");

    const [call] = await upstreamCalls(req);
    expect(call!.body.stream_options).toEqual({ include_usage: true });
    expect(await waitForUsage("stream-plain", 15)).toBe(15); // 12 prompt + 3 words
  });

  it("keeps the usage chunk when the client asked for it", async () => {
    const key = await createKey({ tenant: "stream-usage" });
    const res = await SELF.fetch(chat(key, hello("chat-small", { stream: true, stream_options: { include_usage: true } })));
    const evs = events(await res.text());
    expect(evs.filter((e) => e.includes('"usage"'))).toHaveLength(1);
    expect(await waitForUsage("stream-usage", 15)).toBe(15);
  });

  it("falls back before the first byte if the primary fails", async () => {
    const key = await createKey();
    const res = await SELF.fetch(chat(key, { model: "chat-small", stream: true, messages: [{ role: "user", content: "fail:503" }] }));
    expect(res.headers.get("x-gateway-upstream")).toBe("backup");
    const text = await res.text();
    expect(text).toContain('"model":"backup-small"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});

describe("meterStream", () => {
  it("handles events split across network chunks and CRLF line endings", async () => {
    const enc = new TextEncoder();
    const raw = 'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":7}}\r\n\r\ndata: [DONE]\r\n\r\n';
    const parts = [raw.slice(0, 17), raw.slice(17, 60), raw.slice(60)];
    const src = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    let billed = -1;
    const out = await new Response(meterStream(src, false, (t) => (billed = t))).text();
    expect(billed).toBe(7);
    expect(events(out)).toEqual(['data: {"choices":[{"delta":{"content":"a"}}]}', "data: [DONE]"]);
  });
});
