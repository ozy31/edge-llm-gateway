output "tenant_keys_namespace_id" {
  description = "Put this in wrangler.jsonc (kv_namespaces[TENANT_KEYS].id)."
  value       = cloudflare_workers_kv_namespace.tenant_keys.id
}

output "access_client_id" {
  description = "Store with: wrangler secret put ACCESS_CLIENT_ID"
  value       = try(cloudflare_zero_trust_access_service_token.gateway[0].client_id, null)
}

output "access_client_secret" {
  description = "Store with: wrangler secret put ACCESS_CLIENT_SECRET"
  value       = try(cloudflare_zero_trust_access_service_token.gateway[0].client_secret, null)
  sensitive   = true
}
