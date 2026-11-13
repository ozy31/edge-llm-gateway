import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ibanValid, luhn, redactMessages, redactText } from "../src/redact";
import { chat, createKey, upstreamCalls } from "./helpers";

describe("redaction rules", () => {
  it("checks Luhn and IBAN mod-97", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(ibanValid("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(ibanValid("GB82 WEST 1234 5698 7654 33")).toBe(false);
  });

  it.each([
    ["mail me at jane.doe@example.com please", "mail me at [EMAIL] please", 1],
    ["card 4111 1111 1111 1111 exp 12/29", "card [CARD] exp 12/29", 1],
    ["pay to GB82 WEST 1234 5698 7654 32 today", "pay to [IBAN] today", 1],
    ["order 1234567890123456 is not a card", "order 1234567890123456 is not a card", 0], // fails Luhn
    ["deploy v1.2.3 to 10.0.0.1 at 2026-11-13", "deploy v1.2.3 to 10.0.0.1 at 2026-11-13", 0],
  ])("redacts %j", (input, expected, count) => {
    expect(redactText(input)).toEqual({ text: expected, count });
  });

  it("handles string content and text parts", () => {
    const { messages, count } = redactMessages([
      { role: "user", content: "a@b.io" },
      { role: "user", content: [{ type: "text", text: "c@d.io" }, { type: "image_url", image_url: { url: "https://x" } }] },
    ]);
    expect(count).toBe(2);
    expect(messages[0]!.content).toBe("[EMAIL]");
    expect(messages[1]!.content).toEqual([{ type: "text", text: "[EMAIL]" }, { type: "image_url", image_url: { url: "https://x" } }]);
  });
});

describe("redaction per upstream", () => {
  const secret = "my card is 4111-1111-1111-1111, mail jane@example.com";

  it("redacts before a redact:true upstream and reports how many", async () => {
    const key = await createKey();
    const req = chat(key, { model: "backup-only", messages: [{ role: "user", content: secret }] });
    const res = await SELF.fetch(req);
    expect(res.headers.get("x-gateway-redactions")).toBe("2");
    const [call] = await upstreamCalls(req);
    expect(JSON.stringify(call!.body)).not.toContain("4111");
    expect((call!.body.messages as { content: string }[])[0]!.content).toBe("my card is [CARD], mail [EMAIL]");
  });

  it("sends the prompt unchanged to a self-hosted upstream", async () => {
    const key = await createKey();
    const req = chat(key, { model: "primary-only", messages: [{ role: "user", content: secret }] });
    const res = await SELF.fetch(req);
    expect(res.headers.get("x-gateway-redactions")).toBeNull();
    const [call] = await upstreamCalls(req);
    expect((call!.body.messages as { content: string }[])[0]!.content).toBe(secret);
  });
});
