# Web messaging (P3 slices A–C)

Status: **implemented behind two default-off build flags**. Nothing in this document is enabled in the production `public/` PWA, and no Worker route changed.

This is the browser half of the Android chat experience: conversation list, open conversation, text send/receive, KP1 end-to-end encryption for 1:1 text, read/typing/delivered, reactions, edit, delete-for-everyone, and durable drafts. Attachments, media viewers, statuses and calls are **not** part of this increment.

## Turning it on

```sh
# opt-in build + preview on http://127.0.0.1:4177 (what the E2E suite uses)
VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true npm run build:web
```

`messaging` requires `accountIntegration`: with messaging on but accounts off, `App.tsx` refuses to render the workspace and says so, because a chat list with no session is a privacy bug, not a degraded feature. Flags are build-time client configuration, never authorization — the Worker still authenticates every request. See `docs/web-feature-flags.md`.

## What is where

| Path | Role |
|---|---|
| `web/src/messaging/e2ee.ts` | KP1/KP2 crypto, send policy, `SendRefusedError`, `SECURE_CHAT_WAITING` |
| `web/src/messaging/protocol.ts` | Hostile-payload row parsing, pagination cursor, previews, ticks, day grouping, reducers |
| `web/src/messaging/sockets.ts` | `createManagedSocket`: heartbeat, backoff, explicit close, injectable scheduler |
| `web/src/messaging/outbox.ts` | Optimistic send queue + IndexedDB draft/outbox stores with an in-memory fallback |
| `web/src/messaging/messagingApi.ts` | REST calls for conversations, messages, read, typing, react, edit, delete |
| `web/src/messaging/useE2eeIdentity.ts` | `ensureIdentity()` state machine: adopt / generate / pending unlock / unavailable |
| `web/src/messaging/useMessaging.ts` | The controller the two panes share |
| `web/src/messaging/ConversationList.tsx`, `ChatPane.tsx`, `MessagingWorkspace.tsx` | The three-pane desktop surface and its mobile collapse |
| `web/src/messaging/chatCopy.ts` | Static catalogs and capability wording, testable without a DOM |

## End-to-end encryption — precise claims

Only these are true, and the tests assert exactly these:

- 1:1 **text** bodies and captions are sealed as `KP1.` + base64(nonce ‖ ciphertext ‖ tag), P-256 ECDH → HKDF-SHA256 (`info = "kp-msg-e2ee-v1"`, Android-exact manual expansion) → AES-256-GCM. The Worker never sees the plaintext.
- The backup blob is `KP2.salt.iv.ct` over `"priv\npub"`, PBKDF2-SHA256 at 200 000 iterations.
- A browser **never mints a second identity**. If the server holds a `KP2.` blob the UI shows a passphrase form and stays locked; adopting base64 JSON `{p,u}` or generating fresh only happens when the server has nothing.
- Bots (`kp_official_bot`, `kp_ai_bot`) stay plaintext by design, and a personal chat whose peer has no usable key **refuses to send** rather than silently downgrading: `SendRefusedError` with the `SECURE_CHAT_WAITING` copy.

Not encrypted, and the UI says so in the chat's *Privacy notes* disclosure:

- **Group** message bodies — the server stores group plaintext today.
- **Media bytes** (photos, video, voice, documents) — account-controlled, not sealed.
- Message **metadata**: who, when, which conversation, delivery/read timestamps, reaction emoji.

## Native-only gaps that are disclosed rather than faked

| Android behaviour | Browser reality | How it surfaces |
|---|---|---|
| `FLAG_SECURE` screenshot/recording block | Impossible in a page | `CAPABILITY_COPY.captureWarning` in *Privacy notes* |
| Media sealed end-to-end | Not implemented server-side | `CAPABILITY_COPY.mediaNotEncrypted` in *Privacy notes* |
| Photo/video/voice/document attach | Later slice (D–E) | Attach button rendered `disabled` with the reason as its accessible title, never a stub that pretends to open a picker |
| Full emoji reaction picker | Later slice | Only the six wired quick reactions are offered |
| Drafts in app storage | Needs IndexedDB | When unavailable, a `role="status"` banner says drafts live in memory only |

