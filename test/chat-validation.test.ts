import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { chat, createKey } from "./helpers";

let key: string;
beforeAll(async () => {
  key = await createKey();
});

const post = (body: unknown) => SELF.fetch(chat(key, body));

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { type: string; message: string } }).error;
}

describe("/v1/chat/completions validation", () => {
  it("rejects non-JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });

  it("rejects bodies over the size limit", async () => {
    const res = await post({ model: "chat-small", messages: [{ role: "user", content: "x".repeat(30000) }] });
    expect(res.status).toBe(413);
  });

  it.each([
    [{ messages: [{ role: "user", content: "hi" }] }, "model is required"],
    [{ model: "chat-small", messages: [] }, "messages must be a non-empty array"],
    [{ model: "chat-small", messages: [{ role: "hacker", content: "hi" }] }, "messages[0].role is invalid"],
    [{ model: "chat-small", messages: [{ role: "user", content: "hi" }], max_tokens: 5000 }, "max_tokens must be <= 1024"],
    [{ model: "chat-small", messages: [{ role: "user", content: "hi" }], stream: "yes" }, "stream must be a boolean"],
  ])("rejects invalid request %#", async (body, message) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe(message);
  });

  it("returns 404 for models the gateway does not serve", async () => {
    const res = await post({ model: "gpt-unknown", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(404);
  });

  it("only accepts POST", async () => {
    const res = await SELF.fetch("https://gw.test/v1/chat/completions", { headers: { authorization: `Bearer ${key}` } });
    expect(res.status).toBe(405);
  });
});
