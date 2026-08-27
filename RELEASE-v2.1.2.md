# KuchuPuchu v2.1.2

**APK:** `KuchuPuchu-v2.1.2-debug.apk` (versionCode 25)
**Bhitore ache:** v2.1.1 er sob fix + FCM push (Messenger mode)

## Notun ja ache

### 1. Messenger-mode push notifications (FCM) 🔔
- **Permanent "KuchuPuchu connected" notification OFF** — Firebase push on thakle app ar kono always-on service chalay na
- App closed/killed thakleo message + call notification **instant** ashe (FCM HIGH priority data message)
- FCM setup korar age app automatic bhabe aager system e cholbe (foreground service) — kichu vangbe na, duita mode smooth transition kore
- Setup guide: **FIREBASE-SETUP.md** (10 minute, ekbar korlei hoy)

### 2. v2.1.1 er sob kichu (ei APK te combined)
- Profile redesign: ⋮ menu extreme corner e, hero stats row er pashe Add friend/Message button, back/username row remove
- Call audio fix (hardware AEC/NS off + setCommunicationDevice)
- Notification reliability (wake lock, screen-aware poll, onResume service restart)
- 6 ta performance fix (laggy problem)
- Nav icons 28dp

## Deploy order (IMPORTANT!)

1. **Age Worker deploy:** `npx wrangler deploy` (notun endpoints: `/api/config/firebase`, `/api/devices` + push hooks)
2. **Tarpor APK install:** `adb install -r KuchuPuchu-v2.1.2-debug.apk`
3. (Optional but recommended) **FCM setup:** FIREBASE-SETUP.md folgen → permanent notification off + instant push

APK age install korleo vangbe na (push mode off thakbe, service mode e cholbe) — kintu push mode enjoy korte worker deploy lagbe.

## Worker changes (ei version e)
- `POST/DELETE /api/devices` — push token registration
- `GET /api/config/firebase` — public Firebase config (google-services.json secret theke parse)
- Message insert → other member ke HIGH priority push (`ctx.waitUntil`, non-blocking)
- Call create (RINGING) → callee ke HIGH priority push
- FCM v1 OAuth (RS256 JWT via WebCrypto) + UNREGISTERED token auto-prune
- Noto: `devices` table migration automatic (ensureSchema)
