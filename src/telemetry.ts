// One event per chat request: a structured log line (Workers Logs) and a data
// point in Workers Analytics Engine for per-tenant dashboards and SQL queries.
// Prompts and completions are never recorded, only metadata.

export type Outcome =
  | "ok"
  | "upstream_client_error"
  | "upstream_failed"
  | "rate_limited"
  | "budget_exhausted"
  | "rejected";

export interface ChatEvent {
  requestId: string;
  tenant: string;
  key: string;
  model: string;
  upstream: string; // "" when no upstream answered
  status: number;
  outcome: Outcome;
  attempts: string; // e.g. "primary=503,backup=200"
  attemptCount: number;
  latencyMs: number;
  tokens: number;
  streamed: boolean;
}

export interface DataPointWriter {
  writeDataPoint(p: AnalyticsEngineDataPoint): void;
}

// Column order is the contract with the SQL in docs/analytics.md:
// blob1..6 and double1..3. Only ever append new columns.
export function toDataPoint(e: ChatEvent): AnalyticsEngineDataPoint {
  return {
    indexes: [e.tenant],
    blobs: [e.key, e.model, e.upstream, e.outcome, e.attempts, String(e.status)],
    doubles: [e.latencyMs, e.tokens, e.attemptCount],
  };
}

export function outcomeFor(status: number): Outcome {
  if (status < 400) return "ok";
  if (status === 502 || status === 504) return "upstream_failed";
  return "upstream_client_error";
}

export function emit(e: ChatEvent, writer?: DataPointWriter, log: (line: string) => void = console.log): void {
  log(JSON.stringify({ event: "chat_completion", ...e }));
  writer?.writeDataPoint(toDataPoint(e));
}
