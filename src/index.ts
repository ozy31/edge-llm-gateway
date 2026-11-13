import { authenticate, mayUseModel } from "./auth";
import { loadConfig } from "./config";
import type { Env } from "./env";
import { error, json } from "./http";
import { callUpstream, MissingSecretError } from "./upstream";
import { readJson, validateChat } from "./validate";

const API_ROUTES = new Set(["/v1/models", "/v1/chat/completions"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
      const target = config.models[chat.value.model]!.targets[0]!;
      const upstream = config.upstreams[target.upstream]!;
      let res: Response;
      try {
        res = await callUpstream(upstream, target, chat.value, env, requestId);
      } catch (e) {
        if (e instanceof MissingSecretError) return error(500, "server_error", "gateway is misconfigured");
        return error(502, "upstream_error", "upstream unavailable", { "x-request-id": requestId });
      }
      const headers = new Headers(res.headers);
      headers.set("x-request-id", requestId);
      headers.set("x-gateway-upstream", target.upstream);
      return new Response(res.body, { status: res.status, headers });
    }

    return error(404, "not_found_error", `no route for ${request.method} ${url.pathname}`);
  },
} satisfies ExportedHandler<Env>;
