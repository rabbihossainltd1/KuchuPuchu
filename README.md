# KuchuPuchu

Social app for Free Fire players: home feed, stories, friends, Messenger-style chat, audio/video calls, store, and wallet.

Live API: `https://kuchupuchu-api.kuchupuchu.workers.dev`  
Android id: `app.kuchupuchu.android` (do not change). Debug APKs are signed with `android/app/debug.keystore`.

## What talks to what

```
Android WebView (Capacitor)  →  Vite React app in src/web
        │
        └── HTTPS JSON  →  Cloudflare Worker src/worker/index.ts
                                └── D1 database `kuchupuchu`
```

The phone app does **not** use Firebase Storage or the Hostinger PHP site. Auth, posts, chat, calls, and coins go through the Worker. Hostinger VPS is paused until the owner sets one up.

GitHub Actions (`.github/workflows/ci.yml`) typechecks, tests, builds the web client, `cap sync`, and uploads `app-debug.apk`.

## Local web

```bash
npm ci
npx wrangler dev   # Worker + local D1, or point the web client at the live Worker
npm run build      # outputs dist/web for Capacitor
```

Web API base is `src/web/lib/config.ts` (live Worker URL in the Android build).

## Deploy Worker (required for chat photos/stickers)

```bash
npx wrangler deploy
```

Needs a Cloudflare API token with Workers Scripts Edit + D1 Edit. `wrangler.toml` already has `account_id` and D1 `database_id`. On first request the Worker runs:

- `ALTER TABLE messages ADD COLUMN image_url`
- `ALTER TABLE users ADD COLUMN notif_json`

Until this deploy happens, the live Worker still requires a text body (`Write a message.`) and ignores `imageData` / `sticker`.

## Android APK

```bash
npm run android:apk
```

Or download the CI artifact `kuchupuchu-debug-apk`. `versionCode` must go up for in-place updates. Same `applicationId` + same debug keystore = no signature conflict.

Permissions in `AndroidManifest.xml`: Internet, Camera, Mic, Speaker, `POST_NOTIFICATIONS`, Vibrate.

## Features (how they work)

| Area | How |
| --- | --- |
| Auth | Email/password on Worker, session token in localStorage |
| Home | Feed + 24h stories, search, compose `+` |
| Chat | Poll messages; photos compressed on device then `imageData[]`; stickers are `/stickers/*.png` ids |
| Calls | WebRTC + STUN; signaling via `/api/calls`; hangup ids are ignored so a cut call does not ring again |
| Notifications | In-app list + OS local notifications. Toggles in Settings: messages, calls, friend requests, likes, comments, follows, gifts, wallet |
| Store / wallet | Catalog in `src/shared/catalog.ts`; coin packs on Worker; no Firebase Storage |

Call signaling only works while both apps can reach the Worker. The callee gets an in-app overlay (poll `/api/calls/active`) plus a local notification if call notifications are on.

## Repo map

- `src/web` — React client
- `src/worker` — Cloudflare Worker + `schema.sql`
- `src/server` — leftover Express API (not used by the Android app)
- `android/` — Capacitor shell
- `docs/` — original product spec
- `wrangler.toml` — Worker name `kuchupuchu-api`

Do not commit PATs or Cloudflare tokens. Do not change `applicationId` or invent a new visual theme.

## Notifications API

`PATCH /api/me/notifications`

```json
{
  "messaging": true,
  "calls": true,
  "requests": true,
  "likes": true,
  "comments": true,
  "follow": true,
  "gifting": true,
  "wallet": true
}
```
