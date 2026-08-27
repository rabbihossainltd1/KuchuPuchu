# KuchuPuchu v3 — WhatsApp-style Messenger (Architecture Plan)

**Branch:** `v3-whatsapp` (main thakbe stable v2 porjonto; v3 ready hole merge)
**Pivot decision (user):** Facebook-style social network baad → pure messenger.

## Features (locked scope)
1. 1:1 chat + **group chat**
2. Voice call + video call (WebRTC)
3. **Screen share** (MediaProjection + video track replace)
4. Search (chats, messages, contacts)
5. **24h Status/Stories** (photo/video/text)
6. **File send** (R2: photo, video, audio, doc — size cap)
7. Login: email + password
8. Discovery: username / QR / invite link (kono contacts permission nai)
9. Push notification: FCM (Messenger mode — no permanent notification)

## Locked Design System (user picks onujayi)
- **Theme:** Chat List #7 — Gradient Rings
  - Bg cream `#F7F6F4`, primary gold-amber `#F59E0B`, ink `#1C1917`, muted `#7A6F63`
  - Amber gradient ring (avatar/status circle er chare): `#FDE68A → #F59E0B`
  - White rounded cards (16dp radius), soft shadow, gold FAB
- **Screens locked:**
  | Screen | Pick | Layout notes |
  |---|---|---|
  | Chat list | #7 | Gradient rings, swipe actions (mute/delete), voice/photo previews, tabs top |
  | Calls tab | #2 | Date sections (Today/Yesterday/Monday), direction arrows, gold callback buttons |
  | Chat box | #7 | Coin wallpaper (subtle), gradient outgoing bubble, voice message bubbles, ticks |
  | Status | #7 | Big airy — 72px rings, boro "My status" card, spacious rows |
  | Status viewer | #4 | Quick reactions row above reply bar | |
- Baki screens: calls tab, incoming/outgoing call, in-call voice/video+share, attach, search, settings — design round cholche
- **Logo:** last round e notun logo (current baad)

## Worker v3 (Cloudflare)
### Schema (fresh, D1 — `kuchupuchu` DB replace)
```
users          (id, email, password_hash, username, display_name, avatar_url, about, created_at, last_active_at)
devices        (token PK, user_id, updated_at)              -- FCM
conversations  (id, kind 'SOLO'|'GROUP', title, avatar_url, owner_id, created_at, last_message_at)
members        (conv_id, user_id, role, joined_at, last_read_at, muted)  -- PK(conv,user)
messages       (id, conv_id, sender_id, kind 'TEXT'|'IMAGE'|'VIDEO'|'AUDIO'|'FILE'|'CALL'|'SYSTEM', body, file_key, file_meta_json, reply_to_id, created_at)
statuses       (id, user_id, kind, media_key, text, bg_style, created_at, expires_at)
status_views   (status_id, viewer_id, viewed_at)
calls          (id, conv_id, caller_id, callee_id (1:1), kind AUDIO|VIDEO|SCREEN, status, offer_sdp, answer_sdp, started_at, ended_at)
call_ice       (call_id, sender_id, candidate_json)
blocks         (owner_id, target_id)
```
### Endpoints
- Auth: register/login/logout (email+password, bcrypt-style hash — existing pattern)
- Me: GET/PATCH (display_name, about, avatar)
- Users: GET /api/users/{id}, GET /api/users?username= (search), QR = deep link `kp://u/{username}`
- Conversations: POST (solo by username/userId), GET list (unread count, last message), group: POST /api/conversations/group {memberIds[], title}
- Messages: GET paginated (before cursor), POST (text/file ref), DELETE (own), reactions baad (v3.1?)
- Files: POST /api/files/sign (R2 presigned upload), GET /api/files/{key} (auth-gated download redirect)
- Status: POST (create), GET /api/statuses (contacts er active), POST /:id/view, GET /api/statuses/mine/views, DELETE
- Calls: POST /api/calls, POST /:id/answer|decline|end, GET /api/calls/active, ICE relay (existing pattern)
- Push: /api/devices (existing), message/call/status pushes (FCM data HIGH — existing infra carry over)
- Search: GET /api/search?q= (messages + users)
- Expiry sweeper: statuses delete where expires_at < now (on-request lazy cleanup — no cron dorkar)

### R2
- Bucket: `kp-media` (files + status media + avatars)
- Presigned PUT (client upload, 100MB cap), GET auth-check + redirect
- Image thumbnails: client-side resize before upload (app e compress korbe, R2 e ek copy)

## Android v3
- Single module, min SDK 24, target 35, Kotlin + Compose
- **Carry over from v2 (proven):** CallEngine (WebRTC), KpPush/FCM infra, CallNotify/MsgNotify, Api/Disk patterns, CallService (FGS mic/camera/mediaProjection)
- **Notun:** MediaProjection screen share, R2 upload/download, status viewer (ExoPlayer video), group chat UI, search, QR (ZXing)
- Nav: top tabs Chats/Status/Calls (locked design), bottom kichu nai
- Permissions: INTERNET, CAMERA, RECORD_AUDIO, POST_NOTIFICATIONS, FOREGROUND_SERVICE(+MIC/CAMERA/MEDIA_PROJECTION), USE_FULL_SCREEN_INTENT, READ_MEDIA_IMAGES/VIDEO/AUDIO, READ_EXTERNAL_STORAGE(maxSdk 32), WAKE_LOCK, VIBRATE, MODIFY_AUDIO_SETTINGS

## Milestones
1. **M1 Core:** auth + 1:1 chat + chat list (locked design) + push → usable app
2. **M2 Calls:** 1:1 audio/video (carry-over engine) + incoming/outgoing UI + TURN
3. **M3 Status:** post/list/view/expire + viewer (locked design)
4. **M4 Files + Search:** R2 upload, all file types, search screen
5. **M5 Groups:** group create/add/remove, group chat UI
6. **M6 Polish:** logo, animations, dark mode?, final QA + deploy

## Deploy
- Branch: `v3-whatsapp` → dev/test → main merge
- Worker: wrangler deploy (CF token on hand) + secrets (FCM_CREDENTIALS, FCM_CONFIG — Firebase JSON pending from user)
- R2 bucket + Cloudflare Calls TURN: CF API diye ami setup kormu
- User: shudhu APK install
