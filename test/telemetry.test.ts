import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { emit, outcomeFor, toDataPoint, type ChatEvent } from "../src/telemetry";
import { chat, createKey, hello } from "./helpers";

const event: ChatEvent = {
  requestId: "r1",
  tenant: "search-team",
  key: "ci",
  model: "chat-small",
  upstream: "backup",
  status: 200,
  outcome: "ok",
  attempts: "primary=503,backup=200",
  attemptCount: 2,
  latencyMs: 412,
  tokens: 20,
  streamed: false,
};

describe("telemetry", () => {
  it("maps an event to fixed Analytics Engine columns", () => {
    expect(toDataPoint(event)).toEqual({
      indexes: ["search-team"],
      blobs: ["ci", "chat-small", "backup", "ok", "primary=503,backup=200", "200"],
      doubles: [412, 20, 2],
    });
  });

  it("logs one JSON line and writes one data point", () => {
    const lines: string[] = [];
    const points: AnalyticsEngineDataPoint[] = [];
    emit(event, { writeDataPoint: (p) => points.push(p) }, (l) => lines.push(l));
    expect(points).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "chat_completion", tenant: "search-team", tokens: 20 });
  });

  it("never includes message content", async () => {
    const lines: string[] = [];
    emit({ ...event }, undefined, (l) => lines.push(l));
    expect(lines[0]).not.toContain("hello");
  });

  it.each([
    [200, "ok"],
    [400, "upstream_client_error"],
    [502, "upstream_failed"],
  ] as const)("classifies status %i as %s", (status, outcome) => {
    expect(outcomeFor(status)).toBe(outcome);
  });

  it("works end to end with the Analytics Engine binding present", async () => {
    const key = await createKey();
    expect((await SELF.fetch(chat(key, hello()))).status).toBe(200);
  });
});
