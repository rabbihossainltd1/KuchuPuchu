# Web messaging (P3 slices A–E2)

Status: **implemented behind two default-off build flags**. Nothing in this document is enabled in the production `public/` PWA, and no Worker route changed.

This is the browser half of the Android chat experience: conversation list, open conversation, text send/receive, KP1 end-to-end encryption for 1:1 text, read/typing/delivered, reactions, edit, delete-for-everyone, durable drafts, — since slice D — attachments: photo/video/document sending with single and multipart upload, the photo editor, stickers, and bearer-gated media download; and — since slice E1 — the full-screen viewer, the shared-media panel, album folding and view-once. Voice-note recording and playback, document preview, forwarding, statuses and calls are **not** part of this increment.

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
| `web/src/media/StickerPicker.tsx`, `PhotoEditor.tsx` | Two of the lazy-loaded media surfaces |
| `web/src/messaging/MediaViewer.tsx` | Full-screen viewer: paging, zoom, pan, drag-to-close, save/delete |
| `web/src/messaging/viewerGeometry.ts` | The viewer's numbers, DOM-free so Node can compare them with the Kotlin |
| `web/src/messaging/MediaGallery.tsx` | "Media, links, and docs": three tabs, real downloads, real links |
| `web/src/messaging/sharedMedia.ts` | The gallery payload, its order, its empty states and its refusals |
| `web/src/messaging/viewOnce.ts` | The one-opening rule: which fetch spends it, the spend de-dupe, the text reveal timer |
| `web/src/messaging/OnceText.tsx` | A view-once TEXT row: veiled, five-second reveal, then gone |
| `web/src/messaging/voice.ts` | Every voice number and the waveform maths (DOM-free, so Node compares it with `VoiceNote.kt`) |
| `web/src/messaging/voiceRecorder.ts` | `MediaRecorder` + `AnalyserNode`: start / pause / resume / cancel, the hold geometry, mic-refusal wording |
| `web/src/messaging/useVoiceRecorder.ts` | The composer's recorder controller: hold → release decides, the clock, the live strip, typing pings |
| `web/src/messaging/useVoicePlayer.ts` | One player for the whole transcript: per-message speed, seek, blob cache, `voiceSourceOf` |
| `web/src/messaging/VoiceBubble.tsx`, `VoiceRecorderBar.tsx` | The note (play/pause, wave slider, duration, speed) and the hold/locked recorder panels |
| `web/src/messaging/docPreview.ts` | Document kinds, mime table, size reading, notices — every list compared with `DocViewerScreen.kt` / `Files.kt` |
| `web/src/messaging/DocViewer.tsx` | The full-screen reader: PDF frame, text pane, media player, honest card for the rest |
| `web/src/messaging/forward.ts` | Forward gates and shapes, the meta a copy carries, selection facts, the delete-for-everyone predicate |
| `web/src/messaging/ForwardDialog.tsx` | The full-screen chat picker: tick rows, subtitle, one Send that fires every target |
| `scripts/generate-web-stickers.ts` | Kotlin → TypeScript catalog generator; `--check` compares data, not bytes |

## End-to-end encryption — precise claims

Only these are true, and the tests assert exactly these:

- 1:1 **text** bodies and captions are sealed as `KP1.` + base64(nonce ‖ ciphertext ‖ tag), P-256 ECDH → HKDF-SHA256 (`info = "kp-msg-e2ee-v1"`, Android-exact manual expansion) → AES-256-GCM. The Worker never sees the plaintext.
- The backup blob is `KP2.salt.iv.ct` over `"priv\npub"`, PBKDF2-SHA256 at 200 000 iterations.
- A browser **never mints a second identity**. If the server holds a `KP2.` blob the UI shows a passphrase form and stays locked; adopting base64 JSON `{p,u}` or generating fresh only happens when the server has nothing.
- Bots (`kp_official_bot`, `kp_ai_bot`) stay plaintext by design, and a personal chat whose peer has no usable key **refuses to send** rather than silently downgrading: `SendRefusedError` with the `SECURE_CHAT_WAITING` copy.

