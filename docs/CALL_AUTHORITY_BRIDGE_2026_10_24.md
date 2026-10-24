# Shared call authority (explicit user-approved call-bridge scope)

The user explicitly approved limited KP call-routing/identity bridge changes after reporting VX call UI problems and KP-to-VX `User not found`. Relay keys, chat routing, login/authentication flows, encryption and storage/schema remain unchanged.

## Cause and rollout

The KP edge intentionally kept `/api/calls*` local while the communication authority had no TURN configuration. VX now has its own working TURN relay, but leaving calls on the legacy edge means VX identities are absent there and call REST writes disagree with the already-federated call sockets. One call must live on one authority for create/active/answer/ICE/end/history.

`FEDERATED_CALLS=1` opts ONLY call REST into the existing federation proxy. Without that flag, legacy edge-owned behaviour is unchanged. The KP relay `/api/config/ice`, APK/share-card exceptions and existing non-call routing are unchanged. KP still uses its own relay; VX uses its dedicated relay. No user/session/database copying is done. Legacy call records are not deleted or migrated; this change does not merge old edge-only call history.

## Honest ringing

`GET /api/calls/:id/reachability` verifies call participation and reports whether the authenticated callee has a current, heartbeating call-signal socket. CallSignal's internal `/live?user=<callee>` counts only sockets tagged by the authenticated upgrade route with that callee ID. Caller devices, online presence and push acceptance cannot create a false Ringing state. Existing unfiltered `/live` behaviour for call reaping remains intact. No schema change or durable receipt table is introduced.

## Verification

- Full backend/web-contract runner: **109/109 cases, 4,129 assertions passed** on the final run.
- TypeScript typecheck passed.
- New tests cover every call REST path through federation, callee-only live socket counts and nonparticipant denial.
- Two isolated in-memory Worker environments exercise KP-to-VX and VX-to-KP creation, incoming, answer, bidirectional ICE and end/history using the same IDs. The legacy edge has no VX identity or call table and receives no split-brain writes. Existing anti-phantom ringing grace is respected.
- An earlier full run had a transient fingerprint-warning timing failure in an untouched web-call test; isolated baseline and patched reruns passed, and the final full run passed. No encryption code was changed.

## Deployment safety

Live KP and VX authority scripts/settings were downloaded before changes. Only the bounded call-routing/receipt portions of the live compiled modules are patched, preserving unrelated live differences between deployments. Existing assets, compatibility settings and every binding (including secret/relay bindings and namespace/database IDs) are retained and compared after upload. Only KP gains the `FEDERATED_CALLS` flag. Original modules and settings are in workspace rollback folders; no secret values are in this document or repository.

Rollback of new shared calls: set/remove the KP `FEDERATED_CALLS` flag to return to legacy call routing. Existing already-created core calls should finish before such a rollback. The additive receipt probe can remain, or the saved original modules can be restored with the same preserved bindings/assets.

Actual two-device production call quality/ringing is a separate test; fixture roundtrips are not presented as live-user calls.
