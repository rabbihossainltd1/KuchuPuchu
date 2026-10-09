# Web parity rebuild roadmap (২০২৬-১০-০৪)

`docs/android-web-parity-plan.md`-এর যাচাই করা অবস্থা থেকে তৈরি। ভিত্তি: `main` @ `f93f8ebf`
(PR #72–#79 merge-এর পর), যেখানে P0 plan + P1 Web foundation + P2 account/navigation আছে।

## কেন এই নথি

২০২৬-১০-০৩-এর implementation slice-গুলো (P3 messaging, P4 media/editor/view-once/voice/shared-media,
P5 calls) কোনোদিন push হয়নি — `feat/web-full-parity` branch remote-এ নেই, শেষ push ছিল
২০২৬-১০-০২ ১০:৫৭ UTC। ওই কাজের কোড হারিয়েছে, কিন্তু পূর্ণ নকশা parity plan-এর §৮-এ টিকে আছে।
তাই এটি rebuild — নতুন করে আবিষ্কার নয়।

## হাতে যা সম্পদ আছে (আবার শূন্য থেকে শুরু করতে হবে না)

| সম্পদ | কোথায় | কী কাজে লাগবে |
| --- | --- | --- |
| **byte-for-byte verified KP1 E2EE port** | `public/app.js` (লাইন ~২৯–২৫০): P-256 ECDH → HKDF-SHA256 → AES-256-GCM, `KP1.`/`KP2.` envelope, roaming backup adopt/unlock | Slice B-তে সরাসরি React module-এ পোর্ট করা যাবে; নতুন করে crypto লিখতে হবে না |
| **চালু production Web client** | `public/app.js` ১,৬৩৯ লাইন — chat list, 1:1/group chat, text + photo send, `/ws/user` + `/ws/chat/:id` realtime, ticks, typing, day separator | Slice A/B-এর আচরণগত রেফারেন্স ও API contract-এর জীবন্ত উদাহরণ |
| **নতুন React foundation** | `web/src/` ৩,১৯৯ লাইন — nav rail, typed router + deep link, `api.ts` (same-origin + offline state), feature flags, versioned SW, auth (phone/OTP/approval/Google), account settings | এটাই নতুন কাজের ভিত; `public/` অপরিবর্তিত থাকবে যতদিন না cutover অনুমোদিত |
| **Worker backend** | `src/worker/index.ts` ১২,৮৭২ লাইন — auth, conversations, messages, files (single ≤25 MB + MPU 8 MB), statuses, calls, AI, search, push-ack; DO `/ws/user`, `/ws/chat/:id`, `/ws/call/:id` | বেশিরভাগ slice-এ নতুন endpoint লাগবে না; contract test আগে পড়ে নিতে হবে |
| **Test harness** | `test/cases/01–54` (2,141 assertion), `test/d1shim.mjs`, Playwright (`web/e2e/shell.spec.ts` ৮, `web/e2e-account/account.spec.ts` ১০) | প্রতিটি slice-এ নতুন case + spec যোগ হবে |
| **হারানো কাজের spec** | parity plan §৮ + §৩ matrix + §৫ gesture mapping + §৬ capability boundary | প্রতিটি slice-এর acceptance criteria এখান থেকে নেওয়া হবে |

## সিদ্ধান্ত: slice ক্রম

নির্ভরতা, ঝুঁকি আর ব্যবহারকারীর কাছে দৃশ্যমান মূল্য — এই তিনটে বিবেচনায় ক্রম ঠিক করা হয়েছে।
plan-এর নিজের gate মেনে চলা হচ্ছে: _"do not add media until message contract stable"_।

| # | Slice | কী বানানো হবে | Exit gate |
| --- | --- | --- | --- |
| **A** | Conversation list + chat shell | `/api/conversations` থেকে chat list pane (avatar/name/preview/time/unread/ticks/muted/group), desktop 3-pane wiring, `conversation` route-এ সত্যিকারের chat pane খোলা, `/ws/user` live list update, loading/empty/error/offline state | list route E2E + contract case; 390/768/1366/1920 responsive; keyboard nav |
| **B** | Messaging core | history pagination (`created_at+rowid` cursor), `/ws/chat/:id` realtime + reconnect/resync, text send with optimistic echo + stable `clientId`, **KP1 E2EE `public/app.js` থেকে পোর্ট**, roaming backup adopt/KP2 unlock, read/typing/delivered marker | Android↔Web E2EE vector test; duplicate-submit test; refusal → draft |
| **C** | Message actions + durability | reply/quote, reactions, edit, copy, message info, delete (for me/everyone), forward + multi-select, IndexedDB drafts + outbox (retry/backoff/cancel), scheduled, disappearing, mute/block wall | idempotent send test; offline outbox test; chat switch/tab close-এ draft হারায় না |
| **D** | Attachments + photo editor | attach sheet (photo/video/document/camera-gated/location/contact), multi-file picker + drag/drop, single/chunked upload + progress/cancel, photo editor (crop preset + manual reposition, rotate, filter, pen, text, ৮ pack/১,১৫০ glyph sticker, undo/redo, Standard/HD export) | sticker catalog contract (native Kotlin list-এর সঙ্গে exact compare); pre-Send zero upload; export dimension/byte-target test |
| **E** | Viewers + media surfaces | photo/video viewer (paging/zoom/pan/pinch/double-tap/swipe-down), shared media gallery (Photos/Videos/Files/Links + cursor pagination), view-once (text/photo/video/voice, one-open `no-store`), voice note (MediaRecorder), raw-text document preview | view-once no-prefetch/one-open test; Worker media cursor pagination test |
| **F** | Status | feed, composer (text/photo/video), viewer (segmented timer, next/prev, pause, reply, reaction, views), privacy | hidden-tab timer pause test; owner-only delete; audience preview |
| **G** | Calls (flag-gated) | calls tab/history, 1:1 WebRTC audio/video, incoming/return overlay, mute/camera/end, audio-output selector (`setSinkId` gated), screen share | flag default-off থাকবে; permission-denied path; **group call তখনই যখন measured participant cap আছে** |
| **H** | Web Push | VAPID subscription schema, Worker delivery pipeline, SW click routing, settings opt-in/revoke | আলাদা backend design + test দরকার (plan §১১.২); private plaintext payload নয় |
| **I** | Hardening (P6) | theme picker, motion/`prefers-reduced-motion`, contrast/axe, CSP/XSS review, IDB quota + logout isolation, bundle optimization | 4 breakpoint × theme screenshot matrix; security review |

### অগ্রগতি

| Slice | অবস্থা | কোথায় |
| --- | --- | --- |
| **A** conversation list + chat shell | ✅ merged | PR #82 → `main` @ `d168a913` |
| **B** messaging core + KP1 E2EE | ✅ merged | PR #82 → `main` @ `d168a913` |
| **C** message actions + durability | ✅ merged | PR #82 → `main` @ `d168a913` |
| **D** attachments + photo editor | ✅ merged | PR #83 → `main` @ `d0a44ae0` |
| **E1** viewers + shared media + view-once + albums | ✅ merged | PR #84 → `main` @ `de54086` |
| **E2** voice note + document preview + forward + multi-select | ✅ merged | PR #86 → `main` @ `aaa206d` |
| **F** status (feed + composer + viewer + privacy) | ✅ merged | PR #87 → `main` @ `88dec89` |
| **G** calls (flag-gated 1:1) | ✅ merged | PR #88 → `main` @ `375be10e` |
| **H** Web Push (VAPID doorbell) | ✅ merged | PR #89 → `main` @ `e5ee47a` |
| hotfix — legacy web empty list (`{items}` + SW cache bump) | ✅ merged | PR #90 → `main` @ `eab68c3` |
| **I** hardening (themes, motion, a11y, CSP, IDB) | ✅ merged | PR #91 → `main` @ `1af2694` |

| **J** production cutover (React PWA at /) | ✅ merged | PR #92+#93 (parallel session), integration PR #94 → `main` @ `958dff9` |
| **K** production statuses on | ✅ merged | PR #95 → `main` @ `41cfa971492be11750a0f356fb53572fc04df45b` |
| **O** WS socket tickets (plan §7.2) | ✅ merged | PR #96 → `main` @ `892714df4831ef3bcae0554292a720ce89254159` |
| **P** production web-push on | ✅ merged | PR #97 → `main` @ `433adb652d44197d848127b105ed5b240a485bda` |
| **Q** production calls on (owner-approved) | ✅ built | এই branch; নিচের হিসাব |

**Slice D-তে যা নামলো** (Worker বা Android-এ একটি লাইনও বদলায়নি):

- `web/src/media/` — `uploadContract.ts` (সব ceiling/plan/meta নিয়ম, DOM ছাড়া), `imageEdit.ts` + `renderEdits.ts` (editor geometry আর canvas bake), `stickerPacks.ts` (**GENERATED**, `npm run generate:web-stickers`), `StickerPicker.tsx`, `PhotoEditor.tsx`।
- `web/src/messaging/` — `filesApi.ts` (single + multipart upload, download), `attachments.ts` (pick → prepare → send pipeline), `mediaUrl.ts` (bearer-gated bytes → object URL, bounded cache), `AttachMenu.tsx`, `AttachmentRow.tsx`; `ChatPane.tsx` আর `useMessaging.ts` সেগুলোতে wired।
- Lazy chunks: `MessagingWorkspace`, `PhotoEditor`, `StickerPicker` আলাদা bundle — entry ৩৩২.৯৪ kB থেকে **২৮৭.৯৫ kB (gzip ৮৮.৩২)**, অর্থাৎ messaging চালুর আগের baseline-এরও কম।
- Gates: contract **৫৭/৫৭ case, ২৫২১ assertion** (নতুন case 57 = ২৩৮ check), browser **৪৪ test** (shell ৮ + account ১০ + messaging ২৬), `npm run ci` EXIT=0, `check:web-stickers` CI step-এ যোগ, service worker ৭টা precached file।
- E2E-তে ধরা পড়া আসল bug: `fetchFileBlob` পুরো key-কে `encodeURIComponent` করত, ফলে `f/x.jpg` → `f%2Fx.jpg` হতো আর `api.ts`-এর path guard encoded slash refuse করত — অর্থাৎ **production-এ কোনো received ছবি/ভিডিও/ডকুমেন্টই download হতো না**। এখন Android-এর `Api.encodePath`-এর মতো segment-wise encoding + `FILE_KEY_RE` যাচাই (`fileGetPath`)।

**Slice E1-এ যা নামলো** (Worker/Android/`public/` অপরিবর্তিত):

- `web/src/messaging/` — `MediaViewer.tsx` (paging/zoom/pan/drag-to-close/save/delete), `viewerGeometry.ts` (সব সংখ্যা DOM-free, যাতে Kotlin-এর সাথে মেলানো যায়), `MediaGallery.tsx` + `sharedMedia.ts` (Media/Docs/Links), `viewOnce.ts` + `OnceText.tsx` (one-opening নিয়ম), `AttachmentRow.tsx`-এ album grid আর blurred once-card।
- Album folding (`foldAlbums`) — একই `meta.album` + একই sender-এর ছবিগুলো এক bubble-এ, Android-এর মতো; viewer পুরো group-এর মধ্যে page করে।
- View once: কোন fetch-টা opening spend করে সেটা আলাদা করে দেখা — inline `IMAGE` ⇒ `GET /api/messages/:id/media` (fetch-ই opening), uploaded `FILE` ⇒ `/api/files/:key` (spend করে না, তাই ফোনের মতো blur করে দেখানো যায়) + `POST /view` রিপোর্ট। 404/410 terminal, বাকি failure পরের viewing-এ আবার রিপোর্ট।
- **আরেকটা আসল bug ধরা পড়লো:** Worker-এর `ALBUM_ID_RE = /^alb_[A-Za-z0-9_-]{4,36}$/` ছাড়া album id **চুপচাপ ফেলে দেয়**, আর web client পাঠাচ্ছিল `album_<ms>` ⇒ multi-photo send ফোনে কখনোই group হতো না, কোথাও কোনো error ছাড়াই। এখন `alb_` + 20 hex (Android-এর `UUID.replace("-","").take(20)`), আর case 57 সেই regex-ই Worker source থেকে parse করে মিলিয়ে দেখে।
- Gates: contract **৫৮/৫৮ case, ২৬৫৪ assertion** (নতুন case 58 = ১২৭ check), browser **৫৭ test** (নতুন `viewer.spec.ts` = ১২), `npm run ci` EXIT=0, SW ১১টা precached file, entry bundle মাত্র +০.৮ kB (২৮৮.৭৫ / gzip ৮৮.৫৮) কারণ viewer-gallery দুটোই lazy।

**Slice E2-তে যা নামলো** (Worker-এ মাত্র একটি লাইন, সেটা আলাদা PR #85-এ; Android/`public/` অপরিবর্তিত):

- Worker (PR #85, আলাদা করে review করা): `SAFE_MEDIA_TYPES`-এ `"audio/webm"` — এটা ছাড়া browser-এর রেকর্ড করা voice note `application/octet-stream` হয়ে যেত, আর `/api/messages/:id/media`-র fallback তাকে `image/jpeg` লেবেল দিত। `uploadContract.ts`-এর mirror-ও একই ক্রমে বদলেছে (case 57 index মিলিয়ে দেখে)।
- `web/src/messaging/` — `voice.ts` (সব সংখ্যা আর waveform-এর অঙ্ক DOM-free: `squash`/`pseudo`/`live`/`sanitize`, hold gesture, clock, mime বেছে নেওয়া), `voiceRecorder.ts` (`MediaRecorder` + `AnalyserNode`, pause/resume/cancel, mic refusal-এর ভাষা), `useVoiceRecorder.ts` (hold → release-এ সিদ্ধান্ত, typing ping), `useVoicePlayer.ts` (একটাই player, per-message speed, seek, cache), `VoiceBubble.tsx`, `VoiceRecorderBar.tsx`, `docPreview.ts` (kind/mime/size/notice, সব list Kotlin থেকে মেলানো), `DocViewer.tsx`, `forward.ts` (gate, shape, meta, selection facts, delete scope), `ForwardDialog.tsx`।
- Voice note: ফোনের `VoiceNote.kt`-এর অঙ্ক হুবহু — `BARS 36`, `MAX_BARS 64`, `LIVE_CEIL 20000`, `pseudo`-র LCG আর `0.55f/0.45f/6.4f/0.3f/18f/0.62f` লিটারেলগুলো Float-এ rounding সহ, যাতে একই message id-তে দুই ক্লায়েন্ট একই ছবি আঁকে। Browser পাঠায় `audio/webm` + `voice_<ms>.webm`, ফোন পাঠায় `audio/mp4` + `.m4a` — দুটোই ফোনের `fileLooksVoice`-এ voice bubble হিসেবেই আঁকা হয় (কারণ `.webm` নাম দেখে video ধরার আগে audio type ধরা হয়)।
- View-once voice (r71-19b): **প্রাপক** বাজায় `/api/messages/:id/media` দিয়ে (fetch-ই opening), **প্রেরক** নিজের কপি `/api/files/:key` থেকে শোনে আর কিছু spend করে না; once note-এ seeking নেই।
- Document reader: PDF ⇒ browser-এর নিজের viewer (sandboxed iframe + নতুন tab-এ খোলার লিংক), text/code ⇒ প্রথম ৪০০ KB selectable monospace (ফোনের `ByteArray(400_000)` আর তার truncation লাইনসহ), ছবি/ক্লিপ ⇒ inline, **HTML/SVG/Markdown ⇒ শুধু source, কখনো render নয়**, TIFF/ZIP/RAR/Office ⇒ ফোনের কার্ড + download। Document row-র Download এখন **ক্লিকে fetch করে**, render-এ নয় (আগে চ্যাট খোলার সাথে সাথে সব ডকুমেন্ট ডাউনলোড হতো — গিগাবাইট ফাইলে সেটা বিপদ)।
- Forward + multi-select: gate-এর ক্রম ফোনের মতো (echo ⇒ DELETED ⇒ private chat ⇒ view-once ⇒ r71-18 sender consent), shape-এর ক্রমও (fileKey reuse ⇒ `data:` repost ⇒ hosted media download+re-upload ⇒ TEXT), caption **টার্গেটের key দিয়ে আবার seal** হয় (group/keyless ⇒ plaintext), ২+ ছবি ⇒ **প্রতি টার্গেট চ্যাটে আলাদা নতুন `albumId()`**। Selection bar: back, count, Copy (শুধু TEXT, decrypt করা body), Forward, Edit (single/own/৬০ সেকেন্ড), আর **একটাই Delete** যার প্যানেল scope জিজ্ঞেস করে (`canDeleteForEveryone`, Ui.kt:1009)।
- **আসল bug ধরা পড়লো:** `sendVoice` view-once ফ্ল্যাগটা শুধু top-level-এ পাঠাচ্ছিল, কিন্তু Worker-এর `viewOnceFlag` পড়ে **`meta.viewOnce`** ⇒ view-once ভয়েস নোট আসলে সাধারণ ভয়েস নোট হয়ে যেত, "একবারই খোলা যাবে" কেউ enforce করত না। এখন দুই জায়গাতেই যায় (ফোনের মতো), আর e2e সেটা POST body-তে যাচাই করে।
- **দ্বিতীয় bug:** PR #85-এর আগে browser voice note servable-ই ছিল না।
- Delete-for-me: ফোনের মতো লোকাল hide, কিন্তু browser-এর কোনো local message store নেই ⇒ in-memory, reload-এ ফিরে আসে — UI সেটা **স্পষ্ট ভাষায় বলে দেয়** (Worker-এ per-message delete-for-me endpoint নেই; `/api/conversations/:id/hide` পুরো চ্যাটের watermark)।
- Gates: contract **৬০/৬০ case, ২৯৮১ assertion** (নতুন case 59 = ১৪৬ check, case 60 = ১৭৮), browser **৯৪ test** (shell ৮ + account ১০ + messaging ৭৬; নতুন `voice.spec.ts` ১৩, `docs.spec.ts` ১০, `forward.spec.ts` ১৪ — voice-এ Chromium-এর **আসল fake mic** ব্যবহার হয়েছে, তাই `MediaRecorder` সত্যিই webm/opus বানায়), `npm run ci` EXIT=0, SW ১৫টা precached file, entry +০.৫৫ kB (২৮৯.৩০ / gzip ৮৮.৭৭), নতুন lazy chunk `DocViewer` ১০.৪৮ kB আর `ForwardDialog` ২.৪২ kB।

**Slice F-তে যা নামলো** (Worker/Android/`public/` — একটি লাইনও বদলায়নি):

- `web/src/status/` — `statusModel.ts` (সব সংখ্যা আর copy DOM-free), `statusQuote.ts` + `statusMedia.ts` (messaging chunk-এর একমাত্র দুটো status import, যাতে chat bundle status-এর জন্য ভারী না হয়), `statusApi.ts` (Worker-এর ছয়টা route, নতুন কিছু নয়), `useStatuses.ts`, `StatusFeed.tsx`, `StatusViewer.tsx`, `ViewersSheet.tsx`, `StatusComposer.tsx`, `StatusWorkspace.tsx`, `status.css`।
- Feed: আমার row আগে, তারপর contact-রা **নতুন update আগে** ক্রমে (সার্ভার author ক্রমে দেয়, sort টা client-এর — StatusScreens.kt:124); ring-এ প্রতি status-এ একটা segment, সব দেখা হয়ে গেলে ধূসর (`StatusRingAvatar`-এর 2.5dp/5dp/বারোটা-几何 SVG arc হিসেবে); hidden author-দের list এই browser-এর নিজের (`localStorage["kp.status.hidden"]`), parse-এর সময়ই বাদ যাতে কোনো count/ring/fetch-এ না ঢোকে।
- Viewer-এর ঘড়ি ফোনের হুবহু: photo/text ৫ সেকেন্ড, clip নিজের দৈর্ঘ্য (5…120 s-এর ভিতরে), দৈর্ঘ্য না এলে ৩০ সেকেন্ড, আটকে গেলে hold+৮ সেকেন্ড পর নিজে থেকে এগোনো; pause-এর পাঁচটা কারণ (viewers sheet, menu, reply focus, hold, আর browser-এর অর্ধেক — `visibilityState`) — background tab-এ ঘড়ি চললে ফিরে এসে দেখা যাবে পুরো list শেষ, ফোন round 27-এ যেটা ঠিক করেছিল সেটাই।
- দুই অর্ধেক tap zone = back/next, শেষটা পেরোলে viewer বন্ধ (ফোনের popBackStack); arrow key, hold-to-pause, Escape, আর একটা label-করা pause বাটন — keyboard-এর হাত ধরে mesmas জিনিস।
- `/view` ping প্রতি status-এ একবার, নিজের status-এ কখনো নয়; reaction-এর সাতটা emoji ফোনের ক্রমে, `meta.status` সহ reply = সাধারণ 1:1 message যা author-এর key দিয়ে **seal** হয় (plaintext কখনো নয়), box পাঠানোর মুহূর্তে খালি হয়।
- Browser যা পারে না তা লিখে বলা: clip trim/re-encode নেই (পুরো ফাইল যায়, সার্ভার 120 s-এ cap করে), decode না হওয়া clip কালো আয়তক্ষেত্র নয় — "That clip could not be loaded."; photo browser-এ চার ধাপের ladder-এ ছোট হয় Worker-এর 450 000 char inline cap-এ ঢোকা পর্যন্ত, না ঢুকলে upload হয়ে `fileKey` দিয়ে যায়; Report-এর কোনো route নেই, ফোনের মতো স্বীকৃতি toast।
- Delete নিজেরটা: confirm sheet ("Delete status?" / "Removed for everyone."), viewer সাথে সাথে বন্ধ, network পেছনে (ডাবল-ক্লিক crash-এর ফোনের fix); viewers sheet cache থেকে সাথে সাথে আঁকে, পেছনে refresh; eye-এর পাশের সংখ্যা = feed আর list-এর বড়টা।
- Chat-এ status reply-এর quote: `MessageRow.statusQuote` + ChatPane-এ reply quote-এর উপরে, ফোনের ক্রমে।
- Gates: contract **৬১/৬১ case, ৩১৯৮ assertion** (নতুন case 61 = ২১৭ check), browser **১১৭ test** (shell ৮ + account ১০ + messaging ৭৬ + status ২৩), `npm run ci` EXIT=0, SW ১৮টা precached file, entry ২৯১.৪৩ kB (gzip ৮৯.৩৮) — StatusWorkspace ৩৯.২৫ kB আলাদা lazy chunk, messaging chunk মাত্র +০.৫৬ kB।

### ইচ্ছাকৃতভাবে বাদ / placeholder (কাজ হবে না)

`Add call`, Poll, Event, AI images — Android-এও "coming in a future update"।
Private-group "call recording" — code-এ user-facing recorder পাওয়া যায়নি, তাই "verify" মার্কায় থাকবে।
SIM verification, `FLAG_SECURE` screenshot block, native audio route, full phonebook sync, guaranteed
background call survival — browser-এ অসম্ভব; UI-তে সৎভাবে সীমা দেখানো হবে (plan §৬)।

## Slice G — Web calls ✅

Flag-gated 1:1 voice/video calls are implemented. Worker contract case 62, WebRTC runtime, ICE fallback, call history, ring controls, safety-code verification, browser limitations, and same-origin API integration are documented in `docs/web-calls.md`. Group calls remain explicitly out of scope. Browser E2E wiring is included in CI; the production `public/` PWA remains unchanged.

## Slice H — Web Push ✅

Flag-gated browser doorbell: VAPID subscriptions, Worker delivery, service-worker click routing and settings opt-in/revoke, documented in `docs/web-push.md`.

- **The privacy gate:** the wire payload is GENERIC — `{"t":"kp.msg"}` / `{"t":"kp.call"}` (+ `"s":1` for a message-muted chat). No text, no names, no conversation id. Contract case 77 decrypts every delivery with the subscription's own P-256 key and fails on anything else.
- **Worker:** `web_push_subs` registry (separate from the FCM `devices` table per plan §7.4), `GET/POST/DELETE /api/push/web`, RFC 8292 ES256 JWT + RFC 8291 `aes128gcm` on SubtleCrypto, fan-out to message (no-live-socket members only), missed call and ringing call, 404/410 + 5xx-streak cleanup, 8-browser cap. Off unless `VAPID_PRIVATE_KEY` is set (503/fail-closed).
- **Web:** `VITE_KP_WEB_PUSH` flag (default off); Account → Notifications card with honest unsupported/denied/best-effort copy; the app-shell service worker (`web/service-worker.template.js`, NOT `public/sw.js`) shows the generic notification and hands the app a `kp-push-nav` message — call knocks land on Calls only in a calls-enabled build.
- Gates: contract **78/78 case** (case 77 = 43 check), browser **6 test** (`test:web:push:e2e`), `verify:web-sw` pins the doorbell copy.

## Slice I — Web hardening ✅

Theme/motion/accessibility/security parity and the production contract-drift
fix. Full review in `docs/web-hardening.md`.

- **Contract drift (production bug):** both web clients and all four E2E mocks
  read/served the removed `conversations` key while the Worker ships
  `{ items, marker }`. Live repro showed 200 + six chats rendering as an empty
  list. Fixed in `protocol.ts`, `public/app.js` (PR #90), and every mock;
  pinned three ways (case 04 server / case 55 legacy / case 78 react+mocks).
- **Global appearance:** Dark Blue (default) + Light Cream, device-local like
  Android's SharedPreferences, applied before first paint via
  `data-kp-theme`. Account → Appearance card.
- **Per-chat themes:** the five Android palettes (darkblue/default/mint/rose/
  night) ported value-for-value from `ChatScreen.kt`, stored via the existing
  `PATCH /api/conversations/:id {theme}`, optimistic with rollback, group
  non-owners get an honest lock. Picker is a labelled radiogroup dropdown.
- **Motion:** all animation rides `--kp-motion-*`; `prefers-reduced-motion`
  zeroes the tokens and the global kill-switch holds.
- **A11y/contrast:** 4-breakpoint × 2-theme screenshot matrix + axe WCAG
  A/AA with zero violations; light muted deepened to `#6B6156` for 4.5:1.
- **CSP/XSS:** meta CSP on the React shell (same-origin + GSI only, no inline
  scripts); origin-coverage pin in case 78; no `innerHTML` in `web/src`.
- **IDB isolation:** any sign-out (manual or 401) deletes `kp-web-messaging`
  (outbox+drafts), best-effort; E2E proves the database is gone.
- Gates: new `test:web:hardening:e2e` (20 tests), case 78 (19 checks), full
  `npm run ci` green. Worker/Android/legacy route code unchanged this slice.

## Slice J — Production cutover ✅

The React PWA (`web/dist`) replaced the legacy `public/` shell at the Worker's
assets root — owner-approved direct replacement. Two parallel sessions shipped
it (PR #92 + headers fix #93 from one, PR #94 integration from the other; the
owner chose the worker-stamped-header mechanism). Full mechanics in
`docs/web-cutover.md`.

- **Build hook:** `wrangler.toml [build] command = "npm run build:web:prod"` —
  `wrangler deploy`/`versions upload` build the web app themselves, so assets
  can never be stale and no dashboard change was needed.
- **Prod flags:** account + messaging on (the legacy surface); calls off
  (standing directive), statuses/media off (separate future decision), push
  off until VAPID is set.
- **Headers:** the worker runs first on every path, delegates non-API paths to
  the `ASSETS` binding and stamps the security headers — CSP with
  `frame-ancestors 'self'` on HTML (slice I's deploy-day promise), nosniff +
  no-referrer everywhere, `no-store` on `/sw.js`. A first attempt used
  `[[assets.rules]]` (silently ignored — live deploy proved it), a second used
  a `_headers` file (PR #93); the integration retired `_headers` for this
  single worker-stamped source of truth (the meta CSP stays only as belt for
  worker-less previews).
- **SW migration:** the new worker deletes retired `kp-shell-*` caches on
  activation (no-skip-waiting policy kept); icon/manifest join the precache
  and rotate the build id; rollback is symmetric (legacy activate deletes
  ours). Existing installs cross over in about one reload.
- **Retirement:** `public/` kept only as fixtures/rollback reference
  (`public/RETIRED.md`); the preview config now serves the same React build
  via the same `[build]` hook, still without production bindings.
- **Folded hardening:** the voice player's `ended` state is now honest
  (paused-at-end, replay on next tap/key — also removed a keyboard-seek race);
  no sourcemaps in any build, so none ship as public assets.
- Gates: case 79 (integration pins), `test:web:cutover:e2e` (3 tests, the only
  suite with service workers allowed, built with the exact prod script), full
  `npm run ci` green; post-merge live `curl -sI` header/shell/health checks.

## Slice K — Production statuses on ✅

The last implemented-but-dark surface goes live: `build:web:prod` gains
`VITE_KP_WEB_STATUSES=true`, so signed-in production users get the phone's
status feed, composers, viewer and privacy controls (slice F, 23-test suite).
Nothing else changes: calls stay default-off (standing directive) and the
`media` flag remains reserved — no code reads it yet, attachments/viewers
already ship inside the messaging surface. Case 79 pins the recipe; docs
updated (`web-feature-flags.md`, `web-cutover.md`).

## Slice O — WS socket tickets (plan §7.2) ✅

The browser stopped putting its long-lived session token in socket URLs:

- Worker: `POST /api/ws/ticket` (header auth, rate-limited) mints an
  HMAC-SHA256 ticket `{aid, exp: now+60s, jti}`; `requireUser` spends it on
  `/ws/*` ONLY — signature, expiry and a UNIQUE `ws_tickets(jti)` ledger make
  it single-use, lazy-purged. Unset `WS_TICKET_KEY` ⇒ 503 fail-closed; the
  legacy `?token=` path stays for rollback/Android parity (case 48 untouched).
- Web: `wsTicket.ts` + `socketTicketUrl()`; the managed socket mints a FRESH
  ticket per dial (incl. reconnects). Messaging, chat and call sockets all
  switched; e2e mocks mint `e2e.ticket`.
- Tests: case 80 drives the REAL worker — mint/spend/replay/tamper/expire/
  REST-boundary/legacy-fallback/purge/no-key, 24 checks.
- Provisioning: `WS_TICKET_KEY` secret uploaded BEFORE merge (otherwise the
  new client would 503-loop on every dial).

## Slice P — Production web-push on ✅

The doorbell goes live. The push feature (slice H) was fully built and tested
but dark, because the server had no VAPID key; the settings card showed the
honest "not configured" line instead of a real opt-in.

- Provisioning: `VAPID_PRIVATE_KEY` secret uploaded to Cloudflare (the worker
  derives the public key from it, so pair can never disagree; fail-closed 503
  if unset).
- Recipe: `build:web:prod` gains `VITE_KP_WEB_PUSH=true`, so the settings card
  now offers a real PushManager subscription. Case 79 pins the flag.
- Nothing else changes: subscriptions stay account-scoped, payloads stay
  generic, and the phone's FCM route is never reused (parity plan §7.4).

## Slice Q — Production calls on ✅

Owner-approved: the 1:1 WebRTC surface (slice G, 45-test suite) goes live.

- Recipe: `build:web:prod` gains `VITE_KP_WEB_CALLS=true`; case 79 pins it.
  The gate's default stays `false` — only the production recipe flips it.
- Server prerequisites were already live: `/api/config/ice` + TURN
  credentials (`TURN_KEY_ID`/`TURN_API_TOKEN` secrets), CallSignal DO,
  `/ws/call/:id` (now opened with a one-time ticket, slice O).
- Honest limits stay documented (`docs/web-calls.md`): no group calls, no
  Telecom/hold, no closed-tab ringing — the UI names them instead of implying
  parity.
- Rollback: one-line recipe revert; the phone and every Worker route are
  untouched either way.

## কাজের নিয়ম (আগের বার যে ভুলটা হয়েছিল)

1. **প্রতিটি slice শেষ হলেই commit + push।** কোনো বড় কাজ কখনও শুধু sandbox-এ রাখা যাবে না।
   আগের session ঠিক এভাবেই এক দিনের সব কাজ হারিয়েছে।
2. **এক PR = এক coherent slice.** Worker contract, Web UI, test আলাদা করে reviewable।
3. **merge-এর আগে `npm run ci` সম্পূর্ণ সবুজ** — 54 contract case + সব Playwright + typecheck + build +
   secret scan + Android validation।
4. **status দাবি যাচাইযোগ্য হতে হবে।** parity plan-এর matrix/§৮ হালনাগাদ করার সময় শুধু সেই অবস্থাই
   লেখা হবে যা কোডে আছে; mock E2E-কে device QA বলা যাবে না।
5. **production অক্ষত।** `public/` PWA, `public/sw.js`, `kp-shell-v1` আর deployed Worker অপরিবর্তিত থাকবে।
   কোনো deploy, APK release বা cutover আলাদা অনুমতি ছাড়া নয়।
6. **session-শেষে `memory.md`-তে append-only entry** — এই প্রজেক্টের প্রচলিত handoff নিয়ম।

## খোলা প্রশ্ন (যেখানে পৌঁছালে সিদ্ধান্ত লাগবে)

- Group video call-এর measured participant cap / SFU সিদ্ধান্ত (future work; Slice G-এর 1:1 scope-এর বাইরে)।
- ~~Web Push-এর VAPID key + subscription schema (Slice H-এর আগে)।~~ সমাধান (Slice H): `VAPID_PRIVATE_KEY` secret থেকে পাবলিক key derive হয়; সাবস্ক্রিপশন `web_push_subs` টেবিলে; `docs/web-push.md`। সিক্রেট লাইভ ডিপ্লয়-তে বসানো হয়েছে আর প্রোডাকশন রেসিপিতে `VITE_KP_WEB_PUSH=true` চালু (স্লাইস পি)।
- ~~নতুন `web/` অ্যাপ কখন production cutover হবে — `public/` প্রতিস্থাপন নাকি আলাদা path-এ parallel।~~ সমাধান (Slice J): মালিক সরাসরি প্রতিস্থাপন অনুমোদন করেছেন; `docs/web-cutover.md`।
- ~~Long-lived session token WS query-তে রাখা বনাম short-lived ticket route~~ — শিপড (স্লাইস ও): ব্রাউজার সকেট এখন ৬০-সেকেন্ডের একবার-ব্যবহারযোগ্য টিকিট নেয়; `?token=` ফলব্যাক অক্ষত।
