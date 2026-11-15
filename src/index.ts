import { authenticate, mayUseModel } from "./auth";
import { handleChat } from "./chat";
import { loadConfig } from "./config";
import type { Env } from "./env";
import { error, json } from "./http";
import { limiterFor } from "./limiter";

export { UpstreamBreaker } from "./breaker";
export { TenantLimiter } from "./limiter";

const API_ROUTES = new Set(["/v1/models", "/v1/usage", "/v1/chat/completions"]);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      // Health includes a valid configuration, so a bad GATEWAY_CONFIG fails
      // the post-deploy check instead of every API request.
      try {
        loadConfig(env.GATEWAY_CONFIG);
      } catch (e) {
        return json({ status: "error", gateway: env.GATEWAY_NAME, error: `invalid GATEWAY_CONFIG: ${(e as Error).message}` }, 503);
      }
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
    if (url.pathname !== "/v1/chat/completions" && request.method !== "GET" && request.method !== "HEAD") {
      return error(405, "invalid_request_error", `use GET for ${url.pathname}`, { allow: "GET, HEAD" });
    }

    if (url.pathname === "/v1/models") {
      const data = Object.keys(config.models)
        .filter((id) => mayUseModel(tenant, id))
        .sort()
        .map((id) => ({ id, object: "model", owned_by: env.GATEWAY_NAME }));
      return json({ object: "list", data });
    }
    if (url.pathname === "/v1/usage") {
      // A team can see where its own key stands without asking the platform team.
      const b = await limiterFor(env.TENANT_LIMITER, tenant.tenant).budget(tenant.monthlyTokenBudget);
      return json({
        tenant: tenant.tenant,
        key: tenant.keyName,
        month: b.month,
        tokens: { budget: b.budget, used: b.used, remaining: b.remaining },
        requests_per_minute: tenant.requestsPerMinute,
        expires_at: tenant.expiresAt ?? null,
      });
    }
    return handleChat(request, env, ctx, config, tenant);
  },
} satisfies ExportedHandler<Env>;
