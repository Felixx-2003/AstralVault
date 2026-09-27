# Server

`worker.ts` is the Cloudflare Worker entry point for the static app and game API. It owns guest sessions, request validation, D1 transactions, idempotency and authoritative rewards.

`payments.ts` prepares fixed-price Stripe test checkout and verifies signed payment events before atomically updating the paid-credit ledger. Checkout stays disabled by default; recoverable accounts and production payment support are unfinished. See the root README before configuring any payment settings.

Set the Worker entry in `wrangler.jsonc`. Keep secrets in Wrangler secrets or ignored `.dev.vars`; never pass balances or card stats from the browser as trusted values.
