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
| Account | Workers Tail | **Read** | `npm run tail` — the only way to see a production worker error live from here. Verified with a live token: `Read` is enough, `wrangler tail` printed "Successfully created tail" and streamed requests plus the cron. (Listing existing tails via `GET /workers/tails` answers `10001`, but that is not what tailing needs.) |
| Account | Realtime (Cloudflare Calls) | **Edit** — *optional* | The worker reads TURN credentials from its **own** secrets (`TURN_URLS/USERNAME/KEY_ID/API_TOKEN`), so deploys and diagnosis never need Calls. Probing anyway: `GET /accounts/:id/calls/turn/keys` returned `10001` even with `Realtime:Edit` + `Cloudflare Calls:Edit` granted, i.e. that endpoint family is not authorized by either item under those names. Leave it off until a TURN rotation is actually on the table, then pin the scope by trying the one call. |

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
- `GET /accounts/:id/workers/scripts/kuchupuchu-api` returns the **served bundle**
  as multipart — that is how a deploy is proven rather than assumed (grep the
  download for a symbol that only exists in the new code).
- **TTL**: your call; "Never" means a fix round can't stall at 02:00 waiting for
  a paste. **Client IP**: leave empty — this sandbox's egress is not stable.

## Verify before deploying

`~/.secrets/kp-audit` probes each row with read-only calls (it prints
`NO 10001` = missing permission, `NO 7003` = path does not exist in this API
version — the two failures mean different things and only one of them is fixed by
granting something) and prints `YES` /
`NO <code>` per capability, so a missing permission is named before a deploy
fails, not after. That file, plus `kp-deploy` (wrangler, token redacted from
output), `kp-d1` (SELECT/WITH/PRAGMA only), `kp-ci`, `kp-push`, lives in
`~/.secrets/` — outside this repo on purpose, because `npm run security:secrets`
scans tracked files and this repo must never contain a credential.
