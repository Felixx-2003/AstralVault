# Star Island Rescue

## Player promise

Lead a small rescue crew across four lost star islands. Read an enemy's intent, choose a tactic, watch a short battle, and improve the crew for the next encounter. Recruiting is a way to discover new team options; rescuing the islands is the reason to use them.

## First minute

1. Start with a ready-to-play crew rather than an empty collection.
2. Show one enemy, its intent, three clearly explained tactics, and one Fight button.
3. Play a short, skippable battle with health bars and visible attacks.
4. Explain the reward at the moment it arrives: credits recruit; shards upgrade.
5. Offer the next useful action: fight the next stage, improve the crew, or recruit.

## Core loop

**Scout → choose tactic → fight → collect → improve → continue.**

Four islands contain five encounters each; the fifth is a boss. Show the next boss and progress toward it without opening another menu. Cleared encounters can be replayed for practice and supplies. First-clear milestones must never pay twice. Defeat costs no currency and should suggest a concrete change rather than a purchase.

Each clear earns one star; finishing within five rounds and retaining at least 60% of team health each add one. Save only the best rating per encounter. The 60-star goal gives completed islands a mastery challenge without requiring new currency or duplicate milestone rewards.

Tactics need visible tradeoffs: Assault is direct damage, Guard answers heavy incoming attacks, and Break answers armour. Enemy previews explain the interaction. A choice must affect combat, not just change a button's colour.

## Currency roles

| Resource | Earn it | Spend it |
| --- | --- | --- |
| Astral Credits | Battles, daily supply and announced milestone rewards | Recruit a character: 100 per pull |
| Star Shards | Battle supplies, duplicate cards and daily supply | Raise an owned character's level |
| Free pulls | Starting allowance and explicitly awarded bonuses | Recruit without spending credits |
| Paid Credits | Unavailable in this release | Future optional recruitment; identical odds |

Keep two earned balances prominent. Explain paid credits in the shop rather than making a disabled balance compete with the main game. Show costs before confirmation, published rarity odds and guarantee progress. Upgrades show the actual stat improvement. Do not imply that featured artwork has increased odds.

## Reasons to return

- Immediate: an enemy tell to answer and a satisfying, readable battle result.
- Session: the next island boss, a new teammate, or an affordable upgrade.
- Longer term: finish the rescue campaign, collect the original crew and try different formations.

Enjoyment should come from mastery, discovery and visible progress. No lost streaks, fake scarcity, forced purchases or punishment for leaving. Finishing an island is a natural stopping point. Free starters and earnable upgrades must offer a tested route through the campaign without lucky draws.

## Balance targets

Pax and Eda are the starting duo. Early encounters teach tactics before requiring upgrades. The first two island bosses provide deterministic access to Tomas and Mira; already-owned milestone recruits become shards instead. Existing players retain their cards, rolled stats and saved formations.

At the existing upgrade price (`12 + 8 × current level`), moving a card from level 1 to 3 costs 48 shards. Four level-3 cards cost 192 shards. Daily battle supplies, first-clear boss rewards and daily supply must cover a sensible free progression path; a simulation should demonstrate that path rather than assuming rare recruits will solve difficulty spikes. Repeat farming has separate, clearly displayed daily allowances; one-time rescue progress must remain worthwhile after those allowances are exhausted.

The campaign is tracked separately from the original prototype's repeat-battle win count. Replaying a cleared stage must not advance the frontier, duplicate a boss recruit, or reset guarantee counters. Multiple tabs and retries must not create extra rewards.

## Interface contract

- Adventure is the home screen. The premise and next action are visible immediately.
- Desktop at 1280×720 and above: the game fits in one viewport. Use pages/tabs for collections and long result sets rather than document scrolling or clipped controls.
- Mobile: one clear primary action, comfortable touch targets, stable navigation and readable enemy/crew health. Use the available height before adding scrolling.
- Battles and recruitment can be skipped; reduced-motion mode preserves identical outcomes.
- Use playful original enemy silhouettes, clear hit feedback and distinct island colours. Existing anime crew art may remain; readability and game feel take priority over an imitation franchise style.

## Release checks

Automated checks cover starter accounts, a free campaign path, tactic calculations, replay rewards, concurrent first-clear requests and persistent state. All currency and battle results remain server-authoritative. The user owns visual and gameplay experience testing, including desktop/mobile presentation, and supplies feedback for the next iteration; see [project collaboration rules](../AGENTS.md).
