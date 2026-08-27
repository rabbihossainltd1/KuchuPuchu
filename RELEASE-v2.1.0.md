# KuchuPuchu v2.1.0 — Notification, Chat & Profile Release

versionCode 23 · versionName 2.1.0

## ⚠️ Deploy required (do this first)

The new message-privacy rules live in the Cloudflare Worker. After pulling this
code, deploy it or the app will show everyone as "not a friend":

```bash
npx wrangler deploy
```

Then install the new APK (CI artifact `kuchupuchu-debug-apk`, or a local build).
Both sides must be updated together.

## What changed

### 1. Chat "Sending" status is now instant
- The sent bubble appears on screen the moment you tap send, with **Sending…**
  under it. It flips to **Sent / Delivered / Seen** once the server confirms.
- If the send fails you get **"Couldn't send · Tap to retry"** — tap it to
  resend without retyping.
- The initial message load no longer races with an in-flight send.

### 2. Aggressive notifications (app closed too)
- New foreground service `KpSyncService` ("KuchuPuchu connected") keeps polling
  while the app is closed: calls every ~1.5s, messages every ~3s.
- Message and call notifications now arrive within a few seconds even with the
  screen off. Android may still kill it on aggressive battery-saver ROMs
  (Xiaomi/Oppo) — allow "No restrictions" for best results.
- Ringing calls that are never answered are marked **MISSED after 60 seconds**
  server-side, so a dead caller cannot ring forever.

### 3. Accepting a call from the notification is fixed
- Root causes fixed:
  - Android 12+ blocks starting an activity from a notification receiver
    ("trampoline") — Accept now opens the activity directly.
  - The call engine used to flip the call back to the ringing screen while the
    answer was being set up — it now keeps the state and shows **Connecting…**.
  - Accepting from the notification no longer replays the ring sound or the
    incoming screen; Decline works even when the app process is dead.

### 4. Reply directly from the message notification
- Each conversation shows **one** notification (MessagingStyle) that stacks new
  messages instead of spamming new notifications.
- Tap **Reply**, type, send — the app stays closed; the reply is delivered from
  the notification itself and the notification is dismissed.
- Reply only appears while the notification is live; a later message starts a
  fresh notification.

### 5. Bottom navigation redesigned
- Bigger 24dp icons in a 58×32dp active pill, 11sp labels, taller bar with a
  hairline divider, badges on Chats/Alerts. Selected tab uses the brand amber.

### 6. Who can message me (server-enforced)
- Default: **Friends only**. Existing accounts were migrated to Friends only
  (one-time migration; users can change it afterwards).
- Settings → "Who can message you": Everyone / Friends only / No one. The same
  rule also gates **calls** and is enforced **server-side** — a modified client
  cannot bypass it.
- Blocking someone now cuts contact in **both** directions.
- Because of this, old chats with non-friends will refuse messages until the
  players become friends or the receiver switches to Everyone. That is intended.

### 7. Profile page is now state-aware
- Not friends → **Add friend** button (shows "Request sent" after tapping;
  incoming requests can be accepted right on the profile) + only public details.
- Friends → **Friends ✓** chip + **Message** button; call/video buttons appear
  in the header only when messaging is allowed.
- ⋮ menu on every profile: **Share profile**, **Gift an item** (friends only),
  **Block**, **Report** (with reasons). Gift picks from your giftable store
  inventory. Report files to the moderation queue.
- Follow was removed from the profile per product decision.

### Also in this release
- `allowBackup` off and cleartext HTTP traffic disabled (hardening).
- D1 indexes + a `conversation_members` table so inbox/call polling no longer
  full-scans every table (big billing/scalability win at the new poll rates).
- Inbox listing, friendship lookups and friend counts all use indexed queries.
- `/api/users/:id` now returns `friend`, `canMessage`, `requestState`,
  `requestId` and `friendsCount` for the viewer.

## Files touched

Worker: `src/worker/index.ts`
Android: `SyncService.kt` (new), `CallNotify.kt`, `CallEngine.kt`,
`CallOverlay.kt`, `MainActivity.kt`, `KpApp.kt`, `AppShell.kt`,
`ProfileScreens.kt`, `InboxScreens.kt`, `AndroidManifest.xml`,
`app/build.gradle.kts`
