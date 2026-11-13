import type { Env } from "./env";
import { error, json } from "./http";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return json({ status: "ok", gateway: env.GATEWAY_NAME });
    }
    return error(404, "not_found_error", `no route for ${request.method} ${url.pathname}`);
  },
} satisfies ExportedHandler<Env>;
