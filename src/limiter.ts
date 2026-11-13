import { DurableObject } from "cloudflare:workers";

// One Durable Object per tenant: every request for that tenant, from any
// Cloudflare location, goes through the same object, so the limit is exact
// rather than per-colo like a cache-based counter.

export interface TakeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
}

export class TenantLimiter extends DurableObject {
  // Token bucket for requests per minute. Kept in memory: if the object is
  // evicted the bucket refills, which errs on the side of letting traffic
  // through (see docs/adr/0002-limits-in-durable-objects.md).
  private tokens = -1;
  private updated = 0;

  take(requestsPerMinute: number, now = Date.now()): TakeResult {
    const ratePerMs = requestsPerMinute / 60_000;
    if (this.tokens < 0) {
      this.tokens = requestsPerMinute;
      this.updated = now;
    }
    this.tokens = Math.min(requestsPerMinute, this.tokens + (now - this.updated) * ratePerMs);
    this.updated = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, limit: requestsPerMinute, remaining: Math.floor(this.tokens), retryAfterSec: 0 };
    }
    const retryAfterSec = Math.max(1, Math.ceil((1 - this.tokens) / ratePerMs / 1000));
    return { allowed: false, limit: requestsPerMinute, remaining: 0, retryAfterSec };
  }
}

export function limiterFor(ns: DurableObjectNamespace<TenantLimiter>, tenant: string): DurableObjectStub<TenantLimiter> {
  return ns.get(ns.idFromName(`tenant:${tenant}`));
}

export function rateHeaders(r: TakeResult): Record<string, string> {
  const h: Record<string, string> = {
    "x-ratelimit-limit-requests": String(r.limit),
    "x-ratelimit-remaining-requests": String(r.remaining),
  };
  if (!r.allowed) h["retry-after"] = String(r.retryAfterSec);
  return h;
}
