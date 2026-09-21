# Project Memory

## Round 58 User Directives & Status
- Directive 1: See more expand, message body collapse with animation:
  - User feedback: "not fixed+ tumi expand animation taw remove korcho but why? tumi ager motoi rakho see more a click korle expand hobe massage body te click korle collapse hobe animation er sathe hobe shob."
  - Fix:
    1. Re-enabled message body collapse on expanded messages: in `Box.combinedClickable.onClick`, when `msgExpanded` is true, clicking anywhere on the message body collapses it back (`msgExpanded = false`).
    2. Maintained smooth spring collapse/expand animation via `.animateContentSize(animationSpec = spring(dampingRatio = 0.85f, stiffness = 400f))`.
    3. Clicking "See more" expands the message; clicking the message body or "See less" collapses it.
- Directive 2: Message send animation starting points & physics:
  - User feedback: "ar all massage items sending animation er start point thik nai . massage text er start point hobe massage composer pill er upor theke niche theke na. ar baki items gula jemon voice massage ta voice voice button theke choto theke original voice massage er size a joye nijer position a chole jabe. ar photo video documents attach panel theke jump korbe."
  - Fix:
    1. Text message flight start point: In `SendFlight.kt`, updated `startY = pill.top - s.height` so the bubble lifts off directly from the top of the composer pill, never from below the screen or below the pill.
    2. Voice message launch: Added `fxVoiceLaunch` in `ChatFx.kt` and anchored to `FlightAnchors.micBounds`. Starts at the mic button, scales up from small (0.28f) to full original size (1.0f), and glides smoothly into its seat position.
    3. Media & document jump: Added `fxAttachJump` in `ChatFx.kt` and anchored to `FlightAnchors.attachBounds`. Photos, videos, and documents execute an upward parabolic jump arc from the attach panel / paperclip button to their bubble seat.
- Directive 3: Bumped version to `v190` (`versionCode = 190`, `versionName = "3.9.113"`).

## Round 60 User Directives & Status
- Directive 1: Diagonal slide send/receive flight animation:
  - Sent messages: animate smoothly into chat diagonally from the bottom-right (+44dp X, +18dp Y to 0,0) with soft spring ease and alpha ramp.
  - Received messages: animate smoothly into chat diagonally from the bottom-left (-44dp X, +18dp Y to 0,0).
  - Chat history scrolling and paging remain quiet with no sliding animation.
- Directive 2: View-once media bubble refinements:
  - Center the view-once icon perfectly within the bubble border (`CenteredOnceIcon(40.dp)` on `Alignment.Center`).
  - View-once card size reduced (`widthIn(max = 138.dp)`, `heightIn(max = 175.dp)`, min fallback `widthIn(min = 108.dp).height(138.dp)`).
  - Sending echo retains media aspect ratio while keeping verbatim `metaWith` pattern and test assertions intact.
- Directive 3: Received short message bubble sizing:
  - Compact bubble width `requiredWidthIn(min = if (!mine) 78.dp else 79.dp)` applied to both received and sent short messages.
- Directive 4: Last seen text & presence:
  - 3-letter abbreviations (`yes`, `sun`, `mon`, etc.) implemented across `ChatScreen.kt`, `Theme.kt`, `Ui.kt`, `SettingsScreen.kt`.
  - `ONLINE_WINDOW_MS` reduced to 35s in `src/shared/constants.ts`.
  - Background push media fetches and `/api/calls/active` excluded from updating `last_active_at` in `src/worker/index.ts`.
  - `conv.value` assignment and metadata refresh on message arrival/polling enhanced in `ChatScreen.kt`.
- Directive 5: Version bumped to `v192` (`versionCode = 192`, `versionName = "3.9.115"`), released on GitHub, and Cloudflare Worker deployed.

## Round 61 User Directives & Status
- Directive 1: Corner flight animation coming further down from bottom corner:
  - Sent messages: animate smoothly into chat diagonally from the bottom-right (+68dp X, +84dp Y to 0,0) with soft ease and alpha ramp.
  - Received messages: animate smoothly into chat diagonally from the bottom-left (-68dp X, +84dp Y to 0,0).
  - All items (text, voice, photo, video, document, album, view-once) animated consistently.
  - Removed dependency on `pill == null` or `seat == null` aborts in `SendFlight.kt` so animation reliably triggers every time.
