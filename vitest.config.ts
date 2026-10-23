import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Runs tests inside the Workers runtime (Miniflare) with the bindings from wrangler.jsonc.
// The D1 migrations are read here (Node.js) and applied by test/apply-migrations.ts (Workers runtime).
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('migrations') } },
    })),
  ],
  test: { setupFiles: ['./test/apply-migrations.ts'] },
});
