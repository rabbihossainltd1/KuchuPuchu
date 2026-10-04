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

### ইচ্ছাকৃতভাবে বাদ / placeholder (কাজ হবে না)

`Add call`, Poll, Event, AI images — Android-এও "coming in a future update"।
Private-group "call recording" — code-এ user-facing recorder পাওয়া যায়নি, তাই "verify" মার্কায় থাকবে।
SIM verification, `FLAG_SECURE` screenshot block, native audio route, full phonebook sync, guaranteed
background call survival — browser-এ অসম্ভব; UI-তে সৎভাবে সীমা দেখানো হবে (plan §৬)।

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

- Group video call-এর measured participant cap / SFU সিদ্ধান্ত (Slice G-এর আগে)।
- Web Push-এর VAPID key + subscription schema (Slice H-এর আগে)।
- নতুন `web/` অ্যাপ কখন production cutover হবে — `public/` প্রতিস্থাপন নাকি আলাদা path-এ parallel।
- Long-lived session token WS query-তে রাখা বনাম short-lived ticket route (plan §৭.২)।
