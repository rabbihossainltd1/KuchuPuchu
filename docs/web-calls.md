# Web calls (Slice G)

Slice G adds a flag-gated Web 1:1 voice/video call surface without changing the production `public/` PWA. Enable it with `VITE_KP_WEB_CALLS=true`; the default is off.

## Scope

- 1:1 voice and video calls, call history, incoming ring, accept/decline/message, minimize/restore, mute, camera, screen-share disclosure, audio output picker where `setSinkId` exists, and E2EE safety-code verification.
- Group call-back remains a labelled browser limitation; `Add call` remains a placeholder.
- Native-only features are disclosed: system Telecom/hold, full-screen takeover, foreground service, closed-tab ringing, hardware routes, screenshot blocking, and reminders.

## Security and media

Call media uses browser WebRTC. The safety code is derived from the DTLS P-256 fingerprint path used by the client; it is a verification ceremony, not a claim that media bytes are application-layer E2EE. KP1 ECDH/HKDF/AES-GCM remains limited to 1:1 message bodies/captions.

The Worker endpoints are same-origin `/api/calls/*`, `/api/config/ice`, and receive-only `/ws/call/:id`. ICE candidates are cursor-polled as a fallback. SDP is preserved with its CRLF line endings; tracks and reserved transceivers retain their `MediaStream` association so Chromium does not emit invalid `msid:-` descriptions.

## Verification

- Contract case: `test/cases/62-web-calls.mjs`
- Browser suite: `npm run test:web:calls:e2e`
- Feature default: `VITE_KP_WEB_CALLS` is false (a plain `npm run build:web`)
- Production recipe: on since slice Q — `build:web:prod` flips the gate
- Legacy `public/` PWA: retired by the slice J cutover, untouched here
