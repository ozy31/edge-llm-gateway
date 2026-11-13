// Client API keys. Only the SHA-256 of a key is stored (KV key "key:<hex>"),
// so a KV export or a leaked log line never contains a usable credential.

export interface Tenant {
  tenant: string; // billing / limit unit, e.g. a team
  keyName: string; // human label for this key
  models: string[] | "*"; // model aliases this key may call
  requestsPerMinute: number;
  monthlyTokenBudget: number; // prompt + completion tokens per calendar month (UTC)
  disabled?: boolean;
}

export const KEY_PREFIX = "sk-gw-";

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bearerToken(request: Request): string | undefined {
  const h = request.headers.get("authorization");
  const m = h?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1];
}

export type AuthResult =
  | { ok: true; tenant: Tenant; keyHash: string }
  | { ok: false; status: 401 | 403; message: string };

export async function authenticate(request: Request, keys: KVNamespace): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401, message: "missing bearer token" };
  if (!token.startsWith(KEY_PREFIX)) return { ok: false, status: 401, message: "invalid API key" };
  const keyHash = await sha256Hex(token);
  const tenant = await keys.get<Tenant>(`key:${keyHash}`, { type: "json", cacheTtl: 60 });
  if (!tenant) return { ok: false, status: 401, message: "invalid API key" };
  if (tenant.disabled) return { ok: false, status: 403, message: "API key is disabled" };
  return { ok: true, tenant, keyHash };
}

export function mayUseModel(tenant: Tenant, alias: string): boolean {
  return tenant.models === "*" || tenant.models.includes(alias);
}