Not encrypted, and the UI says so in the chat's *Privacy notes* view (inside the ⋮ conversation sheet, see *Chat surface parity* below):

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

## Viewers, shared media and view once (slice E1)

### Full-screen viewer

Ported from `MediaViewer.kt` (`KpPhotoViewer`) with the desktop half built out, because a gesture with no keyboard equivalent is a gesture most readers do not have:

| Android gesture | Browser equivalent |
|---|---|
| pinch zoom, `coerceIn(1f, 6f)` | wheel zoom, `+` / `-` / `0`, same 1×…6× clamp |
| double-tap `if (scale > 1f) 1f else 2.5f` | double-click, same target |
| pan while zoomed, `maxX = size.width * (scale - 1f) / 2f` | pointer drag, arrow keys, same clamp box |
| swipe between photos | Prev/Next, `←` / `→`, `Home` / `End` |
| swipe down to close | drag down past 120 px at 1×, Escape, or the Close button |
| ⋮ sheet: Save / Forward / Delete | Save (a real `download` anchor), Forward (**disclosed as not built**), Delete (inline confirm) |

Zoom resets on every page flip, and a zoomed photo holds the arrow keys for panning instead of paging — both are the phone's rules, and `viewerGeometry.ts` keeps the numbers DOM-free so `test/cases/58-web-media-viewers.mjs` can parse them out of the Kotlin and compare.

### Shared media

`GET /api/conversations/:id/media` answers `{images, videos, docs, links}` — one payload, newest-first, capped at 400 rows, with the delete-for-me watermark applied server-side, view-once rows excluded, and `403 PRIVATE_GROUP` / `403 REQUEST_PENDING` where the gallery is not allowed. There is **no cursor**, so the client invents none.

`ChatMediaScreen.kt` owns the shape: three tabs (**Media / Docs / Links**, not four), the Media tab being `images + videos` merged and re-sorted, the panel title "Media, links, and docs", and the empty states verbatim ("No media" / "Photos and videos sent in this chat show up here", "No documents yet.", "No links yet."). A row that has left the transcript leaves the panel too (`visibleMedia`), because a thumbnail for a message the reader can no longer see is its own kind of leak. Docs are real downloads and links are real anchors with `rel="noopener noreferrer"`.

### Albums

