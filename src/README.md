# Source code

Source is split by trust boundary and responsibility.

- `client/` contains the browser interface; it never decides rewards or balances.
- `server/` contains the Cloudflare Worker API and validates all player actions.
- `shared/` contains the catalog and deterministic game rules used by the server and tests.

The Worker entry point is configured in `wrangler.jsonc`. The browser entry point is referenced by the root `index.html`.
