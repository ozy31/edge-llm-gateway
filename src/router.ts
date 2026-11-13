import type { GatewayConfig, Target } from "./config";
import { callUpstream } from "./upstream";
import type { ChatRequest } from "./validate";

// Statuses where another upstream may succeed. Other 4xx mean the request
// itself is wrong, so trying elsewhere would only repeat the error.
export const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface Attempt {
  upstream: string;
  outcome: number | "timeout" | "network_error";
  ms: number;
}

export interface RouteResult {
  response?: Response; // undefined only when every attempt failed without an HTTP response
  target?: Target;
  attempts: Attempt[];
}

export async function routeChat(
  config: GatewayConfig,
  chat: ChatRequest,
  env: object,
  requestId: string,
  skip: (upstream: string) => boolean = () => false,
): Promise<RouteResult> {
  const attempts: Attempt[] = [];
  let last: RouteResult = { attempts };
  for (const target of config.models[chat.model]!.targets) {
    if (skip(target.upstream)) continue;
    const upstream = config.upstreams[target.upstream]!;
    const started = Date.now();
    let res: Response;
    try {
      res = await callUpstream(upstream, target, chat, env, requestId);
    } catch (e) {
      if (e instanceof Error && e.name !== "TimeoutError" && e.name !== "AbortError" && e.name !== "TypeError") throw e;
      attempts.push({ upstream: target.upstream, outcome: e instanceof Error && e.name === "TypeError" ? "network_error" : "timeout", ms: Date.now() - started });
      continue;
    }
    attempts.push({ upstream: target.upstream, outcome: res.status, ms: Date.now() - started });
    if (!RETRYABLE.has(res.status)) return { response: res, target, attempts };
    await res.body?.cancel();
    last = { response: new Response(null, { status: res.status }), target, attempts };
  }
  return last;
}
