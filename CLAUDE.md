# CLAUDE.md

pilight: tally light service for the Pi. Node 24, ESM, zero runtime dependencies, `node:test`.

- `src/core/` is vendored from jsilvanus/stream-light (MIT). Keep it free of Node-app assumptions. Changes that stream-light should have too: note them in the commit.
- `src/modes.js` is pure: mode + feeds + clock in, reading out.
- `src/hub.js` owns mode, feeds and manual colours; `src/gateway/client.js` only reads pigateway.
- Never log API keys. Never call Tally-MA lamp reset or cloud-mode endpoints.
- Everything is unverified against the real ATEM, Tally-MA lamp, Monarch and YouTube. Say so in docs when touching those.
- Keep `openapi/openapi.json`, `src/api.js` (ROUTES) and `README.md` in step; `npm test` checks the first two.
