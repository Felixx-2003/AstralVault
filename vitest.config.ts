import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(projectRoot, 'migrations'));
  return {
    plugins: [cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: {
        SESSION_SECRET: 'test-session-secret-long-enough-2026',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_for_automated_signature_checks_2026',
        TEST_MIGRATIONS: migrations,
      } },
    })],
    test: {
      include: ['tests/**/*.test.ts'],
      setupFiles: ['./tests/apply-migrations.ts'],
      maxWorkers: 1,
      fileParallelism: false,
    },
  };
});
