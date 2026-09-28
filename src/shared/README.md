# Shared game rules

`catalog.ts` defines the character roster and summon rules. `campaign.ts` defines four islands, twenty encounters, enemy intentions and reward limits. `engine.ts` contains pure rarity, stat and tactical battle calculations, including the health snapshots used for animation.

These rules may be imported by the trusted Worker and deterministic tests. Browser code must not call them to award or persist rewards.
