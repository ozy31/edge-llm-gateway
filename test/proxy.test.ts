import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { chat, createKey, hello, upstreamCalls } from "./helpers";

describe("proxying to the upstream", () => {
  it("rewrites the model alias and returns the completion", async () => {
    const key = await createKey();
    const req = chat(key, hello("chat-small", { temperature: 0.2 }));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-upstream")).toBe("primary");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]!.message.content).toBe("hello from primary");

    const [call] = await upstreamCalls(req);
    expect(call!.path).toBe("/v1/chat/completions");
    expect(call!.body.model).toBe("llama-8b");
    expect(call!.body.temperature).toBe(0.2); // unknown fields pass through
  });

  it("sends the upstream's credential, never the client's key", async () => {
    const key = await createKey();
    const req = chat(key, hello());
    await SELF.fetch(req);
    const [call] = await upstreamCalls(req);
    expect(call!.headers.authorization).toBe("Bearer test-primary-key");
    expect(JSON.stringify(call!.headers)).not.toContain(key);
  });

  it("passes upstream errors through with their status", async () => {
    const key = await createKey();
    const req = chat(key, hello("chat-small", { messages: [{ role: "user", content: "fail:400" }] }));
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
  });
});
