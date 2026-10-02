# PROJECT_UNDERSTANDING.md
_Generated/updated by Arena agent on 2026-10-01 from repo HEAD `2ca4e0d` (v274, 3.9.197). Read this at the start of every session; use the latest `memory.md` tail for round-specific truth._

## 1. Overview
KuchuPuchu is a messenger for Free Fire players with a native Android app and a browser/PWA client. Android provides 1:1 and group chat, media/files, 24h statuses, WebRTC audio/video calls with screen share, blocks, FCM push, hidden chats, and AI features; the browser client provides web chat, text/photos, and account access. No wallet/store/payments (abandoned v2 spec). Latest Android release is v274 / 3.9.197 (2026-10-01); r104 added the no-build Web client to the same Cloudflare Worker origin. Owner-tested on real phones in Bangladesh.

## 2. Tech Stack
| Layer | Technology | Version | Notes |
|---|---|---|---|
| API | Cloudflare Worker (`src/worker/index.ts`, 12872 lines) | wrangler 4.86.0 (lockfile) | D1 + R2 + Durable Objects; also serves the Web PWA assets |
| DB | D1 `kuchupuchu-v3-apac` | — | id `28f6c033-4334-4fc0-ba1c-441ab42cf9a0`, APAC/Singapore primary, schema via `ensureSchema()` plus additive migrations |
| Media | R2 `kp-media` | — | photos/voice/docs/video, single POST (≤25MB) + multipart (MPU) 8MB chunks |
| Android | Kotlin + Jetpack Compose | AGP 8.7.2, Kotlin 1.9.25, Gradle 8.11.1; compileSdk 35, min 24, target 35 | `ChatScreen.kt` 12384 lines; app id `app.kuchupuchu.android`, versionCode 274 / 3.9.197 |
| Web | Dependency-free HTML/CSS/JavaScript PWA (`public/`) | no build step | Served as same-origin Worker assets; WebCrypto KP1 message E2EE and roaming key backup |
| Auth | Phone + Google recovery; one active Android and one active Web session per account | — | New-device login supports six-digit in-app OTP or approval; browser reports `sim: UNAVAILABLE` |
| Push | FCM (data + notification) | — | Worker credentials live in Worker secrets; secret names only in docs |
| Tests | tsx + in-memory D1/R2 shim (`test/d1shim.mjs`) | 49 cases, 2046 assertions | `npm test` runs all; CI also runs Android tests/lint and builds the release APK |
| Node | >=20 (sandbox has 20.20.2) | TS 5.9.3, Prettier 3.9.6, tsx 4.23.12, better-sqlite3 12.11.1 |

