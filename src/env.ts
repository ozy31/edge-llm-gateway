export interface Env {
  GATEWAY_NAME: string;
  GATEWAY_CONFIG: unknown; // JSON object (wrangler var); see src/config.ts
  TENANT_KEYS: KVNamespace;
}
