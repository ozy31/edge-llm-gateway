# Usage analytics

Each request writes one data point to the `llm_gateway_requests` Analytics
Engine dataset. Columns (see `src/telemetry.ts`; only ever append):

| column | value |
| --- | --- |
| index1 | tenant |
| blob1 | key name |
| blob2 | model alias |
| blob3 | upstream that answered |
| blob4 | outcome: ok, upstream_client_error, upstream_failed, rate_limited, budget_exhausted, rejected |
| blob5 | attempt trail, e.g. `primary=503,backup=200` |
| blob6 | HTTP status |
| double1 | latency ms (streams: to end of stream) |
| double2 | tokens charged |
| double3 | upstream attempts |

Queries run through the SQL API
(`POST https://api.cloudflare.com/client/v4/accounts/<account>/analytics_engine/sql`).
Data points may be sampled, so counts use `_sample_interval`.

Tokens per tenant this month:

```sql
SELECT index1 AS tenant, SUM(_sample_interval * double2) AS tokens
FROM llm_gateway_requests
WHERE timestamp >= toStartOfMonth(now())
GROUP BY tenant ORDER BY tokens DESC
```

Fallback rate per model over the last hour (requests that needed more than one attempt):

```sql
SELECT blob2 AS model,
       SUM(_sample_interval * IF(double3 > 1, 1, 0)) / SUM(_sample_interval) AS fallback_ratio
FROM llm_gateway_requests
WHERE timestamp > now() - INTERVAL '1' HOUR
GROUP BY model
```

p95 latency by upstream:

```sql
SELECT blob3 AS upstream, quantileWeighted(0.95)(double1, _sample_interval) AS p95_ms
FROM llm_gateway_requests
WHERE timestamp > now() - INTERVAL '1' HOUR AND blob4 = 'ok'
GROUP BY upstream
```

Tenants hitting limits:

```sql
SELECT index1 AS tenant, blob4 AS outcome, SUM(_sample_interval) AS requests
FROM llm_gateway_requests
WHERE timestamp > now() - INTERVAL '1' DAY AND blob4 IN ('rate_limited', 'budget_exhausted')
GROUP BY tenant, outcome ORDER BY requests DESC
```