## 3. Repository Map
- `src/worker/index.ts` — whole API, auth/session/OTP routes, Worker entrypoint and scheduled tasks; line numbers drift, grep first.
- `public/` — browser PWA shell (`index.html`, `app.js`, `sw.js`, manifest, country catalog and login helpers), served by the Worker from the same origin.
- `src/worker/durable-objects/` — `ChatRoom.ts` (user:<id> + conv:<id> rooms), `CallSignal.ts` (WebRTC signalling), `liveness.ts`
- `src/shared/constants.ts` — single source of truth for limits (ONLINE_WINDOW_MS 35s, SESSION_TTL 90d, MESSAGE_MAX 4000, media limits 100MB image / 2GB video / 5GB doc / 100MB voice, SINGLE_UPLOAD_MAX 25MB, PART 8MB)
- `native-android/app/src/main/java/app/kuchupuchu/android/` — 76 Kotlin files:
  - Core: `MainActivity.kt`, `KpApp.kt`, `Api.kt` (OkHttp 10s/45s), `Cache.kt` (Cache+Outbox queue-first), `ScreenStore.kt`, `Store.kt` (`SnapshotSingletons.warm()`)
  - Chat: `ChatScreen.kt` (poll 1s, paintSent, SendFlight, ChatFx, EmojiAnim, ViewOnceIcon), `ChatListScreen.kt`, `ChatMediaScreen.kt`, `AttachSheet.kt`, `StickerSheet.kt`, `LinkPreview.kt`, `Drafts.kt`, `OutboxPolicy.kt`
  - Calls: `CallEngine.kt` (WebRTC, ICE, renegotiation, network watch), `CallScreens.kt`, `CallNotify.kt`, `KpTelecom.kt`, `KpCallConnection.kt`, `KpConnectionService.kt`, `E2eeCall.kt`, `SystemAudioTap.kt`, `VoiceIsolation.kt`, `AudioRouter.kt`
  - Status: `StatusScreens.kt`, `StatusPhotoScreen.kt`, `StatusPickScreen.kt`, `CropTrimKit.kt`, `VideoExport.kt`
  - Push: `KpPush.kt`, `KpNotify.kt`, `NotifyIds.kt`, `KpUpdate.kt` (in-app updater reads releases/latest)
  - Auth: `LoginScreen.kt`, `PhoneVerifier.kt`, `GoogleAuth.kt`, `Countries.kt`, `OtpTest.kt`
  - UI: `Ui.kt` (KpSheet*, KpAvatar, pressScale), `Theme.kt`, `Feel.kt` (KpSounds), `EmojiRepo.kt`, `EmojiAnim.kt`, `SendFlight.kt`, `ChatFx.kt`, `ViewOnceIcon.kt`, `DeleteAnim.kt`, `MediaViewer.kt`, `DocViewerScreen.kt`, `MarkdownLite.kt`
  - Other: `SearchScreen.kt`, `SettingsScreen.kt`, `ProfileScreen.kt`, `ContactsScreens.kt`, `CreateGroupScreen.kt`, `GroupInfoScreen.kt`, `ArchiveList.kt`, `AIHistoryScreen.kt`, `AboutScreen.kt`, `KpCrash.kt`, `KpSecure.kt`, `PhoneBook.kt`, `Files.kt`, `ShareIntake.kt`, `Reminders.kt`, `Flags.kt`, `VideoFacts.kt`, `TiffDecoder.kt`
- `test/cases/01-49` — worker, Web-client and source-contract tests; `test/run.ts` runner (child process per case); `test/d1shim.mjs` in-memory D1/R2 with _stats; `test/helpers/phoneauth.mjs`
- `scripts/` — `ktlint-check.sh`, `validate-android.ts`, `secret-scan.ts`, `ci-watch.*`, `ktlint`
- `.github/workflows/ci.yml` — worker checks (format, typecheck, tests, secrets, Android source validation, ktlint) plus Android unit tests/lint and release-only APK build.
- `memory.md` — append-only project handoff/round log through r104 and v274; read the latest entries, never reformat.
- `docs/web-login-plan.md` — completed Web/Android login parity and OTP implementation record.
- `AUDIT-2026-09-21.md` — previous full audit (v194)
- `ARCHITECTURE-v3.md`, `PHONE_AUTH_PLAN.md`, `FIREBASE-SETUP.md` — product/architecture docs

## 4. Entry Points & Flow
- Worker: `export default { fetch, scheduled }` (~L5519). Typical send: `POST /api/conversations/:id/messages` → `requireUser` → `requireMember` → dedupe probe (`idx_messages_dedupe` PLAIN) → guarded insert → batched preview/unread writes → `waitUntil` broadcast through ChatRoom DO and FCM. Presence writes are throttled and selected background paths are excluded.
- Web: Cloudflare Worker Assets serves `public/` on the API origin (`wrangler.toml`); `/api/*` and `/ws/*` always run through the Worker, other paths serve the PWA shell. The service worker caches static shell assets only, never API or WebSocket traffic. REST uses Bearer headers; `?token=` authentication is accepted only on `/ws/*`. Web login sends `sim: UNAVAILABLE`, supports in-app OTP/approval and Google recovery, and uses WebCrypto KP1 with the account's roaming E2EE backup.
- App: `MainActivity` → `KpApp` → route store (`ScreenStore` survives nav, persisted to disk). Chat polls `GET /api/conversations/:id/messages` ~1s (cursor `created_at+rowid`), sends via `Api.http` with `Outbox` queue-first + `paintSent` fast paint (inherits mediaW/H, ImageRatios from pending echo). Composer: text flight from pill top, voice launch from micBounds (0.28→1.0 scale), media jump from attachBounds (parabolic).
- Calls: `CallEngine.startCall` → POST `/api/calls` → callee polls `/api/calls/active` 1.5s + FCM ring + DO broadcast. 5 ring layers: kickPoll, anti-phantom re-kick (WS 1.2s / FCM 1.7s), foreground poll 1.5s, worker relay 0.7s, `syncNow()` on resume. ICE via `/calls/:id/ice`, TURN from worker secrets or openrelay fallback. System back minimizes call, new ring un-minimizes, Return-to-call banner with timer.
- Cron: every minute (`wrangler.toml`) reaps stale RINGING (→MISSED + push), sweeps sessions (90d), statuses (24h), stale MPU uploads (24h with R2 abort), PENDING signups (24h), runs scheduled-message replay (in-process `handle()` to `scheduled.internal`, same-isolate nonce) and hourly latency probe (`SELF_ORIGIN /api/health` → metrics_daily lat.count/lat.sum_ms/lat.err).
- FCM: `KpPush` entry, data messages for chat/call, login approval card (Decline action only, Approve in app). Logout = no notifications for that account on device.

