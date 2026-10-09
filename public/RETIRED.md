# public/ — RETIRED, no longer served

Since the slice J production cutover (docs/web-cutover.md) the Worker serves
the built React PWA from `web/dist` (wrangler.toml `[assets]`). Nothing in this
directory is deployed any more.

The files stay in the repository for three reasons:

1. **Contract history** — `app.js`, `index.html`, `sw.js` are the fixtures that
   contract cases 04 and 55 pin (the `{items}` drift fix and the `kp-shell-v2`
   cache-bump rule). Deleting them would delete the regression pins.
2. **Rollback** — reverting the cutover commit restores this directory as the
   served assets in one move; the legacy worker's activate handler then
   deletes the `kp-web-shell-*` caches symmetrically.
3. **Migration reference** — the legacy `sw.js` documents the cache-first
   behaviour that existing installs run until their browser's service-worker
   update check swaps in the new `/sw.js`.

Do not edit these files for new behaviour. New client work happens in `web/`.
