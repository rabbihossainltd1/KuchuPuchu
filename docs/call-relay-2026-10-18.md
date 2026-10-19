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

---

# The call that could not start (2026-10-19)

Owner report: the relay credential was fixed (v289), but **the call still never
started** — the dialer kept saying *"Calling is temporarily unavailable because
the dedicated relay is not configured."*

## What was actually wrong

That string is `503 CALL_RELAY_UNAVAILABLE`, and it came from the **core**,
not from the edge:

* `POST /api/calls` and `POST /api/calls/group` were **proxied** to
  `vintoxbd-comm-core` (the deployment that owns the live sessions).
* The core holds **no TURN keys** — they live on the edge — and both of its
  call-creation sites are gated by `dedicatedTurnConfigured(env)`.
* So the edge minted a perfectly good relay credential, the app fetched it,
  and the very next call to the core was refused. The relay was never the
  problem; the **database the call had to live in** was.

A call must live in ONE database for its whole life (create → answer → ice →
peer → end). The core could not open one, so the whole protocol had to move
to the deployment that can.

## The fix (edge version `3a0c0e95-0942-42fa-927b-072624622147`)

Three things now stay on the edge instead of being handed to the core:

| Route | Why it stays |
| --- | --- |
| `/api/config/ice` | the edge holds the TURN keys; the core mints nothing |
| `/download/apk` | the release pipeline drops the newest signed APK in the **edge's** R2 bucket; the proxied core bucket still held an old build, so the in-app Update kept serving a stale APK |
| `/api/calls*` | the core cannot open a call; the call protocol runs in the edge's own database |

Dropping the `/api/calls` clause from that list hands the call protocol back
to the core (one line, documented in the source).

**The caller's identity.** The edge's session table is frozen — the live
sessions live in the core's database — so a call for a session the edge does
not know borrows the caller's identity from the core's `GET /api/me`, exactly
the way the relay route already does. Only the identity travels back (no
token, no secret), and it is asked for **only** after a real `401` and
**only** on the call routes; every other route keeps its strict lookup. A
session nobody knows still gets `401`.

**The cron stays core-owned.** The frozen legacy D1 is not written by the
edge's timer. The calls the edge owns are reaped by the same reaper inside
`GET /api/calls/active` (`reapStaleCallsIfDue`), which every client polls
while a call is up and again when the app opens.

## Live proof (2026-10-19, on the live edge)

| Check | Result |
| --- | --- |
| `GET /download/apk` on the edge | `200`, 28,425,120 B, md5 `769ae6b5…` — **v289**, the build the Update button must deliver |
| `POST /api/calls` (no session) | `401 UNAUTHENTICATED` — **not** `503 CALL_RELAY_UNAVAILABLE` any more |
| `POST /api/calls` (signed-in) | `201` — call `RINGING`, caller and callee read back correctly |
| `GET /api/calls/active` (callee) | the incoming ring card, `other = Rabbi Hossain` |
| `POST /api/calls/{id}/answer` | `200` — the call goes `ACTIVE`, the answer SDP is stored |
| `POST` + `GET /api/calls/{id}/ice` | `201` + the candidate delivered to the peer |
| `POST /api/calls/{id}/end` | `200` |
| `GET /api/health` | `ok`, `capabilities.turn = true` |
| `GET /api/config/ice` with a bogus bearer | `401` (the relay stays gated) |

The test call, the temporary sessions and the call-log row were deleted again
after the check.

## What still needs the owner (the durable fix)

The edge can open a call, but the **core** still cannot — and the core is
where the sessions, the chat, the Durable Objects and the push live. Give the
core the same two secrets and the call protocol can go back where the rest of
the app lives:

```
TURN_KEY_ID    = 896cd44929831f8724744db412851b7c
TURN_API_TOKEN = 536e03775d38b7682c794e8b503330cb2e6c11b82e851394794c43144e314c16
```

Cloudflare dashboard → *vintoxbdinstitute* → *Workers & Pages* →
`vintoxbd-comm-core` → *Settings* → *Variables and Secrets* → add both as
**encrypted** secrets. After that, removing the `/api/calls` clause from the
edge's list hands the whole call protocol back to the core, and the chat's
"call ended" bubble comes back with it.