## 5. Commands
| Purpose | Command | Verified |
|---|---|---|
| install | `npm ci` | ✅ local 2026-10-02 (81 packages; six audit advisories: 1 low, 5 high) |
| typecheck | `npm run typecheck` | ✅ GitHub Actions run 36844205261 |
| tests | `npm test` (49 cases, 2046 assertions) | ✅ local `npm run ci` on 2026-10-02; latest main CI 36844205261 green |
| format | `npm run format:check` | ✅ GitHub Actions run 36844205261 |
| secrets | `npm run security:secrets` | ✅ GitHub Actions run 36844205261 |
| Android source validation | `npm run validate:android` | ✅ GitHub Actions run 36844205261 |
| Kotlin style | `bash scripts/ktlint-check.sh` | ✅ local 2026-10-02; latest main CI 36844205261 green |
| full source CI | `npm run ci` (format, typecheck, tests, secret scan, Android source validation) | ✅ local 2026-10-02; GitHub Actions run 36842404028 also green |
| Android unit tests + lint + APK | CI `apk` job (`testDebugUnitTest lintDebug assembleRelease`) | ✅ GitHub Actions run 36842404028 |
| local Android build | `cd native-android && ./gradlew assembleRelease` | ❌ not run here: JDK 11 only; Android SDK/adb absent; CI is the compiler |
| Worker + Web deploy | `npm run deploy` | ✅ owner-approved v274 deploy on 2026-10-01; `/` and `/api/health` returned 200 |

## 6. Environment Variables
| Key | Required | Purpose | Where |
|---|---|---|---|
| `FCM_CONFIG` | yes | Firebase config JSON for FCM | worker secret |
| `FCM_CREDENTIALS` | yes | Firebase service-account JSON | worker secret |
| `GEMINI_API_KEY` | for AI | Gemini chat fallback | worker secret (value not in repo) |
| `GOOGLE_WEB_CLIENT_ID` | yes | aud for Google ID-token verify | worker secret |
| `TURN_API_TOKEN`, `TURN_KEY_ID` | optional | Cloudflare Realtime TURN | worker secret, else openrelay |
| `HF_TOKEN` | for AI | HuggingFace router token | worker secret (credits exhausted) |
| `CF_AI_TOKEN` | for AI | Workers AI token | worker secret |
| `DEBUG_KEY` | owner diag | `?key=` gate for `/api/debug/push`, `/api/debug/clientlog`, `/api/debug/errors` | worker secret |
| `LOGIN_OTP_HMAC_SECRET` | yes for OTP login | Keyed OTP verifier; fail closed if absent | Worker secret; provisioned for v274; value never stored in docs |
| `SELF_ORIGIN` | config | `https://kuchupuchu-api.kuchupuchu.workers.dev` for self-probe | wrangler.toml vars |
| `CF_ACCOUNT` | config | account id for Workers AI | wrangler.toml vars |
| `GITHUB_PAT` | local only | CI/release API access | /home/user/.env (never commit) |
| `CLOUDFLARE_API_TOKEN` | local deploy | scoped token for wrangler deploy | /home/user/.env |
| `CLOUDFLARE_GLOBAL_API_KEY` | local D1/R2 | global key + email for D1 REST | `/home/user/.env` when provisioned |

