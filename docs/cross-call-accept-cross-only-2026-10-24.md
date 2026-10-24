# Cross-call Accept and cross-only badges — 2026-10-24

Owner correction: only foreign VX identities receive the original VX artwork inside KP web/Android. Same-platform people and own KP account/QR are normal; identity realm metadata and supplied source artwork remain unchanged. Verification badges are separate and unchanged.

Native initial addTrack/setDirection events can fire negotiationneeded while the first offer/answer is still being applied. Reoffer now requires the initial answer exchange to have completed AND both SDP descriptions. Camera/screenshare/ICE renegotiation on established calls remains supported. Callee setup completion is not released until the answer POST succeeds; caller completion follows successful remote answer application. Accept offer-fetch/transport/negotiation/relay failure ends the authority row and ignores its stale ring. A capture finishing after the selected call changed cannot build a replacement peer for the canceled call. Active-call polls do not fall back to cached ringing snapshots.

Native policy tests cover the initial SDP gate; source contract verifies its integration, failure termination and cache-free active polls. Cross-only browser assertions cover list/header/account/QR, and native unit policy checks own vs foreign badges.

Audit: read-only recent VX authority call metadata showed VX→KP calls with offers but no answer. KP D1 read query returned 403 and was not retried. No private device logs were captured. No database writes, key/login/relay changes or Worker deployments were made for this correction.

Version 304 / 3.9.227 is the corrective in-app update. Release workflow must pass source/browser CI, native unit/lint/build and previous signer gate. Physical two-handset Android↔VX calling is not certified by local synthetic browser tests; report this limitation explicitly.
