# Rotate the Access service token for self-hosted upstreams

The token expires after `service_token_duration` (default one year).
Cloudflare sends an expiring-token notification if one is configured.

1. `terraform apply -replace='cloudflare_zero_trust_access_service_token.gateway[0]'`
   creates a new token; the Access policy is updated to the new token id.
2. Immediately store the new values:
   `terraform output -raw access_client_secret | npx wrangler secret put ACCESS_CLIENT_SECRET`
   and the same for `ACCESS_CLIENT_ID`.
3. Between steps 1 and 2 requests to self-hosted upstreams fail and fall back.
   For a zero-gap rotation, add a second token to the policy first, switch
   the secrets, then remove the old token.