Local runtime credentials are held in `/home/user/.env` outside this repository; keep it mode 0600 and never print or stage it.

## 7. Data Model
`users` (id PK, phone UNIQUE E164, google_subject UNIQUE, auth_status PENDING/ACTIVE, profile fields, `e2ee_public_key`, `e2ee_backup`), `sessions` (token_hash PK sha256, user_id, device_id, platform-bound auth device, created_at, expires_at 90d), `auth_devices` (user_id, device_id, platform ANDROID/WEB, ACTIVE/REVOKED status, last-seen metadata; one active device per platform), `login_requests` (id, target device/platform, status, five-minute expiry, keyed `otp_hash`, `otp_attempts` capped at five, one-time claim id), `recovery_requests` (id, user_id, google_subject, target platform, status, 5m TTL), `auth_audit` (audit trail), `devices` (FCM token PK, user_id, platform, updated_at), `blocks` (owner_id, target_id PK), `unblock_requests`, `conversations` (id PK, kind SOLO/GROUP, title, avatar, owner_id, created_at, last_message_at, hidden keys JSON), `members` (conv_id, user_id PK, role, joined_at, last_read_at, `muted_call`/`muted_msg`, hide_secret), `messages` (id PK, conv_id, sender_id, kind TEXT/IMAGE/VIDEO/AUDIO/FILE/CALL/SYSTEM/STICKER/LOCATION/CONTACT, body, file_key, file_meta_json with w/h/duration, reply_to_id, created_at, delivered_at, read_at, view_once, scheduled), `files` (key PK, owner_id, conv_id NULL until attached, size, mime, created_at — **no orphan sweep for single-POST, only MPU swept**), `uploads` (MPU session id PK, owner, parts JSON, 24h sweep WITH R2 abort), `statuses` (id PK, user_id, kind TEXT/IMAGE/VIDEO, media_key, text, bg_style, created_at, expires_at 24h), `status_views` (status_id, viewer_id PK, viewed_at, reaction), `calls` (id PK, conv_id, caller_id, callee_id, kind AUDIO/VIDEO/SCREEN, status RINGING/CONNECTED/ENDED/MISSED/DECLINED, offer/answer SDP, started_at, ended_at), `call_ice`, `call_members`, `call_peers`, `typing` (conv_id, user_id PK, at, kind), `scheduled_messages` (id PK, conv_id, sender_id, body, send_at, status), `error_log` (id PK, stack TEXT, created_at, 7d retain, currently 1337 rows), `metrics_daily` (day,key,value — msg.sent, msg.text/media, call.*, lat.count/sum_ms/err, err.worker/rows, dev.active24h, prune.done), `metrics_wm`, `schema_meta` (key,value,updated_at), `rate_limits`, `push_fallback`, `ai_sessions`+`ai_session_msgs`.

Indexes: `idx_messages_conv` (conv_id, created_at), `idx_messages_dedupe` PLAIN (conv_id, sender_id, client_id) + app-level guard, etc. Migrations via `runCatchingSql` outside batch.

