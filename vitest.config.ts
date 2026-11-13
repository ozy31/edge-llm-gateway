import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { TEST_CONFIG } from "./test/fixtures/config.ts";
import { fakeUpstream } from "./test/fake-upstream.ts";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { GATEWAY_CONFIG: TEST_CONFIG, PRIMARY_KEY: "test-primary-key" },
        outboundService: fakeUpstream,
      },
    }),
  ],
});
