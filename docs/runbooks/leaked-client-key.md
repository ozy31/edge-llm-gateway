# Leaked client key

1. Find the record: `node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" 'sk-gw-...'`
2. Disable it: set `"disabled": true` on `key:<hash>` in KV
   (`npx wrangler kv key get/put --binding TENANT_KEYS --remote`). Requests
   with it return 403 within 60 s.
3. Issue a new key with `scripts/new-key.mjs` and hand it over.
4. Check the key's usage since the leak (filter blob1 = key name in
   docs/analytics.md queries) for abuse.
5. Delete the old record once the owner has moved over.
