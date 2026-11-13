# 0003: Fallback and circuit breaking

## Decision

- A model alias has an ordered list of targets. A target is skipped to the
  next on 408, 429, 500, 502, 503, 504, a timeout or a network error. Other
  4xx responses mean the request itself is wrong and are returned unchanged.
- Fallback only happens before any byte reaches the client. Once a stream has
  started, a failure ends the stream; replaying a half-delivered answer from
  another model would confuse the client more than an error.
- One `UpstreamBreaker` Durable Object per upstream counts consecutive
  failures. At the threshold it opens for the cooldown, then admits a single
  probe. 429 triggers fallback but not the breaker, because "busy" is not
  "broken".
- The last target is always tried even if its breaker is open: trying a
  probably-down upstream is better than failing without trying.

## Consequences

During an outage of the primary, after `threshold` requests clients stop
paying the primary's timeout and go straight to the fallback. The attempt
trail (`x-gateway-attempts`, also in analytics) makes every fallback visible.
