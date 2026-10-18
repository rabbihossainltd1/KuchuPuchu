# The call relay (2026-10-18)

Owner report: pressing call showed **"Calling is unavailable until the dedicated
relay is configured."** — the dialer never received a relay (TURN) credential, so
no call could leave the phone.

## What was actually wrong

The refusal is not a UI string; it is what the dialer says when
`GET /api/config/ice` comes back without `ice.urls` / `ice.username` /
`ice.credential`. Two independent things made that happen:

1. **No TURN keys were configured anywhere.** The Cloudflare Realtime TURN
   credentials are minted server-side (a static key pair is rejected by
   Cloudflare — aioice returns `400` for a hand-made credential), so the APK can
   never carry the secret itself. A TURN key was created in the KuchuPuchu
   account and wired into the worker as `TURN_KEY_ID` + `TURN_API_TOKEN`.
2. **After the slice-J cutover the live host is an edge, not the session
   owner.** `kuchupuchu-api.kuchupuchu.workers.dev` proxies every `/api` and
   `/ws` request to the core that owns the sessions
   (`https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev`, account
   `vintoxbdinstitute`). The core holds no TURN keys, so a **proxied**
   `/api/config/ice` came back empty — an empty relay is exactly the refusal
   the dialer shows.

## The fix

**The relay route answers on the edge itself.**

```
GET /api/config/ice
  └─ edge (kuchupuchu-api)  ── has TURN_KEY_ID + TURN_API_TOKEN
       ├─ who is the caller?  local D1 → SESSION_AUTHORITY_URL → FEDERATED_CORE_ORIGIN
       │     (the core's GET /api/me, with the caller's own bearer + cookie)
       └─ mint Cloudflare TURN credentials  (rtc.live.cloudflare.com)
```

* `sessionAcceptedBy(origin, request)` asks one deployment-time constant
  whether the caller is signed in. `200` from `GET /api/me` means yes; no
  session data travels back — only the yes/no. The origin is never taken from
  a request, so a caller cannot choose where the check goes.
* `requireUserOrAuthority()` keeps the local database first and only falls
  back to the authority after a **401** (a broken database still surfaces as
  itself, not as "signed out").
* The fetch handler serves `/api/config/ice` **before** the core proxy, so the
  edge's own TURN keys mint the credential.
* `GET /api/health` keeps the core's capabilities but reports **this**
  deployment's relay flag (`turn`), so the live host no longer says
  `turn:false` while minting a relay for every signed-in caller.

**The Android dialer** (`CallEngine.ensureDedicatedTurn()`) asks the primary
host first and then the relay host (`Api.RELAY_BASE`), which is the same code
under a second name with the TURN keys wired in. The relay host gets the
session bearer too (`Api.isOwnHost()` covers both hosts) and verifies the
session against the authority before handing out a credential.

**The web** (`web/src/calls/callsApi.ts`) asks the same route on its own
origin, so the browser PWA gets the relay as well — the cookie session is
forwarded to the core by the edge.

## Live proof

| Check | Result |
| --- | --- |
| `GET /api/config/ice` with a signed-in session | `200` + real `turn:`/`turns:` URLs, username, credential |
| `GET /api/config/ice` with a bogus bearer | `401 UNAUTHENTICATED` |
| `GET /api/health` on the live host | `capabilities.turn = true` (the core's own flags are kept) |
| aioice `ALLOCATE` with the minted credential | **OK** (relayed `104.30.145.121:21822`) |
| relay host `kuchupuchu.kuchupuchu.workers.dev` | `200` for a signed-in session, `401` for a bogus one |

## Deployments

| Script | Version | Notes |
| --- | --- | --- |
| `kuchupuchu-api` (edge, live) | `9e9a33ad-186a-43d4-9996-4dbb2767e308` | `FEDERATED_CORE_ORIGIN` = the core; `TURN_KEY_ID` + `TURN_API_TOKEN` as secrets |
| `kuchupuchu` (relay host) | `88c1bd3c-a0c4-4fb7-8a97-e413910e57d0` | `SESSION_AUTHORITY_URL` = the core; same TURN secrets |

The Durable Object namespaces are now **pinned in `wrangler.toml`** (a binding
without an id makes wrangler create a new namespace on the next deploy, which
would move the live sockets — a silent realtime outage).

## Owner action still open: the lost worker secrets

An accidental `wrangler delete --name kuchupuchu-api` removed the live script
and with it its secret store. The script was redeployed within a minute and
the relay keys were restored, but **nine owner secrets are still missing** on
`kuchupuchu-api` and only the owner can put them back (the API can write a
secret but never read one):

| Secret | Needed for | Recoverable? |
| --- | --- | --- |
| `FCM_CREDENTIALS` | Firebase service account (private key) — FCM push | **no** — download it again from the Firebase console (Project settings → Service accounts) |
| `FEDERATION_PUSH_KEY` | shared key the core presents on `/api/internal/federation/push` | **no** — it must be the same value the core holds; ask the core's owner to re-set it there too |
| `WS_TICKET_KEY` | `/api/ws/ticket` signing | no (proxy serves it from the core) |
| `LOGIN_OTP_HMAC_SECRET` | OTP login | no (proxy serves it from the core) |
| `VAPID_PRIVATE_KEY` | web push | no (proxy serves it from the core) |
| `GEMINI_API_KEY`, `HF_TOKEN`, `CF_AI_TOKEN`, `LARAVEL_BRIDGE_KEY` | AI + classroom bridge | no (proxy serves them from the core) |
| `FCM_CONFIG` | public Firebase config | **restored** — rebuilt from the core's `/api/config/firebase` |
| `GOOGLE_WEB_CLIENT_ID` | Google sign-in | **restored** — copied from the core's `/api/config/firebase` |

```bash
npx wrangler secret put FCM_CREDENTIALS   # paste the service-account JSON
npx wrangler secret put FEDERATION_PUSH_KEY
```

Everything else on the live host is proxied to the core, so the app keeps
working while these are outstanding: the relay (calls), messaging, chat and
the web shell all live on the core.

## Never again

* `wrangler delete --name <script>` **overrides** the config and deletes the
  live script. Delete a stub by its own config file and **without `--name`**,
  and list `GET /accounts/{id}/workers/scripts` before and after.
* A bulk secret upload must be **one request per secret**:
  `{"name":…,"text":…,"type":"secret_text"}`. A `{"body":{…}}` map answers
  `400 Binding must have a name`.
* Never put a TURN secret in the APK. The credential is minted server-side,
  short-lived, and signed by Cloudflare.
