// Gateway configuration: which upstreams exist and which public model names
// map to which upstream models. It is plain JSON (a wrangler var), parsed and
// validated once per isolate so a bad deploy fails loudly on the first request.

export type UpstreamAuth =
  | { type: "none" }
  | { type: "bearer"; secret: string } // name of a Worker secret holding the key
  | { type: "access_service_token"; idSecret: string; secretSecret: string }; // Cloudflare Access

export interface Upstream {
  baseUrl: string; // OpenAI-compatible base, e.g. https://api.openai.com/v1
  auth: UpstreamAuth;
  timeoutMs: number;
  breaker: { threshold: number; cooldownMs: number };
}

export interface Target {
  upstream: string;
  model: string; // model name the upstream expects
}

export interface ModelRoute {
  targets: Target[]; // tried in order; later ones are fallbacks
}

export interface Limits {
  maxBodyBytes: number;
  maxTokensCap: number; // hard ceiling on max_tokens a client may request
}

export interface GatewayConfig {
  upstreams: Record<string, Upstream>;
  models: Record<string, ModelRoute>;
  limits: Limits;
}

export class ConfigError extends Error {}

const DEFAULT_LIMITS: Limits = { maxBodyBytes: 1_000_000, maxTokensCap: 4096 };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseAuth(name: string, v: unknown): UpstreamAuth {
  if (v === undefined) return { type: "none" };
  if (!isObject(v)) throw new ConfigError(`upstream ${name}: auth must be an object`);
  switch (v.type) {
    case "none":
      return { type: "none" };
    case "bearer":
      if (typeof v.secret !== "string") throw new ConfigError(`upstream ${name}: bearer auth needs "secret"`);
      return { type: "bearer", secret: v.secret };
    case "access_service_token":
      if (typeof v.idSecret !== "string" || typeof v.secretSecret !== "string") {
        throw new ConfigError(`upstream ${name}: access_service_token needs "idSecret" and "secretSecret"`);
      }
      return { type: "access_service_token", idSecret: v.idSecret, secretSecret: v.secretSecret };
    default:
      throw new ConfigError(`upstream ${name}: unknown auth type ${String(v.type)}`);
  }
}

export function parseConfig(raw: unknown): GatewayConfig {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isObject(value)) throw new ConfigError("config must be an object");
  if (!isObject(value.upstreams) || !isObject(value.models)) {
    throw new ConfigError('config needs "upstreams" and "models"');
  }

  const upstreams: Record<string, Upstream> = {};
  for (const [name, u] of Object.entries(value.upstreams)) {
    if (!isObject(u) || typeof u.baseUrl !== "string") throw new ConfigError(`upstream ${name}: baseUrl is required`);
    const url = new URL(u.baseUrl);
    if (url.protocol !== "https:") throw new ConfigError(`upstream ${name}: baseUrl must be https`);
    upstreams[name] = {
      baseUrl: u.baseUrl.replace(/\/+$/, ""),
      auth: parseAuth(name, u.auth),
      timeoutMs: typeof u.timeoutMs === "number" ? u.timeoutMs : 30_000,
      breaker: {
        threshold: isObject(u.breaker) && typeof u.breaker.threshold === "number" ? u.breaker.threshold : 5,
        cooldownMs: isObject(u.breaker) && typeof u.breaker.cooldownMs === "number" ? u.breaker.cooldownMs : 30_000,
      },
    };
  }

  const models: Record<string, ModelRoute> = {};
  for (const [alias, m] of Object.entries(value.models)) {
    if (!isObject(m) || !Array.isArray(m.targets) || m.targets.length === 0) {
      throw new ConfigError(`model ${alias}: needs at least one target`);
    }
    models[alias] = {
      targets: m.targets.map((t, i) => {
        if (!isObject(t) || typeof t.upstream !== "string" || typeof t.model !== "string") {
          throw new ConfigError(`model ${alias}: target ${i} needs "upstream" and "model"`);
        }
        if (!upstreams[t.upstream]) throw new ConfigError(`model ${alias}: unknown upstream ${t.upstream}`);
        return { upstream: t.upstream, model: t.model };
      }),
    };
  }

  const limits = { ...DEFAULT_LIMITS, ...(isObject(value.limits) ? value.limits : {}) } as Limits;
  return { upstreams, models, limits };
}

let cached: { raw: unknown; config: GatewayConfig } | undefined;

export function loadConfig(raw: unknown): GatewayConfig {
  if (cached && cached.raw === raw) return cached.config;
  const config = parseConfig(raw);
  cached = { raw, config };
  return config;
}
