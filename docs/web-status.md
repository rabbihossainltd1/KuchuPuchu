# Web statuses (P3 slice F)

24-hour stories in a browser: the feed, the two composers, the full-screen
viewer with the phone's clock, the viewers sheet and the reply — against the
same Worker the phones use, with no Worker route added and no Android line
changed.

Everything here is read out of the source that owns the rule, and pinned again
by `test/cases/61-web-statuses.mjs` (217 checks) and
`web/e2e-status/status.spec.ts` (23 Chromium tests). Where a browser genuinely
cannot do what a phone does, the surface says so in words instead of drawing a
control that does nothing.

## Turning it on

```
VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_STATUSES=true npm run build:web
```

Three separate rollout flags: `statuses` gates the whole subtree (the workspace
is a lazy chunk, so a flag-off build never downloads or parses it), and it
requires a verified session exactly like the chat list does. A status feed is
other people's pictures; a reply is a sealed 1:1 message. Neither may exist
behind an anonymous tab.

## What is where

| Path | Role |
|---|---|
| `web/src/status/statusModel.ts` | Every number and string, DOM-free: hold durations, tap-zone stepping, the ring geometry, the Dhaka stamps, the gradients, the copy, the hidden-author list, feed parsing and ordering |
| `web/src/status/statusQuote.ts` | The tiny piece the messaging chunk imports: `meta.status` → a quote a chat bubble can draw |
| `web/src/status/statusMedia.ts` | The path guard and the bearer-gated byte fetch for `/api/statuses/:id/media` — the only status import the messaging chunk makes |
| `web/src/status/statusApi.ts` | The six status routes, and nothing invented beyond them |
| `web/src/status/useStatuses.ts` | The controller: the 12 s poll, posting, deleting, reacting, the viewers cache, the sealed reply, photo shrinking |
| `web/src/status/StatusFeed.tsx` | My row, Recent updates, the rings, the two composer buttons, the notices |
| `web/src/status/StatusViewer.tsx` | Full screen: segments, header, tap zones, the clock, the reply bar, the quick reactions, the menu, the confirm |
| `web/src/status/ViewersSheet.tsx` | "Viewed by", with each viewer's reaction |
| `web/src/status/StatusComposer.tsx` | Text on a gradient card, or a photo through the editor / a clip through the uploader |
| `web/src/status/StatusWorkspace.tsx` | The route entry; owns the identity hook and the controller |
| `web/src/status/status.css` | The surfaces' own stylesheet |

The reply quote lands in `web/src/messaging/protocol.ts` (`statusQuote` on
`MessageRow`) and is drawn by `web/src/messaging/ChatPane.tsx` above the reply
quote, in the same order the phone draws them.

## The rules this slice copies

### The feed

- Mine first, then contacts ordered **newest update first** — a client-side
  sort, because the server groups per author in author order and a contact who
  just posted would otherwise stay where their row already was.
- One ring segment per status; the ring is dark blue until every status of that
  author has been viewed, then gray (`StatusRingAvatar`). The geometry is the
  Canvas maths reproduced as SVG arcs: 2.5 dp stroke, a 5 dp gap between
  segments, none at all when there is one, starting at twelve o'clock.
