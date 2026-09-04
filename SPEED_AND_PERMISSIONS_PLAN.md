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

## Moderator badge round — v3.9.19 / 95 (2026-09-04)

@fsleader gets the owner-supplied crossed-tools badge (SVG from
savedly.net/f/ufmdyvbf → res/drawable/ic_moderator_badge.xml with the
source gradient + outline preserved). New `users.moderator` column
(default 0, independent of `verified` so the 3-tick rule is untouched),
emitted by userFrom() → flows into chat lists, discovery, profiles,
calls. App renders ModeratorBadge() beside the name in the chat-list
row, chat header and profile screen (same spots as the verified tick).
Live DBs migrated (APAC flagged fsleader; old WNAM altered too so the
one-line rollback stays safe). 5 new live-worker assertions; 894 total.

## Owner identity + AI upgrade round — v3.9.20 / 96 (2026-09-04)

1. **AI persona rebuilt from the owner's full details + website**: MD Rabbi
   Hossain (Rabbihossainltd, @rabbihossainltd verified), email
   info@rabbihossainltd.online, site rabbihossainltd.online, Kaliganj
   Jhenaidah Khulna BD, FB @Rabbihossainltd / IG @Rabbihossainltd1 / TG
   @Rabbihossainltd0 / TikTok @Rabbihossainltd, RabbiHossainLTD services
   (websites, security audits, branding, Meta verification, cards, gaming
   top-ups). Any owner/developer/malik/Rabbi Hossain/Rabbihossainltd
   question answers from these facts; wrong suggested names are corrected.
2. **Owner profile card in the AI chat**: an owner-intent question also drops
   a tappable card (kind OWNER_CARD, deduped per 10-message window) with
   brand icons — FB/IG/TG/TikTok open the app via profile URLs, mail icon →
   mail client, globe → website.
3. **AI now replies in pure Bengali script** to Bengali/Banglish messages —
   never Banglish (Latin) again. English stays English.
4. **AI photo create + edit**: a photo+caption message = edit request; a
   "photo banao/draw/make" text = generation. Gemini image model → R2 →
   IMAGE message from the bot; any failure falls back to the text reply.
5. **Chat bubbles stretch right**: max width 280dp → 82% of screen width
   (280 floor, 420 cap) — long bodies no longer flatten.
6. **Header name sits a touch lower** for every account.
Suite: 32/32, 905 assertions (+11).

## Owner round 3 — v3.9.23 / 99 (2026-09-04)

1. **Header name row lowered TOGETHER** — the verified/moderator badges move
   with the name now (the old per-Text padding split them apart).
2. **Owner card animation removed** (static, per owner request).
3. **Timestamp no longer overlays the body** — it sits under the text,
   right-aligned; single-line messages never get climbed over and long
   bodies use the full widened bubble.
4. **Owner card covers the full bubble width** (82% screen, 280–420dp):
   photo (4:3, tap-to-view), texts, socials (spread edge-to-edge) and the
   Send Message button all stretch with it.
5. **Header shows the first name only** ("MD Rabbi Hossain" → "Rabbi";
   MD/Mohammad honorifics skipped); the two bots and group titles stay
   full; owner's account shows "Rabbi" + verified tick.
6. **Login-approval Accept/Decline expire in 5 minutes** — client hides the
   buttons at the 5-minute mark ("⏰ Expired"), remembers the decision for
   the whole app session (never reappears), and the worker's decline
   endpoint now enforces the same 5-minute window server-side.
Suite: 32/32, 914 assertions.

## Owner round 4 — v3.9.24 / 100 (2026-09-04)

1. **Header back to normal height** — the name block sits at the avatar's
   optical middle via a draw-time offset (6dp): no layout growth, no extra
   space under the header, last-seen right under the name, badges locked to
   the name.
2. **Owner photo viewer truly fullscreen** — the platform's default dialog
   width was capping the black backdrop into a small box;
   usePlatformDefaultWidth = false fixes it.
3. **Owner card behaves like a normal message** — dedupe widened from 10
   messages to once per conversation per 24h (and per 100 messages), so a
   card no longer keeps landing at the bottom of owner-heavy threads; the
   card timestamp is guaranteed strictly after its reply.
4. **12-hour clock with AM/PM on every message stamp** (the AI chat had
   24-hour stamps).
5. **Pretty shared typing indicator** — one bouncing-dots bubble (smooth
   wave, gold) for both the AI composing and the other person typing; the
   header's "typing..." text is gone for all accounts.
6. **Unread numbers update instantly** — viewing messages now also cancels
   that conversation's OS notification cards on read and on live view, not
   just the in-app badge.
Suite: 32/32, 919 assertions.

## Owner round 5 — v3.9.25 / 101 (2026-09-04)

1. **Google sign-in truly fixed** — root cause found: Credential Manager
   returns the Google credential as a plain CustomCredential (type string +
   data payload) on EVERY OEM; it never auto-deserializes into
   GoogleIdTokenCredential. The old `is GoogleIdTokenCredential` check read
   every successful sign-in as "no token". Now parsed manually via
   GoogleIdTokenCredential.createFrom(data) — a local parse, identical on
   Realme / MIUI / Pixel / any Android.
2. **Header subtitle ("last seen" / "Official account") rises a touch** —
   only that line (−2dp draw offset); name, badges and header height
   untouched.
3. **Owner photo sharper** — bundled image rebundled at 640×640 so the
   fullscreen viewer (fixed in v100) stays crisp edge to edge.
