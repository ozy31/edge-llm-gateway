# Tenant out of budget

**Signals**: a team reports 429 `insufficient_quota`; `budget_exhausted`
outcomes in analytics.

1. Confirm usage with the tokens-per-tenant query in docs/analytics.md.
2. Look for a runaway client first (one key name with most of the usage,
   requests at a constant rate). If so, disable that key, not the tenant.
3. If the usage is legitimate, raise `monthlyTokenBudget` on the tenant's
   key records in KV. The new value applies within the KV cache TTL (60 s).
4. Budgets reset at 00:00 UTC on the first of the month.
