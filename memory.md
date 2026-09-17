# memory.md — Project Long-Term Memory

> Read this fully at the start of every session. Update it at the end of every task.
> Owner: MD Rabbi Hossain · Repo: rabbihossainltd1/KuchuPuchu · Last updated: 2026-09-17 14:30 by Arena agent
> ⚠️ Never write real secrets/tokens/passwords here — reference the key name only.

## 1. Project Snapshot (30-second briefing)
- **কি:** KuchuPuchu — Free Fire players-দের জন্য WhatsApp-style messenger (1:1 + group chat, media/file/status, WebRTC voice/video + screen share, блокировка, FCM push, AI chat)
- **Stack:** Cloudflare Worker (TypeScript, D1 SQLite apac, R2 kp-media, DO ChatRoom/CallSignal) + Android Kotlin/Compose (minSdk 24, target 35, single activity)
- **Run:** `npm ci && npm test` (32 cases, worker in-memory D1), `npx tsc --noEmit`, `bash scripts/ktlint-check.sh`, `./gradlew assembleDebug` (Android)
- **Deploy:** `wrangler deploy` (CF_ACCOUNT_ID + CF_API_TOKEN), cron `* * * * *`, health `/api/health`
- **Live (2026-09-17):** `v147 (3.9.71, vc147)` · `ce27941` · worker health 200 · tests 32/32, 1527 assertions

## 2. Golden Rules for THIS repo (hard-won, non-obvious)
- NEVER `AlertDialog`/`DropdownMenu` — every popup is `KpSheet`/`KpSheetRow`/`KpConfirmSheet` (bottom sheet). Test 32 scans for violations.
- ALWAYS use `Workspace` outside repo (`/home/user/.env` + `/home/user/HANDOFF.md` + `/home/user/SKILLS.md`) — never commit `.env`, APK, secret.
- NEVER `npx tsc` without `npm ci` — bare install pulls junk `tsc@2`. ALWAYS `npm ci` first (~90s).
- ALWAYS `git fetch` + `update-ref` before commit/push — parallel sessions + owner pushes directly to `main`. Never force-push.
- NEVER `await listState.scroll` inside network coroutine — scroll gets its own `scope.launch`. Prevents auto-jump yank.
- ALWAYS import Compose extensions (`detectTapGestures`, `animateFloatAsState`, `tween`, `withTransform` etc.) — qualified use = CI red (ktlint only flags unused).
- NEVER `Log.*` in app code — use `KpCrash.mark()`. Secret-scan stays green.
- ALWAYS warm new Compose-state objects in `SnapshotSingletons.warm()` — else race on Install tap (r33-26 crash).
- HANDOFF.md § latest is truth for product traps; SKILLS.md §0-7 is truth for workflow. Read both at session start.

## 3. Environment & Access
| Need | Status | Where it lives | Notes |
|---|---|---|---|
| Node >=20 | ✅ 20.20.2 | system | `npm ci` required |
| GITHUB_PAT | ✅ | `/home/user/.env` | `GITHUB_REPO=rabbihossainltd1/KuchuPuchu` |
| CLOUDFLARE_API_TOKEN | ✅ | `/home/user/.env` | deploy + wrangler secret |
| CLOUDFLARE_GLOBAL_API_KEY | ✅ | `/home/user/.env` | D1 REST + R2 (scoped token has NO D1 read) |
| CF_ACCOUNT_ID | ✅ | `/home/user/.env` + `wrangler.toml [vars]` | 92081fac… |
| HF_TOKEN | ✅ | worker secret `HF_TOKEN` | Hugging Face Inference (Kimi-K2, DeepSeek, SD3-medium, Whisper) |
| GOOGLE_WEB_CLIENT_ID | ✅ | worker secret | Firebase Google binding |
| FCM_CONFIG / FCM_CREDENTIALS | ✅ | worker secrets (6→8 total) | push |
| TURN_API_TOKEN / TURN_KEY_ID | ✅ | worker secrets | Cloudflare Realtime TURN |

