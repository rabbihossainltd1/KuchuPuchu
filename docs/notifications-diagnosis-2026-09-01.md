# Background notification diagnosis — 2026-09-01

Report: "message notification app background e ashe na".

## Server side (worker) — checked against live deploy

- Secrets `FCM_CONFIG` + `FCM_CREDENTIALS` present; `/api/config/firebase` serves
  project `kuchupuchuff2026` (sender 458576897499). Public config OK.
- FCM OAuth + v1 send proven end-to-end via `/api/debug/push` with a probe
  token: Google answers a well-formed `INVALID_ARGUMENT` → **credentials and
  the FCM pipeline itself are working**.
- 14 valid device tokens registered (161 users; token-less users simply never
  receive pushes — expected on this scale).

### BUG FOUND AND FIXED (deployed): message push was a dangling promise

In the messages POST handler the per-recipient push was

```ts
async function pushMessageToMember(...) {
  pushToUser(...).then(ok => ok ? run(db, delivered_at update) : null);
}
```

The outer `ctx.waitUntil(async () => { ...; await pushMessageToMember(...); })`
only tracked the *async function's* promise — the un-awaited promise created
inside `pushMessageToMember` was NOT part of it. Cloudflare can tear down the
isolate once tracked work settles, so in live tests the FCM send was fired but
its response was frequently never read:

- `fcm_error` telemetry never reached `wrangler tail` on failed sends;
- UNREGISTERED dead-token pruning inside `pushToUser` could be skipped;
- the push-path `delivered_at` write never ran;
- worst case the fetch itself raced teardown.

From the phone this is indistinguishable from "background e push ashe na":
FCM 200s what it receives, so nothing looks wrong server-side.

Fix: `await pushToUser(...)` + await the delivered_at write (commit alongside
this note). Post-deploy verification with the same probe token now logs
`fcm_error 400 INVALID_ARGUMENT` in tail and the request wall-time includes
the FCM round trip (510-640 ms vs 188-382 ms before).

Also added telemetry for the silent failure modes: `fcm_no_auth`,
`fcm_oauth_failed`, `fcm_oauth_exception`, `fcm_no_device`.

## Client side (Android) — evidence from live `error_log`

The on-device breadcrumb table shows **zero** `stage=push data-msg` rows — a
data-only FCM message reaching `KpPushService` posts exactly that breadcrumb.
Meanwhile 5 rows on 2026-08-31 (both tester devices):

```
notify threw IllegalArgumentException: ... Not posted.
PendingIntents attached to actions with remote inputs must be mutable
```

That is the Android 14/15 (API 34+) rule: a notification carrying a
RemoteInput reply action needs `FLAG_MUTABLE` on its PendingIntent, otherwise
the system drops the **whole card**. Current source (v3.8.5, versionCode 51)
already has the fix (`KpNotify.kt` replyPending uses FLAG_MUTABLE on S+),
and also already contains:

- POST_NOTIFICATIONS runtime request; channels `kp_messages_v2` (sound+vibrate),
  `kp_silent_v1`, `kp_calls_v5`;
- system notification payload when the recipient has no live socket
  (`recipientAlert` → liveSockets===0 or >5 min idle), so a swiped-away /
  MIUI-frozen app still gets a tray card drawn by Play services;
- boot/replace re-registration receiver, token retry/backoff, onNewToken
  re-post, logout unregister.

=> The devices showing the exception are running an **older APK build**.
After installing the current build, data pushes that reach the process paint
correctly; and the worker now attaches the system payload whenever the app is
not actually connected, which covers the MIUI/HyperOS process-freeze case
without depending on the app process at all.

## Still required on-device (cannot be fixed in code)

MIUI/HyperOS: enable **Autostart** for KuchuPuchu and set battery to
**Unrestricted** (Settings → Apps → KuchuPuchu). The app deep-links to both
pages (KpSetup.openFixIt). Without these, Xiaomi freezes the process and a
data-only push is never delivered — the system-payload path mitigates this
only for messages/calls that the server classifies as "not connected".

## Cleanup done after diagnosis

- Probe users / conversations / sessions / devices removed from D1.
- 3 leftover `FAKE_TOKEN_*` test device rows removed.
- Temporary `DEBUG_KEY` secret deleted again (debug endpoints back to 404).