## 8. API Surface
Auth: `POST /api/auth/verify-phone` (E164 + platform/SIM result), `POST /api/auth/google/bind`, `POST /api/auth/login/{poll,cancel,approve,decline,otp}`, `POST /api/auth/recovery/{lookup,start,complete}`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/devices`, `POST /api/auth/phone/change`; E2EE identity backup via `GET/PUT /api/e2ee/backup`.
Users: `GET /api/users/:id`, `GET /api/users/username/:name`, `PATCH /api/users/me`, `POST /api/users/:id/avatar`, `GET /api/users/:id/avatar`.  
Conversations: `POST /api/conversations` (solo/group), `GET /api/conversations` (list, ≤8 stmts, pinned budget), `GET /api/conversations/:id`, `DELETE /api/conversations/:id` (watermark), `POST /api/conversations/:id/{avatar,read,mute,hide,accept,reset,restore-latest}`, `POST /api/conversations/:id/members`, `DELETE /api/conversations/:id/members/:uid`, `GET /api/conversations/:id/messages` (cursor), `POST /api/conversations/:id/messages` (4 waves/6 trips), `GET /api/conversations/:id/messages/search`, `GET /api/conversations/:id/media`, `POST /api/conversations/:id/typing`, `GET /api/conversations/:id/scheduled`, `POST /api/scheduled/:id`.  
Messages: `DELETE /api/messages/:id` (permanent; personal 1:1 members may remove either member's message for everyone, while groups and bot transcripts keep stricter sender rules; no Edited indicator), `POST /api/messages/:id/react` (bare emoji), `GET /api/messages/:id/{media,view,fx}`, `POST /api/messages/:id/fx` (emoji 3D replay, 3s damper + fx:uid rate bucket).
Files: `POST /api/files` (single ≤25MB), `POST /api/files/mpu/{start,part,complete,abort}` (multipart 8MB chunks, 2GB video/5GB doc), `GET /api/files/:key` (auth-gated, nosniff).  
Statuses: `POST /api/statuses`, `GET /api/statuses` (≤8 reads), `GET /api/statuses/:id`, `DELETE /api/statuses/:id`, `POST /api/statuses/:id/{view,react}`, `GET /api/statuses/:id/viewers`, `GET /api/statuses/:id/media`.  
Calls: `POST /api/calls`, `GET /api/calls/active`, `POST /api/calls/:id/{join,answer,decline,end,ice,reoffer,reanswer,media}`, `GET /api/calls/:id/peer`.  
AI: `POST /api/ai/sessions`, `GET /api/ai/sessions/:id`, etc. (HF + Gemini + CF AI, currently 402/503 due to credits).  
Debug: `GET /api/debug/errors` (key-gated), `POST /api/debug/{push,clientlog}` (key-gated).  
WS: `/ws/chat/:convId`, `/ws/call/:callId` (Durable Objects).  
Health: `GET /api/health` (200, version 3.0, push/turn/realtime/media true).  
Auth: `Authorization: Bearer <90d token>` (sha256 stored). CORS `*`.

## 9. Conventions (MUST FOLLOW)
- One logical item per commit. Use a new branch, Conventional Commits, push and open a PR; never commit directly to `main`/`master` or force-push. Fetch first because the owner may update `main` outside this session.
- UI: Every popup is bottom sheet (`KpSheet` / `KpSheetRow` / `KpConfirmSheet`), no AlertDialog/DropdownMenu (test 32 scans). No long text on buttons, buttons never wrap, no helper text, short placeholders, compact bars. Theme: light-cream gold + dark-blue ActionBlue, login excluded. Avatars no border, ring only for status (dark blue unseen/gray viewed), sizes 36/44/88/40/48. Home ⋮ = My Profile, New contact, All contacts, Settings. Settings hub: Privacy/Appearance/Device/Permissions/App. Privacy headers are questions. Chat ⋮: View contact / Add contact. Other-user profile ⋮ = Add/Block/Hide/Mute/Report. Chat-list long-press = Delete/Mute/Pin/Create group/Select, rounded checkbox multi-select, one open swipe row. Hidden chats: free-form secret key per chat, typed in Search reveals, no notifications/sounds. Group: Add Members/Group Media/Theme/Search/Mute/Leave, profile ⋮ = Add Members/Settings Private toggle. No Edited, Delete for everyone permanent, DELETED vanishes not replyable, reactions bare emoji, photos small inline card (120x160, album 208), tap own viewer, JPEG q90, Viewer ⋮ = Save/Forward only, own video player. Owner unblockable, Calls option on his profile.
- Calls: System back MINIMIZES call, new ring un-minimizes, Return-to-call banner with timer everywhere, opening app with call connected must NOT auto-navigate. 5 ring layers mandatory. Incoming notification self-retires 60s, missed-call push posts card + retracts ring. No waiting-for-video, camera-off shows avatar. Action strip icon-only no ripple. Login-alert notification Decline only, Approve in app.
- Sounds/notifications/privacy: message receive sound only for incoming in OPEN chat, never on send. Notification Like sends 👍. Logout = no notifications for that account on that device, login elsewhere needs no approval when no other device holds session. Private profile ⇒ FLAG_SECURE in chat+calls, no save/forward of that peer's pictures. Status photo auto-close 5s, hold pauses, release resumes, reactions go to viewer list never inbox, dedicated share screen no caption, video crop+trim first minute default.
- Code hygiene: No `Log.*` in app (use `KpCrash.mark`), no APKs in repo, secret-scan green, `.env` never in repo, ASCII-only Kotlin/TS source emoji as \uXXXX, prettier printWidth 100, lexicographic imports, explicit Compose imports (missing = red CI), `SnapshotSingletons.warm()` for new Compose-state singletons, hoist nullable before remember, CompositionLocal.current outside remember, local fun after var it captures, statement-when inside runCatching needs else->{}, `String.replaceFirst(Regex,lambda)` does not exist, Python-written Kotlin regex needs \\\\ per backslash, pointerInput keyed on changing values → rememberUpdatedState, inner pointerInput consuming Main suppresses outer drag, never await list scroll inside network coroutine, M3 ModalBottomSheet inside Dialog layers badly, do not name object Contacts.
- Worker/D1: `ensureSchema` verbatim-locked, NEW DDL appended never edited, migrations via runCatchingSql + fingerprint 1 walk per deploy. Deploy validator error 10021 = random/I-O at module scope (mint lazily). `new Response(uint8array)` needs `Uint8Array<ArrayBuffer>`. Message list returns items. Round-trip budget product feature (BD↔Singapore 60-100ms per stmt): independent reads → Promise.all ≤6 concurrent, writes → one db.batch, reads never inside batch (shim runs _run() on batched stmts → no rows). idx_messages_dedupe PLAIN keep pre-INSERT probe AND INSERT..SELECT..WHERE NOT EXISTS guard. Pinned budgets: list ≤8 stmts (test04), statuses ≤8 reads, idle rollup ≤6 (17/23), disappearing write deltas (07), latency probe 3 writes (26), warm boot 1 read (27), message POST 4 waves/6 trips (32 r33-4). Secrets unreadable live diagnosis = temporary console.log + `wrangler tail --format json` (multi-object JSON parse via raw_decode loop, events carry cf.colo, wallTime, cpuTime) remove before commit kill tail before deploy. Time-dependent tests pin to minute last second. Test32 check detail truncated ~600 chars → emit compact map temporarily then restore.
- Tests/locks: Grep tests for OLD literal before editing any worker/Android line. Slice-based locks (src.slice(indexOf(A),indexOf(B))) depend on function names/visibility/order — keep `private fun ConvCard(`, `async function sendAiReply(`, `async function all<T>(`, `function previewOf(row: MsgRow): string {`, `const scheduledListMatch = path.match(` etc. Python-written JS regex literals double escaping, raw r''' for big JS blocks, `node file.mjs` fails on TS import → always `npx tsx`.
- Shell/tooling: source .env needs quoted values with spaces. No backticks in echo/heredocs unless single-quoted. Python heredoc edits never leave $var inside Kotlin strings. Big JS in Python → raw string. `wrangler dev --remote` no longer supports DOs (fine for D1-only A/B — room broadcasts log broadcast_failed), `wrangler versions upload` preview URLs 404. GitHub: release create needs FULL 40-char SHA, CI list ?per_page=1, artifact zip via /actions/artifacts/<id>/zip.
- Git: branch naming `fix/`, `feat/`, etc., Conventional Commits, one logical change per commit, never --force, never --no-verify unless hook truly broken.

## 10. Test Setup
`npm test` → `test/run.ts` runs `test/cases/01..49` in separate processes against `test/d1shim.mjs` (makeD1 with `_stats`, makeR2, `makeCtx().drain()`, phone-auth helpers, and isolated worker imports). The suite covers Worker behavior, Web country/login parity, WS token scope, and source-contract locks. Status 2026-10-01: **49/49 green, 2046 assertions** in GitHub Actions run `36842404028`; latest main CI `36844205261` succeeded. `npm run ci` covers format, typecheck, tests, secret scan and Android source validation; CI separately runs ktlint plus Android unit tests, lint and release APK build. Local dependencies are absent in this read-only bootstrap.

## 11. Git & Deploy
- Repository: `rabbihossainltd1/KuchuPuchu`; `main` tracks `origin/main`; CI uses cancel-in-progress. Work on a new branch, make one logical commit at a time, push and open a PR; never force-push or commit directly to `main`.
- Release tags are `v<versionCode>` and names are `v<versionCode> (<versionName>)`; the in-app updater reads `releases/latest`. CI publishes a release-only APK artifact (`app-release.apk`); never commit APKs. A release requires a green CI run and owner approval.
- Current 2026-10-01: main `2ca4e0db73ef146e3b056557eee0dd4b5b9c1816`; latest release v274 (3.9.197), CI `36844205261` SUCCESS. Worker/Web v274 deployed as `22ddb1f5-3e34-45ef-b6ac-0ffa9d0fcc66`; `/` and `/api/health` returned 200. The v274 APK was signed with the tracked debug keystore under a one-time owner approval to preserve v273 update continuity; future releases require separate approval and a secure signing-key migration. The web app is served from the Worker at `https://kuchupuchu-api.kuchupuchu.workers.dev`.
- Production deploy/release credentials are not present in this bootstrap workspace; no deployment or release was performed here.
## 12. Historical Known-Issue Snapshot

> The table below is the 2026-09-21/v194 audit snapshot, not a verified 2026-10-01 status. Later rounds fixed or changed several areas. Re-check the latest `memory.md` and current source before treating any row as open.

| # | Area | Observation | Severity | Status |
|---|---|---|---|---|
| 1 | AI | HF credits exhausted 09-17 → hf-chat 402, gemini 503, 242 err/day on 09-21 | HIGH | OPEN — needs top-up or provider migration or disable endpoints |
| 2 | Auth | logged-out takeover via self-attested SIM on no-live-device path (index.ts:5388, no 2nd factor) | HIGH | OPEN — owner decision needed (breaks SIM-only reinstall if fixed) |
| 3 | View-once | media fetchable without spend — honest-client only | HIGH | FIXED in 7121277 (H3) — server spend on fetch, test38 added |
| 4 | Enumeration | user/phone/conversation oracles | MED | FIXED in 6ff3e2a (M1) + test40 — generic 404s |
| 5 | Rate limit | per-isolate in-memory buckets, bypass via many isolates | MED | FIXED in 2e64800? (M2) + test39 — global D1-backed limits |
| 6 | Storage | no per-user quota + unattached single-POST uploads never swept (MPU swept) | MED | OPEN — needs quota + orphan sweep |
| 7 | Signing | debug.keystore committed, anyone with read can sign update-accepted APK | MED | MITIGATED phase1 — KP_DEBUG_KEYSTORE_B64 secret + repo file fallback, sha256 logged, phase2 deletion pending owner |
| 8 | Versioning | v194 had 2 commits same tag, updater won't offer 2nd | MED | FIXED process — v195+ single commit per tag |
| 9 | Observability | latency self-probe 100% failing lat.count=0 | MED | FIXED — lat.count 63 on 09-21 |
| 10 | Polling | ~1s chat poll + 1.5s call poll battery/data/D1 cost | MED | OPEN — by design, WS exists but poll remains fallback |
| 11 | CORS | * | LOW | OPEN — by design for now |
| 12 | DEBUG_KEY in query | key in URL logged | LOW | OPEN — use header alternative? |
| 13 | Public TURN fallback | openrelay.metered.ca no capacity guarantee | LOW | OPEN — dedicated TURN if calls fail |
| 14 | No delete time-limit | Delete for everyone permanent anytime | INFO | Intentional per owner? |
| 15 | Index-keyed photo grid | ProfileScreen items(photos.size) can mis-animate | LOW | OPEN |
| 16 | Manual 16ms FX loops | ChatFx 16ms frame-stepping, Animatable smoother | LOW | OPEN — works, nit |
| 17 | APK assets duplication | v200 has 4 assets (2 naming schemes) | INFO | By design (updater picks correctly) |

## 13. Current Open Questions / Owner Actions
1. Rotate the GitHub and Cloudflare credentials included in the uploaded handoff; they were not used in this bootstrap. Do not paste replacement values into chat.
2. Plan secure Android signing-key migration before the next APK release; v274's tracked-debug-key use was a one-time exception, not standing authorization.
3. Owner phone/browser smoke test for v274 Web login, OTP/approval, and Android-Web session coexistence remains the product-level verification path.
4. Any future production deploy or APK release requires separate explicit owner approval.

## 14. Round 66 delta — 2026-09-23 (supersedes older snapshot details above)
- Base release is v214 / 3.9.137; the Round 66 release candidate is v215 / 3.9.138 (publication awaits CI). The historical v200 snapshot above is superseded by memory.md Round 66.
- Personal message E2EE was introduced in Round 64 (`E2eeMsg.kt`); Round 66 adds session-aware retryable publication at app entry, late-key envelope reopening, and a shared Api.request fail-closed transport guard (`E2eePolicy.kt`). KP1 wire crypto is unchanged; group/bot and media-byte encryption scope is unchanged. The notice scrolls within the first actual history row, not a fixed overlay.
- Attach panel: 50% black edit/caption controls, longer shared caption/view-once boundary, 48dp full-seat glyph that turns blue without another border. Panel heights unchanged. `AttachmentExitGate.kt` + a bottom-sheet confirmation protect selected media from Back/reply/outside actions. Cancel keeps the batch; consumed outside gestures are not replayed into dangerous actions.
- Chat-list previews: `lastMessagePreview` carries an opaque latest message for local off-Main decrypt; `unreadPreviewKind` is a bounded metadata-derived category. Unread content is hidden behind count/type; seen content is displayed locally. Mixed/unknown or large batches use total new-message count. No schema change or added D1 statements; sample cost is bounded to 32 recent metadata rows only for unread chats.
- Verification checkpoint: 41/41 cases / 1705 assertions; local gates green; 11 new E2EE policy, 8 attachment-exit and 9 preview formatter JVM tests. CI for items 1 and 2 is green; item 3/release CI follows. See memory.md for live probe evidence and IDs, not the historical deployment table above.
- Release assets are release-only now (owner policy since 2026-09-22): `app-release.apk` + `kuchupuchu-vN.apk`, no debug APK. Worker versions also changed after app-only pushes; verify the actual deployment pointer after final push.

- Round 66 final integrity fix: the encrypted-body cap is derived from worst-case UTF-8 (4000 UTF-16 units), 12-byte nonce, 16-byte GCM tag and base64 = 16044 characters. Envelopes are never truncated; oversized send/edit/schedule is rejected. Actual Bengali AES-GCM round trips passed locally and against live endpoints. Combined selected JVM checks: 36 passed. The KP1 wire format/key derivation itself is unchanged.


## 15. Current Bootstrap Snapshot — 2026-10-01
- Repository state: shallow checkout of public `main` at `2ca4e0db73ef146e3b056557eee0dd4b5b9c1816`; latest release v274 / 3.9.197; latest main CI `36844205261` completed successfully. The uploaded v211 handoff predates r104 and must not override the current repo/memory.
- r104 adds a same-origin PWA under `public/`, OTP + approval login parity, platform-aware Android/Web sessions, and WebCrypto KP1 identity reuse. `wrangler.toml` routes `/api/*` and `/ws/*` through the Worker and serves the other paths as the SPA.
- Production Worker/Web v274 is recorded as live in the latest release handoff; this bootstrap did not deploy or publish. Future releases require separate owner approval and a signing-key migration plan.
- This sandbox: Node 20.20.2 / npm 10.8.2 / Python 3.13; local-only `/home/user/.env` is mode 0600; repo `.env`, `gh`, Docker, Go, PHP, `kotlinc`, and `adb` are absent; Java is 11 while Android CI uses Java 17. `npm ci` added 81 packages; `npm run ci` passed 49/49 cases (2046 assertions), and ktlint passed. A local Gradle/Android build was not run (JDK 17 and Android SDK are absent). The install reported six dependency advisories (1 low, 5 high); no dependency changes were made.
- Workspace after the approved shallow clone: 16 MB and 595 tracked working-tree files (excluding `.git`); full history was not cloned.
- Bootstrap branch `chore/project-bootstrap-v274` contains documentation-only updates to `README.md`, `PROJECT_UNDERSTANDING.md`, and `memory.md`. No product source/dependency changes, Worker deployment, or release were made.
- Security: local runtime credentials are stored only in `/home/user/.env` outside the repository; no secret value was added to tracked project files.
- Next: read the newest `memory.md` tail and the owner's current issue list before code work; do not infer a new bug from the old v211 handoff.