## 4. Commands That Actually Work (verified, copy-paste ready)
| Purpose | Command | Verified |
|---|---|---|
| install | `npm ci` | ✅ 2m, 81 packages |
| typecheck | `npx tsc -p tsconfig.json --noEmit` | ✅ pass |
| tests | `npx tsx test/run.ts` | ✅ 32/32, 1527 assertions |
| format check | `npx prettier --check .` | ✅ pass |
| secret scan | `npx tsx scripts/secret-scan.ts` | ✅ pass |
| android validate | `npx tsx scripts/validate-android.ts` | ✅ pass |
| ktlint | `bash scripts/ktlint-check.sh` | ✅ clean |
| full ci | `npm run ci` (format+typecheck+test+secrets+validate+ktlint) | ✅ pass |
| deploy worker | `CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID npx wrangler deploy` | ✅ |
| health check | `curl https://kuchupuchu-api.kuchupuchu.workers.dev/api/health` | ✅ 200 |

## 5. Architecture Decisions (ADR-lite)
| Date | Decision | Why | Rejected alternative |
|---|---|---|---|
| 2026-09-04 | D1 primary WNAM → SIN (APAC) `kuchupuchu-v3-apac` | BD users paid trans-Pacific RTT; every query slow | keep WNAM (structural slowness) |
| 2026-09-06 | OTP-less phone auth (SIM + Google binding) | No OTP cost, deterministic E.164 BD-first | email/password (removed) |
| 2026-09-10 | Schema fingerprint `schema_meta` single-read skip | cold isolate 60 ALTER took 12-24s every time | sequential awaited ALTER (grew forever) |
| 2026-09-16 | HF Inference for all AI (Kimi-K2/DeepSeek/SD3/Whisper) | Owner order: all AI via HF; Gemini free tier blocks image | Gemini/Workers AI (quota blocked) |
| 2026-09-16 | `hfChat` Kimi→DeepSeek failover 25s budget | HF 503 loading + model flap | single model (fragile) |
| 2026-09-17 | Keyboard follower via `LaunchedEffect(glidePx)` + geometric bottom check | Edge-to-edge window never resizes; inset feed constant on his device | Box `onSizeChanged` / snapshotFlow (both dead) |

## 6. Open Bugs / Known Broken Things
| # | Symptom | Root cause | Status | Branch / PR |
|---|---|---|---|---|
| 1 | HANDOFF.md stops at v137, .env was LIVE_VERSION=v133, live is v147 (53 commits gap) | Docs not updated after r42..r52 | ✅ fixed this session — .env bumped to v147, HANDOFF §21 needs full append | `audit/self-test-2026-09-17` |
| 2 | **Home ⋮ uses `DropdownMenu` — violates SKILLS §4 "every popup is a bottom sheet"** | `ChatListScreen.kt:375 DropdownMenu` predates r31 sheets-only rule; test 32 whitelists ChatList | 🔴 open — migrate to `KpSheet` (1 commit, update r31-7 pin) | `audit/self-test-2026-09-17` |
| 3 | Keyboard thread follower brittle — 6 takes (r47→r52) for same issue | Edge-to-edge + IME overlay vs resize; `onSizeChanged` dead (height constant 0), inset feed device-specific | 🟡 mitigated in r52 (`LaunchedEffect(glidePx)` + `glideApplied` + geometric tail `ChatScreen.kt:2077`), watch on device | main `ce27941` |
| 4 | Updater relaunch killed app below API 34 (`setDontKillApp` API 34+ only) | Process killed mid-install, no receiver | ✅ fixed r51 `KpRelaunchReceiver` on `MY_PACKAGE_REPLACED` `KpUpdate.kt:404`, needs device proof | main `a9a756f` |
| 5 | HF image edit is variation not true pixel-edit | No img2img provider enabled on his HF account (only hf-inference) | 🟡 by design — needs fal/replicate provider enabled (owner decision) | HF migration §16 |
| 6 | Worker has 11 `console.log` (FCM/oauth/error_log) — noisy | Intentional per SKILLS §6 but ungated `src/worker/index.ts:3376,3427,3470` | 🟢 low — gate with `if (env.DEBUG_KEY)` suggested | `src/worker/index.ts` |
| 7 | `ChatScreen.kt` 8154 lines — God file | All chat UI/bubbles/viewer/composer in one file | 🟡 medium — split candidate (Composer/Bubble/List/Viewer), needs plan | — |
| 8 | Owner watch items unproven on device | Requires killed-app push, status viewer pause, group video mesh 3+ | ⏳ queued — needs owner device retest | HANDOFF §13-20 watch lists |

