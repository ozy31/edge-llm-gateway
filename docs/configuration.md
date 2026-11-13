# Configuration

`GATEWAY_CONFIG` is a JSON object in `wrangler.jsonc` vars. It is parsed and
validated on the first request in each isolate; an invalid config fails every
request with a clear error instead of half-working.

```jsonc
{
  "upstreams": {
    "<name>": {
      "baseUrl": "https://host/v1",          // must be https; /chat/completions is appended
      "auth": { "type": "none" },            // or bearer / access_service_token, see below
      "timeoutMs": 30000,                    // per attempt; then the next target is tried
      "breaker": { "threshold": 5, "cooldownMs": 30000 },
      "redact": false                        // true for third-party providers
    }
  },
  "models": {
    "<alias clients use>": {
      "targets": [
        { "upstream": "<name>", "model": "<model name the upstream expects>" }
      ]
    }
  },
  "limits": { "maxBodyBytes": 1000000, "maxTokensCap": 4096 }
}
```

Auth types (values are names of Worker secrets, never the secrets themselves):

| type | fields | sends |
| --- | --- | --- |
| `none` | | nothing |
| `bearer` | `secret` | `Authorization: Bearer <secret>` |
| `access_service_token` | `idSecret`, `secretSecret` | `cf-access-client-id`, `cf-access-client-secret` |

Tenant records in KV (`key:<sha256 of the key>`):

```json
{ "tenant": "search-team", "keyName": "ci", "models": ["chat-small"], "requestsPerMinute": 60, "monthlyTokenBudget": 2000000 }
```

Set `"disabled": true` to revoke a key immediately (KV cache: up to 60 s).
