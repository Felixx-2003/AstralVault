# D1 migrations

Numbered SQL files define the persistent schema and are applied in filename order by Wrangler. Migration `0002_guest_limits_battle_cap.sql` adds hashed-IP guest bootstrap limits and per-UTC-day battle credit accounting. Migration `0003_stripe_test_payments.sql` adds fixed-order checkout, signed-event, and paid-credit ledger tables. Add a new migration for schema changes instead of editing an already-applied migration.

Apply locally with `npm run db:migrate:local`; apply remotely with `npm run db:migrate:remote` after confirming the configured Cloudflare account and database.

`0004_star_island_rescue.sql` adds separate campaign progress, daily shard accounting and per-stage best ratings. It grants missing starter cards without replacing existing stats and equips only empty teams. Legacy battle wins do not automatically clear the new campaign.
