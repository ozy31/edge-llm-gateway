import type { UpstreamBreaker } from "./breaker";
import type { TenantLimiter } from "./limiter";

export interface Env {
  GATEWAY_NAME: string;
  GATEWAY_CONFIG: unknown; // JSON object (wrangler var); see src/config.ts
  TENANT_KEYS: KVNamespace;
  TENANT_LIMITER: DurableObjectNamespace<TenantLimiter>;
  UPSTREAM_BREAKER: DurableObjectNamespace<UpstreamBreaker>;
  USAGE_EVENTS?: AnalyticsEngineDataset; // optional: the gateway works without it
}
