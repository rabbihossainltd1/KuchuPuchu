# KuchuPuchu

Social app for Free Fire players: chat, statuses, audio/video calls, contacts, and a coin wallet.

Live API: `https://kuchupuchu-api.kuchupuchu.workers.dev`
Android id: `app.kuchupuchu.android` (do not change).

## What talks to what

```
native Android app (Kotlin + Jetpack Compose)  native-android/
        │
        └── HTTPS JSON  →  Cloudflare Worker   src/worker/index.ts
                                ├── D1 database  kuchupuchu-v3
                                └── R2 bucket    kp-media   (photos, voice notes, documents, videos)
```

There is no web client and no Express server in this repository. Earlier revisions had a
Capacitor/React front end; it was replaced by the native app and the leftovers were removed.
`src/shared/` holds only the limits the worker enforces, imported by the worker itself.

## Checks

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # drives the real worker against in-memory D1 and R2
npm run format:check
npm run security:secrets
npm run ci          # all four
```

`npm test` runs the cases in `test/cases/`. Each one boots `src/worker/index.ts` against
`test/d1shim.mjs` — an in-memory SQLite database shaped like D1, plus an in-memory R2 — and
prints one `OK` / `BROKEN` line per assertion. Cases run in separate processes because the
worker keeps `schemaReady` and the rate-limit buckets in module scope. The runner exits
non-zero if anything prints `BROKEN`.

GitHub Actions (`.github/workflows/ci.yml`) has two jobs: `worker` runs the four checks above,
and `apk` builds `app-debug.apk` and uploads it as an artifact.

## Deploy the Worker

```bash
npm run deploy      # wrangler deploy
npm run tail        # wrangler tail
```

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
| `KpPush.kt` | FCM entry point |

## How the main features work

| Area | How |
| --- | --- |
| Auth | Email/password on the worker; the session token is stored hashed and expires after 90 days |
| Chat | Messages are polled; `GET /api/conversations/:id/messages` pages with a `created_at` + `rowid` cursor |
| Media | Uploaded to R2 through `POST /api/files`, which records the owner and the conversation so `GET /api/files/:key` can authorise the download. Media is always served as a download with `nosniff` |
| Statuses | 24h text, image, and video statuses. Video goes to R2 and is posted as `kind=VIDEO` with its duration |
| Calls | WebRTC. Signalling through `/api/calls`; the callee is found by polling `/api/calls/active` |
| Delete chat | Records a watermark per member. The chat leaves their list until a newer message arrives, and only messages after the watermark come back |

## Repo map

- `src/worker/index.ts` — the whole API
- `src/shared/` — limits the worker enforces (message length, bio length, session TTL, presence window)
- `native-android/` — the Android client
- `test/` — worker test harness and cases
- `scripts/secret-scan.ts` — the `security:secrets` check
- `docs/` — original product spec

## Known sharp edges

- `native-android/app/debug.keystore` is committed and signs the release build. Anyone with
  read access to this repository can produce an APK that Android treats as an update from the
  same developer. Rotating it means existing installs cannot update in place, so it needs an
  owner decision rather than a drive-by change.
- ICE relay uses the public `openrelay.metered.ca` TURN server with its published credentials.
  It has no capacity guarantee; a dedicated TURN provider is the fix if calls start failing to
  connect.

Do not commit PATs or Cloudflare tokens. Do not change `applicationId`.
