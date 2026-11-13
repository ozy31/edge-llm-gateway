// Fake OpenAI-compatible upstreams, run on the Node side of the test pool.
// Every outbound fetch from workerd lands here (miniflare outboundService),
// so the gateway's real fetch, timeout and streaming code is exercised.
//
// Behaviour is chosen by the last user message:
//   "fail:<status>"  -> the PRIMARY upstream answers with that status
//   "slow:<ms>"      -> the PRIMARY upstream waits that long before answering
//   anything else    -> a normal completion
// The backup upstream always succeeds. https://control.upstream.test/ lets
// tests read what each upstream received (filtered by x-request-id).
import { Response, type Request } from "miniflare";

interface Seen {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
const seen: Seen[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body: Record<string, unknown>): string {
  const msgs = (body.messages as { role: string; content: unknown }[]) ?? [];
  const last = [...msgs].reverse().find((m) => m.role === "user");
  return typeof last?.content === "string" ? last.content : "";
}

function completion(model: string, text: string) {
  return {
    id: "chatcmpl-fake",
    object: "chat.completion",
    created: 1_800_000_000,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  };
}

function sse(model: string, text: string, includeUsage: boolean): Response {
  const words = text.split(" ");
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const [i, w] of words.entries()) {
        const chunk = { id: "chatcmpl-fake", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: (i ? " " : "") + w }, finish_reason: null }] };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        await sleep(5);
      }
      const done = { id: "chatcmpl-fake", object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
      controller.enqueue(enc.encode(`data: ${JSON.stringify(done)}\n\n`));
      if (includeUsage) {
        const usage = { id: "chatcmpl-fake", object: "chat.completion.chunk", model, choices: [], usage: { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length } };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(usage)}\n\n`));
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream as never, { headers: { "content-type": "text/event-stream" } });
}

export async function fakeUpstream(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === "control.upstream.test") {
    return Response.json(seen);
  }
  if (!url.hostname.endsWith(".upstream.test")) {
    return new Response("blocked: tests must not reach the internet", { status: 599 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const host = url.hostname.split(".")[0]!;
  seen.push({ host, path: url.pathname, headers: Object.fromEntries(request.headers), body });

  const text = lastUserText(body);
  const model = String(body.model);
  if (host === "primary") {
    const fail = text.match(/^fail:(\d{3})$/);
    if (fail) return Response.json({ error: { message: "fake failure" } }, { status: Number(fail[1]) });
    const slow = text.match(/^slow:(\d+)$/);
    if (slow) await sleep(Number(slow[1]));
  }
  const reply = `hello from ${host}`;
  if (body.stream) {
    const opts = body.stream_options as { include_usage?: boolean } | undefined;
    return sse(model, reply, Boolean(opts?.include_usage));
  }
  return Response.json(completion(model, reply));
}
