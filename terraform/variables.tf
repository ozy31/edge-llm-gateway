variable "account_id" {
  type        = string
  description = "Cloudflare account ID."
}

variable "zone_id" {
  type        = string
  description = "Zone that holds the gateway hostname."
}

variable "gateway_hostname" {
  type        = string
  description = "Public hostname clients call, e.g. llm.example.com."
}

variable "worker_name" {
  type        = string
  default     = "edge-llm-gateway"
  description = "Must match \"name\" in wrangler.jsonc. The script itself is deployed by wrangler."
}

variable "self_hosted_upstreams" {
  type        = list(string)
  default     = []
  description = <<-EOT
    Hostnames of self-hosted model servers (behind a Cloudflare Tunnel). Each
    gets an Access application that only the gateway's service token may
    pass, so the model servers are not reachable from the internet directly.
  EOT

  validation {
    condition     = alltrue([for h in var.self_hosted_upstreams : can(regex("^[a-z0-9.-]+$", h))])
    error_message = "self_hosted_upstreams must be bare hostnames, without scheme or path."
  }
}

variable "service_token_duration" {
  type        = string
  default     = "8760h"
  description = "Lifetime of the gateway's Access service token. Rotate before it expires (see docs/runbooks/rotate-service-token.md)."
}
