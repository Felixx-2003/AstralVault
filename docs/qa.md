# Verification notes

## Manual browser and API checks (local Worker + D1)

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
