import type { Target, Upstream } from "./config";
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

export function upstreamBody(chat: ChatRequest, target: Target): string {
  return JSON.stringify({ ...chat, model: target.model });
}

export async function callUpstream(
  upstream: Upstream,
  target: Target,
  chat: ChatRequest,
  env: object,
  requestId: string,
): Promise<Response> {
  return fetch(`${upstream.baseUrl}/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders(upstream, env, requestId),
    body: upstreamBody(chat, target),
    signal: AbortSignal.timeout(upstream.timeoutMs),
  });
}
