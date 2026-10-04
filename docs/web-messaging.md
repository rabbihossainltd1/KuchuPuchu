# Web messaging (P3 slices A–D)

Status: **implemented behind two default-off build flags**. Nothing in this document is enabled in the production `public/` PWA, and no Worker route changed.

This is the browser half of the Android chat experience: conversation list, open conversation, text send/receive, KP1 end-to-end encryption for 1:1 text, read/typing/delivered, reactions, edit, delete-for-everyone, durable drafts, and — since slice D — attachments: photo/video/document sending with single and multipart upload, the photo editor, stickers, and bearer-gated media download. Full-screen viewers, shared-media tabs, view-once, voice notes, document preview, statuses and calls are **not** part of this increment.

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
| `web/src/messaging/attachments.ts` | Pick → prepare → send pipeline: classify, probe, shrink, rejections, `PendingAttachment` reducers |
| `web/src/messaging/filesApi.ts` | `POST /api/files`, the multipart lifecycle, and `fetchFileBlob` |
| `web/src/messaging/mediaUrl.ts` | Resolves a file key to an object URL with a bounded, ref-counted cache |
| `web/src/messaging/AttachMenu.tsx`, `AttachmentRow.tsx` | The attach sheet and the transcript/composer attachment surfaces |
| `web/src/media/uploadContract.ts` | Every ceiling, plan, meta and key rule — DOM-free, so Node can test it |
| `web/src/media/imageEdit.ts`, `renderEdits.ts` | Edit model (crop/rotate/draw/text/sticker) and the canvas bake |
| `web/src/media/stickerPacks.ts` | **GENERATED** from the Kotlin catalog; never hand-edit |
| `web/src/media/StickerPicker.tsx`, `PhotoEditor.tsx` | The two lazy-loaded media surfaces |
| `scripts/generate-web-stickers.ts` | Kotlin → TypeScript catalog generator; `--check` compares data, not bytes |

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

## Attachments and the photo editor (slice D)

**Live tiles:** Gallery (multi-select images), Camera (`capture="environment"`; a phone browser opens the camera, a desktop browser offers its file picker — a documented browser substitute), Video, Document, plus Sticker and the photo editor.