## 7. IN-PROGRESS HANDOFF  ← most important section for a new session
- **Current branch:** `docs/full-app-audit` = `3a4ab4a` + `audit/self-test-2026-09-17` pending — self-test audit `AUDIT-2026-09-17.md` created, 8 bugs triaged, `.env` fixed to v147
- **Exact state of the work:** Self-test full audit DONE: `AUDIT-2026-09-17.md` (10 sections, evidence tables), `PROJECT_UNDERSTANDING.md` (13 sections) + `memory.md` created and pushed (`docs/full-app-audit` → PR). Gates all green (32/32, 1527). Live health 200 verified, ChatList `DropdownMenu` violation found as HIGH bug. `.env` updated to `v147 (3.9.71, ce27941)`; `HANDOFF.md` still at v137 — §21 append (v138→v147) is next.
- **Verified:** `npm ci` + `tsc` + `prettier` + `secret-scan` + `validate-android` + `ktlint` all pass; `npm test` 32/32 (1527); repo tree mapped; 53-commit gap after HANDOFF v137 analyzed; AI chain verified; keyboard r47→r52 traced; security audit (0 vulns, no Log., no hardcoded secrets, auth gates ok); UI scan (1 DropdownMenu violation); performance (fingerprint, D1 budget, 8154-line God file); live `/api/health` + `/api/config/firebase` + unauth 401 check.
- **Not yet verified:** Live worker version after v147 (need `wrangler versions list` + `wrangler secret list`); killed-app FCM thumbnail with app KILLED; status viewer pause/resume on device; group call mesh 3+; HF image generate live probe (quota); Android `lintDebug` full (needs Gradle OOM); Home ⋮ sheets migration fix not yet coded.
- **Next 3 steps, in order:**
  1. Append `HANDOFF.md` §21 (v138→v147: r42→r52 detailed) — template from AUDIT §10
  2. Fix HIGH bug #2: `ChatListScreen.kt:375` DropdownMenu → `KpSheet` (1 commit, update test 32 r31-7 pin)
  3. Owner device retest checklist for r52 keyboard glide + r51 receiver (API 33 vs 34) + killed-app FCM
- **Blockers:** none — D1 shell needs `CLOUDFLARE_GLOBAL_API_KEY` as `CLOUDFLARE_API_KEY` (scoped token 7403), otherwise all access ok

## 8. Pending Requests To Owner
| Item | Why needed | How owner gets it | Requested | Status |
|---|---|---|---|---|
| HF img2img provider enable (fal/replicate) | True background-remove edit on actual photo | HF dashboard → Settings → Inference Providers → enable one | 2026-09-16 | pending — variation is current |
| Device retest: keyboard glide + updater relaunch | Confirm r52 fix + r51 receiver on real phones (API 31 vs 34) | Install v147, open chat → keyboard, update via in-app | 2026-09-17 | requested |

## 9. Owner Preferences
- **Language:** বাংলা লিপিতে কথা · code/commit/branch/command/log সব ইংরেজিতে
- **Git policy:** new branch → Conventional Commit → push → PR · never direct to main (but owner himself pushes to main — always fetch/rebase)
- **Risk tolerance:** high for reversible changes · ask before destructive (delete data, drop column, rewrite history, prod config, paid service)
- **Workspace budget:** 128 MB / 10,000 files · scratch only in `.scratch/` · clean every task end
- **Vision in last session:** ✅ আছে — স্ক্রিনশট attach করলে পড়তে পারি
- **Do-not-touch areas:** `native-android/app/build.gradle.kts` version lines (owner bumps via release), `.env` secrets never commit
- **Standing order:** "step by step koro ek ek kore" — one item per commit, behavioural lock in test 32, all 4 gates before commit

## 10. Session Log (keep last 10 only — delete older rows)
| Date | Task | Root cause | Outcome | PR |
|---|---|---|---|---|
| 2026-09-17 | Full app audit (how it works + bugs) | HANDOFF stale + need PROJECT_UNDERSTANDING | `docs/full-app-audit` 2 docs, 32/32 green | `docs/full-app-audit` |
| 2026-09-17 | Self-test full audit (8 bugs) | Need evidence-based bug triage + gates | `AUDIT-2026-09-17.md` 10 sections, `.env` fixed, 1 HIGH UI violation | `audit/self-test-2026-09-17` (pending) |
