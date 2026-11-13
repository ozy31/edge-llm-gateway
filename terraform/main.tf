# Cloudflare resources around the Worker. The Worker code, its Durable Object
# migrations and its secrets are deployed with wrangler; Terraform owns the
# account-level pieces that should not change on every code deploy.

# Hashes of client API keys and their limits (see scripts/new-key.mjs).
resource "cloudflare_workers_kv_namespace" "tenant_keys" {
  account_id = var.account_id
  title      = "${var.worker_name}-tenant-keys"
}

# Clients reach the gateway on its own hostname, not *.workers.dev.
resource "cloudflare_workers_custom_domain" "gateway" {
  account_id = var.account_id
  zone_id    = var.zone_id
  hostname   = var.gateway_hostname
  service    = var.worker_name
}

# The gateway authenticates to self-hosted model servers with an Access
# service token (cf-access-client-id / cf-access-client-secret headers).
resource "cloudflare_zero_trust_access_service_token" "gateway" {
  count = length(var.self_hosted_upstreams) > 0 ? 1 : 0

  account_id = var.account_id
  name       = "${var.worker_name}-upstream"
  duration   = var.service_token_duration
}

resource "cloudflare_zero_trust_access_policy" "gateway_only" {
  count = length(var.self_hosted_upstreams) > 0 ? 1 : 0

  account_id = var.account_id
  name       = "${var.worker_name}-only"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.gateway[0].id } }]
}

resource "cloudflare_zero_trust_access_application" "upstream" {
  for_each = toset(var.self_hosted_upstreams)

  account_id       = var.account_id
  name             = "${var.worker_name}-${each.key}"
  domain           = each.key
  type             = "self_hosted"
  session_duration = "0s" # every request carries the token; no session cookie

  policies = [{ id = cloudflare_zero_trust_access_policy.gateway_only[0].id, precedence = 1 }]
}
