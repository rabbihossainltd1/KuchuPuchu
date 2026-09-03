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

## Follow-up round — v3.9.17 / 93 (2026-09-04)

1. **Google flow permanent fix** (owner: "continue with Google dile new mail
   login ashe, onno device e google returned no id token"). Root cause: the
   flow LED with `GetSignInWithGoogleOption` — the button flow that on several
   OEM/Play-services combos routes straight into the browser "new account"
   sign-in, whose credential is not always a GoogleIdTokenCredential (the
   "no ID token" dead end). New order: `GetGoogleIdOption` with
   `filterByAuthorizedAccounts=false` FIRST (native sheet listing every device
   account, every time), one automatic relaunch on a blank-token credential,
   web sign-in ONLY when the device has zero Google accounts, defensive
   token extraction with a retryable error instead of a cryptic crash.

2. **CI flake fixed** — main's post-merge run failed because the ktlint jar
   download from Maven Central hit a transient 429. `scripts/ktlint-check.sh`
   now retries the download (--retry 6 --retry-all-errors) so a rate-limit
   blip can never fail CI again.

## AI + typing round — v3.9.18 / 94 (2026-09-04)

1. **AI identity fixed** — the bot used to invent a developer or agree with
   whatever name a user suggested ("Sohel vai"). The worker's reply prompt now
   carries a fixed fact block: KuchuPuchu is created/developed/owned by
   Rabbihossainltd (@rabbihossainltd, verified, Rabbihossainltd@gmail.com,
   Rajshahi BD), and it must politely correct any other suggested name.
2. **Banglish spelling rule** — explicit prompt rule with standard
   transliteration examples (kemon achen, bhalo achen, dhonnobad, kivabe);
   unsure of a word → write it in Bengali script instead.
3. **AI typing indicator** — in-thread three-dot bubble + header "typing..."
   while the newest message in the AI chat is the user's own (the bot always
   replies, so that state == generating).
4. **Word-by-word reply reveal** — a NEW AI reply (created after the chat
   opened) types itself out with a caret ▍, 30–45ms per word, auto-pinned to
   the bottom unless the user scrolled up. History never re-types on open.
5. **Google-fix guard** — 5 new suite assertions pin the GoogleAuth shape:
   filterByAuthorizedAccounts(false), native-first ordering, blank-token
   relaunch, no "Google returned no ID token" dead-end, retryable message.
