# Astral Vault

[Play the game](https://astral-vault.jiahongfuji915.workers.dev) · [GitHub repository](https://github.com/Felixx-2003/AstralVault)

Astral Vault is an original anime sci-fi summon and team-battle game. Discover an eight-character crew, inspect each card’s rolled stats and signature technique, strengthen duplicates with shards, and take a formation into repeatable encounters.

The game uses a Cloudflare Worker and D1 as the source of truth. A signed, HttpOnly guest cookie identifies the player; balances, pulls, pity, cards, teams, daily claims and battle rewards stay in D1. The browser never submits card stats or reward amounts.

## Play locally

Use Node.js 20 or later. In PowerShell, copy the local secret example and edit the value:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Set `SESSION_SECRET` in `.dev.vars` to a private random value with at least 24 characters. Then install dependencies, apply the local schema and start the Worker:

```text
npm install
npm run db:migrate:local
npm run dev
```

Open `http://127.0.0.1:8787/`. The dev command builds the Vite client, watches source changes and runs the Worker with local D1. Refresh the page to load a newly built client. The normal browser refresh keeps the signed guest cookie and game save; clearing site cookies loses access because account recovery is not configured yet.

Run the focused engine and Worker API suite with `npm test`, and make a production bundle with `npm run build`.

## Project map

- [`src/client`](src/client/README.md) — responsive game interface and styles.
- [`src/server`](src/server/README.md) — Worker routes and trusted game actions.
- [`src/shared`](src/shared/README.md) — catalog and deterministic game engine.
- [`tests`](tests/README.md) — engine and D1-backed API verification.
- [`migrations`](migrations/README.md) — ordered D1 schema changes.
- [`public/art`](public/art/README.md) — original character illustrations.
- [`docs`](docs/README.md) — approved plan, art direction and QA notes.
- [`scripts`](scripts/README.md) — local Worker/Vite development launcher.

## Summoning and progression

Each pull costs 100 Astral Credits after free pulls. New guests start with three free pulls. A daily claim grants 200 credits and 10 shards. A cleared battle grants 75–125 credits, depending on the encounter stage, and 4 shards, then raises the next encounter’s difficulty; battles can earn up to 500 credits per UTC day, separately from the daily claim. Cleared battles continue to grant shards after the credit cap. An unsuccessful attempt grants nothing. Battles can be repeated after a 20-second recovery period.

Base per-pull rates are 5★ 2%, 4★ 18% and 3★ 80%. After nine consecutive pulls without a 4★ or better, the next pull guarantees a 4★ or 5★. This counter carries across single and ten-pulls. A 5★ is guaranteed by the 50th pull since the last 5★. If both guarantees meet, the 5★ guarantee takes precedence. All characters within a rarity tier have equal odds; the banner artwork does not imply a rate-up.

Each newly collected character receives server-rolled attack, health and defence modifiers from −5% to +7%. A duplicate grants 40 shards for 5★, 12 for 4★ or 3 for 3★. Shard upgrades cost `12 + 8 × current level`, up to level 10; each level adds 8 attack, 72 health and 5 defence.

Combat is deterministic. Each living unit attacks once per round using `max(5, attack − floor(enemy defence × 0.4))`. The enemy attacks the first living team member using `max(6, enemy attack − floor(defence × 0.55))`. Character techniques modify these values, add opening damage, restore health or reduce incoming damage. Tests pin the guarantee boundaries and representative skill effects.

## Paid store

The store uses **Paid Astral Credits**, separate from upgrade shards. Pulls always spend free pulls first, earned Astral Credits second, then Paid Astral Credits; each costs 100 and uses the same published odds and pity. The interface checkout is disabled. A Stripe test-mode adapter is prepared for fixed server-priced bundles, but it creates orders only when explicitly enabled with test credentials and account-recovery configuration. No payment settings are configured here, and guest account recovery is not implemented, so do not enable it. Signed `checkout.session.completed` webhooks must confirm paid status, exact server order amount/currency, player, bundle, and test mode before one atomic ledger credit; the browser success return never grants credits. Production purchase support still requires a recoverable account flow, privacy and consumer-policy review, refund handling, and live-provider setup.

For an isolated integration environment only, apply migrations and configure local `.dev.vars` with `PAYMENTS_TEST_ENABLED=true`, `ACCOUNT_RECOVERY_ENABLED=true`, a Stripe `sk_test_` key, and the matching `whsec_` endpoint secret. Do not set the account-recovery flag until a real recovery path exists. In Cloudflare, store credentials as secrets rather than variables or source. The adapter rejects live-mode Stripe events, and the built-in interface remains locked until a separately reviewed purchase flow is implemented.

## Cloudflare setup and deploy

The checked-in Wrangler config binds the Worker to `astral-vault-db`. For a different Cloudflare account, create a D1 database with that name and set its `database_id` in `wrangler.jsonc`. Keep the session signing key out of source control. New guest archives are limited to 10 per hashed IP per fixed UTC hour; existing signed sessions do not use this bootstrap limit.

```text
npx wrangler login
npx wrangler d1 migrations apply astral-vault-db --remote
npx wrangler secret put SESSION_SECRET
npm run deploy
```

When prompted for the secret, provide a private value of at least 24 characters. The deploy script builds `dist/` and publishes the Worker with its static Vite assets. Local data uses Wrangler’s `.wrangler/state` directory; `.dev.vars` and local state are ignored by Git. Do not configure Stripe secrets or enable checkout for the guest-only deployment.

Mutating API calls require the same origin, a JSON body, strict action fields and a unique idempotency key. D1 compare-and-swap revisions and atomic batches protect balances and rewards under concurrent requests. The public catalog does not create guest rows. A guest session has no account-recovery path yet, so avoid clearing its cookie if you want to keep that save.
