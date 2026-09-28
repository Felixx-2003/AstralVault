# Verification notes

## Rescue deployment (2026-09-28)

- Remote D1 migration `0004_star_island_rescue.sql` applied successfully.
- Production Worker version: `42d68fe7-ebb5-4c64-8fd4-88118d9717db`.
- HTTP health checks passed: homepage returned 200, catalog returned eight heroes and twenty stages, and database-backed guest state returned successfully.
- No new visual review or manual gameplay session was performed; the user owns those checks and feedback. Paid checkout remains disabled.

## Rescue redesign checks (local, 2026-09-27)

- Migration 0004 preserved an existing save's four cards, rolled stats, levels, 22 pulls and 100 credits; its empty team was filled with Pax/Eda and the new campaign started at zero.
- A fresh guest received both starter cards, an equipped team and three free pulls.
- Actual Worker playthrough of island one: stages 1–5 cleared with starters; two simultaneous boss requests produced one success and one cooldown rejection. The saved balance was exactly 625 credits and 60 shards, Tomas joined the three-member team, and five stage records were stored.
- Replaying that boss paid only 35 credits and 2 shards, with no recruit or boss bonus and no campaign advancement. Duplicate first-battle requests returned the same receipt; locked stages and injected reward fields returned 400.
- Independent deterministic simulation completed all 20 encounters using only starter and guaranteed boss recruits, correct tactics and earned upgrades. No random summons, purchases, practice farming or daily reset were needed. The final team levels were 3/2/2/2, with 102 shards remaining after the last boss.
- A full local Worker/D1 playthrough also completed all 20 stages through real API actions. A level-1 crew lost stage 18 without losing currency, then recovered through earned upgrades. The final save contained 54/60 stars, all twenty records, 1,500 credits and 102 shards; no summons or paid credits were used. It included one practice replay to check boss protection.
- Final automated verification on 2026-09-28: all 37 tests passed across three suites; TypeScript checking and the Vite production build passed. Coverage includes starter crews, stage/tactic validation, battle snapshots, reward caps, concurrent boss rewards, duplicate recruits and a guaranteed-recruit 20-stage route.
- From 2026-09-28 onward, visual review and gameplay experience testing belong to the user; the agent verifies code and automated tests only unless asked otherwise. Earlier manual checks below are historical.

## Initial release manual browser and API checks (local Worker + D1)

Verified using Playwright against http://127.0.0.1:8787, desktop 1440x960 and mobile 390x844.

- Browser loads without JavaScript page errors.
- Single summon creates a persistent card and consumes exactly one free pull.
- Collection filters, team assignment/save, daily claim, and battle reward flow work through the UI.
- Same summon key submitted four times concurrently returns four identical responses but charges/grants once.
- Reusing a key with different data returns 409.
- Supplying a custom currency field returns 400.
- Insufficient balance returns 402.
- Concurrent daily claims return one success and one conflict, crediting the daily reward once.
- Eight distinct concurrent summon requests with four affordable pulls yield four successes and four conflicts; final balances stay at zero, never negative.
- Skip reveals saved results; mobile reload preserves progression.
- No horizontal page overflow at 390px.
- Deterministic worst-case rarity sequence produces 4-star at pulls 10/20/30/40 and 5-star at50.

Additional checks verified ten-pull results, reduced-motion immediate reveals, and a lost summon response followed by retry: only one pull was charged and granted.

## Automated verification (2026-09-27)

- `npm test`: 33 tests passed across engine, API and payment suites.
- `npm run build`: TypeScript checks and Vite production build passed.
- `npm audit`: zero reported vulnerabilities.
- Final desktop and mobile ten-pull review: card details remain readable in a scrolling grid and Continue stays visible.
- Coverage includes guest bootstrap throttling, daily battle credit caps, paid-credit spending order, signed test-payment webhooks, duplicate events and atomic wallet updates.
- Stripe checkout is disabled in the deployed guest-only configuration; real provider checkout and account recovery are not release-ready.

## Public deployment smoke check

Verified at https://astral-vault.jiahongfuji915.workers.dev on 2026-09-27: guest initialization, summon animation Skip, one free pull consumed, saved card and pull count after reload, no JavaScript page errors, no horizontal overflow at 390px, and checkout returns 503 while disabled. All three D1 migrations are applied remotely.
