import type { GatewayConfig, Target } from "./config";
import { callUpstream } from "./upstream";
import type { ChatRequest } from "./validate";

// Statuses where another upstream may succeed. Other 4xx mean the request
// itself is wrong, so trying elsewhere would only repeat the error.
export const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface Attempt {
  upstream: string;
  outcome: number | "timeout" | "network_error" | "circuit_open";
  ms: number;
}

export interface RouteResult {
  response?: Response; // undefined only when every attempt failed without an HTTP response
  target?: Target;
  attempts: Attempt[];
}

export interface Health {
  allow(upstream: string): Promise<boolean>;
  record(upstream: string, success: boolean): void;
}

export const ALWAYS_HEALTHY: Health = { allow: async () => true, record: () => {} };

export async function routeChat(
  config: GatewayConfig,
  chat: ChatRequest,
  env: object,
  requestId: string,
  health: Health = ALWAYS_HEALTHY,
): Promise<RouteResult> {
  const attempts: Attempt[] = [];
  let last: RouteResult = { attempts };
  const targets = config.models[chat.model]!.targets;
  for (const [i, target] of targets.entries()) {
    // Skip an upstream whose breaker is open, unless it is the last option:
    // trying a probably-down upstream beats failing without trying.
    if (i < targets.length - 1 && !(await health.allow(target.upstream))) {
      attempts.push({ upstream: target.upstream, outcome: "circuit_open", ms: 0 });
      continue;
    }
    const upstream = config.upstreams[target.upstream]!;
    const started = Date.now();
    let res: Response;
    try {
      res = await callUpstream(upstream, target, chat, env, requestId);
    } catch (e) {
      if (e instanceof Error && e.name !== "TimeoutError" && e.name !== "AbortError" && e.name !== "TypeError") throw e;
      attempts.push({ upstream: target.upstream, outcome: e instanceof Error && e.name === "TypeError" ? "network_error" : "timeout", ms: Date.now() - started });
      health.record(target.upstream, false);
      continue;
    }
    attempts.push({ upstream: target.upstream, outcome: res.status, ms: Date.now() - started });
    // 429 means "busy", not "broken": it triggers fallback but not the breaker.
    if (res.status !== 429) health.record(target.upstream, !RETRYABLE.has(res.status));
    if (!RETRYABLE.has(res.status)) return { response: res, target, attempts };
    await res.body?.cancel();
    last = { response: new Response(null, { status: res.status }), target, attempts };
  }
  return last;
}
