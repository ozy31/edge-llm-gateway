import { authenticate, mayUseModel } from "./auth";
import { loadConfig } from "./config";
import type { Env } from "./env";
import { error, json } from "./http";
import { limiterFor, rateHeaders } from "./limiter";
import { routeChat } from "./router";
import { meterStream, withUsageRequested } from "./stream";
import { usageTokens } from "./usage";
import { MissingSecretError } from "./upstream";
import { readJson, validateChat } from "./validate";

const API_ROUTES = new Set(["/v1/models", "/v1/chat/completions"]);

export { TenantLimiter } from "./limiter";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json({ status: "ok", gateway: env.GATEWAY_NAME });
    }

    if (!API_ROUTES.has(url.pathname)) {
      return error(404, "not_found_error", `no route for ${request.method} ${url.pathname}`);
    }
    const config = loadConfig(env.GATEWAY_CONFIG);

    const auth = await authenticate(request, env.TENANT_KEYS);
    if (!auth.ok) {
      return error(auth.status, auth.status === 401 ? "authentication_error" : "permission_error", auth.message, {
        "www-authenticate": "Bearer",
      });
    }
    const { tenant } = auth;

    if (url.pathname === "/v1/models") {
      return json({
        object: "list",
        data: Object.keys(config.models).filter((id) => mayUseModel(tenant, id)).sort().map((id) => ({ id, object: "model", owned_by: env.GATEWAY_NAME })),
      });
    }

    if (url.pathname === "/v1/chat/completions") {
      if (request.method !== "POST") return error(405, "invalid_request_error", "use POST", { allow: "POST" });
      const body = await readJson(request, config.limits.maxBodyBytes);
      if (!body.ok) return error(body.status, "invalid_request_error", body.message);
      const chat = validateChat(body.value, config.limits.maxTokensCap);
      if (!chat.ok) return error(400, "invalid_request_error", chat.message);
      if (!config.models[chat.value.model]) {
        return error(404, "not_found_error", `model ${chat.value.model} is not served by this gateway`);
      }
      if (!mayUseModel(tenant, chat.value.model)) {
        return error(403, "permission_error", `this key may not use model ${chat.value.model}`);
      }
      const limiter = limiterFor(env.TENANT_LIMITER, tenant.tenant);
      const budget = await limiter.budget(tenant.monthlyTokenBudget);
      if (budget.remaining <= 0) {
        return error(429, "insufficient_quota", `monthly token budget of ${budget.budget} is used up for ${budget.month}`);
      }
      const rate = await limiter.take(tenant.requestsPerMinute);
      if (!rate.allowed) {
        return error(429, "rate_limit_error", `rate limit of ${rate.limit} requests per minute reached`, rateHeaders(rate));
      }
      const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
      const streaming = chat.value.stream === true;
      const prepared = streaming ? withUsageRequested(chat.value) : { body: chat.value, clientWantsUsage: false };
      let routed;
      try {
        routed = await routeChat(config, prepared.body as typeof chat.value, env, requestId);
      } catch (e) {
        if (e instanceof MissingSecretError) return error(500, "server_error", "gateway is misconfigured");
        throw e;
      }
      const attempts = routed.attempts.map((a) => `${a.upstream}=${a.outcome}`).join(",");
      if (!routed.response || !routed.target || routed.response.body === null) {
        const status = routed.response?.status === 429 ? 429 : 502;
        return error(status, status === 429 ? "rate_limit_error" : "upstream_error", "all upstreams failed", {
          "x-request-id": requestId,
          "x-gateway-attempts": attempts,
        });
      }
      const headers = new Headers(routed.response.headers);
      headers.set("x-request-id", requestId);
      headers.set("x-gateway-upstream", routed.target.upstream);
      headers.set("x-gateway-attempts", attempts);
      for (const [k, v] of Object.entries(rateHeaders(rate))) headers.set(k, v);
      headers.set("x-gateway-tokens-remaining-month", String(budget.remaining));

      if (streaming && routed.response.ok) {
        const metered = meterStream(routed.response.body, prepared.clientWantsUsage, (tokens) => {
          if (tokens > 0) ctx.waitUntil(limiter.recordUsage(tokens));
        });
        headers.delete("content-length");
        return new Response(metered, { status: routed.response.status, headers });
      }

      // Non-streaming: the body is small JSON, read usage from it and record
      // it after the response is sent.
      const text = await routed.response.text();
      const tokens = usageTokens(text);
      if (tokens > 0) ctx.waitUntil(limiter.recordUsage(tokens));
      return new Response(text, { status: routed.response.status, headers });
    }

    return error(404, "not_found_error", `no route for ${request.method} ${url.pathname}`);
  },
} satisfies ExportedHandler<Env>;
