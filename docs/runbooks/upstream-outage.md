# Upstream outage

**Signals**: `x-gateway-attempts` shows `primary=5xx` or `primary=timeout`;
fallback ratio query in docs/analytics.md rises; breaker opens
(`primary=circuit_open`).

1. Check whether fallback is absorbing it: if requests end on the backup with
   200, clients are fine; latency is higher until the breaker opens.
2. For a self-hosted upstream, check the Tunnel (`cloudflared` pods, Tunnel
   health notification) and the model server itself (GPU node, vLLM pod).
3. For a provider, check its status page.
4. If there is no fallback target for an alias, consider adding one to
   `GATEWAY_CONFIG` and deploying; config changes take effect on deploy.
5. After recovery, the breaker closes on the first successful probe; no
   manual reset is needed.