`Add call`, Poll, Event and AI image tiles remain **verified placeholders**: they are not built as live features.

## Desktop-first interaction rules

- Chat list and open conversation coexist at 1366×768 and 1920×1080; below 720 px the list collapses and a *Back to Chats* link returns.
- Every gesture has a keyboard equivalent: `Enter` sends, `Shift+Enter` newline, `Escape` cancels a reply or an edit, `Tab` reaches every per-message action.
- Per-message action rows are revealed by `:hover` **and** `:focus-within`, and are permanently visible under `prefers-reduced-motion`. No hover-only or unlabeled icon-only control exists.
- Delete uses an inline confirm panel (*Delete for everyone* / *Keep message*), never `window.confirm`.
- Conversation rows are real `RouteLink` anchors to `/chats/:id`, so middle-click, Ctrl-click and "open in new tab" work.
- Unread badges cap at `99+`; hidden conversations never render or contribute to counts; times render in `Asia/Dhaka`.

## Wire contract

REST is Bearer-header-only (pinned by `test/cases/48-r104-web.mjs`); `?token=` is accepted only on `/ws/*`. The client matches the Worker exactly on:

- `GET /api/conversations/:id/messages` — page size 50, cursor `?before=<iso>&beforeRowid=<n>`, `PAGE+1` probe for `hasMore`, malformed cursor ⇒ `400 BAD_CURSOR`, freshness `marker` short-circuit, per-member delete watermark and disappear-TTL already applied server-side.
- `POST /api/conversations/:id/messages` — `{kind, body, clientId, replyTo?, …}` ⇒ `201 {message}`, or `{duplicate:true}` on a `clientId` retry, which makes resends from the outbox idempotent.
- `POST .../typing` `{kind:"text"|"voice"|"clear"|"none"}`, `POST .../read`, `POST /api/messages/:id/react`, `PATCH /api/messages/:id` (own `TEXT`, ≤60 s), `DELETE /api/messages/:id` (permanent, delete-for-everyone; there is no delete-for-me scope).
- `/ws/user` and `/ws/chat/:id` frames: `message`, `conv`, `read`, `typing` (`at:""` clears), `delivered`; `{type:"hb"}` every 20 s; reconnect backoff 2.5 s → ×2 → cap 30 s.

No endpoint was invented for this increment.

## Tests

| Suite | Command | Covers |
|---|---|---|
| `test/cases/55-web-messaging-e2ee.mjs` | `npm test` | 43 checks. Seals with an independent `node:crypto`/OpenSSL reference and opens in the client, and vice versa; KP2 blob via `pbkdf2(200 000)`; send-policy refusals; `HKDF_INFO` and iteration count pinned |
| `test/cases/56-web-messaging-protocol.mjs` | `npm test` | 99 checks. Hostile payload parsing, previews, ticks, reducers, socket frames with a fake WebSocket and fake scheduler (open/frame/heartbeat/backoff 2500→5000/explicit close), outbox state machine, draft caps, copy catalogs |
| `web/e2e-messaging/messaging.spec.ts` | `npm run test:web:messaging:e2e` | 13 Chromium tests against a mocked Worker and a mocked WebSocket (`page.routeWebSocket`), including a genuinely sealed body the browser must decrypt, the outgoing envelope reopened from the peer's key, hidden-chat exclusion, draft survival across reload, keyboard actions, live frames, a signed-out shell that makes zero conversation requests, axe WCAG 2.1/2.2 A/AA on both panes, and a 390×844 layout check |

Honest test scope: Chromium only, synthetic events, mocked Worker and mocked sockets. This is **not** physical-device, cross-browser, real Worker↔Web↔Android or load QA. The real cross-client path is still proven by the existing Worker contract cases.

`npm run ci` runs all three suites. GitHub Actions runs the shell, account and messaging browser suites as separate steps; each builds with its own flags.

## Known follow-ups (slices D–I)

Attachments and the photo editor, media viewers and shared media, view-once, voice notes, document preview, statuses, calls (flag stays default-off), Web Push (needs a VAPID design), and the hardening pass. See `docs/web-parity-rebuild-roadmap.md`.
