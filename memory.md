# memory.md — Project Long-Term Memory

> Read this fully at the start of every session. Update it at the end of every task.
> Owner: Rabbih (rabbihossainltd1) · Repo: KuchuPuchu · Last updated: 2026-09-14 by Arena agent
> ⚠️ Never write real secrets/tokens/passwords here — reference the key name only.

## 1. Project Snapshot (30-second briefing)
- KuchuPuchu = WhatsApp-style messenger for Free Fire players (BD). 1:1 + group chat, R2 media/files,
  24h statuses, WebRTC 1:1 + group audio/video calls + screen share, FCM push, in-app Gemini AI bot,
  OTP-less phone auth. No coins/store/payments/matchmaking (removed v2 pivot).
- Backend: single Cloudflare Worker `src/worker/index.ts` (9,750 lines, TypeScript) + D1
  `kuchupuchu-v3-apac` (primary Singapore) + R2 `kp-media` + Durable Objects `ChatRoom`/`CallSignal`
  + 1-min cron. Live: https://kuchupuchu-api.kuchupuchu.workers.dev (health all-cap true on 2026-09-14).
- Client: native Android only, Kotlin + Compose, `native-android/` (71 .kt ≈ 40 k LOC + C/RNNoise).
  applicationId `app.kuchupuchu.android` — NEVER change. minSdk 24 / target 35, JDK 17, AGP 8.7.2.
- Distribution: GitHub releases tag `v<versionCode>` with debug+release APK; in-app updater polls
  releases/latest. Current: v132 / 3.9.56 / versionCode 132 (2026-09-10). No Play Store.
- Worker checks run locally on Node 20; APK compile/lint/unit tests are CI-only (local JDK is 11,
  no Android SDK/NDK). No web client, no Express.

## 2. Golden Rules for THIS repo (hard-won, non-obvious)
- NEVER push to `main` directly — branch (fix/feat/chore/perf…) + Conventional Commit + PR, CI green.
- NEVER change `applicationId`; bump `versionCode` for EVERY released APK or in-place update won't show.
- NEVER commit `.env`, PATs, CF tokens, release keystores, `google-services.json`; `secret-scan` gates it.
- The signing key that actually ships is the COMMITTED `native-android/app/debug.keystore` — see §6 #1;
  changing it breaks in-place updates for every installed phone (owner decision, not a drive-by change).
- Worker hot routes have a FIXED statement budget (list route pinned by test 04; tests count D1 round
  trips via the shim). Don't add N+1; add an index for every cleanup DELETE (D1 bills rows scanned — a
  missing index exhausted the free-tier row-read quota on 2026-09-02 and forced 503s until midnight).
- Schema changes go through `ensureSchema()` migrations ONLY: `CREATE TABLE IF NOT EXISTS` in the batch,
  additive ALTERs/CREATE INDEXes OUTSIDE the batch (idempotent, individually tolerant) — a dup-column
  error must never roll the base tables back. The fingerprint in `schema_meta` skips re-walking migrations.
- All media is served with `nosniff` + `Content-Disposition: attachment`; `GET /api/files/:key` must stay
  authorised (owner / conversation member / membership-referencing message).
- Match house style and comment density: explain WHY with provenance ("Owner round N", "§N", bug/date).
- Android deps are PINNED (validator fails on `+`); permissions need justification in `validate-android.ts`.
- Client must never send the bearer token off the worker origin (`Api.isOwnHost()`; GitHub updater strips Authorization).

