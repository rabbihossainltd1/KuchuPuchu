# Cloudflare API token — what this project actually needs

Derived from the repo, not from a generic list: `wrangler.toml` (worker
`kuchupuchu-api`, `workers_dev`, cron `* * * * *`, Durable Objects `ChatRoom` /
`CallSignal` + the `v1-realtime-do` migration, D1 `kuchupuchu-v3`, R2
`kp-media`, `account_id = 92081fac7caf54a46a756c382081544b`), the worker's `env`
surface (`DB`, `MEDIA`, `CHAT_ROOM`, `CALL_SIGNAL`, `DEBUG_KEY`, `FCM_CONFIG`,
`FCM_CREDENTIALS`, `TURN_*`) and the app origin
`https://kuchupuchu-api.kuchupuchu.workers.dev`.

## Required (everything below assumes Create Custom Token)

| Category | Permission | Action | Why this project needs it |
| --- | --- | --- | --- |
| User | User Details | **Read** | `wrangler` resolves the account owner first; without it every command dies with `Authentication error [code: 10000]` / "Unable to retrieve email for this user". |
| Account | Workers Scripts | **Edit** | Upload worker versions, `[triggers] crons`, Durable Object namespaces + migrations (DO has **no separate permission** — a namespace is backed by the worker script), `wrangler secret put/delete` for `FCM_CREDENTIALS` / `TURN_KEY_ID` / `TURN_API_TOKEN` / `DEBUG_KEY`, version rollback, `workers.dev` toggling. |
| Account | D1 and SQL databases | **Edit** | Apply schema/fixes to `kuchupuchu-v3` (`wrangler d1 execute --remote`), exports/backups, read-only production queries during diagnosis. `Read` would allow my `SELECT` checks but blocks any repair. |
| Account | Workers R2 Storage | **Edit** | `kp-media`: verify/read objects when "photo won't open" comes in, delete leaked junk, lifecycle rules so deleted-for-everyone media actually stops counting. |
| Account | Account Settings | **Read** (Edit if you want subdomain/toggles changed too) | Validates `account_id`; also what a dead token fails against (`GET /accounts` → `9109`). |
| Account | Workers Tail | **Edit** | `npm run tail` — the only way to see a production worker error live from here; a tail config is *created*, so Read alone is not enough. |
| Account | Realtime (Cloudflare Calls) | **Edit** | The worker mints TURN credentials at runtime (`TURN_KEY_ID` + `TURN_API_TOKEN`, see `src/worker/index.ts`); to reproduce/rotate those and debug "call connects, no audio" the same scope is needed. |

## Only if you want the deploy pipeline fixed too

| Category | Permission | Action | Why |
| --- | --- | --- | --- |
| Account | Workers Builds Configuration | **Edit** | The "Workers Builds: kuchupuchu" GitHub integration is currently red on its own; with this scope its config can be read/re-run so a push to `main` deploys the worker without a human clicking anything. |

## Do NOT bother granting (this repo uses none of it)

`Workers KV Storage` (no KV binding — rate limiting is in D1), `Queues`,
`Hyperdrive`, `Vectorize`, `Workers AI`, `Cloudflare Pages` (the repo has no
Pages project; the dashboard/API are one worker), `Access: Users`, `Cloudflare
One Networks`, `Turnstile`, `Email Routing`, `Zone: DNS / Workers Routes / SSL
and Certificates` (the app is on `*.workers.dev` — see below), `Account Members:
Edit`.

## Zone category: skip today

Nothing in this project is served from a Cloudflare-purchased zone
(`kuchupuchu-api.kuchupuchu.workers.dev`). If you ever attach `api.kuchupuchu.com`
or `kuchupuchu.com` to the worker, add at that point: Zone → **DNS: Edit**,
Zone → **Workers Routes: Edit**, Zone → **SSL and Certificates: Edit**. A token
with `All zones - DNS: Edit` sitting unused is just a wider blast radius.

## Resource scoping

- **Account Resources**: Include → `92081fac7caf54a46a756c382081544b` only.
  (`d262ab82da01da509da8f9935b03907d` shows up in old notes for R2/D1 — if the
  audit probe below shows `R2 … NO`, the media bucket is in the other account and
  that one gets added too, nothing else.)
- **Zone Resources**: none.
- **TTL**: your call; "Never" means a fix round can't stall at 02:00 waiting for
  a paste. **Client IP**: leave empty — this sandbox's egress is not stable.

## Verify before deploying

`~/.secrets/kp-audit` probes each row with read-only calls and prints `YES` /
`NO <code>` per capability, so a missing permission is named before a deploy
fails, not after. That file, plus `kp-deploy` (wrangler, token redacted from
output), `kp-d1` (SELECT/WITH/PRAGMA only), `kp-ci`, `kp-push`, lives in
`~/.secrets/` — outside this repo on purpose, because `npm run security:secrets`
scans tracked files and this repo must never contain a credential.
