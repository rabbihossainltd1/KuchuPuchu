# PROJECT_UNDERSTANDING.md
_Generated/updated by Arena agent on 2026-09-17. Read this at the start of every session._

## 1. Overview
KuchuPuchu is a WhatsApp-style messenger for Free Fire players — 1:1 and group chat, media/file send, 24h statuses (photo/video/text), WebRTC audio/video calls with screen share, blocks, and FCM push. No coin wallet/store/gifting/matchmaking/payments (removed from v2 social-network spec). Single Android client (Kotlin + Jetpack Compose, minSdk 24/target 35, single activity `MainActivity`) talks HTTPS JSON to a Cloudflare Worker (`src/worker/index.ts`) backed by D1 (SQLite, primary SIN `kuchupuchu-v3-apac`, read replication) and R2 (`kp-media`), with Durable Objects `ChatRoom` (per conversation+per user list channel) and `CallSignal` (per call WebRTC signalling). Live at `https://kuchupuchu-api.kuchupuchu.workers.dev`, package `app.kuchupuchu.android` (do not rename). Maturity: 147 releases (v147/3.9.71), 1527 test assertions, CI two-job pipeline (worker checks + APK build). Current state: needs HANDOFF update (stops at v137, 53 commits behind).

## 2. Tech Stack
| Layer | Technology | Version | Notes |
|---|---|---|---|
| Worker runtime | Cloudflare Workers | compat 2025-08-01 | `wrangler.toml` account 92081fac…, cron `* * * * *` |
| Language | TypeScript | 5.9.3 | strict, Bundler resolution, noEmit |
| DB | Cloudflare D1 (SQLite) | `kuchupuchu-v3-apac` 28f6c033… | SIN primary, auto read replication |
| Object storage | Cloudflare R2 | `kp-media` | photos/voice/docs/videos, worker-mediated |
| Realtime | Durable Objects | `ChatRoom`, `CallSignal` | WebSocket fan-out, 6 concurrent D1 limit |
| Android language | Kotlin | Compose BOM | single module `native-android/` |
| Android UI | Jetpack Compose | M3, target 35 | edge-to-edge `MainActivity` |
| Calls | WebRTC 1.1.3 | native | `CallEngine.kt` ~2.9k, TURN via CF Realtime |
| Push | Firebase FCM | — | `KpPush.kt`/`KpNotify.kt`, data HIGH |
| AI | Hugging Face Inference | router.huggingface.co | Kimi-K2→DeepSeek→Workers AI→Gemini fallback; SD3-medium for images; Whisper STT |
| Tests | tsx + in-memory D1/R2 | better-sqlite3 12.2 | `test/d1shim.mjs` with `_stats` (reads/writes/trips/waves) |
| CI | GitHub Actions | ubuntu-22.04, Node 20, Java 17 | worker (typecheck/tests/format/secrets/validate/ktlint) → apk (lint+test+assemble) |
| Lint/format | ktlint 1.3.1 (pinned), prettier 3.6.2 | — | import hygiene, 100-char width |

