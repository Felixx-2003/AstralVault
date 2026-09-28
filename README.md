# Astral Vault — Star Island Rescue

[Play](https://astral-vault.jiahongfuji915.workers.dev) · [Source](https://github.com/Felixx-2003/AstralVault)

Lead a crew across four lost star islands and restore their beacons. Twenty short encounters combine a simple tactic choice, animated auto-battles, character collecting and upgrades. Adventure is the home screen; recruitment supports the rescue campaign.

## How to play

1. Start with Pax and Eda already in your team.
2. Read the enemy's intention: **Assault** interrupts a charge, **Guard** answers a heavy strike, and **Break** defeats armour.
3. Fight, watch or skip the animation, then use the rewards to improve your crew.
4. Clear each fifth-stage boss. The first two bosses recruit Tomas and Mira; already-owned recruits become shards.
5. Finish all four islands, then replay stages to improve your best rating toward 60 stars.

Defeat costs nothing. A clear earns one star, finishing within five rounds earns another, and retaining at least 60% team health earns the third. Cards, formations, rewards and best ratings are saved on the server.

## Resources and rewards

| Resource | Purpose | Sources |
| --- | --- | --- |
| Astral Credits | Recruit: 100 per pull | Battles, daily supply, first boss clears |
| Star Shards | Upgrade characters to level 10 | Battles, duplicates, daily supply, first boss clears |
| Free pulls | Recruit before spending credits | Three starting pulls |
| Paid Credits | Future optional recruitment | Purchases currently disabled |

Frontier victories grant 75–125 credits and 8 shards; practice clears grant 35 credits and 2 shards. Regular battle rewards have daily limits of 500 credits and 120 shards. Each boss's first clear adds 200 credits and 20 shards outside those limits. Daily supply adds 200 credits and 10 shards. Allowances reset at UTC midnight. A short three-second request cooldown is normally covered by the battle animation.

Recruitment rates: **5★ 2%, 4★ 18%, 3★ 80%**. A 4★ or better is guaranteed within ten pulls and a 5★ within fifty; the 5★ guarantee takes priority. Counters carry between singles and ten-pulls. Characters within a tier have equal odds; featured art is not a rate-up. Free pulls are spent first, then earned credits, then paid credits.

Duplicate cards grant 40/12/3 shards for 5★/4★/3★. Upgrade cost is `12 + 8 × current level`; each level adds 8 attack, 72 health and 5 defence. Recruited cards roll base stat modifiers from −5% to +7%; guaranteed starter and milestone cards use neutral modifiers. See [game design](docs/game-design.md) for the intended progression and [QA](docs/qa.md) for verification.

## Local development

Use Node.js 20 or later. Copy `.dev.vars.example` to `.dev.vars` and replace `SESSION_SECRET` with a private random value of at least 24 characters.

```text
npm install
npm run db:migrate:local
npm run dev
```

Open `http://127.0.0.1:8787`. The dev script builds and watches Vite assets while Wrangler serves the Worker and local D1. Refresh after client changes. Use `npm test` for isolated D1/engine/payment tests and `npm run build` for TypeScript and production bundling. On PowerShell systems that block unsigned scripts, use `npm.cmd` / `npx.cmd`.

## Project map

- [Client](src/client/README.md): screens, animation and responsive layout.
- [Server](src/server/README.md): trusted API, sessions and payment adapter.
- [Shared](src/shared/README.md): character catalog, campaign and calculations.
- [Tests](tests/README.md): engine and D1-backed API checks.
- [Migrations](migrations/README.md): ordered database changes.
- [Artwork](public/art/README.md): original crew illustrations.
- [Docs](docs/README.md): game design, art direction and QA.
- [Scripts](scripts/README.md): development launcher.

## Deploy to Cloudflare

`wrangler.jsonc` configures the `astral-vault` Worker, static assets and `astral-vault-db` D1 database. A different account needs its own database ID. Keep the signing key in Wrangler secrets:

```text
npx wrangler login
npm run db:migrate:remote
npx wrangler secret put SESSION_SECRET
npm run deploy
```

The Worker calculates rolls, combat and rewards. Signed HttpOnly guest cookies identify saves; strict requests, idempotency receipts, revision checks and atomic D1 batches protect progression. Guest creation is limited to ten per hashed IP per UTC hour. `.dev.vars`, build output, dependencies and local database files are ignored by Git.

## Current limits

Saves are guest-only: **clearing the cookie loses access**, and cross-device recovery is not implemented. Existing cards and teams survive the gameplay migration; the new rescue campaign starts separately from legacy battle wins.

Purchases remain disabled. `payments.ts` prepares fixed-price, card-only Stripe **test** checkout and verifies signed events before one atomic credit. Test activation requires test credentials plus explicit payment/recovery flags; do not enable recovery flags until recovery actually exists. Browser success redirects never grant credits. Live payments still need recoverable accounts, provider configuration and refund handling. No production payment credentials are stored here.