**Inert tiles with the reason spoken aloud:** Location (needs the phone's own location provider and a reverse-geocode the Worker does not offer), Contact (needs the platform contacts app), Poll / Event / AI images (`comingSoon()` on Android too — verified placeholders, never built as live features). Each carries `aria-describedby` pointing at an `sr-only` reason, so "the button exists" is never mistaken for parity; `web/e2e-messaging/attachments.spec.ts` asserts the reasons are actually rendered.

### The pipeline, in the order it runs

1. **Classify** by MIME and name (`classifyAttachment`) into photo / video / audio / document.
2. **Prepare.** A photo is decoded and shrunk to a 2048 px long edge immediately, so the composer chip already reports the box that will be sent and sending does no image work. Video and audio are probed for a box and duration; a probe failure is not a refusal — the file still sends, it just carries no facts.
3. **Re-encode only when pixels change.** A scaled pick, or any editor bake, becomes `photo_<ms>.jpg` / `image/jpeg`, exactly like the phone. A photo that already fits uploads its own bytes, name and type — so a small PNG or an intact GIF is not needlessly flattened. The row never claims a type the bytes do not have, and `test/cases/57-web-media-attachments.mjs` pins both halves of that rule.
4. **Route the upload** with `planUpload`: ≤ 25 MB is one `POST /api/files`; larger goes multipart at the server's own `partSize`, with per-part progress and `mpu/abort` if a part fails. `fetch` has no upload progress, so a single-shot upload is all-or-nothing and the UI says so instead of animating a fake bar.
5. **Send** `kind: "FILE"` with `fileName/fileType/fileSize/fileKey/clientId`, optional `replyTo`, and `meta` built by the same rules as `ChatScreen.kt` (photo ⇒ `w,h`; clip ⇒ `w,h,durMs`; audio ⇒ `durMs` and a whole `seconds` ≥ 1; as-document ⇒ `{document:true}` and never view-once; several photos ⇒ one shared `album`).
6. **Show it optimistically.** The echo carries a `blob:` preview, so the thumbnail is on screen before the upload finishes, and `mediaUrl.ts` short-circuits `blob:` keys instead of asking the API for bytes the browser already holds.

Attachments are deliberately **not** in the durable IndexedDB outbox: a `Blob` cannot be reliably resurrected across a reload, and pretending otherwise would produce a send that silently drops the file. Object URLs therefore outlive the send and are revoked only when a chip is removed or the chat changes.

### Photo editor

Crop presets plus a keyboard-movable crop box, 90° rotation, freehand draw (colour and width), text layers (length-capped, blank refused), and sticker layers from the same catalog the picker uses. Layers cap at `MAX_EDIT_LAYERS`; **undo follows insertion order**, which is why the editor keeps a `history` of layer ids rather than guessing from three separate arrays. The bake is a JPEG at the 2048 long edge, and the preview is capped at 1024 so the surface stays responsive.

### Stickers

`web/src/media/stickerPacks.ts` is **generated** from `native-android/.../StickerSheet.kt` (`object Stickers` / `val packs`): 8 packs, 1 150 glyphs, in the phone's order. `npm run check:web-stickers` re-parses the Kotlin and compares pack names, glyph order and totals — data, not bytes, so prettier reflow cannot fake a pass — and case 57 compares glyph-by-glyph. A sticker is sent as `kind: "STICKER"` with the glyph as the body: no upload, no file key. Recents live in `localStorage["kp.sticker.recents"]`, capped at 24 like the phone's `sticker_recents` deque.

### Media download and the path guard

`GET /api/files/:key` is Bearer-gated (uploader, or a member of a conversation that references the key), so a media row cannot be an `<img src>` pointed at the API — the browser would send no `Authorization` header. Bytes are fetched through the session client and held as object URLs, cached by key and evicted with revocation.

The key is `f/<id>.<ext>`, i.e. it contains a slash. `fileGetPath()` encodes **each segment** and keeps the slashes, like Android's `Api.encodePath`, after validating the key against the Worker's own `FILE_KEY_RE` and refusing `.`/`..`/empty segments. Encoding the whole key (`encodeURIComponent("f/x.jpg")` → `f%2Fx.jpg`) also satisfies the Worker, which `decodeURIComponent`s the remainder — but `web/src/api.ts` refuses `%2f` on principle, because an encoded slash is how a path escape is smuggled past a validator. That mismatch meant **every received photo, clip and document failed to download**; the E2E suite caught it, and both halves are now contract-tested.

## Native-only gaps that are disclosed rather than faked

| Android behaviour | Browser reality | How it surfaces |
|---|---|---|
| `FLAG_SECURE` screenshot/recording block | Impossible in a page | `CAPABILITY_COPY.captureWarning` in *Privacy notes* |
| Media sealed end-to-end | Not implemented server-side | `CAPABILITY_COPY.mediaNotEncrypted` in *Privacy notes* |
| Photo/video/document attach | Live (slice D) | Gallery, Camera, Video and Document tiles with a real file input |
| Voice note recording | Later slice (E) | Needs `audio/webm` allowlisted server-side; `CAPABILITY_COPY.mediaViewerPending` says it is coming, and no fake mic toggle exists |
| Location / Contact share | Not possible in a browser | Tiles disabled, each with an `sr-only` reason read by `aria-describedby` |
| Full-screen viewer, shared media, view-once, document preview | Later slice (E) | `CAPABILITY_COPY.mediaViewerPending` in the chat's *Privacy notes*; a document row says "Document preview arrives in a later slice; downloading works now." |
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

File bytes, read out of `src/worker/index.ts` and mirrored by `web/src/media/uploadContract.ts`:

- `POST /api/files?name=&type=` — raw body, `400` when empty, `413 USE_MULTIPART` above 25 MB, `413 TOO_LARGE` above `mediaLimitFor(type)`, `501` when `env.MEDIA` is unset, rate-limited at 120/60 s per user, key `f/<id>.<ext>`.
- `POST /api/files/mpu/start` `{name,type,size}` ⇒ `201 {uploadId,partSize,key}`; `PUT|POST /api/files/mpu/part?uploadId=&n=` ⇒ `{ok,n,etag}` (`n` 1…10 000, `404` if not open, `403` if not the owner); `POST /api/files/mpu/complete` ⇒ `201 {fileKey,size}`; `POST /api/files/mpu/abort` ⇒ `{ok:true}`.
- `GET /api/files/:key` — Bearer-only, uploader or conversation member.
- Ceilings: image 100 MB, video 2 GB, audio 100 MB, other 5 GB. `ALLOWED_MESSAGE_KINDS` is `{TEXT, STICKER, IMAGE, FILE}`.

No endpoint was invented for this increment, and no Worker route changed for slice D.

## Tests

| Suite | Command | Covers |
|---|---|---|
| `test/cases/55-web-messaging-e2ee.mjs` | `npm test` | 43 checks. Seals with an independent `node:crypto`/OpenSSL reference and opens in the client, and vice versa; KP2 blob via `pbkdf2(200 000)`; send-policy refusals; `HKDF_INFO` and iteration count pinned |
| `test/cases/56-web-messaging-protocol.mjs` | `npm test` | 99 checks. Hostile payload parsing, previews, ticks, reducers, socket frames with a fake WebSocket and fake scheduler (open/frame/heartbeat/backoff 2500→5000/explicit close), outbox state machine, draft caps, copy catalogs |
| `test/cases/57-web-media-attachments.mjs` | `npm test` | 238 checks. Every ceiling and `mediaLimitFor` branch against `src/shared/constants.ts`; the served-type list parsed back out of the Worker's own source; `planUpload`/`splitParts` coverage-exactness; `meta` parity with `ChatScreen.kt`; the sticker catalog re-derived from `StickerSheet.kt` and compared glyph-by-glyph; edit geometry and layer reducers; `fileGetPath` and the path guard |
| `web/e2e-messaging/attachments.spec.ts` | `npm run test:web:messaging:e2e` | 12 Chromium tests with **real PNG bytes** (so decode → shrink → JPEG re-encode actually runs): 2048 px long edge and JPEG magic, sealed caption vs readable metadata, shared album id, document bytes preserved, "send as a document", editor rotation reaching the upload, chip removal, a sticker send that uploads nothing, a bearer-authenticated media download, a one-way account that cannot attach, axe on the sheet/picker/editor, and the disclosed limits |
| `web/e2e-messaging/messaging.spec.ts` | `npm run test:web:messaging:e2e` | 14 Chromium tests against a mocked Worker and a mocked WebSocket (`page.routeWebSocket`), including a genuinely sealed body the browser must decrypt, the outgoing envelope reopened from the peer's key, hidden-chat exclusion, draft survival across reload, keyboard actions, live frames, a signed-out shell that makes zero conversation requests, axe WCAG 2.1/2.2 A/AA on both panes, and a 390×844 layout check |

Honest test scope: Chromium only, synthetic events, mocked Worker and mocked sockets. This is **not** physical-device, cross-browser, real Worker↔Web↔Android or load QA. The real cross-client path is still proven by the existing Worker contract cases.

`npm run ci` runs all four suites plus `check:web-stickers`. GitHub Actions runs the sticker-catalog check and the shell, account and messaging browser suites as separate steps; each builds with its own flags.

Bundle shape after slice D, with the three media surfaces lazy-loaded: entry `index.js` 287.95 kB (gzip 88.32), `MessagingWorkspace` 77.55 kB (24.03), `PhotoEditor` 12.04 kB (3.83), `StickerPicker` 10.27 kB (4.74), CSS 25.78 kB + 19.88 kB, `sw.js` 2.43 kB with 7 precached files. A flag-off build is therefore *smaller* than before messaging existed.

## Known follow-ups (slices E–I)

Media viewers and shared media, view-once, voice notes, document preview, statuses, calls (flag stays default-off), Web Push (needs a VAPID design), and the hardening pass. See `docs/web-parity-rebuild-roadmap.md`.
