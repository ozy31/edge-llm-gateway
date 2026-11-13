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

export interface BudgetStatus {
  month: string;
  budget: number;
  used: number;
  remaining: number;
}

export function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7); // UTC calendar month, e.g. 2026-11
}

export class TenantLimiter extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Token usage is money, so unlike the request bucket it is persisted.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS usage (month TEXT PRIMARY KEY, tokens INTEGER NOT NULL)");
  }

  private used(month: string): number {
    const row = this.ctx.storage.sql.exec<{ tokens: number }>("SELECT tokens FROM usage WHERE month = ?", month).toArray()[0];
    return row?.tokens ?? 0;
  }

  budget(monthlyBudget: number, month = monthKey()): BudgetStatus {
    const used = this.used(month);
    return { month, budget: monthlyBudget, used, remaining: Math.max(0, monthlyBudget - used) };
  }

  recordUsage(tokens: number, month = monthKey()): number {
    if (!Number.isFinite(tokens) || tokens <= 0) return this.used(month);
    this.ctx.storage.sql.exec(
      "INSERT INTO usage (month, tokens) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET tokens = tokens + excluded.tokens",
      month,
      Math.round(tokens),
    );
    return this.used(month);
  }

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