- Directive 2: View-once media bubble refinements:
  - Enlarged center view-once badge (`size(62.dp)`, `CenteredOnceIcon(48.dp)`) with smooth breathing pulse scale animation (0.92f <-> 1.08f) before viewed.
  - Removed top-left capsule pill (`Icons.Filled.Refresh` + `1`).
  - Removed dim background box from timestamp, rendered clean single-line timestamp in bottom right corner with smaller font (10.sp).
  - Fixed ratio jumping on send/sent: sender's `paintSent` inherits `mediaW`/`mediaH` and populates `ImageRatios` from donor pending echo; `photoUrlOf` prefers `kpLocalUrl`.
  - Allowed sender to view their own sent view-once media until the opponent views and vanishes it (`canOpen = !pendingEcho`, `onShown` and `kpOnce` gated so sender views don't spend the single opening).
- Directive 3: Received short message bubble sizing:
  - Reduced minimum width for received short text messages to compact `52.dp` (`requiredWidthIn(min = if (!mine) 52.dp else 70.dp)`), making received short messages like "hi" or "ok" truly compact.
- Directive 4: Version bumped to `v193` (`versionCode = 193`, `versionName = "3.9.116"`).

## Round 62 User Directives & Status
- Directive 1: Voice message flight animation & layout fix:
  - User feedback: "1. fixed almost just voice massage er animation er somoy original body na hoye fake animation hocche left side a extra space dekha jacche original rakho."
  - Root Cause:
    1. In `FileBubble`, `VoiceWave` was passed `grow = fxGrow` (`fxGrow = fxFresh`), which caused waveform bars to reveal one by one over time (`reveal = (growAt - 40f) / 22f`), rendering an empty canvas area initially instead of showing the complete real waveform.
    2. In `MessageRow`, `Box` had `.animateContentSize(...)` which animated the bubble's width during entry, causing it to stretch and move its left boundary.
    3. In `MessageRow`, `Box` had `.fxSideSlide(...)` which ran simultaneously with the outer `Row.fxFlyIn(...)`, doubling the horizontal translation and pushing the bubble too far right while creating empty space on the left.
  - Fix:
    1. Set `grow = false` in `VoiceWave` so the complete, original waveform is rendered immediately with all bars visible from the very first frame.
    2. Restricted `animateContentSize` to `textLike && longBody` only, preventing any size animation or stretching on voice message bubbles.
    3. Excluded `voiceRow` from duplicate `fxSideSlide` so voice messages glide smoothly via `Row.fxFlyIn` without duplicate offset or left-side void.
- Directive 2: View-once icon styling & animation:
  - User feedback: "2. shob ok just tomar zoom in zoom out animation ta pochondo hoi i ar ei icons er dim background remove koro just icon ta animate korbe."
  - Fix:
    1. Removed zoom-in / zoom-out pulse scale (`pulseScale` 0.92f <-> 1.08f) from center view-once badge.
    2. Removed the 62dp circular dim backdrop (`.clip(CircleShape).background(Color(0x66000000))`) so the icon floats directly over the blurred media with no dim disc behind it.
    3. Implemented clean continuous rotation on the outer dotted ring of the view-once icon (`ringRotation` 0f -> 360f), while keeping the central bold digit "1" stationary and upright, ensuring only the icon itself animates cleanly without any breathing scale or dim background.
- Directive 3: Received short message bubble size confirmation:
  - User confirmed: "3. fixed". Maintained compact 52.dp minimum width for received short messages and 70.dp for sent.
- Directive 4: Bumped version to `v194` (`versionCode = 194`, `versionName = "3.9.117"`).

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.

## Audit 2026-09-21 (Arena agent, read-only — no push/deploy)
- Scope: full self-audit at HEAD 8a9b631 (v194): security, UI (static), performance, bugs. Full list: `AUDIT-2026-09-21.md`; project map: `PROJECT_UNDERSTANDING.md`.
- Gates re-run locally, all green: 37/37 tests (1611 assertions), tsc, prettier, secret-scan, validate-android, ktlint. HEAD CI #35538569060 success.
- HIGH: (1) AI down in prod — HF credits exhausted 09-17 (error_log 2-4/day → 186-317/day, `hf-chat 402` + `gemini 503`); (2) logged-out takeover via self-attested SIM on no-live-device path (`index.ts:5388`, no 2nd factor); (3) view-once media fetchable without spend (`index.ts:9163`, honest-client only).
- MEDIUM: enumeration oracles; per-isolate rate limits; no per-user storage quota + unattached uploads never swept; debug.keystore committed (needs owner call); v194 on TWO commits (8a9b631+1e0e252, updater won't offer 2nd); latency self-probe 100% failing (lat.count=0); ~1s chat poll cost.
- LOW/INFO: CORS *, DEBUG_KEY in query, unused timingSafeEqualHex, public TURN fallback, no delete time-limit (confirm intentional), stale debug/errors refs, commented code in ChatScreen, 4 APK assets on v194, red-main CI pattern, index-keyed photo grid, no pinning, 16ms FX loops.
- UI verdict: Round 62 + 1e0e252 diffs reviewed line-by-line, no static glitch; real visual check impossible here (no Android build/emulator in sandbox) — needs owner device / CI APK.
- Live: /api/health 200, releases/latest v194, error_log 1050 rows (7d). Origin ahead by 1e0e252 (ChatScreen-only) — local tree intentionally kept at 8a9b631 for stable audit line numbers.

## Fix loop 2026-09-21/22 (Arena agent; order H3→M1→M2→M4→M5→M6→M7→E1..E8→release; CI green per item)
- H3 done, commit `7121277`, pushed to main (owner-overridden flow: push-to-main, PR skipped — see git-flow conflict note).
- M2 done, commit `2e64800`, pushed to main.
- M1 (enumeration hardening) done, commit `6ff3e2a`, pushed; deployed Version ID `d9088ece-91e3-4985-8975-5f769b6ec1a9`; live-verified (start-unknown → 404 NO_RECOVERY_TARGET; lookup exists:false + masked RECOVERY_LOOKUP audit row). Gates 40/40 (1643 assertions). test31 lock updated same-commit (wrong-Google denial 401→404).
- M4 phase 1 (debug-key migration, same bytes) done, commit `6e66c04`, pushed; no worker change → no deploy. gradle reads KP_DEBUG_KEYSTORE_B64 secret, falls back to committed file, prints `kp-debug-keystore source=… sha256=…`. Continuity hash (public): `1e595e947dd292dced9fc223fee469405be0894740cdaacde17e7c9a4d0c8a6b`. Phase 2 (delete file, AGP-default fallback) waits on owner confirming the secret. Rotation ruled out: CI signs with the committed key (de-facto prod key). Gates 41/41 (1646 assertions).
- M5 done at release: version bump 194/3.9.117 -> 195/3.9.118 is the fix (release discipline); tag v195 + GitHub Release with CI APKs; updater (KpUpdate.kt) picks it from releases/latest.
- M6 (latency self-probe 100% failing) done, commit `7cf30da`, pushed; deployed Version ID `0c68322e-6308-4353-86ea-9bc014889`. Root cause (index.ts:5071): the cron isolate's network subrequest to SELF_ORIGIN never returned ok (egress leg — same URL 200s for outside traffic incl. every UA tested). Fix: scheduled() passes an in-process fetcher (handle(), same isolate); URL/timeout/counters unchanged. Probe doc corrected (health runs no D1 — number is handler time, sub-ms → sum_ms 0). test27's fixed 4000-char scheduled() window bumped to 4600 (log line pushed to +4035). Gates: `npm run ci` exit 0, 41/41 (1646 assertions). Live-verified at 23:00Z tick 2026-09-20: lat.count=3 (first samples ever), lat.err=69 (23 failed hrs × 3 — arithmetic exact), lat.sum_ms=0.
- CI pattern: cancel-in-progress works (older mains superseded); e.g. M6 run 35542945952 completed success while 6e66c04/6ff3e2a/2e64800/7121277 runs cancelled.
- D1 REST reminder: var is $D1_DATABASE_ID with X-Auth-Email/X-Auth-Key (global key); the scoped CLOUDFLARE_API_TOKEN has no D1 scope (10000 auth error); $D/$R do not exist.
- M7 (aggressive polling) done, commit `674917f`, app-only (no worker change -> no deploy; ships with release APK). Audit premises re-checked: tree already socket-primary (chat r6/r14 net, adaptive call net, PollCadence inbox, worker 0.7s one-shot). Change: ChatScreen safety-net timer restarts on any same-conv frame + 8s->30s backoff after 2min idle (no frame + no in-flight send). Call/login cadences untouched (r24 lock + owner rules). test32 r14 lock updated same-commit. Gates: `npm run ci` exit 0, 41/41 (1646 assertions). NOTE: node_modules does not persist across turns (snapshot exclusion) — rerun `npm ci` first in a fresh turn.
- E1 (see-less exact-text collapse) done, commit `657d3cf`, app-only (no worker change -> no deploy). Root cause (ChatScreen.kt:6256-6274): triple tap-handler stack double-toggled exact-text taps into a no-op. Fix: keep only the row pointerInput (1dcd592 on-device-proven); row clickable + text pointerInput deleted. Past attempts reviewed: 74b3f8d (exact-toggle rule), d51b774 (full-width target), 1dcd592 (pointerInput fix for dead clickable), 78b5e93 (body-collapse restore). Animation kept (msgExpanded + spring animateContentSize untouched). test32 +1 E1 lock, test37's 2 clickable pins moved to pointerInput same-commit. Gates: `npm run ci` exit 0, 41/41 (1647 assertions).
- E2 (typing/voice indicator 4px down) done, commit `ad86115`, app-only (no worker change -> no deploy). TypingBubble + RecordingBubble rows: symmetric vertical 3dp -> top 7dp / bottom 3dp (layout-aware shift; offset() would overlap). test32 +1 E2 lock (both rows pinned, count==2). Gates: `npm run ci` exit 0, 41/41 (1648 assertions).
- E3 (sending/sent identical for all types) done, commit `5a42a60`, app-only (no worker change -> no deploy). Sweep: photo/video/voice/doc/album/view-once/text/sticker/link echoes already carry first-frame ratio+thumb (v166/r62 work). Gaps fixed: (1) sending tick was 12dp vs 13dp sent/delivered/seen (TickIcon, shared by ALL mine types) -> 13dp; (2) fallback wave bars seeded from server id -> redrawn on echo->sent swap for audio without waveform -> seed from shared clientId; (3) audio-as-media (forwarded mp3) had no duration (echo "0:00", sent showed size) -> VideoFacts.probeAudioMs + seconds in echo+row meta. test32: r31-27 pseudo pin updated + new E3 lock. Gates: `npm run ci` exit 0, 41/41 (1649 assertions).
- E4 (calls-only E2EE verify; owner picked "calls" over secret-chats/full — message E2EE deferred) done, commit `72c86ea`, app-only (no worker change -> no deploy). Media is DTLS-SRTP; gap was unverified server-relayed SDP. Build: stable DTLS identity (RtcCertificatePem, private prefs, warmed at init) set on both pc creation sites (1:1 newPc + group newGroupPc; relayConfig untouched — setConfiguration only); per-call order-independent safety codes from both SDP fingerprints; TOFU peer store + change warning + trust ceremony; lock row on voice+video + KpSheet (no AlertDialog); groups show nothing. Zero latency: local parse+sha256+prefs only (locked by !includes("Api.")). WebRTC API verified against the real stream-webrtc-android-1.1.3 AAR before writing. Gates: `npm run ci` exit 0, 41/41 (1650 assertions).
- E5 (repo clean) done, commit `a69ee3f`, no code change (no deploy). Deleted after reference+freshness verification: SPEED_AND_PERMISSIONS_PLAN.md (45KB completed Sep-5 plan, zero refs), send-animations-preview.html (44KB fulfilled preview of shipped send FX, zero refs), DEPLOY-GUIDE.md (stale realtime-steps framing; live deploy/verify/rollback lines already covered by .env comments). Kept: memory/README/ARCHITECTURE-v3 (worker refs)/PHONE_AUTH_PLAN (many refs)/FIREBASE-SETUP+docs/native-plan (README refs)/docs/cloudflare-token (accurate runbook)/audio-routing+image-cache (test contracts)/AUDIT-2026-09-21+PROJECT_UNDERSTANDING (active loop basis — post-release archival candidate)/scripts (CI-used or live tooling). Gates: `npm run ci` exit 0, 41/41 (1650 assertions).
- E6 (keyboard closes on call arrival) done, commit `199686c`, app-only (no worker change -> no deploy). Root cause: CallGate is an overlay above everything (KpApp.kt:295) while the chat composer below keeps IME focus, so the keyboard parked over the call UI. Fix: LaunchedEffect(call.id) in CallGate hides IME + force-clears focus on arrival (codebase recipe from ChatScreen closeKeyboard). test32 +1 E6 lock. Gates: `npm run ci` exit 0, 41/41 (1651 assertions).
- E7 (old-history scroll animation) done, commit `9d27700`, app-only (no worker change -> no deploy). New fxHistoryUnfurl (ChatFx.kt): soft one-shot fade+14dp-rise 260ms, unique vs live slide/fly/pop. loadOlder keys each fresh page (historyFxKeys); both list-item sites apply + consume on first compose (no replay); reduced-motion gated; no listState touch (r52 no-yank intact). CONFLICT NOTED: overrides r45-item-1/r50/r58 + ChatScreen:6074 "history stays quiet" by explicit owner ask, for loadOlder rows only; flicker-proof by construction. test32 +1 E7 lock. Gates: `npm run ci` exit 0, 41/41 (1652 assertions).
- E8 (all message items max 70% width) done, commit `df15e68`, app-only (no worker change -> no deploy). bubbleMax factor 0.82 -> 0.70, floor 280 -> 240 (cap 420 kept); OwnerCard cardMax 0.92 -> 0.70, floor 300 -> 240, cap 440 -> 420; albums clamp via albumW = minOf(albumWidth, width * 0.70); FileBubble inherits ceiling via widthIn inside bubble Box; CallLogBubble left intrinsic (timestamps never cap short). Locks: test32 E8 check (exactly three 0.70 factors, no 0.82/0.92, albumW clamp) + owner-card pin 92% -> 70%; test36 v166-new#4 follows new formula. Gates: `npm run ci` exit 0, 41/41 (1653 assertions).

## Round 2 2026-09-21 (owner feedback on v195 + 3 new items; E3f needs worker deploy)
- E3f (view-once 1 s fake ratio after send) done, commit `06581cc`, WORKER+app -> deployed Version ID `04a07c7f-62f8-46f0-b47a-5cd075cf7ec4`, live health 200. Root cause (index.ts:8374): server stripped meta.w/h on once-rows (`!viewOnce ? dims : {}`), so every server copy lacked mediaW/H and ViewOnceRow fell to the 108x138 placeholder until the blurred thumb decoded. Fix: store dims (album exclusion + H3 spend + spent-hiding untouched); client payloads carry w/h under the once flag (metaWith, clipMeta-preferred file payload, both scheduled paths measure their own box). CONFLICT NOTED: overrides r32-17 + v163 "once publishes no dimensions" by explicit owner ask (dims leak nothing past the blur); pins migrated same-commit (test17 x2, test32 x2 incl. app-bytes pin, test33 x1) + test32 E3f lock. Gates: 41/41 (1654).
- E4f+N1+N2 done, commit `dbcd39e`, app-only (ships with next release APK). E4f: E2eeCodeRow reads plain "End-to-end encrypted"; tap swaps code in 3 s (auto-hide), tap-while-visible opens verify sheet; warn path unchanged. N1: faint white ring removed from CallAction/CallCircle/StripAction (fill+shadow carry the circle); form-field borders (Login/Ui) kept — not transparent buttons. N2: message list Arrangement.spacedBy(3.dp, Alignment.Bottom). test32 +3 locks. Gates: 41/41 (1657). CI `35611548854` success covers both commits.
- N3a (sticker-emoji bubble removal) done, commit `9c990b6`, app-only. STICKER rows share the emoji-only path (noBubble): no min width, no shadow, transparent fill, wallpaper-ink ticks, both sides. test32 N3a lock; r32-8 + both v169 stamp pins migrated same-commit. Gates: 41/41 (1658).
- N3b (per-emoji internal animation) done, commit `8252cbc`, app-only. New EmojiAnim.kt: 10 Canvas-drawn faces (JOY/ROLL/GRIN/SMILE/HEART/CRY/WOW/ANGRY/FLAT/SLEEP), each part-animated (chomping mouths, squinting eyes, falling/sliding tears, beating hearts, darting pupils, rising Z's); face outline never moves, zero whole-glyph transforms (locked by !graphicsLayer). Routed for single/multi/sticker rows with phase-shifted siblings; non-curated stay static glyphs; reduced-motion frozen. CONFLICT NOTED: overrides r44 generic emoji entry/idle for message rows by explicit owner ask (AnimatedEmoji kept for registry/tests). Pins migrated: test37 v169-item-7 call, test32 r31-12/r32-8/r34-19/v169-PLAIN, test36 new#5 (maxLines/countLines 4->3 — emoji bodies never fold). Gates: 41/41 (1659). Follow-up compile fix (CI apk red: missing animateFloat import + DrawScope.size shadowed the size param -> faceSize) committed on top, same push train.
