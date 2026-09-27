# Scripts

`dev.mjs` builds the Vite client, watches client changes and starts Wrangler with local D1 at `127.0.0.1:8787`.

Run it from the project root with `npm run dev`. It requires `.dev.vars`, copied from `.dev.vars.example`, with a local `SESSION_SECRET`.
