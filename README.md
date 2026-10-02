# KuchuPuchu

KuchuPuchu is a messenger for Free Fire players. The Android app offers 1:1 and group chat, media/files, 24h statuses, WebRTC audio/video calls with screen share, blocks, and FCM push; the browser PWA provides web chat, text and photos.

There is no coin wallet, store, gifting, matchmaking, or payments in this product — those
belonged to the abandoned v2 social-network spec and were removed from the repo.

Live API: `https://kuchupuchu-api.kuchupuchu.workers.dev`
Android id: `app.kuchupuchu.android` (do not change).

## What talks to what

```
native Android app (Kotlin + Jetpack Compose)  native-android/ ─┐
                                                                  ├─ HTTPS JSON / WebSocket ─→
browser PWA (plain HTML/CSS/JS)              public/ ──────────────┘
                                                                  Cloudflare Worker
                                                                  src/worker/index.ts
                                                                  ├── D1 database  kuchupuchu-v3
                                                                  ├── R2 bucket    kp-media
                                                                  └── Worker Assets (`./public`, same origin)
```

The browser PWA is served by the same Cloudflare Worker as the API; there is no Express server or separate frontend deployment. Earlier Capacitor/React work was removed. `src/shared/` holds limits enforced by the Worker. The PWA has no build step, uses WebCrypto for personal-chat KP1 message E2EE, and caches only its static shell (never `/api/*` or `/ws/*`).

## Checks

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # drives the real worker against in-memory D1 and R2
npm run format:check
npm run security:secrets
npm run validate:android
bash scripts/ktlint-check.sh # Kotlin import hygiene (also a CI step)
npm run ci          # format, typecheck, tests, secrets, Android source validation
```

`npm test` runs the cases in `test/cases/`. Each one boots `src/worker/index.ts` against
`test/d1shim.mjs` — an in-memory SQLite database shaped like D1, plus an in-memory R2 — and
prints one `OK` / `BROKEN` line per assertion. Cases run in separate processes because the
worker keeps `schemaReady` and the rate-limit buckets in module scope. The runner exits
non-zero if anything prints `BROKEN`.

GitHub Actions (`.github/workflows/ci.yml`) has two jobs. `worker` runs typecheck, all tests, formatting, secret scan, Android source validation, and ktlint. `apk` runs Android unit tests and lint, then builds the release-only APK artifact `app-release.apk`.

## Web client

`public/` contains the dependency-free browser/PWA client (`index.html`, `app.js`, `sw.js`, manifest, country data). It is deployed together with the API by `wrangler deploy`, on the same origin. Browser REST calls use Bearer headers; because browser WebSockets cannot set headers, `?token=` is accepted only on `/ws/*` and is rejected for REST routes. Web login honestly reports `sim: UNAVAILABLE`; new-device login uses an in-app OTP or approval, and Google recovery remains available.

## Deploy the Worker

```bash
npm run deploy      # wrangler deploy
npm run tail        # wrangler tail
```

Phone auth needs one extra secret (Google binding/recovery):

```bash
npx wrangler secret put GOOGLE_WEB_CLIENT_ID   # Firebase console → Authentication → Google → Web client ID
```

Without it `/api/config/firebase` reports `googleWebClientId: null` and the
Google bind/recovery endpoints answer 503 (fail-closed) — see `FIREBASE-SETUP.md`.

Needs a Cloudflare API token with Workers Scripts Edit, D1 Edit, and R2 Edit. `wrangler.toml`
already carries `account_id`, the D1 `database_id`, and the R2 binding.

The schema is created on the first request: `ensureSchema()` sends the `CREATE TABLE IF NOT
EXISTS` statements as a single D1 batch, then best-effort `ALTER TABLE` migrations for columns
added later. Those `ALTER`s are deliberately outside the batch so a duplicate-column error
cannot roll the whole batch back.

## Android

```bash
cd native-android
./gradlew assembleDebug
```

Or download the `kuchupuchu-apk` artifact from the latest CI run. `versionCode` must increase
for an in-place update.

Source is `native-android/app/src/main/java/app/kuchupuchu/android/`. The pieces worth knowing:

| File | Role |
| --- | --- |
| `Api.kt` | HTTP client; clears the session on 401 |
| `ScreenStore.kt` | In-memory screen cache that survives navigation, persisted to disk |
| `ChatScreen.kt` | Chat UI, message sending, attachment handlers |
| `CallEngine.kt` | WebRTC signalling and the call poll loop |
| `CallNotify.kt` | Incoming-call heads-up and the ongoing-call foreground service |
| `KpPush.kt` | FCM entry point (also shows the new-device login approval card) |
| `PhoneVerifier.kt` | Phone auth: E.164 normalization + OTP-less SIM match |
| `GoogleAuth.kt` | Phone auth: Credential Manager Google ID token (binding/recovery) |

## How the main features work

| Area | How |
| --- | --- |
| Auth | OTP-less phone auth (`PHONE_AUTH_PLAN.md`): number → SIM check → session, mandatory Google binding on signup, new-device login needs Accept from the current device, Google recovery for lost devices; the session token is stored hashed and expires after 90 days |
| Chat | Messages are polled; `GET /api/conversations/:id/messages` pages with a `created_at` + `rowid` cursor |
| Media | Uploaded to R2 through `POST /api/files`, which records the owner and the conversation so `GET /api/files/:key` can authorise the download. Media is always served as a download with `nosniff` |
| Statuses | 24h text, image, and video statuses. Video goes to R2 and is posted as `kind=VIDEO` with its duration |
| Calls | WebRTC. Signalling through `/api/calls`; the callee is found by polling `/api/calls/active` |
| Delete chat | Records a watermark per member. The chat leaves their list until a newer message arrives, and only messages after the watermark come back |

## Repo map

- `src/worker/index.ts` — the whole API
- `src/shared/constants.ts` — the limits the worker enforces (message length, bio length, session TTL, presence window)
- `native-android/` — the Android client
- `public/` — same-origin browser/PWA client
- `test/` — worker, Web parity and source-contract test harness/cases
- `scripts/secret-scan.ts` — the `security:secrets` check
- `docs/native-plan.md` — locked in-call UI decisions

Everything else that used to sit in `docs/` was the pre-pivot product spec (discovery,
matchmaking, coins, store, gifting, referrals, SPV payments, admin panel, moderation) for
features the worker never implemented. It is gone from the tree; `git log --diff-filter=D -- docs/`
brings it back if it is ever needed again.

## Known sharp edges

- `native-android/app/debug.keystore` remains tracked. v274 used it as a one-time, explicitly owner-approved signer to preserve v273 update compatibility. Future APK releases require a secure signing-key migration and separate owner approval; do not reuse the tracked key by default.
- ICE relay uses the public `openrelay.metered.ca` TURN server with its published credentials.
  It has no capacity guarantee; a dedicated TURN provider is the fix if calls start failing to
  connect.

Do not commit PATs or Cloudflare tokens. Do not change `applicationId`.