Photos that share `meta.album` and a sender fold into one bubble (`foldAlbums`, mirroring Android's), so a five-photo send is one row with five thumbs, and opening any thumb opens the viewer on the whole group. A group of one stays a plain photo, and a transcript with no albums is returned untouched.

The album id itself is `alb_` + 20 hex characters, minted the way the phone mints it. The Worker only keeps an id matching `ALBUM_ID_RE = /^alb_[A-Za-z0-9_-]{4,36}$/` and **drops anything else silently** — an earlier client-side shape (`album_<ms>`) would have un-grouped every multi-photo send without a single error anywhere. Both the shape and the 500-id uniqueness are now contract-tested against the Worker's own regex.

### View once

Three rules, all of them easy to get wrong, all pinned against source:

1. **Which fetch spends the opening.** An inline `IMAGE` row is served by `/api/messages/:id/media`, and that route deletes the row, collects the object and broadcasts `VANISHED` *on the fetch itself*. An uploaded photo or clip is a `FILE` row served by `/api/files/:key`, which spends nothing — so the phone shows those very pixels blurred behind a lock, and reports the opening with `POST /api/messages/:id/view` when the picture is on screen. Rendering a transcript must therefore never fetch an `IMAGE` once-row: `openingCostsFetch` marks them and the row waits for a tap.
2. **A spent row advertises nothing.** Once `viewedAt` is set the Worker stops sending `mediaUrl`, `fileKey` and `hasImage`, and the client says "already opened, the bytes are gone" instead of showing a broken frame.
3. **The report is de-duplicated and its failures are classified.** `createViewOnceSpender` mirrors Android's `object ViewOnce`: one report per id per page, `404`/`410` treated as terminal ("already gone"), any other failure releasing the id so the next viewing reports again.

A view-once **clip or voice note fetches no bytes at all** until it is opened ("a view-once clip the recipient has not opened has no bytes to show" — a hardcoded thumbnail would be a fake). A view-once **TEXT** row arrives veiled, one tap reveals it, a five-second countdown is painted for the reader (`ONCE_TEXT_REVEAL_MS`, measured against the wall clock so a throttled background tab cannot extend it), and then the opening is reported. Sending side: the attach sheet offers "View once" for photos and clips, refuses to combine it with "send as a document" (the Worker drops the flag on a document), never attaches an album id, and the composer chip says "view once" out loud before the send.

The `VANISHED` socket frame is an instruction, not a message: `applyMessageFrame` removes the row and can never insert the marker as a bubble.

## Voice notes, documents, forwarding and multi-select (slice E2)

### Voice notes

The recorder is `MediaRecorder` + an `AnalyserNode`, and the maths is the phone's:

- **The wave travels in the message**, not in a decoder. `meta.waveform` (≤64 ints, 0…100) is what both clients draw, so a note recorded on a phone looks the same here. `squashWaveform` is `VoiceWaveform.squash` bucket-for-bucket; `pseudoWaveform` is the LCG that seeds from Java's `String.hashCode` and keeps Kotlin's *Float* literals (`0.55f`, `0.45f`, `6.4f`, `0.3f`, `18f`, `0.62f`) — same seed, same 36 bars, on both clients. A note with no recorded bars draws the pseudo pattern from `clientId.ifBlank { id }`, so an optimistic echo and its confirmed row never redraw.
- **The container is the browser's own.** `audio/webm;codecs=opus` first, `audio/mp4` in Safari, and the file name follows the container (`voice_<ms>.webm` / `.m4a` / `.ogg`). The Worker's `SAFE_MEDIA_TYPES` gained `audio/webm` (PR #85) — without it a browser note was served as `application/octet-stream` and the message-media fallback labelled it `image/jpeg`.
- **Both clients still draw it as a note, not a clip.** Android's FILE bubble tests `fileLooksVoice` before `fileLooksVideo`, so a `.webm` name with an `audio/*` type is a voice note there too. The Worker files `audio/*` under *Docs* in shared media for both clients.
- **The hold gesture decides on the release** (r75-1/r75-9/r76-19): a tap arms the locked panel, a drag left past the cancel arm throws the take away, a rise past the lock arm keeps the panel, anything else sends. On a desktop pointer the same three outcomes are also real labelled buttons — Send, Pause, Delete and View once — so nothing is gesture-only. Pause freezes the clock *and* the wave (`recorderElapsedMs` subtracts the paused total), which is what makes the stored `seconds` the words that were actually spoken.
- **Speed is per message** (r76-16): 1× → 2× → 3× → 4× → 1×, keyed on the row id, so one note at 2× leaves every other note alone.
- **Limits:** 100 MB (`Api.VOICE_MAX`), 600 s (the Worker's clamp), under one second is thrown away. `mediaLimitFor` matches a `.webm` *name* in its video branch before its audio branch, so a browser note measures against the 2 GB clip ceiling server-side — the 100 MB voice rule is enforced in `sendVoice`, and case 59 pins that fact rather than pretending the server does it.
- While a take runs the chat pings `typing` with `kind: "voice"` once and then every 3 s against the Worker's ~6 s lease, so the other side sees a recording microphone instead of typing dots; finishing or cancelling sends `clear`.

**View-once voice (r71-19b)** keeps the one-opening rule exact: the *recipient* plays through `GET /api/messages/:id/media`, where the fetch **is** the opening (and `POST /api/messages/:id/view` is reported), while the *sender* previews from their own `fileKey` and spends nothing. A once note cannot be seeked, has no speed control, and leaves the transcript on the server's `VANISHED` frame — never on the client's own say-so.

### Documents

`docPreview.ts` is the phone's `docKind` branch for branch, in the same order (pdf → svg → tiff → image → archive → text → other), with the same extension sets, the same ZIP-shaped exceptions (`docx`/`xlsx`/`pptx`/`apk`/`jar`/`odt`/`ods`/`odp`/`epub` are *not* archives) and the same magic-byte tests. Then the reader does what a browser honestly can:

| Kind | What the reader does | Disclosed as |
|---|---|---|
| PDF | The browser's own viewer, in an `iframe sandbox="allow-same-origin allow-popups"` on a blob URL, plus "Open in a new tab" | "Rendered by your browser's own PDF viewer." |
| text / code | Selectable monospace, first **400 000 bytes** cut *before* the UTF-8 decode, then the phone's own truncation line | "Plain text, selectable, first 400 KB of it." |
| image | A picture | — |
| a clip or an audio file sent as a document | The browser's own player | "The phone hands a file like this to its system player." |
| **HTML / XHTML / SVG / Markdown** | **Source only, never rendered** | Why: this origin will not execute markup another person uploaded; the phone's offline WebView is a sandbox a browser tab does not have |
| TIFF, ZIP/RAR, DOC(X)/XLS(X)/PPT(X) and everything else | The phone's card — badge, name, `type · size` — with the download as the way through | "No browser can decode a TIFF" / "download-only here" |

A document row's **Download fetches on the click**, not on render: `/api/files/:key` is member-checked so an `<a href>` can never carry the Bearer header, and a document row can be gigabytes. Opening a chat used to download every document in it.

### Forwarding and multi-select

Gates, in the order the phone tests them: an echo that is still sending, a `DELETED` row, a **private chat** (`privateGroup`, or a 1:1 whose `other.privateProfile` is set), a **view-once** row, and somebody else's media when they turned off *Media Save permission* (r71-18). Each refusal is a labelled, `aria-disabled` element carrying its reason — never a button that silently does nothing.

Shapes, in the same order: a stored `fileKey` is **reused** (no re-upload), a `data:` URL is reposted inline as an `IMAGE`, a server-hosted media URL is downloaded and re-uploaded as `photo.jpg` / `image/jpeg`, and anything else is a `TEXT` post. The `meta` a copy carries is exactly the phone's: `{voice, seconds, waveform?}`, or `{document: true}`, or `{album}` for a grouped photo — a reply quote, reactions and the view-once flag belong to the original and do not travel. Two or more photos forwarded together arrive as one grouped bubble again, with **a fresh `albumId()` per target chat** so two chats never share a group.

The caption is **re-sealed for the target's** peer key (plaintext for a group or a keyless chat). Android falls back to plaintext when sealing fails; this client refuses instead (`SendRefusedError`) and reports that chat as not forwarded, because posting a readable copy of a sealed message is worse than posting nothing. Per-row failures are swallowed exactly as `runCatching` does, and the announcement says how many landed and which chat refused, with the chat's own name.

The selection bar is the phone's: back, count, **Copy** (TEXT rows only, `
`-joined *decrypted* bodies), **Forward**, **Edit** (single, own, inside the 60-second window) and **one Delete** whose panel asks the scope. `canDeleteForEveryone` is `Ui.kt`'s predicate: never an echo, always your own, never in a group, and for somebody else's row only in a 1:1 with a real person (not a bot). The panel's wording is `Also delete for <display name | username | "everyone">`.

**Delete-for-me is session-only here, and says so.** Android hides the ids in its local store; a browser tab has no local message store and the Worker has no per-message delete-for-me route (`POST /api/conversations/:id/hide` is a whole-chat watermark), so the rows hide in memory, play the same vanish show, and the announcement states that they come back on a reload.

## Native-only gaps that are disclosed rather than faked

| Android behaviour | Browser reality | How it surfaces |
|---|---|---|
| `FLAG_SECURE` screenshot/recording block | Impossible in a page | `CAPABILITY_COPY.captureWarning` in *Privacy notes* |
| Media sealed end-to-end | Not implemented server-side | `CAPABILITY_COPY.mediaNotEncrypted` in *Privacy notes* |
| Photo/video/document attach | Live (slice D) | Gallery, Camera, Video and Document tiles with a real file input |
| Voice note recording + playback | Live (slice E2) | Real `MediaRecorder`; `CAPABILITY_COPY.voiceRecorderNotice` names the container, the 100 MB cap, the one-second floor and Safari's missing Pause |
| Location / Contact share | Not possible in a browser | Tiles disabled, each with an `sr-only` reason read by `aria-describedby` |
| Full-screen viewer, shared media, view-once | Live (slice E1) | Viewer, gallery and one-opening flow; Forward is a labelled, disabled row in the viewer, not a stub that pretends |
| Document preview | Live (slice E2), with substitutions | `CAPABILITY_COPY.documentPreviewNotice` and a per-kind notice in the reader: HTML/SVG/Markdown as source only, TIFF and archives download-only |
| Delete for me (durable) | Not possible in a browser | The hide is in-memory and the announcement says the rows return on a reload |
| Full emoji reaction picker | Later slice | Only the six wired quick reactions are offered |
| Drafts in app storage | Needs IndexedDB | When unavailable, a `role="status"` banner says drafts live in memory only |

`Add call`, Poll, Event and AI image tiles remain **verified placeholders**: they are not built as live features.

## Chat surface parity (live batch 2)

The chat surface follows the phone's `ChatScreen.kt` layout, and every string
follows one rule: **what the phone says, verbatim** — English-only copy, no
invented emojis, no extra explanation lines.

- **Header** keeps only back, avatar, title and the phone's subtitle
  (`online`, `last seen …`, `typing…`, `N members`, `Official account`), plus
  one ⋮ button. Connection state lives in the list footer, not the header.
- **⋮ sheet** (`web/src/messaging/ChatMenu.tsx`) holds everything the phone's
  overflow menu holds that the browser can do: *Media, links, and docs*
  (*Group Media* in groups), *Mute…* (Calls + Messages toggles), *Chat
  privacy* (screenshots, recording, save media, read receipts), *Chat theme*,
  *Privacy notes*, *Block/Unblock*, *Delete chat* (two-step). Groups get
  *Mute…*, *Chat theme* and *Leave group*. A non-owner group's theme view
  shows the owner-lock notice instead of the picker. Not possible on the Web
  (Scheduled, New group, View contact, Search in chat, Disappearing messages)
  is skipped and disclosed, never stubbed.
- **Bubbles** are phone-sized; the per-message action row and the quick
  reaction bar float over the row's top corners (actions right, reactions
  left) and reserve no space. They take pointer events only on hover or
  keyboard focus, so nothing in the transcript is hover-locked.
- **Ticks** are the app's glyphs at 13 dp: single grey while pending/sent to
  server, double grey when delivered, double `#53BDEB` when read.
- **Previews** (`conversationPreviewText`) mirror Android's
  `ChatPreviewText.kt`: plain category words, `<Category> · View once`, and a
  sealed body previews as its category word — never ciphertext, never a lock.

## Desktop-first interaction rules

- Chat list and open conversation coexist at 1366×768 and 1920×1080; below 720 px the list collapses and a *Back to Chats* link returns.
- Every gesture has a keyboard equivalent: `Enter` sends, `Shift+Enter` newline, `Escape` cancels a reply or an edit, `Tab` reaches every per-message action.
- Per-message action rows are revealed by `:hover` **and** `:focus-within`, and are permanently visible under `prefers-reduced-motion`. No hover-only or unlabeled icon-only control exists.
- Delete uses an inline confirm panel (*Delete for everyone* / *Keep message*), never `window.confirm`; the selection bar's Delete asks the scope in the same panel, and only offers "also delete for …" when the server would accept it.
- The composer's circle is a **microphone** while it is empty and a **Send** button the moment there is text or an attachment. A click arms the recorder panel (no drag needed), `Escape` is never required to reach Send, and the panel's Send / Pause / Delete / View-once are labelled buttons, so the hold gesture has a full keyboard-and-mouse equivalent.
- A voice note's wave is a `role="slider"` with `aria-valuenow`/`aria-valuetext` and Arrow / Home / End keys; the value is always a finite number, never `NaN`.
- Multi-select is reachable two ways (the row's tick and the action row's *Select*), an album ticks as one group, and the bar is a `role="toolbar"` whose count is a live `role="status"`.
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
- `GET /api/files/:key` — Bearer-only, uploader or conversation member. The key contains a slash, so `fileGetPath` encodes segment-wise like Android's `Api.encodePath`; a whole-key `encodeURIComponent` produces `%2f`, which the client's own path guard refuses (and which once made every received photo undownloadable).
- `GET /api/conversations/:id/media` — the shared-media gallery, four newest-first lists, no cursor.
- `GET /api/messages/:id/media` — inline media bytes; **for a view-once row this fetch is the opening**.
- `POST /api/messages/:id/view` — report the single opening; `400 NOT_VIEW_ONCE`, `403 OWN_MESSAGE`, `404`/`410 VIEWED` when it is already gone.
- Ceilings: image 100 MB, video 2 GB, audio 100 MB, other 5 GB. `ALLOWED_MESSAGE_KINDS` is `{TEXT, STICKER, IMAGE, FILE}`.
- Voice meta is normalised on the way in: `meta.voice`, `seconds` clamped 0…600, `waveform` at most `VOICE_WAVEFORM_MAX` (64) integers rounded and clamped 0…100; `clientId` is optional server-side and copied into `meta.clientId`.
- **`viewOnceFlag` reads the flag from `meta`** (`meta.viewOnce !== true` returns false), so a client that sends only the top-level `viewOnce` stores an ordinary row. Android sends it in both places; so does this client — a voice note that omitted `meta.viewOnce` would have been a once note nobody enforced.
- A `fileKey` belonging to somebody else's view-once message is refused for reuse: `403 VIEW_ONCE` ("This was sent as view once."), which is what makes forwarding a spent once-row impossible from a modified client too.

No endpoint was invented for these increments. The only Worker change in slice E2 is the one-line `audio/webm` addition to `SAFE_MEDIA_TYPES` (PR #85, reviewed on its own); nothing else in the Worker, the Android client or `public/` moved.

## Tests

| Suite | Command | Covers |
|---|---|---|
| `test/cases/55-web-messaging-e2ee.mjs` | `npm test` | 43 checks. Seals with an independent `node:crypto`/OpenSSL reference and opens in the client, and vice versa; KP2 blob via `pbkdf2(200 000)`; send-policy refusals; `HKDF_INFO` and iteration count pinned |
| `test/cases/56-web-messaging-protocol.mjs` | `npm test` | 99 checks. Hostile payload parsing, previews, ticks, reducers, socket frames with a fake WebSocket and fake scheduler (open/frame/heartbeat/backoff 2500→5000/explicit close), outbox state machine, draft caps, copy catalogs |
| `test/cases/57-web-media-attachments.mjs` | `npm test` | 238 checks. Every ceiling and `mediaLimitFor` branch against `src/shared/constants.ts`; the served-type list parsed back out of the Worker's own source; `planUpload`/`splitParts` coverage-exactness; `meta` parity with `ChatScreen.kt`; the sticker catalog re-derived from `StickerSheet.kt` and compared glyph-by-glyph; edit geometry and layer reducers; `fileGetPath` and the path guard |
| `test/cases/59-web-voice-notes.mjs` | `npm test` | 146 checks. `SAMPLE_MS`/`BARS`/`MAX_BARS`/`LIVE_BARS`/`LIVE_CEIL` parsed out of `VoiceNote.kt` and compared with `voice.ts`; the golden `pseudo` pattern for `msg_1` and Java's `hashCode("abc")`; `squash`/`live`/`sanitize` behaviour including silence and over-long input; `VoiceHoldGesture.decide` branch for branch plus the desktop arms; the per-message speed cycle; the `%d:%02d` clock at every point on the dial; paused-clock arithmetic; `Api.VOICE_MAX` and the Worker's 600 s clamp; `fileLooksVoice` before `fileLooksVideo`; which fetch spends a view-once note for reader and sender; the 3 s typing ping against the Worker's lease and `typing.kind`; and the disclosed recorder copy |
| `test/cases/60-web-forward-docs.mjs` | `npm test` | 178 checks. `privatePeer || privateGroup` out of `KpSecure.kt`/`ChatScreen.kt`; the five forward gates and their reasons; `forwardMessageTo`'s four branches in source order with its `ifBlank` fallbacks and the `photo.jpg`/`image/jpeg` re-upload; the meta a copy carries; one fresh album id per target, validated against the Worker's own `ALBUM_ID_RE`; the re-seal rule and the documented plaintext-fallback divergence; `ForwardDialog`'s title and subtitle; the selection bar's Copy/Edit/Unsend/Delete rules with `canEdit`'s 60 s window; `Ui.kt`'s `canDeleteForEveryone` and both delete labels; `DocViewerScreen.kt`'s 400 000-byte cap, its truncation line, `(empty file)`, the whole `docKind` branch order, the ZIP-shaped exceptions and the magic bytes; `Files.kt`'s `mimeFor` and `displaySize` against the composer's `formatBytes`; and the disclosed reader copy |
| `test/cases/58-web-media-viewers.mjs` | `npm test` | 127 checks. The gallery's four lists, tab labels, title and empty states parsed out of `ChatMediaScreen.kt`; the Worker's link regex compared sample-by-sample with `firstLink`; `ONCE_TEXT_REVEAL_MS` and the four quote labels out of `ChatScreen.kt`; zoom/pan constants out of `MediaViewer.kt`; which fetch spends an opening; the spend de-dupe with terminal 404/410; `VANISHED` handling; album folding; and the send-side view-once gate |
| `web/e2e-messaging/voice.spec.ts` | `npm run test:web:messaging:e2e` | 13 Chromium tests with a **real fake microphone** (`--use-fake-device-for-media-stream` + `--use-file-for-fake-audio-capture` of a generated WAV), so `MediaRecorder` produces genuine webm/opus bytes: a note drawn from `meta.waveform` with no fetch, play → one bearer-authenticated fetch → pause holding its position, per-message speed cycling, the wave as a keyboard slider, a view-once note that cannot be seeked and whose single opening is the play (then a second report is de-duplicated and a `VANISHED` frame removes the row), the sender's own preview spending nothing, tap-to-lock → Send posting a real note with `meta.voice`/`seconds`/`waveform`/`clientId`, the under-one-second take thrown away with a spoken reason, Delete discarding without a post, Pause freezing clock and wave, view-once arming reaching both `viewOnce` and `meta.viewOnce`, and the disclosed recorder copy |
| `web/e2e-messaging/docs.spec.ts` | `npm run test:web:messaging:e2e` | 10 Chromium tests: a document row whose bytes do not move until Preview is pressed, a text document shown whole and selectable, Save as a real blob download, a PDF in a sandboxed frame (with the no-viewer branch), an SVG whose markup stays text and whose `<script>` never runs (asserted with a `dialog` listener), TIFF and ZIP as honest cards with their notices, forwarding a document by reusing its key, deleting your own document through an inline confirm, closing and Escape, and the disclosed reader copy |
| `web/e2e-messaging/forward.spec.ts` | `npm run test:web:messaging:e2e` | 14 Chromium tests: Select replacing the composer and Back restoring it, an album ticking as one group, Copy putting the **decrypted** bodies on the clipboard, no Copy without a text row, a sealed message re-sealed for a 1:1 and posted as readable text to a group, two photos grouped with one album id per target, a view-once refusal on both the row and the bar, a private chat refusing everything, Edit's single-own-in-window rule, Delete asking the scope and really calling `DELETE /api/messages/:id`, hiding for me asking nothing of the server and returning on reload, a group never offering the other side's rows, labelled bar controls, and the r71-18 save-permission gate across the row, the viewer's Save and its Forward |
| `web/e2e-messaging/viewer.spec.ts` | `npm run test:web:messaging:e2e` | 12 Chromium tests: the three tabs with real download and link anchors, a private group's refusal, the phone's empty states, keyboard zoom inside the 1×…6× clamp, album paging with zoom-reset, a blurred view-once photo that reports exactly once, a view-once clip that fetches nothing until opened, a VANISHED frame removing its row, a five-second text reveal, Save/Forward/Delete chrome, and axe on both surfaces |
| `web/e2e-messaging/attachments.spec.ts` | `npm run test:web:messaging:e2e` | 13 Chromium tests with **real PNG bytes** (so decode → shrink → JPEG re-encode actually runs): 2048 px long edge and JPEG magic, sealed caption vs readable metadata, shared album id, document bytes preserved, "send as a document", editor rotation reaching the upload, chip removal, a sticker send that uploads nothing, a bearer-authenticated media download, a one-way account that cannot attach, axe on the sheet/picker/editor, and the disclosed limits |
| `web/e2e-messaging/messaging.spec.ts` | `npm run test:web:messaging:e2e` | 14 Chromium tests against a mocked Worker and a mocked WebSocket (`page.routeWebSocket`), including a genuinely sealed body the browser must decrypt, the outgoing envelope reopened from the peer's key, hidden-chat exclusion, draft survival across reload, keyboard actions, live frames, a signed-out shell that makes zero conversation requests, axe WCAG 2.1/2.2 A/AA on both panes, and a 390×844 layout check |

Honest test scope: Chromium only, synthetic events, mocked Worker and mocked sockets. This is **not** physical-device, cross-browser, real Worker↔Web↔Android or load QA. The real cross-client path is still proven by the existing Worker contract cases.

`npm run ci` runs all six contract-suite groups plus `check:web-stickers`: **60/60 cases, 2 981 assertions**, and **94 browser tests** (shell 8 + account 10 + messaging 76). GitHub Actions runs the sticker-catalog check and the shell, account and messaging browser suites as separate steps; each builds with its own flags.

Bundle shape after slice E2, with every heavy surface lazy-loaded: entry `index.js` 289.30 kB (gzip 88.77), `MessagingWorkspace` 108.57 kB (33.06), `protocol` 12.80 kB, `PhotoEditor` 12.03 kB, **`DocViewer` 10.48 kB (3.94)**, `StickerPicker` 10.27 kB, `MediaViewer` 7.36 kB (2.56), `MediaGallery` 4.51 kB (1.58), `uploadContract` 3.44 kB, **`ForwardDialog` 2.42 kB (1.02)**, `viewOnce` 0.88 kB, `filesApi` 2.52 kB, CSS 25.78 kB + 37.68 kB, `sw.js` with 15 precached files.

The reader and the picker are lazy, so opening a chat still costs what it did before: slice E2 added **0.55 kB** to the entry bundle. `MessagingWorkspace` grew 34.5 kB because the recorder, the player, the waveform maths and the forward rules all live in the chat pane's own chunk — none of it is loaded by the shell, the account pages or the production PWA in `public/`.

## Known follow-ups (F–I)

Statuses, calls (the feature flag stays default-off), Web Push (needs a VAPID design) and the hardening pass. See `docs/web-parity-rebuild-roadmap.md`.

Smaller things slice E2 deliberately left alone, so they are written down rather than discovered:

- `MediaGallery`'s own download links still resolve their bytes when the panel renders, the way document rows used to. The transcript's are lazy now; the gallery's should follow the same rule.
- A full emoji reaction picker (only the six wired quick reactions are offered).
- Durable drafts: IndexedDB when it is available, with the `role="status"` banner when it is not.
- Voice notes are recorded in whatever container the browser has. A `.webm` note plays in Chrome, Firefox and Edge; Safari plays an `.m4a` from a phone. Neither client transcodes, and the notice says which container this browser produced.
