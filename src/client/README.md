# Client

`game.ts` renders Adventure, Recruit, Crew, and Supplies, including the server-authored battle timeline and paged recruit results. `game.css` styles those screens and their responsive layouts.

The client calls `/api/*` and renders returned state. Currency, card stats, summon outcomes, stage progress, and battle events remain server-authoritative. The entry module is `/src/client/game.ts` in `index.html`.
