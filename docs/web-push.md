# Web Push (Slice H)

Slice H adds a flag-gated browser "doorbell" — VAPID Web Push subscriptions, a
Worker delivery pipeline, service-worker click routing, and an opt-in/revoke
settings card — without changing the production `public/` PWA or the phone's
FCM path. Enable it with `VITE_KP_WEB_PUSH=true`; the default is off.

## The one rule: the payload is generic

A web push here is a **doorbell, never a preview**. The Worker builds exactly
one payload (`webPushToUser`): `{"t":"kp.msg"}` or `{"t":"kp.call"}`, plus
`"s":1` when the chat is muted for messages. It carries **no message text, no
sender name, no conversation id, no media**. The push service therefore learns
only that "something happened," the notification shows a generic line, and the
signed-in app fetches whatever it may show after the user opens it. Contract
case 77 subscribes with a real P-256 key pair, intercepts delivery, decrypts
the RFC 8291 record, and fails if the plaintext is anything but the generic
doorbell.

## Worker

- Registry: `web_push_subs` (endpoint PK, user_id, p256dh, auth, created_at,
  failures). Deliberately separate from `devices` (the FCM token world); the
  parity plan §7.4 forbids reusing a phone's FCM route as a web subscription.
- Routes (header-only auth): `GET /api/push/web` (capability + VAPID public
  key + my own rows), `POST /api/push/web` (subscribe), `DELETE /api/push/web`
  (unsubscribe). Per-user cap 8 browsers; re-subscribing the same endpoint
  renews it.
- Delivery: RFC 8292 VAPID JWT (ES256) + RFC 8291 `aes128gcm`, all on
  SubtleCrypto. Enabled only when `VAPID_PRIVATE_KEY` is set; the public key
  is derived at runtime so the pair cannot disagree. Unset ⇒ `supported:false`,
  subscribe answers 503, zero fan-out.
- Fan-out points: new message (only to members with no live socket — an open
  tab already got the WS poke), missed call, and incoming ring. Hidden chats
  are never knocked; muted chats are knocked silently.
- Cleanup: 404/410 retires a subscription at once; a 5xx bumps `failures`
  until the limit (5) retires it; a success resets the counter.

## Web client

- Feature flag: `VITE_KP_WEB_PUSH` (default off).
- Settings card (Account → Notifications): opt-in/opt-out, and honest lines
  for an unsupported browser, an unconfigured server, and a blocked permission.
  The privacy and best-effort-delivery facts are stated on the card.
- Service worker: a `push` handler shows the generic notification (one live
  card per kind via `tag`), and `notificationclick` focuses an open window or
  opens one, handing the app a `kp-push-nav` message. The app decides the
  section: a call knock lands on Calls only in a calls-enabled build; every
  other knock lands on Chats.

## Verification

- Contract case: `test/cases/77-web-push.mjs`
- Browser suite: `npm run test:web:push:e2e`
- Service-worker checks: `scripts/verify-web-sw.ts`
- Feature default: `VITE_KP_WEB_PUSH` is false
- Production PWA (`public/`) and the phone's FCM pipeline: unchanged