## 3. Environment & Access
| Need | Status | Where it lives | Notes |
|---|---|---|---|
| Node ≥ 20 | ✅ v20.20.2 | system | npm 10.8.2 |
| git | ✅ 2.47.3 | system | identity set repo-local to owner |
| JDK 17 (Android) | ❌ only JDK 11 | CI `apk` job (temurin 17) | APK build/lint/test = CI-only locally |
| Android SDK + NDK + CMake 3.22.1 | ❌ | CI `setup-android` | heavy; do not install without owner OK |
| `gh` CLI | ❌ missing | — | use compare-URL + pasted PR body; request auth (§8) |
| Docker | ❌ missing | — | not needed for worker |
| GitHub PAT (repo+workflow) | ✅ | `/home/user/.env` → GITHUB_PAT (mode 600, OUTSIDE repo) | classic token, over-broad admin:* — see §6 #3 |
| Cloudflare token/account | ✅ | `/home/user/.env` (CF_API_TOKEN, account id, etc.) | wrangler deploy/tail; value never printed |
| Worker secrets | ✅ deployed | FCM_CREDENTIALS, FCM_CONFIG, GEMINI_API_KEY, GOOGLE_WEB_CLIENT_ID, TURN_KEY_ID, TURN_API_TOKEN, DEBUG_KEY | set via `wrangler secret put` |
| GitHub Actions signing secrets | ✅ per .env note | KP_KEYSTORE_B64 / KP_KEY_ALIAS / KP_KEY_PASSWORD / KP_STORE_PASSWORD | but shipped v132 still used committed key (§6 #1) |
| Operator secrets file | ✅ `/home/user/.env` | created from uploaded env.txt; never commit, never quote values | |

## 4. Commands That Actually Work (verified, copy-paste ready)
| Purpose | Command | Verified |
|---|---|---|
| install | `npm ci` | ✅ 2026-09-14 (81 pkgs) |
| dev-ish bundle check | `npx wrangler deploy --dry-run --outdir .scratch/x` | ✅ 277 KiB / 74 gzip |
| build (worker) | dry-run above; real deploy `npm run deploy` (CF auth) | deploy ❌ not run |
| test (all, worker) | `npm test` | ✅ 32/32 cases, 1,447 assertions |
| test (single case) | `node --import tsx test/cases/17-backend-integrity.mjs` (cwd repo root) | ✅ runner model |
| typecheck | `npm run typecheck` | ✅ pass |
| lint/format | `npm run format:check` (`npm run format` to fix) | ✅ pass |
| secret scan | `npm run security:secrets` | ✅ pass |
| android gate (local) | `npm run validate:android` | ✅ pass |
| kotlin import gate | `bash ./scripts/ktlint-check.sh` | ✅ clean |
| all worker CI | `npm run ci` | ✅ (also add ktlint like GHA) |
| prod dep audit | `npm run security:deps` | ✅ 0 prod vulns (5 dev-only) |
| android build | `cd native-android && ./gradlew assembleDebug assembleRelease` | ❌ CI-only (JDK17/SDK) |
| android tests+lint | `cd native-android && ./gradlew testDebugUnitTest lintDebug` | ❌ CI-only |
| health | `curl -s https://kuchupuchu-api.kuchupuchu.workers.dev/api/health` | ✅ all capabilities true |

## 5. Architecture Decisions (ADR-lite)
| Date | Decision | Why | Rejected alternative |
|---|---|---|---|
| pre-session | Pivot to pure messenger; remove v2 social/coins/store/matchmaking | owner scope lock | old Capacitor/React + Express (deleted) |
| pre-session | Native Android (Compose), no web client | push/calls/media quality | Capacitor WebView (removed) |
| pre-session | Cloudflare Worker + D1 + R2 + DO | BD latency, zero-server | Express host |
| 2026-09-04 | D1 migrate `kuchupuchu-v3` (WNAM) → `kuchupuchu-v3-apac` (Singapore primary + replicas) | trans-Pacific RTT was structural slowness | kept old DB untouched as one-line rollback |
| pre-session | OTP-less phone auth + mandatory Google bind + old-device approval + Google recovery | SIM match UX, anti-takeover | email/password (removed; legacy NOT NULL cols remain) |
| pre-session | D1 source of truth; DOs only hold sockets + re-broadcast; clients re-sync on events | sockets can drop without data loss | DO-authoritative state |
| pre-session | Hibernation WebSockets + per-socket liveness attachments | zero active-duration when idle; survive DO evict | server.accept() in-memory liveness (broke rich pushes) |
| pre-session | Self-healing schema w/ fingerprint + out-of-batch additive migrations | quota/dup-column must not brick requests | hand-run migrations |
| r31/r32 | Self-managed telecom (ConnectionService, MANAGE_OWN_CALLS) | headset/watch/one-call rules without being dialer | default dialer integration |
| r32 | RNNoise voice isolation via CMake `libkp_voice` (2 ABIs) | call audio | larger APK w/ 4 ABIs |
| r33 | Gemini sees/creates/edits images; honest quota answers | owner request | canned "unsupported" |
| §51 | release signing via KP_* keystore with debug fallback (loud) | public debug key risk; forks must still build | (reality: shipped v132 still on committed key — §6 #1) |

## 6. Open Bugs / Known Broken Things
| # | Symptom | Root cause | Status | Branch / PR |
|---|---|---|---|---|
| 1 | Shipped release APK offers no signing security over debug | v132 `-release.apk` is signed by the SAME cert as committed `debug.keystore` (SHA-256 `39:19:0B:0F…CD:2E`, CN=KuchuPuchu); KP release path fell back | OPEN — owner decision (rotate = one-time manual reinstall for users) | audit docs only |
| 2 | Updater could silently switch APK signer | `KpUpdate.kt:84-87` takes LAST `*.apk` asset by upload order, no name pin / cert verify | OPEN, small fix ready to do | — |
| 3 | Operator token over-privileged | classic PAT has admin:* + repo + workflow; also CF global API key present | OPEN — advise fine-grained repo token + rotation | — |
| 4 | Old Firebase API key in git history | deleted v2 `google-services.json` / `src/web/lib/firebase.ts` hold `AIza…` (still live project's public key) | OPEN — restrict/retire in console; not a code change | — |
| 5 | Dead v2 constants shipped | ~120 unreferenced lines in `src/shared/constants.ts` (RANKS/GAME_MODES/ledger/products…) | OPEN — safe delete | — |
| 6 | Legacy NOT NULL email/password_hash | phone signups insert synthetic email + `''` hash | OPEN — cosmetic/schema | — |
| 7 | 5 dev-only npm advisories | undici/esbuild/sharp/ws via wrangler; prod audit clean | OPEN — bump wrangler later | — |
| 8 | ~50 merged stale remote branches; 5 unmerged ahead 1–2 commits | history hygiene | OPEN — needs owner OK to delete | branches listed in PROJECT_UNDERSTANDING §11 |
| 9 | Session token in plain SharedPreferences | `Api.kt` prefs "kp" (allowBackup=false mitigates) | OPEN hardening (EncryptedSharedPreferences) | — |

## 7. IN-PROGRESS HANDOFF  ← most important section for a new session
- **Current branch:** `chore/audit-project-understanding` (from `main` @ `32a5240`), PUSHED.
  **PR #56: https://github.com/rabbihossainltd1/KuchuPuchu/pull/56** (base `main`, docs-only).
- **Exact state of the work:** Full Phase-1 audit COMPLETE and delivered as PR #56. Two commits:
  (1) `9ce9f8b` adds `PROJECT_UNDERSTANDING.md` (13-item risk register) + this `memory.md`,
  `.gitignore` scratch/venv entries, README D1-name delta; (2) this handoff/log update.
  NO product, worker, or Android source code changed (findings logged, not fixed).
- **Verified (real output 2026-09-14):** local full gate green — typecheck pass; `npm test` 32/32,
  1,447 assertions; prettier pass (new docs already conform); secret scan pass; android validation
  pass; ktlint clean; prod dep audit 0; `wrangler deploy --dry-run` 277 KiB; live `/api/health`
  all-cap true; v132 debug+release APK signer cert parsed (v2 APK Signing Block) and matched the
  committed `debug.keystore` (`39:19:0B:0F…CD:2E`, CN=KuchuPuchu); full git history has no
  PAT/CF token (only legacy Firebase public web key in deleted v2 paths). PR CI: **Worker job
  success**; `apk` job was still running at report time (docs-only, cannot affect the APK).
- **Not yet verified:** Android compile / lint / JVM unit tests (need JDK 17 + Android SDK + NDK —
  CI `apk` job only); worker deploy (not performed — owner action); the eventual `apk` job conclusion
  on PR #56 (check the PR checks page).
- **Next 3 steps, in order:**
  1. Owner reviews/merges PR #56 (docs only, zero runtime risk; revert = one `git revert`).
  2. Get owner decisions on the three §13 questions — especially APK signing (keep+pin committed key
     vs move to KP keystore, which forces one manual reinstall), and remote-branch cleanup.
  3. If approved, do the small safe fixes as separate branches/PRs: pin updater asset name
     (`KpUpdate.kt:84-87`) + signer verify; delete dead v2 constants in `src/shared/constants.ts`.
- **Blockers:** none. APK-level verification permanently gated here by missing JDK17/Android SDK
  (use CI). Real fixes await the owner's "baki kotha" tasks and the §13 decisions.

## 8. Pending Requests To Owner
| Item | Why needed | How owner gets it | Requested | Status |
|---|---|---|---|---|
| Decision: APK signing (§6 #1/#2) | cannot harden updater/CI without knowing if committed key is permanent | reply: keep+pin current key, or move to KP keystore (accept one manual reinstall) | 2026-09-14 | awaiting |
| Permission to delete merged remote branches | 57 branches clutter the repo; destructive remote op | reply "delete merged" — I'll list exact branches first | 2026-09-14 | awaiting |
| Optional: `gh` auth or fine-grained PAT | automate PRs; current classic PAT over-privileged | GitHub→Settings→Developer settings→Fine-grained token (this repo, Contents+PRs r/w) into `/home/user/.env` | 2026-09-14 | awaiting |

## 9. Owner Preferences
- **Language:** বাংলা লিপিতে কথা · code/commit/branch/command/log সব ইংরেজিতে; technical term untranslated.
- **Git policy:** new branch → Conventional Commit → push → PR · never direct to main · full PR body.
- **Risk tolerance:** high for reversible changes · ask before anything destructive (delete branches,
  rotate signing key, deploy, prod D1/R2 changes, paid services).
- **Workspace budget:** 128 MB / 10,000 files · scratch only in `.scratch/` (now gitignored) · clean
  every task end · node_modules is gitignored/286 MB (not snapshotted).
- **Vision in last session:** ✅ available (images/screenshots can be read).
- **Do-not-touch areas:** `applicationId`; the signing key continuity for installed users; the owner
  round-15 call to ship both debug+release APKs; FCM/Firebase project config; live worker without a
  green `npm run ci`.

## 10. Session Log (keep last 10 only — delete older rows)
| Date | Task | Root cause | Outcome | PR |
|---|---|---|---|---|
| 2026-09-14 | Full Phase-1 audit + bootstrap (repo cloned from GitHub) | n/a (new project) | All local checks green (32/32, 1,447 assertions); 13-item risk register; top finding = shipped release signed by committed debug.keystore (cert verified); added PROJECT_UNDERSTANDING.md + memory.md + .gitignore/README delta | **PR #56** (Worker CI green; apk running) |
