# 0001: Run the gateway on Cloudflare Workers

## Context

Teams need one OpenAI-compatible endpoint with per-team keys, limits and
usage, in front of both self-hosted models (vLLM on Kubernetes, behind a
Cloudflare Tunnel) and hosted providers. The options were a gateway in the
cluster (LiteLLM, Envoy AI Gateway), Cloudflare AI Gateway on its own, or a
Worker.

## Decision

A Worker. It runs at the edge in front of the Tunnel, so self-hosted model
servers can stay private behind Cloudflare Access and only the gateway holds
the service token. It has no servers to run, and the parts that need global
consistency (limits, breaker state) map onto Durable Objects.

Cloudflare AI Gateway is complementary, not a replacement: it provides
caching and analytics for provider calls, but not per-team keys with budgets,
allow-lists or fallback to a self-hosted upstream behind Access. An upstream
`baseUrl` can point at an AI Gateway URL to get both.

## Consequences

- The gateway is TypeScript code with tests, not configuration of a product.
- Worker CPU limits do not matter much: the gateway mostly waits on I/O and
  streams bodies through without buffering.
- An in-cluster gateway would still be needed for traffic that must not leave
  the cluster; this design is for traffic that comes from outside it.
