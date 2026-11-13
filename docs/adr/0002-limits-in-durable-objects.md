# 0002: Rate limits and budgets in one Durable Object per tenant

## Context

Limits must hold across all Cloudflare locations and across all keys of a
tenant. KV is eventually consistent and per-location caches would let a
tenant multiply its limit by the number of locations it hits.

## Decision

One `TenantLimiter` Durable Object per tenant (`idFromName("tenant:<id>")`):

- **Requests per minute**: a token bucket kept in memory. If the object is
  evicted the bucket starts full again, which errs towards letting traffic
  through. That is acceptable for a rate limit, whose job is smoothing.
- **Monthly token budget**: usage per UTC month persisted in the object's
  SQLite storage, because it is money and must survive eviction.

The budget is checked before a request and charged after it, from the usage
the upstream reports. A single request can therefore overshoot the budget by
its own size; reserving tokens up front would need a token estimate before
the call and a correction after, which is more complex than the overshoot is
worth.

## Consequences

- Each chat request makes two calls to the tenant's object (budget, take) and
  one write after the response. Durable Object calls from a Worker are
  typically single-digit milliseconds, small next to model latency.
- A very hot tenant is limited by one object's throughput (on the order of
  a thousand requests per second), far above what LLM traffic per team needs.
