# Native Android rewrite

Package: `app.kuchupuchu.android` (same applicationId as the Capacitor APK — updates replace it).
API: `https://kuchupuchu-api.kuchupuchu.workers.dev`

CI APK job builds `native-android/` (Compose). The old WebView shell was deleted; there is no fallback client in this repo.

## Locked UI

- In-call audio: pick 6
- In-call video: pick 14 + share
- Incoming audio: pick 10
- Incoming video: pick 11 (full self-camera)
