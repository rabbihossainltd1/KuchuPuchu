# Speed, Permissions & Cleanup Round — v3.9.16 / 92

Owner batch (2026-09-04). Seven asks, one round.

## 0. The real speed problem (found): the database is in America

`kuchupuchu-v3` D1 runs in **WNAM** (verified via API: `running_in_region: WNAM`).
Workers themselves run at Cloudflare's nearest edge POP to every user (Dhaka for BD
users — nothing to "choose" there). But **every D1 query** — open chat, search,
marker poll, send — crossed the Pacific: ~200–280ms before the handler even starts
thinking. That single fact is what made "search → tap user → open" feel late and
why the "unchanged" ticks were slow.

**Fix:** new database `kuchupuchu-v3-apac`, primary **APAC (Singapore)**, **read
replication auto** (reads served from the replica nearest each user; writes to
Singapore ≈ 30–80ms from BD). Export old → import new → swap `database_id` in
wrangler.toml → deploy. Old DB kept untouched for instant rollback (revert one
line, redeploy). Data verified identical (row counts + the 3 verified accounts).

## 1. KpSetup — removed entirely

Owner: "KpSetup remove koro". Delete `KpSetup.kt`, the chat-list amber banner
(shipped 12 hours ago in #31 — superseded), and the Settings "Background
notifications" row. The manifest keep-alive layer (boot receivers, full-screen
call intent, FGS types) stays — only the user-facing deep-link system goes.

## 2. New permission flow

Owner spec: first open asks **notification + ignore battery optimization**;
camera permission is asked **at the moment a camera feature is entered**; never
all permissions at once.

- MainActivity: bulk CAMERA+RECORD_AUDIO+POST_NOTIFICATIONS ask removed.
- New one-time gate (first signed-in open, once per install): POST_NOTIFICATIONS
  (API 33+) → then the `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` dialog.
- Contextual asks via `MainActivity.ensurePermissions(perms) { … }`:
  - RECORD_AUDIO — starting a call (voice or video), answering a call, starting a
    voice note.
  - CAMERA — starting/answering a VIDEO call, camera toggle during a call,
    AttachSheet "Camera".
- SIM/location/contacts stay contextual exactly as before.

## 3. Log catching — removed entirely

Owner: "log catch korbe na, app jeno smooth hoi".

- `KpDiag.kt` deleted; all `KpDiag.log` call sites in KpPush removed.
- Settings "App log (this device)" row + dialog removed.
- Crash trap removed (kp_crash.txt write, boot toast, upload).
- Every `/api/debug/clientlog` POST removed (KpNotify.reportSkip, KpPush
  breadcrumb, ChatScreen doc trace). The endpoint stays server-side (other
  clients may still send; tests unaffected) but this app no longer ships any
  log capture. The 2 `android.util.Log` writes also go.

## 4. Restart = no reload

Already mostly true (ScreenStore disk snapshot, Coil filesDir image cache, 24h
user-profile cache). Gaps closed this round:

- **Chat headers now persist too** (`convDetail` added to the snapshot + hydrate)
  — reopening any chat after restart paints the header instantly.
- **Outbox + Drafts file reads moved off the main thread** — cold start no longer
  parses three JSON files before the first frame (hydrate stays synchronous on
  purpose: it IS the first-frame data).

## 5. Instant actions / no full rebuild / polling only where needed

Audit result: the app already does this the right way — WebSocket channels with
Durable Objects push events; HTTP ticks exist only as socket-down fallback
(2s→15s backoff, 10s when healthy, 30s in cooldown); marker-based freshness
checks return tiny `unchanged` payloads; every list has signature guards so an
unchanged response never recomposes anything; delete/archive/mute/read are
optimistic-local-first. The *latency* the owner felt on those actions was the
WNAM round trip behind each confirmation — fixed by §0, not by more client code.
Verified this round: markRead optimistic + 10s grace window; FCM badge bump
reorders the list instantly; search→chat opens cache-first.

## 6. Cleanup

- SearchScreen still had two Banglish strings → clean English (standing rule).
- Sweep for any other non-English UI text.

## 7. Ship

Version 92 / 3.9.16. Gates: suite, typecheck, ktlint, validate-android, brace
balance. One PR (Android + wrangler.toml id swap). CI → merge → deploy worker →
live verification (login, message, verified=3, latency re-measure) → deployed
reset.
