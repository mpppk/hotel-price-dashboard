import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hosting from "./.openai/hosting.json";

const { d1, r2 } = hosting;
const config = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1 ? [{
    binding: d1,
    database_name: "hotel-price-dashboard",
    // Local Miniflare only; Sites supplies the actual hosted resource.
    database_id: "00000000-0000-4000-8000-000000000000",
  }] : [],
  r2_buckets: r2 ? [{ binding: r2, bucket_name: "unused" }] : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config,
      }),
    ],
  };
});