## 3. Repository Map
```
KuchuPuchu/
├── src/
│   ├── worker/
│   │   ├── index.ts              // ~10.5k lines — all REST, schema, AI, FCM, cron
│   │   ├── env.d.ts              // D1/R2/DO ambient types
│   │   └── durable-objects/
│   │       ├── ChatRoom.ts       // user:<id> + conv:<id> WS
│   │       └── CallSignal.ts     // per-call SDP/ICE relay
│   └── shared/constants.ts       // single source: limits, TTLs, ranks
├── native-android/
│   ├── app/
│   │   ├── build.gradle.kts      // vc 147 / vname 3.9.71
│   │   ├── debug.keystore
│   │   └── src/main/
│   │       ├── AndroidManifest.xml // 30+ permissions, FGS types, ShareActivity
│   │       └── java/app/kuchupuchu/android/
│   │           ├── ChatScreen.kt (8154)  // chat UI, bubbles, send, keyboard glide, fly anim
│   │           ├── ChatListScreen.kt (1720)
│   │           ├── CallEngine.kt (2923) / CallScreens.kt (1622) / CallNotify.kt
│   │           ├── AttachSheet.kt (1231) / MediaViewer.kt (983) / MediaEditScreen.kt (2075)
│   │           ├── Api.kt (669) / Cache.kt (685) / ScreenStore.kt (760)
│   │           ├── KpPush.kt / KpNotify.kt / KpUpdate.kt / KpCrash.kt / KpSecure.kt
│   │           ├── StatusScreens.kt / LoginScreen.kt / SettingsScreen.kt / ProfileScreen.kt
│   │           └── Ui.kt / Theme.kt / Feel.kt / PhoneBook.kt / etc (~60 files, 43k total)
│   ├── audio-routing.md / image-cache.md
│   └── gradle/
├── test/
│   ├── run.ts                    // runs 32 cases in isolated processes
│   ├── d1shim.mjs                // makeD1/makeR2/makeCtx, _stats
│   ├── helpers/phoneauth.mjs
│   └── cases/01…32-*.mjs         // 1527 assertions (32-bots-verified = 541)
├── scripts/
│   ├── ktlint-check.sh / validate-android.ts / secret-scan.ts / ci-watch.*
│   └── ktlint/.editorconfig
├── .github/workflows/ci.yml
├── wrangler.toml / package.json / tsconfig.json / README.md / ARCHITECTURE-v3.md
└── docs/ (cloudflare-token.md, native-plan.md)
Workspace outside repo (/home/user/):
├── .env                          // PAT, CF keys, LIVE_VERSION (stale v133)
├── SKILLS.md (rules) / HANDOFF.md (map, stops at v137, 354 lines, should be v147)
├── uploads/ (owner bug lists)
└── scratch/ (one-shot patches, rig.sh/kc2.sh)
```

## 4. Entry Points & Flow
**Worker:** `src/worker/index.ts:handle()` (~L4724) — `ensureSchema(env.DB)` on first request (fingerprint `schema_meta` single-read skip), then `new URL(request.url).pathname` routing. Example — **send message:**
1. `POST /api/conversations/:id/messages` (L6992) → `requireUser` → `requireMember` + `membersOf` + block JOIN in `Promise.all` → reply/clientId dedupe probe + upload refs in second `Promise.all` → ONE `db.batch` (INSERT SELECT WHERE NOT EXISTS + files.conv_id bind + preview UPDATE + unread bump) → `broadcastRoomEvent` (DO `ChatRoom`) + `pushToUser` (FCM). Budget: 4 waves/6 trips/≤3 concurrent (test 32 r33-4). `msgFrom` builds payload, `previewOf` for list/push, `pokeUserConversation` bumps list. D1 primary SIN = BD→SIN 60-100ms per statement; independent reads parallelized, writes batched.

**Auth (OTP-less phone):** `POST /api/auth/verify-phone` (E.164 BD-first normalize `01…/8801…/+880…`) → `auth_devices` + `login_requests` (5m TTL) → if other device holds session → push `kp_login_req` with Decline only; else `verify-phone` treats no-live-session as signed-out. `POST /api/auth/google/bind` (Credential Manager ID token, aud = `GOOGLE_WEB_CLIENT_ID`) mandatory on signup, recovery via `auth/recovery`. Session token stored hashed, 90-day TTL, `Api.AuthInterceptor` attaches bearer only for worker host.

