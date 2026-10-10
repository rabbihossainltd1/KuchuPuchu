# Web calls (Slice G)

Slice G adds a flag-gated Web 1:1 voice/video call surface without changing the production `public/` PWA. Enable it with `VITE_KP_WEB_CALLS=true`; the default is off.

## Scope

- 1:1 voice and video calls, call history, incoming ring, accept/decline/message, minimize/restore, mute, camera, **screen share (complete since slice R)**, audio output picker where `setSinkId` exists, and E2EE safety-code verification.
- Group call-back remains a labelled browser limitation; `Add call` remains a placeholder.
- Native-only features are disclosed: system Telecom/hold, full-screen takeover, foreground service, closed-tab ringing, hardware routes, screenshot blocking, and reminders.

## Screen share (slice R)

- Local share goes through the browser's own picker (`getDisplayMedia`), started and stopped from the in-call control; the browser's own "Stop sharing" pill ends the share from the engine too (`track.onended`). A share rides the already-negotiated video m-line via `replaceTrack` — no renegotiation — and NEVER changes the call's kind (owner round 31 item 19): a shared screen on a voice call stays a voice call on both sides.
- The peer sees the phone's two surfaces: the "They are sharing their screen" line with a 16:9 preview card on a voice call, and the card expands to the phone's edge-to-edge `ShareFullscreen` view (name + clock on top, one exit control, Escape/Back collapses it). The fullscreen flag drops itself the moment the share ends or the call does.
- "Share audio via screen share" is the phone's settings toggle of the same name: device-local (`kp.calls.share_audio` in localStorage, never sent to the server), read at share time. With it on, the capture asks for sound; when the browser grants an audio track, the engine mixes it with the mic through a Web Audio graph and puts the mix on the audio sender — the peer hears voice AND screen, the phone's round-31 item 20 mix. Stopping the share restores the mic and tears the mix down.
- Honest browser facts, stated instead of hidden: tab sound is granted by Chromium, SYSTEM sound depends on the OS and may arrive as "no audio track" (share without sound, never an error), and the capture itself can be denied — the refusal names the screen share and changes nothing.

## Security and media

Call media uses browser WebRTC. The safety code is derived from the DTLS P-256 fingerprint path used by the client; it is a verification ceremony, not a claim that media bytes are application-layer E2EE. KP1 ECDH/HKDF/AES-GCM remains limited to 1:1 message bodies/captions.

The Worker endpoints are same-origin `/api/calls/*`, `/api/config/ice`, and receive-only `/ws/call/:id`. ICE candidates are cursor-polled as a fallback. SDP is preserved with its CRLF line endings; tracks and reserved transceivers retain their `MediaStream` association so Chromium does not emit invalid `msid:-` descriptions.

## Verification

- Contract case: `test/cases/62-web-calls.mjs`
- Browser suite: `npm run test:web:calls:e2e`
- Feature default: `VITE_KP_WEB_CALLS` is false (a plain `npm run build:web`)
- Production recipe: on since slice Q — `build:web:prod` flips the gate
- Legacy `public/` PWA: retired by the slice J cutover, untouched here
