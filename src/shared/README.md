# Shared game rules

`catalog.ts` defines the character roster, published summon rates and progression constants. `engine.ts` contains pure rarity, stat and battle calculations.

These rules may be imported by the trusted Worker and deterministic tests. Browser code must not call them to award or persist rewards.
