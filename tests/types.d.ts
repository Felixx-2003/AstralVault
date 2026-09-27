declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      SESSION_SECRET: string;
      STRIPE_WEBHOOK_SECRET: string;
      STRIPE_SECRET_KEY?: string;
      PAYMENTS_TEST_ENABLED?: string;
      ACCOUNT_RECOVERY_ENABLED?: string;
      TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
    }
  }
}

export {};
