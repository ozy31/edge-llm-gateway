import { loadConfig } from "./config";
import type { Env } from "./env";
import { error, json } from "./http";
import { readJson, validateChat } from "./validate";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json({ status: "ok", gateway: env.GATEWAY_NAME });
    }

    const config = loadConfig(env.GATEWAY_CONFIG);

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return json({
        object: "list",
        data: Object.keys(config.models).sort().map((id) => ({ id, object: "model", owned_by: env.GATEWAY_NAME })),
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
      return error(501, "server_error", "upstream routing not implemented yet");
    }

    return error(404, "not_found_error", `no route for ${request.method} ${url.pathname}`);
  },
} satisfies ExportedHandler<Env>;
