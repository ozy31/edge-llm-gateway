import type { Target, Upstream } from "./config";
import { redactMessages } from "./redact";
import type { ChatRequest } from "./validate";

export class MissingSecretError extends Error {}

function secret(env: object, name: string): string {
  const v = (env as Record<string, unknown>)[name];
  if (typeof v !== "string" || v === "") throw new MissingSecretError(`secret ${name} is not set`);
  return v;
}

// Headers for the upstream. The client's own Authorization header is never
// forwarded: clients authenticate to the gateway, the gateway to upstreams.
export function upstreamHeaders(upstream: Upstream, env: object, requestId: string): Headers {
  const h = new Headers({ "content-type": "application/json", "x-request-id": requestId });
  switch (upstream.auth.type) {
    case "bearer":
      h.set("authorization", `Bearer ${secret(env, upstream.auth.secret)}`);
      break;
    case "access_service_token":
      h.set("cf-access-client-id", secret(env, upstream.auth.idSecret));
      h.set("cf-access-client-secret", secret(env, upstream.auth.secretSecret));
      break;
    case "none":
      break;
  }
  return h;
}

export function upstreamBody(chat: ChatRequest, target: Target, upstream: Upstream): { body: string; redactions: number } {
  if (!upstream.redact) return { body: JSON.stringify({ ...chat, model: target.model }), redactions: 0 };
  const r = redactMessages(chat.messages);
  return { body: JSON.stringify({ ...chat, model: target.model, messages: r.messages }), redactions: r.count };
}

export async function callUpstream(
  upstream: Upstream,
  target: Target,
  chat: ChatRequest,
  env: object,
  requestId: string,
): Promise<{ response: Response; redactions: number }> {
  const { body, redactions } = upstreamBody(chat, target, upstream);
  const response = await fetch(`${upstream.baseUrl}/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders(upstream, env, requestId),
    body,
    signal: AbortSignal.timeout(upstream.timeoutMs),
  });
  return { response, redactions };
}
