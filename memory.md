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
| 1 | HANDOFF.md stops at v137, .env LIVE_VERSION=v133, live is v147 (53 commits gap) | Docs not updated after r42..r52 | 🔴 open — needs Handoff §21 append + .env bump | audit/full-app-analysis |
| 2 | Keyboard thread follower brittle — 6 takes (r47→r52) for same issue | Edge-to-edge + IME overlay vs resize; inset feed device-specific | 🟡 mitigated in r52 (`LaunchedEffect(glidePx)` + geometric tail), watch on device | main `ce27941` |
| 3 | Updater relaunch killed app below API 34 (`setDontKillApp` API 34+ only) | Process killed mid-install, no receiver | ✅ fixed r51 `KpRelaunchReceiver` on `MY_PACKAGE_REPLACED`, needs device proof | main `a9a756f` |
| 4 | HF image edit is variation not true pixel-edit | No img2img provider enabled on his HF account (only hf-inference) | 🟡 by design — needs fal/replicate provider enabled | HF migration §16 |
| 5 | Worker has 11 `console.log` (FCM/oauth/error_log) — noisy | Intentional debug logs not removed before commit | 🟢 low — allowed for FCM diagnostics per SKILLS §6, but should be gated | `src/worker/index.ts:33xx,46xx` |
| 6 | Owner watch items unproven on device | Requires killed-app push, status viewer, group video mesh | ⏳ queued — needs owner device retest | HANDOFF §13-20 watch lists |

## 7. IN-PROGRESS HANDOFF  ← most important section for a new session
- **Current branch:** `main` = `ce27941` (v147) · worker `ce27941` deployed? verify via `wrangler versions list` — last known `90034cb5` at v137, then 53 commits; latest worker version unchecked this session
- **Exact state of the work:** Audit `audit/full-app-analysis` branch created this session: `memory.md` + `PROJECT_UNDERSTANDING.md` generated, full suite green (32/32), no code change yet. User asked full app audit (how it works + bugs).
- **Verified:** `npm ci` + `tsc` + `prettier` + `secret-scan` + `validate-android` + `ktlint` all pass; `npm test` 32/32 (1527); repo tree mapped; 53-commit gap after HANDOFF v137 analyzed; AI chain (HF Kimi→DeepSeek→Workers AI→Gemini) verified in code; keyboard history r47-r52 traced.
- **Not yet verified:** Live worker version after v147 deploy (needs `wrangler whoami` + health curl); killed-app FCM; status viewer pause/resume; group call mesh 3+; HF image generate live probe (token quota); Android lint `lintDebug` full run (needs Gradle, not run locally)
- **Next 3 steps, in order:**
  1. Append HANDOFF.md §21 (v138..v147: r42→r52) + bump `/home/user/.env` LIVE_VERSION/MAIN_SHA/WORKER_VERSION/LAST_CI
  2. Owner device retest checklist for r50→r52 keyboard glide + updater relaunch (API <34 vs 34+)
  3. If HF image edit needs true pixel-edit → enable img2img provider in HF dashboard + wire `hfImageEdit` with multipart
- **Blockers:** none — D1 read blocked with scoped token (needs GLOBAL_API_KEY as CLOUDFLARE_API_KEY for D1 shell), otherwise all access ok

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
| 2026-09-17 | Full app audit (how it works + bugs) | HANDOFF stale + need PROJECT_UNDERSTANDING | audit branch, 2 docs, 32/32 green | audit/full-app-analysis |
