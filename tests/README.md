# Tests

Run all tests with `npm test`. Vitest uses the Cloudflare Workers pool and an isolated D1 database; `apply-migrations.ts` applies the checked-in migrations for each test environment.

- `engine.test.ts` covers rarity guarantees, rolled stats and deterministic combat skills.
- `api.test.ts` exercises guest sessions, action validation, idempotency, paid-credit spending and atomic D1 economy updates.
- `payment.test.ts` verifies checkout stays disabled by default and Stripe test webhooks validate signatures and credit once.
- `types.d.ts` supplies test Worker binding types for TypeScript.
