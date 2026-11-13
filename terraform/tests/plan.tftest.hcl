# Runs against the real provider schema with a mocked API: no account needed.
mock_provider "cloudflare" {}

variables {
  account_id       = "0123456789abcdef0123456789abcdef"
  zone_id          = "fedcba9876543210fedcba9876543210"
  gateway_hostname = "llm.example.com"
}

run "without_self_hosted_upstreams" {
  command = plan

  assert {
    condition     = length(cloudflare_zero_trust_access_service_token.gateway) == 0
    error_message = "no service token without self-hosted upstreams"
  }
  assert {
    condition     = cloudflare_workers_custom_domain.gateway.service == "edge-llm-gateway"
    error_message = "custom domain must point at the gateway worker"
  }
}

run "self_hosted_upstreams_only_admit_the_gateway" {
  command = plan

  variables {
    self_hosted_upstreams = ["llm.internal.example.com", "embed.internal.example.com"]
  }

  assert {
    condition     = length(cloudflare_zero_trust_access_application.upstream) == 2
    error_message = "one Access application per upstream"
  }
  assert {
    condition     = cloudflare_zero_trust_access_policy.gateway_only[0].decision == "non_identity"
    error_message = "upstreams must be service-token only"
  }
  assert {
    condition     = alltrue([for a in cloudflare_zero_trust_access_application.upstream : length(a.policies) == 1])
    error_message = "upstreams must have exactly the gateway policy"
  }
}

run "rejects_urls_as_hostnames" {
  command = plan

  variables {
    self_hosted_upstreams = ["https://llm.internal.example.com/v1"]
  }
  expect_failures = [var.self_hosted_upstreams]
}
