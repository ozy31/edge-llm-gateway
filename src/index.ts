import { authenticate, mayUseModel } from "./auth";
import { handleChat } from "./chat";
import { loadConfig } from "./config";
import type { Env } from "./env";
import { error, json } from "./http";

export { UpstreamBreaker } from "./breaker";
export { TenantLimiter } from "./limiter";

const API_ROUTES = new Set(["/v1/models", "/v1/chat/completions"]);

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
      const data = Object.keys(config.models)
        .filter((id) => mayUseModel(tenant, id))
        .sort()
        .map((id) => ({ id, object: "model", owned_by: env.GATEWAY_NAME }));
      return json({ object: "list", data });
    }
    return handleChat(request, env, ctx, config, tenant);
  },
} satisfies ExportedHandler<Env>;