Suite: 32/32, 922 assertions.

## Owner round 6 — v3.9.26 / 102 (2026-09-04)

1. **Owner card photo much bigger** — card widened to 92% of the screen and
   the photo is square now (was 4:3 at 82%).
2. **Header subtitle raised further** (net back to its original line) and
   the blank strip under the header trimmed (vertical padding 4→2dp) — only
   the subtitle text and that strip move.
3. **Scroll perf** — timestamp parsing (Instant.parse + zone math) ran for
   every visible row on every recomposition; now memoized in a concurrent
   map. Inline stamp strings cached per message too.
4. **Realtime lateness** — when the chat socket dies the fallback poll now
   runs every 3s (was 10s) and the socket is actively rejoined every 10s
   (a dead channel used to stay dead until reopening the screen).
5. **Text bubbles: inline timestamp** — the time (and read ticks) ride at
   the end of the text IN-FLOW: single-line messages are true single-line
   bubbles, nothing sits on a separate line, and no overlay is possible.
   Sticker/file/deleted bubbles keep the small stamp line.
Suite: 32/32, 926 assertions.

## Owner round 7 — v3.9.27 / 103 (2026-09-04)

1. **AI canned-reply + slowness fixed** — root cause: the "flash-latest"
   aliases now route to thinking models (and were 503ing), so the 220-token
   budget was eaten by thinking and every reply came back EMPTY → the canned
   fallback. Now: gemini-3.5-flash first (live-verified with this key),
   thinkingBudget 0 (fast, budget goes to the answer), reply budget 400.
2. **Header**: the last blank strip under "last seen" is gone (padding 0).
3. **Owner card photo**: display-only — tapping does nothing.
4. **AI chat 3-dot menu**: exactly Reset session / New chat / Mute / Chat
   theme / Incognito mode / Search in chat. Reset+New chat wipe the bot
   conversation via new POST /api/conversations/:id/reset (bot chats only);
   Incognito wipes the session on leaving the chat.
5. **KuchuPuchu notifications bot**: no 3-dot menu at all.
6. **Owner account**: Block removed from his profile.
Suite: 32/32, 932 assertions.

## Owner round 8 — v3.9.28 / 104 (2026-09-04)

1. **Google sign-in**: single native sheet launch (the auto-relaunch was the
   1-second popup flash on Realme); hardened parser (official createFrom +
   raw bundle keys); unusable picks fall to the web flow once. Works the
   same on every OEM.
2. **AI**: NEW Gemini API key set (system prompt unchanged; same key powers
   photos when image quota exists). gemini-3.5-flash + thinkingBudget 0.
3. **OTP TEST path** (beta, does not log in): "Test OTP (beta)" on the
   login screen runs Firebase Phone Auth on the typed number and reports
   exactly where it stops (console Phone disabled / SHA-1 missing / OTP
   arrived + verified). Production switch only after the owner sees SMS.
4. **AI menu fixed + History**: the reset route regex was dead
   (convMatch never matched /reset — that's why nothing worked); now its own
   route, and every wipe ARCHIVES the session into ai_sessions. "Reset
   session" replaced by "History" (list of past sessions, read-only view).
5. **Header**: extra 2px trimmed (offset 6→4).
6. **Photo messages**: thin 1dp border added.
Suite: 32/32, 942 assertions.

## Owner round 9 — v3.9.29 / 105 (2026-09-04)

1. **Google sign-in LOCKED** — owner-verified working; "LOCKED BY OWNER"
   marker in GoogleAuth.kt + a guard test; no further changes without the
   owner's explicit approval.
2. **OTP diagnostics upgraded** — the app talks to Firebase project
   kuchupuchuff2026; errors now name the project and the real blocker:
   Firebase requires the BLAZE (pay-as-you-go) plan for Phone Auth SMS —
   on the free Spark plan it keeps saying "phone sign-in disabled" even
   with Phone enabled in the console.
3. **Owner card Bangla fix** — the intent regex missed Bengali verb
   inflections (বানিয়েছে/বানাল/তৈরি করে/চালায়), the Bengali-script name
   (রবি হোসাইন), and photo requests ("tomar photo dao"/"তোমার ছবি দাও").
   Now stem-based (বানা/বানি/চালা) so the য় dual-encoding trap can't bite;
   11/11 live phrase checks pass. Card also drops when the user asks the
   AI for the owner's photo.
Suite: 32/32, 944 assertions.

## Owner round 10 — v3.9.30 / 106 (2026-09-04)

1. **Owner's Bangla name spelling corrected** — রাব্বি হোসেন (was রবি হোসাইন
   everywhere); the card trigger matches রাব্বি/রবি + হোসেন/হোসাইন variants.
2. **OTP test UI hidden** (code kept in OtpTest.kt for when Blaze is on).
3. **Owner sound pack wired in**: default calling ring replaced everywhere
   (ringback + incoming + call channel); 7 incoming ringtones user-pickable
   in Settings → Incoming ringtone (with preview); "massage sent" plays the
   moment ANY message (text/photo/file/voice) is actually accepted by the
   server — not on tap; "in app massage" plays when a message arrives while
   the user is inside the app but NOT on that chat screen.
4. **3D bubbles** — text + photo bubbles and the owner card float with the
   same soft shadow as the call buttons; send + mic circles got the lift too.
5. **HANDOFF.md** written at the workspace root (credentials, architecture,
   workflow, links, pitfalls).
Suite: 32/32, 951 assertions.
