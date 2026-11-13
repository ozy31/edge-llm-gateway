import { mayUseModel, type Tenant } from "./auth";
import { breakerFor } from "./breaker";
import type { GatewayConfig } from "./config";
import type { Env } from "./env";
import { error } from "./http";
import { limiterFor, rateHeaders } from "./limiter";
import { routeChat, type Health } from "./router";
import { meterStream, withUsageRequested } from "./stream";
import { emit, outcomeFor, type ChatEvent } from "./telemetry";
import { MissingSecretError } from "./upstream";
import { usageTokens } from "./usage";
import { readJson, validateChat } from "./validate";

export async function handleChat(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: GatewayConfig,
  tenant: Tenant,
): Promise<Response> {
  const started = Date.now();
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const event: ChatEvent = {
    requestId,
    tenant: tenant.tenant,
    key: tenant.keyName,
    model: "",
    upstream: "",
    status: 0,
    outcome: "rejected",
    attempts: "",
    attemptCount: 0,
    latencyMs: 0,
    tokens: 0,
    streamed: false,
  };
  const finish = (res: Response, patch: Partial<ChatEvent> = {}): Response => {
    Object.assign(event, { status: res.status, latencyMs: Date.now() - started }, patch);
    emit(event, env.USAGE_EVENTS);
    return res;
  };

  if (request.method !== "POST") return error(405, "invalid_request_error", "use POST", { allow: "POST" });
  const body = await readJson(request, config.limits.maxBodyBytes);
  if (!body.ok) return finish(error(body.status, "invalid_request_error", body.message));
  const chat = validateChat(body.value, config.limits.maxTokensCap);
  if (!chat.ok) return finish(error(400, "invalid_request_error", chat.message));
  event.model = chat.value.model;
  if (!config.models[chat.value.model]) {
    return finish(error(404, "not_found_error", `model ${chat.value.model} is not served by this gateway`));
  }
  if (!mayUseModel(tenant, chat.value.model)) {
    return finish(error(403, "permission_error", `this key may not use model ${chat.value.model}`));
  }

  const limiter = limiterFor(env.TENANT_LIMITER, tenant.tenant);
  const budget = await limiter.budget(tenant.monthlyTokenBudget);
  if (budget.remaining <= 0) {
    return finish(error(429, "insufficient_quota", `monthly token budget of ${budget.budget} is used up for ${budget.month}`), {
      outcome: "budget_exhausted",
    });
  }
  const rate = await limiter.take(tenant.requestsPerMinute);
  if (!rate.allowed) {
    return finish(error(429, "rate_limit_error", `rate limit of ${rate.limit} requests per minute reached`, rateHeaders(rate)), {
      outcome: "rate_limited",
    });
  }

  const streaming = chat.value.stream === true;
  event.streamed = streaming;
  const prepared = streaming ? withUsageRequested(chat.value) : { body: chat.value, clientWantsUsage: false };
  const health: Health = {
    allow: (name) => breakerFor(env.UPSTREAM_BREAKER, name).allow(config.upstreams[name]!.breaker),
    record: (name, ok) => ctx.waitUntil(breakerFor(env.UPSTREAM_BREAKER, name).record(ok, config.upstreams[name]!.breaker)),
  };
  let routed;
  try {
    routed = await routeChat(config, prepared.body as typeof chat.value, env, requestId, health);
  } catch (e) {
    if (e instanceof MissingSecretError) return finish(error(500, "server_error", "gateway is misconfigured"));
    throw e;
  }
  event.attempts = routed.attempts.map((a) => `${a.upstream}=${a.outcome}`).join(",");
  event.attemptCount = routed.attempts.filter((a) => a.outcome !== "circuit_open").length;

  if (!routed.response || !routed.target || routed.response.body === null) {
    const status = routed.response?.status === 429 ? 429 : 502;
    return finish(
      error(status, status === 429 ? "rate_limit_error" : "upstream_error", "all upstreams failed", {
        "x-request-id": requestId,
        "x-gateway-attempts": event.attempts,
      }),
      { outcome: "upstream_failed" },
    );
  }

  event.upstream = routed.target.upstream;
  const headers = new Headers(routed.response.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-gateway-upstream", routed.target.upstream);
  headers.set("x-gateway-attempts", event.attempts);
  for (const [k, v] of Object.entries(rateHeaders(rate))) headers.set(k, v);
  headers.set("x-gateway-tokens-remaining-month", String(budget.remaining));
  if (routed.redactions > 0) headers.set("x-gateway-redactions", String(routed.redactions));

  if (streaming && routed.response.ok) {
    const status = routed.response.status;
    const metered = meterStream(routed.response.body, prepared.clientWantsUsage, (tokens) => {
      if (tokens > 0) ctx.waitUntil(limiter.recordUsage(tokens));
      // latency for streams is time to the end of the stream
      Object.assign(event, { status, outcome: "ok", tokens, latencyMs: Date.now() - started });
      emit(event, env.USAGE_EVENTS);
    });
    headers.delete("content-length");
    return new Response(metered, { status, headers });
  }

  // Non-streaming: the body is small JSON; read usage from it and record it
  // after the response is sent.
  const text = await routed.response.text();
  const tokens = usageTokens(text);
  if (tokens > 0) ctx.waitUntil(limiter.recordUsage(tokens));
  const res = new Response(text, { status: routed.response.status, headers });
  return finish(res, { outcome: outcomeFor(res.status), tokens });
}