**Android:** `MainActivity.kt` → `KpApp.kt` NavHost → `ChatScreen(convId)`:
- State: `ScreenStore` (in-memory + disk `kp-*.json`), `Cache` (`Cache`, `Outbox` queue-first `kp-outbox.json`), `Api.http` (OkHttp 10s/45s)
- Send: `Outbox.send(convId, clientId, body, local, onResult)` writes queue before request, `pendingFor(convId)` repaints clock bubbles, `materialize()` uploads media from queue, `paintSent` decides `follow` before rows move, `animateScrollToItem` in own coroutine
- Keyboard: `rememberImeGlidePx()` spring (critical spring) animates IME height; `LaunchedEffect(glidePx)` scrolls thread by delta when parked at bottom (geometric check `tail.index == total-1 && tail.offset+tail.size <= viewportEnd+24`); composer `padForIme` lifts pill; edge-to-edge window never resizes (the bug that killed r50's `onSizeChanged` feed)
- Realtime: `KpSocket` (DO `ChatRoom`) `user:<id>` + `conv:<id>`, `CallSignal` for WebRTC; `KpPush` (FCM `MESSAGING_EVENT`) → kick/re-kick/kickPoll (1.2s WS/1.7s FCM) + foreground poll 1.5s + worker relay 0.7s + `syncNow()` on resume — 5 layers must stay

**Calls:** `POST /api/calls`, `/calls/:id/join`, `/:id/media {camera,screen}` → `calls.media_json` + `media` frame; `CallEngine` (WebRTC, `JavaAudioDeviceModule.setAudioRecordDataCallback` for `SystemAudioTap` + `VoiceIsolation` RNNoise), `CallService` FGS (mic/camera/mediaProjection), `KpTelecom` self-managed, back minimizes, banner `ReturnToCallBanner` when minimized.

## 5. Commands
| Purpose | Command | Verified ✅/❌ |
|---|---|---|
| install | `npm ci` | ✅ 81 pkgs, 2m |
| typecheck | `npx tsc -p tsconfig.json --noEmit` | ✅ pass |
| tests (all) | `npx tsx test/run.ts` | ✅ 32/32, 1527 |
| test single | `npx tsx test/cases/17-backend-integrity.mjs` (via run.ts isolation) | ✅ pattern works |
| format check | `npx prettier --check .` | ✅ pass |
| format write | `npx prettier --write <file>` | ✅ |
| secret scan | `npx tsx scripts/secret-scan.ts` | ✅ pass |
| android validate | `npx tsx scripts/validate-android.ts` | ✅ manifest/resources/deps/lint gate |
| ktlint | `bash scripts/ktlint-check.sh` | ✅ clean (pinned 1.3.1) |
| full ci | `npm run ci` (all above) | ✅ pass |
| deploy | `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy` | ✅ |
| tail | `npx wrangler tail kuchupuchu-api --format json` | ⚠️ pretty-printed, parse with raw_decode loop |
| android build | `cd native-android && ./gradlew assembleDebug` | ❌ OOM in sandbox (2GB), CI supports |
| android lint local | `bash scripts/ktlint-check.sh` only; full lint needs CI | ⚠️ structural only |

## 6. Environment Variables
| Key | Required | Purpose | Example |
|---|---|---|---|
| `GITHUB_PAT` | yes | push/fetch, release API | `ghp_…` (never commit) |
| `GIT_USER_NAME/EMAIL` | yes | repo-local identity | `rabbihossainltd1` |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Wrangler deploy | `92081fac…` |
| `CLOUDFLARE_EMAIL` | yes | D1 REST auth (`X-Auth-Email`) | `rabbihossainltd@…` |
| `CLOUDFLARE_GLOBAL_API_KEY` | yes | D1/R2 REST (scoped token has no D1 read) | `cfk_…` |
| `CLOUDFLARE_API_TOKEN` | yes | Worker deploy (`wrangler secret`) | `cfut_…` (Workers Scripts R/W) |
| `WORKER_URL` | yes | health probe | `https://kuchupuchu-api…workers.dev` |
| `DB` (binding) | yes | D1 | `kuchupuchu-v3-apac` 28f6c033… |
| `MEDIA` (binding) | yes | R2 | `kp-media` |
| `FCM_CONFIG` / `FCM_CREDENTIALS` | yes | push | JSON secrets (6→8 total) |
| `GOOGLE_WEB_CLIENT_ID` | yes | phone auth Google bind | `*.apps.googleusercontent.com` |
| `TURN_KEY_ID` / `TURN_API_TOKEN` | yes | CF Realtime TURN | ICE mint cache |
| `HF_TOKEN` | yes | Hugging Face Inference | `hf_…` (inference.serverless.write) |
| `GEMINI_API_KEY` / `CF_AI_TOKEN` | fallback | AI fallback chain | removed from Env in r48? still in code as fallback |
| `SELF_ORIGIN` | yes | cron latency probe | `https://kuchupuchu-api…` |
| `DEBUG_KEY` | optional | `/api/debug/errors` | — |
| `LIVE_VERSION` / `MAIN_SHA` / `WORKER_VERSION` | local only | `/home/user/.env` live pointers | stale (v133 vs v147) |

## 7. Data Model
**D1 tables (30+):** `users` (id, username, displayName, phone_e164, google_subject, auth_status, priv_phone/avatar/messages/lastSeen/groups/status, read_receipts, private_profile, badge, verified…), `sessions` (token_hash, user_id, device_id, 90d), `auth_devices` (deviceId, userId, appVersion, heartbeat, ip/city/country), `login_requests` (new_device_name, 5m), `devices` (push token per device per platform), `conversations` (id, kind SOLO/GROUP, title, avatar_url/version, disappear_seconds/theme/request_from/private_group), `members` (conv_id,user_id, role, muted, hidden, hidden_key), `messages` (id, conv_id, sender_id, kind TEXT/IMAGE/…/DELETED, body, file_key/meta, reply_to, client_id, created_at, delivered_at), `scheduled_messages` (sendAt ≥ next minute ≤30d, cron dispatch), `files` (key, owner_id, conv_id, size), `statuses` (id, userId, kind, media_key, text, expires_at 24h), `status_views` (status_id,viewer_id,reaction), `calls` (id, conv_id, caller/callee, kind AUDIO/VIDEO/SCREEN, status RINGING/ACTIVE/ENDED/MISSED, offer/answer/reoffer SDP, media_json), `call_ice`/`call_members`/`call_peers` (mesh group calls), `blocks` (owner→target), `unblock_requests` (blocker/requester, PENDING/IGNORED), `typing` (conv_id,user_id,at,kind image|text), `metrics_daily`/`metrics_wm`/`schema_meta` (fingerprint), `error_log`. **Indexes:** `idx_messages_dedupe` PLAIN (needs pre-INSERT probe + `WHERE NOT EXISTS` guard), conversation list/unread, etc. **R2:** `kp-media` objects keyed by message/file id.

## 8. API Surface
Auth: `POST /api/auth/verify-phone`, `POST /api/auth/google/bind`, `POST /api/auth/login/poll|cancel|approve|decline`, `POST /api/auth/recovery/*`, `POST /api/auth/logout|refresh`, `GET /api/auth/devices`, `GET /api/me` + `PATCH /api/me` (priv* + readReceipts/privateProfile), `GET /api/config/firebase|ice`, `GET /api/auth/phone/change`
Conversations: `POST /api/conversations` (solo), `POST /api/conversations/group`, `GET /api/conversations` (list, ≤8 stmts), `GET /api/conversations/:id` (detail + block shapes), `DELETE /api/conversations/:id`, `POST /api/conversations/:id/hide` (now hidden_key), `PATCH /api/conversations/:id` (privateGroup/theme)
Messages: `GET /api/conversations/:id/messages` (before cursor), `POST /api/conversations/:id/messages` (text/image/video/file, sendAt, clientId, reply_to, viewOnce, schedule 202), `POST /api/conversations/:id/typing`, `POST /api/conversations/:id/read`, `DELETE /api/messages/:id` ( → DELETED tombstone or hard delete for viewOnce), `POST /api/messages/:id/view` (viewOnce, 410 race), `GET/DELETE /api/scheduled/:id`, `POST /api/blocks`, `POST /api/blocks/request|ignore`, `GET /api/blocks`
Files/Media: `POST /api/files` (multipart 25MB, owner+conv recorded), `GET /api/files/:key` (auth gated), `GET /api/users/:id/avatar`, `GET /api/link-preview?url`, `GET /api/link-image?url`
Statuses: `POST /api/statuses` (photo/video/text, maybe trim/crop meta), `GET /api/statuses`, `POST /api/statuses/:id/view|react`, `GET /api/statuses/mine/views`, `DELETE /api/statuses/:id`
Calls: `POST /api/calls`, `POST /api/calls/group`, `POST /api/calls/:id/answer|decline|end|join|peer|media`, `GET /api/calls/active`, ICE via `call_ice`, `GET /api/debug/errors|push`
Push: `POST /api/devices` (register), `DELETE /api/devices`, `POST /api/push/ack`
Search/Contacts: `GET /api/search?q`, `GET /api/users?username=`, `GET /api/users/:id`, `POST /api/contacts/match` (500 chunks), `POST /api/reports`, `GET /api/health` (probe), `GET /ws/user`, `GET /ws/conv/:id` (DO)
AI: `POST /api/ai/welcome`, `GET /api/ai/sessions`, internal via `hfChat`/`hfImage`/`hfTranscribe`

Auth: Bearer token hashed in `sessions`; `Api.AuthInterceptor` only for worker host; FLAG_SECURE if selfPrivate; rateLimit per IP.

## 9. Conventions (MUST FOLLOW)
- **Popups = bottom sheets:** `KpSheet`/`KpSheetRow`/`KpConfirmSheet` everywhere; no AlertDialog/DropdownMenu (test 32 enforces via grep).
- **Imports:** Compose extensions imported, not qualified; lexicographic order; unused imports flagged but missing = CI red.
- **Kotlin smart-cast:** hoist `val x = nullable ?: default` before `remember{}`; `CompositionLocal.current` outside `remember`.
- **Regex:** `String.replaceFirst(Regex, lambda)` doesn't exist; Kotlin regex needs `\\\\` per backslash when written from Python.
- **Pointer:** inner `pointerInput` consuming in Main pass suppresses outer drag; key changing values → `rememberUpdatedState`.
- **Navigation:** `ModalBottomSheet` not inside `Dialog` — sibling composition.
- **Worker:** `ensureSchema` fingerprints via `schema_meta`; new DDL appended never edited; `runCatchingSql` for ALTER; budget 6 concurrent D1, ≤8 stmts list route, 4 waves/6 trips for send (test 27/32). `crypto.randomUUID()` lazily (10021 validator). `Uint8Array<ArrayBuffer>` for Response.
- **Logging:** `KpCrash.mark()` only, no `Log.*` in app; worker `console.log` allowed but gated for FCM.
- **Theme:** light-cream gold vs dark-blue `ActionBlue*` (no cream leaks; test 32 scans); avatars no border, ring only for status; sizes 36/44(48)/88/40/48.
- **Patches:** one-shot Python scripts in `/home/user/scratch/r<round>_<item>.py` with assert-once replaces; `npx prettier --write` on changed ts/mjs only, re-grep after.
- **Gates (every commit):** `npx tsx test/run.ts | grep ^32/32` + `ktlint` + `tsc --noEmit` + `prettier --check` + `secret-scan` — all four before push. Deploy worker first if `src/worker/**` changed, then probe live, record Version ID.
- **Git:** repo-local identity, fetch+update-ref before commit, one item per commit `rNN-<item>: …` with WHY/WHAT/measured numbers, push via PAT URL, never force, rebase on reject.

## 10. Test Setup
- Framework: custom runner `test/run.ts` → spawns each `test/cases/*.mjs` in isolated process (module-scope state), prints `OK/BROKEN` per assertion, exits non-zero on BROKEN.
- Harness: `test/d1shim.mjs` `makeD1` (SQLite in-memory, `_stats` reads/writes/trips/waves/concurrent), `makeR2`, `makeCtx().drain()`, `test/helpers/phoneauth.mjs` `makeReg` + `installGoogleStub()` (env `GOOGLE_WEB_CLIENT_ID="kp-test-web-client"`), import `src/worker/index.ts?v=N`.
- Running one case: runner isolates — use `npx tsx test/cases/17-backend-integrity.mjs` pattern via probe.mjs (see cases/32 example `mk()`).
- Location: `test/cases/01…32` (32 cases, 1527 assertions). Heavy: `32-bots-verified.mjs` (541, locks source literals), `17-backend-integrity.mjs` (128), `18-app-review-guards.mjs` (102).
- Android unit tests: `native-android/app/src/test/` `VoiceWaveformTest`, `VideoPlanTest` etc., run via `./gradlew testDebugUnitTest` in CI.
- Current: ✅ 32/32 pass.

## 11. Git & Deploy
- Branch model: `main` is truth (protected, CI on push/PR). Feature: new branch per task → commit → push via `https://$PAT@github.com/$REPO.git` → PR (`gh pr create` or compare URL). Never direct to `main` except owner (do fetch+rebase).
- Remote: `origin` = PAT-embedded URL; `.git/config` is snapshot-excluded — re-add after session restore.
- CI: `.github/workflows/ci.yml` two jobs: `worker` (Node 20: `npm ci` → typecheck → tests → format → secret-scan → validate-android → ktlint) then `apk` (Java 17: `testDebugUnitTest` + `lintDebug` → `assembleDebug` + `assembleRelease`, artifact `kuchupuchu-apk` debug+release). `cancel-in-progress: true`. Lint gate not run locally (~141 errors caught only via CI text report).
- Deploy worker: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` → `npx wrangler deploy` → `npx wrangler secret list` (8 secrets: FCM_CONFIG, FCM_CREDENTIALS, GEMINI_API_KEY, GOOGLE_WEB_CLIENT_ID, TURN_API_TOKEN, TURN_KEY_ID, HF_TOKEN, CF_AI_TOKEN) → `curl $WORKER_URL/api/health` → live probe. D1 migrations via fingerprint.
- Release: bump `versionCode`/`versionName` in `native-android/app/build.gradle.kts` (L43-44, +1/patch), gates, commit `release: vN (x.y.z)`, push, wait green, download artifact `kuchupuchu-apk` of THAT run (`/repos/.../actions/runs?per_page=1` → artifacts zip) → unzip debug+release → verify manifest `versionName` utf-16le → create release via API `tag_name vN` with full 40-char SHA → upload both APKs `application/vnd.android.package-archive` → confirm `releases/latest`.

## 12. Known Issues & Risks
| # | Area | Observation | Severity |
|---|---|---|---|
| 1 | Docs | HANDOFF stops at v137 (2026-09-16), .env v133, live v147 — 53 commits undocumented, live pointers stale | High — next session loses context |
| 2 | Chat keyboard | 6 iterations (r47→r52) for same IME glide follower; edge-to-edge + device-specific inset feed made every fix die silently; r52's `LaunchedEffect(glidePx)` + geometric tail is best yet but still spring-dependent | High — core UX, device-proof only via owner retest |
| 3 | Updater relaunch | `setDontKillApp` API 34+ only; pre-34 kills process on install until r51 receiver `MY_PACKAGE_REPLACED` — proven but needs <API34 device proof | Medium |
| 4 | AI images | HF free quota (10k neurons/day) + `hf-inference` only provider → SD3-medium 429 frequent; edit is variation not img2img (no fal/replicate enabled); Bangla prompts previously painted as gibberish text (fixed via English rewrite + "no text") | Medium — user sees "quot blocked" or variation faces |
| 5 | Worker logs | 11 `console.log` left (FCM/oauth/cron) — noisy but intentional per §6; missing structured log levels | Low |
| 6 | Android build | Cannot build locally in sandbox (2GB OOM); only CI compiles Kotlin — string-suite cannot catch missing Compose import | Medium — every push needs CI watch |
| 7 | D1 ops | Scoped token cannot D1 REST (7403); GLOBAL_API_KEY + `CLOUDFLARE_API_KEY` env swap needed for shell D1 probe; `wrangler dev --remote` no DO support; `wrangler versions upload` preview 404 | Low — workaround known |
| 8 | Block/Hide | `members.hidden_key` free-form, typed in Search to reveal; per-chat keys may differ; no push for blocked (by design) | Low — by design but needs UX discoverability |
| 9 | Status/ViewOnce | Trim/crop (`VideoPlan`, `CropOverlay`, `VideoExport` transcode 60s window) only proven via compilation; ` metrics_daily lat.err` historical quota errors (2026-09-06 21:43-23:45) cause unknown | Low |
| 10 | Tests | 32/32 green but slice-based locks (`src.slice(indexOf(A),indexOf(B))`) fragile to function reorder/rename; 27's 4000-char `scheduled()` window brittle | Low — keep function names/order per SKILLS §5 |

## 13. Open Questions
- Does r52's glide follower finally hold on his device (API level ?, edge-to-edge inset %) and on low-end Android 24? Need owner's keyboard open/close + mid-thread + attach-panel proof.
- Is `KpRelaunchReceiver` delivery reliable below API 34 (OEM kills, battery savers)? Need killed-app + `MY_PACKAGE_REPLACED` proof.
- Should HF image generation move to Paid (`$5/mo`) or stay free-tier with 429 honest message? Owner decision per HF §16 watch item.
- Enable which img2img provider for true pixel-edit? (fal-ai/replicate/nscale) and its credit budget?
- Should worker `console.log` be replaced by gated `debug` flag or kept for live FCM diagnosis?
