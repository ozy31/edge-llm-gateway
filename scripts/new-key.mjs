#!/usr/bin/env node
// Creates a client API key. Prints the key once (hand it to the client) and
// the wrangler command that stores only its hash and limits in KV.
//
//   node scripts/new-key.mjs --tenant search-team --name ci --models chat-small --rpm 60 --budget 2000000
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    name: { type: "string" },
    models: { type: "string", default: "*" },
    rpm: { type: "string", default: "60" },
    budget: { type: "string", default: "1000000" },
  },
});
if (!values.tenant || !values.name) {
  console.error("usage: new-key.mjs --tenant <tenant> --name <label> [--models a,b|*] [--rpm N] [--budget TOKENS]");
  process.exit(2);
}

const key = "sk-gw-" + randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(key).digest("hex");
const record = {
  tenant: values.tenant,
  keyName: values.name,
  models: values.models === "*" ? "*" : values.models.split(","),
  requestsPerMinute: Number(values.rpm),
  monthlyTokenBudget: Number(values.budget),
};

console.log(`API key (shown once): ${key}\n`);
console.log(`npx wrangler kv key put --binding TENANT_KEYS --remote "key:${hash}" '${JSON.stringify(record)}'`);