- Hidden authors ("Hide status" in the viewer's menu) are a **local, persisted**
  list in `localStorage["kp.status.hidden"]`, applied while parsing so a hidden
  author never reaches a count, a ring or a byte fetch. The notice says the list
  belongs to this browser: the phone keeps its own.
- Nothing is fetched to draw the list — the feed carries no media bytes at all.

### The viewer clock

- A photo or a text card holds **5 000 ms**; a clip holds its own length inside
  5…120 s; a clip whose length never arrived holds 30 000 ms; and a stalled clip
  still advances `hold + 8 000 ms` later, so a broken player is not a stuck
  viewer.
- The clock ticks every 50 ms and **skips** ticks while paused. The pause set is
  the phone's: the viewers sheet up, the menu up, the reply field focused, a
  finger holding the picture — plus the browser's half of "not foreground",
  `document.visibilityState !== "visible"`. A viewer left in a background tab
  must not come back to a slideshow that ran on without them.
- Elapsed time lives in a ref, so a pause that restarts the interval does not
  rewind the bar.
- The halves of the picture step back and forward (`stepStatus`: back on the
  first stays put; forward off the last **closes** the viewer, as the phone pops
  the screen). Arrow keys do the same; a hold on a half pauses; `Escape` closes.
- One `/view` ping per status id per page, and never for your own statuses —
  the phone's `if (!isMine)`.
- A clip drives its own bar from the element's `currentTime / duration`, and the
  viewer advances on `ended`.

### What a browser cannot do, said out loud

- **No trim, no re-encode.** The phone's status editor cuts and re-encodes video
  (`VideoExport`); a browser posts the clip whole and the server caps the
  seconds it stores at 120. The chooser and the facts line both say so.
- **A clip that will not decode is not shown as a black rectangle.** The
  element's own error flips the surface to "That clip could not be loaded." —
  the same line a 404 gets.
- **A photo is shrunk in the browser** down a four-step ladder (1280/1080/900/720
  long edge) until its data URL fits the Worker's 450 000-character inline cap;
  one that never fits is uploaded and posted by `fileKey`, which the same Worker
  handler accepts. The ladder only ever goes down, so a status photo is never
  upscaled.
- **HTML is not in this feature at all** — statuses are text, image or video,
  and an inline photo is a data URL the Worker has already checked against
  `SAFE_DATA_URL`.
- **Report has no route** on the Worker; the phone's is an acknowledgement
  toast, and so is this one. Inventing an endpoint would be a lie in the other
  direction.

### The reply and the reaction

- A reply is an ordinary 1:1 message: `POST /api/conversations {userId}` first
  (idempotent server-side), then the message with `meta.status = { id }`, which
  the Worker expands to `{id, kind, text}` and both clients draw as a quote.
  The box clears the moment Send is pressed; only a failure speaks up; and
  releasing the field is what un-pauses the clock.
- The reply body is **sealed to the author's key** with the same
  `protectOutgoingBody` the chat composer uses — a personal chat's text never
  leaves plaintext — or refused with `SECURE_CHAT_WAITING` when the identity is
  locked.
- The seven quick reactions (`❤️ 😂  😢 🙏 🔥 👍`, in the phone's order) post
  to `/api/statuses/:id/react` and land on the viewer's own view row. They never
  create a chat message. The client checks the Worker's emoji-only rule before
  spending a request, because that rule exists after `<script>alert(1)` once
  reached an owner's viewer list.

### Delete, hide, viewers

- Deleting your own status asks first ("Delete status?" / "Removed for
  everyone." / "Delete"), leaves the viewer immediately and deletes behind the
  network — waiting for the API let a second click double-fire on the phone and
  index into a shrunken list.
- The viewers sheet paints its cached list at once and refreshes behind it; only
  a first-ever load spins and only a first-ever failure shows the error line.
  The count beside the eye is `max(feed count, fetched list)`.

## Wire contract

`GET /api/statuses` (feed: my group with per-status `viewers`, then contacts
with `allViewed`, blocks applied in both directions, the author's
`priv_status` applied by `statusVisibleTo`); `POST /api/statuses`
(`{kind, text?, bgStyle?, imageData?, fileKey?, seconds?}` with the 500-char
text slice, the 450 000-char inline cap and the 0…120 seconds clamp);
`GET /api/statuses/:id/media` (member-checked like a file, `video/mp4` for a
clip and `image/jpeg` otherwise); `POST /api/statuses/:id/view` (silently
ignored when not allowed); `POST /api/statuses/:id/react` (`BAD_REACTION`,
`Can't react to your own status.`); `GET /api/statuses/:id/viewers` (owner
only); `DELETE /api/statuses/:id` (owner only, views and orphaned media
collected). Nothing else is called.

## Known divergences, recorded not hidden

- The phone's **viewer** gradient map has five entries; `ink` statuses fall back
  to amber there. This client draws all six it offers.
- The phone draws status photos from a cached avatar/bytes pipeline; this client
  renders an author's photo only when the feed hands it an inline image, and
  initials otherwise — the same rule the rest of the web app already follows.
- A status photo here may be posted by `fileKey` when it is too large for an
  inline data URL; the phone always posts inline. Both shapes are accepted by
  the same Worker field.

## Tests

| Suite | Command | Covers |
|---|---|---|
| `test/cases/61-web-statuses.mjs` | `npm test` | 217 checks against `StatusScreens.kt`, `StatusPickScreen.kt`, `MediaEditScreen.kt`, `Ui.kt`, `Theme.kt`, `ScreenStore.kt` and `src/worker/index.ts`: every cap and clamp, the pause set, the tap-zone and close rules, the ring geometry and colours, the stamps in Dhaka time, the gradients (including the phone viewer's missing `ink`), the seven reactions, the viewers-cache and hidden-list rules, the delete/hide/report wording, the sealed-reply path, and the wiring (flag, lazy chunk, session requirement, `status:` media prefix) |
| `web/e2e-status/status.spec.ts` | `npm run test:web:status:e2e` | 23 Chromium tests against a mocked Worker: the feed's words and order, ring segments and the gray rule, the five-second clock advancing on its own, one `/view` per status and none for your own, stepping with pointer and keyboard and closing off the end, hold / sheet / labelled-pause all freezing the bar, a reply that is sealed for the author and opens back to the typed words with `meta.status` intact, reactions that post and never message, the viewers sheet and its chat-opening rows, a photo fetched from the status route with the session header, an undecodable clip saying so, delete with its confirm, hide surviving a reload, both composers' POST shapes (an inline JPEG under the cap, an uploaded clip with its seconds), the disclosed notices, the empty and failing feeds, and axe WCAG 2.1/2.2 A/AA on the feed and the viewer |

Honest scope: Chromium, synthetic events, a mocked Worker. The suite's clip
bytes are deliberately not a decodable video, which is what makes the honest
failure path testable at all; real clips are exercised by the messaging suite.

Bundle shape after slice F: entry `index.js` 291.43 kB (gzip 89.38) — the entry
grows only by the lazy import and the banner words — with `StatusWorkspace`
39.25 kB (12.17) and its stylesheet 12.09 kB as their own chunk, `sw.js`
precaching 18 files. The messaging chunk grew by 0.56 kB for the status quote,
because `statusQuote.ts` and `statusMedia.ts` are the only status code it
imports.
