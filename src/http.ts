// Errors use the OpenAI error shape so existing SDKs surface them correctly.
export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "permission_error"
  | "not_found_error"
  | "rate_limit_error"
  | "insufficient_quota"
  | "upstream_error"
  | "server_error";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function error(status: number, type: ErrorType, message: string, headers: HeadersInit = {}): Response {
  return json({ error: { type, message, code: type } }, status, headers);
}
