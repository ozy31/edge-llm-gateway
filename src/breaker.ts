import { DurableObject } from "cloudflare:workers";

// Circuit breaker, one Durable Object per upstream. After `threshold`
// consecutive failures the upstream is skipped for `cooldownMs`; then one
// request is let through as a probe (half-open). A success closes it again.
// Without this, every request during an outage would wait for the primary to
// time out before falling back.

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerPolicy {
  threshold: number;
  cooldownMs: number;
}

export const DEFAULT_POLICY: BreakerPolicy = { threshold: 5, cooldownMs: 30_000 };

export class UpstreamBreaker extends DurableObject {
  private failures = 0;
  private openedAt = 0;
  private probing = false;

  state(policy: BreakerPolicy = DEFAULT_POLICY, now = Date.now()): BreakerState {
    if (this.failures < policy.threshold) return "closed";
    return now - this.openedAt >= policy.cooldownMs ? "half_open" : "open";
  }

  // Asks whether a request may go to this upstream. In half-open state only
  // one caller at a time gets a yes.
  allow(policy: BreakerPolicy = DEFAULT_POLICY, now = Date.now()): boolean {
    const s = this.state(policy, now);
    if (s === "closed") return true;
    if (s === "open" || this.probing) return false;
    this.probing = true;
    return true;
  }

  record(success: boolean, policy: BreakerPolicy = DEFAULT_POLICY, now = Date.now()): BreakerState {
    this.probing = false;
    if (success) {
      this.failures = 0;
    } else {
      this.failures += 1;
      if (this.failures >= policy.threshold) this.openedAt = now; // (re)open
    }
    return this.state(policy, now);
  }
}

export function breakerFor(ns: DurableObjectNamespace<UpstreamBreaker>, upstream: string): DurableObjectStub<UpstreamBreaker> {
  return ns.get(ns.idFromName(`upstream:${upstream}`));
}
