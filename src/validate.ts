// Validation of /v1/chat/completions bodies. Only what the gateway relies on
// is checked; everything else is passed through to the upstream untouched.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: unknown;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
  [key: string]: unknown;
}

const ROLES = new Set(["system", "user", "assistant", "tool", "developer"]);

export type Validation = { ok: true; value: ChatRequest } | { ok: false; message: string };

export function validateChat(body: unknown, maxTokensCap: number): Validation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.model !== "string" || b.model === "") return { ok: false, message: "model is required" };
  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, message: "messages must be a non-empty array" };
  }
  for (const [i, m] of b.messages.entries()) {
    if (typeof m !== "object" || m === null || !ROLES.has((m as { role?: unknown }).role as string)) {
      return { ok: false, message: `messages[${i}].role is invalid` };
    }
  }
  if (b.stream !== undefined && typeof b.stream !== "boolean") return { ok: false, message: "stream must be a boolean" };
  for (const key of ["max_tokens", "max_completion_tokens"] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return { ok: false, message: `${key} must be a positive integer` };
    }
    if (v > maxTokensCap) return { ok: false, message: `${key} must be <= ${maxTokensCap}` };
  }
  return { ok: true, value: b as ChatRequest };
}

// Reads a JSON body with a size limit, without trusting Content-Length.
export async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, status: 413, message: `body larger than ${maxBytes} bytes` };
  const buf = await request.arrayBuffer();
  if (buf.byteLength > maxBytes) return { ok: false, status: 413, message: `body larger than ${maxBytes} bytes` };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false, status: 400, message: "body is not valid JSON" };
  }
}
