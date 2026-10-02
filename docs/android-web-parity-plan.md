# KuchuPuchu Android → Web পূর্ণ parity পরিকল্পনা

> **অবস্থা:** পরিকল্পনা ও source-audit deliverable মাত্র। এই নথি তৈরির সময় Web/Android source edit, build, test, deploy, release বা merge করা হয়নি।
>
> **Audit baseline:** repository `chore/project-bootstrap-v274`, commit `d7928fee7938ffcc8b15fde053a19eeb07a76fc5` (2026-10-02, Asia/Dhaka)। PR #72 merge/deploy/release করার অনুমতি এই কাজের অংশ নয়।
>
> **লক্ষ্য:** Android-এর চালু screen, user flow, controls, media, motion, data/security behavior ও app-level systems Web-এ আনা—বিশেষ করে desktop-এ একটি পূর্ণাঙ্গ, native-app-সদৃশ messenger অভিজ্ঞতা তৈরি করা। এটি Android phone UI-কে desktop-এ সঙ্কুচিত করে বসানো নয়; সব action-এর browser/keyboard সমতুল্য থাকবে।

## ১. কাজের নীতি ও parity-র সংজ্ঞা

1. **প্রথমে inventory, পরে implementation।** নিচের matrix-এ প্রতিটি audited Android surface-এর বর্তমান Web অবস্থা, gap-এর ধরন, প্রস্তাবিত Web আচরণ ও সীমাবদ্ধতা লেখা হয়েছে। কোনো row যাচাই না করে “parity done” বলা যাবে না।
2. **চালু feature বনাম placeholder আলাদা।** Android-এ `Add call` এখন “Adding calls is coming in a future update”; `Poll`, `Event`, `AI images` attach action-ও “Coming in a future update” দেখায়। এগুলোকে চালু feature ধরে Web-এ বানানো হবে না। Web-এও placeholder/coming-soon হিসেবে চিহ্নিত থাকবে—নতুন product scope আলাদাভাবে অনুমোদিত না হলে।
3. **Android-এর API/data contract অক্ষত রাখা।** Worker/D1/R2-কে source of truth রেখে একই origin-এ `/api/*` ও `/ws/*` ব্যবহার করতে হবে। Android client বা পুরোনো Web login/chat ভেঙে দেওয়া যাবে না।
4. **E2EE দাবি সুনির্দিষ্ট।** Web বর্তমানে Android-এর সঙ্গে compatible P-256 ECDH → HKDF-SHA256 → AES-GCM `KP1.` message envelope ব্যবহার করে। বর্তমান scope 1:1 message body; group/AI এবং media bytes-কে E2EE বলা যাবে না। File/photo caption sealed করা, binary media নিজে E2EE করা নয়।
5. **Native-only gap-কে fallback বলে লুকানো নয়।** Browser-এ screenshot block, SIM/phone state, Android foreground service/Telecom, guaranteed full-screen call takeover, FCM action এবং hardware audio route-র সমতুল্য না থাকলে UI-তে তা স্পষ্ট বলা হবে।
6. **Desktop-first, responsive everywhere.** Desktop-এর জন্য side-by-side panes ও keyboard/mouse controls; tablet ও mobile browser-এ responsive navigation। Gesture-only control, hover-only action বা icon-only unlabeled button থাকবে না।

### Matrix status legend

- **আছে** — Web-এ বর্তমান feature আছে।
- **আংশিক** — UI/flow-এর ছোট অংশ আছে, কিন্তু Android-এর feature scope নেই।
- **নেই** — বর্তমান Web client-এ নেই।
- **সীমিত** — browser/OS capability-র কারণে exact parity সম্ভব নয়; Web substitute দরকার।
- **Placeholder** — Android-এও বাস্তব feature চালু নয়; parity backlog নয়।
- **UI gap / API gap / browser gap** আলাদা করে বলা হয়েছে, কারণ Worker endpoint থাকা মানেই Web UI থাকা নয়।

## ২. Audited baseline

### ২.১ বর্তমান Web

- `public/index.html` + `public/app.js` ছোট no-build PWA client; বর্তমান প্রধান screen `login`, `list`, `chat`। CSS-এ dark-blue theme আছে; responsive rule প্রায় কেবল `360px`-এর নিচের login-country picker-এর জন্য—desktop-এর messenger layout নেই।
- বর্তমান flow: phone number → existing account-এর OTP/অন্য signed-in device approval → session; Google recovery; conversation list; text send; photo pick/compress/send; `/ws/user` ও `/ws/chat/:id` real-time update। 1:1 text body browser-এ seal/open হয়; approval card-এ Accept/Decline আছে।
- Web নতুন account বানায় না: Worker `ACCOUNT_CREATED`/`BIND_REQUIRED` দিলে Web “ফোনের app-এ sign up করুন” দেখায়। Android-এর Google bind/profile onboarding Web-এ নেই।
- Photo send এখন এক image, long edge সর্বোচ্চ 2048px-এ JPEG re-encode; caption/editor/HD/multi-select/view-once/scheduled-media/progress UI নেই। `FILE` row কিছু ক্ষেত্রে chip/thumbnail হিসেবে দেখা যায়; পূর্ণ document/media action flow নেই।
- `public/sw.js` shell asset cache করে; API/WS network-only। Web Push subscription/delivery নেই। Offline send-এর persistent outbox নেই।
- Session token, profile/device id ও exported E2EE key pair `localStorage`-এ থাকে। Browser WebSocket header সেট করতে পারে না বলে বর্তমান Web `?token=` ব্যবহার করে; Worker fallback কেবল `/ws/*`-এ অনুমোদিত। REST auth header-only—`test/cases/48-r104-web.mjs` এই সীমা পরীক্ষা করে। Web client-এ session refresh flow এখনও wired নয়, যদিও Worker refresh endpoint আছে।

### ২.২ Hosting/API baseline

- `wrangler.toml` একই Cloudflare Worker/origin থেকে `public/` assets serve করে; `/api/*` ও `/ws/*` Worker-first, বাকি path SPA/static fallback পায়। আলাদা API origin/CORS বাধ্যতামূলক নয়; এই pattern রাখাই সুপারিশ।
- Worker-এ auth, profile/users, contacts match, blocks/reports, conversations/messages, files, statuses, calls, AI, search ও push-ack-এর route family আছে; Durable Object WebSocket family `/ws/user`, `/ws/chat/:id`, `/ws/call/:id`। Android-এর অনেক feature-এর backend ভিত্তি আছে, কিন্তু route payload/permission contract প্রতিটি Web screen-এ যাচাই করতে হবে।
- Android বড় screen/source: `ChatScreen.kt` (12,385 lines), `MediaEditScreen.kt` (2,910), `CallEngine.kt` (2,987), `ChatListScreen.kt` (1,966), `StatusScreens.kt` (1,745), `MediaViewer.kt` (1,715), `SettingsScreen.kt` (1,588), `CallScreens.kt` (1,633), `AttachSheet.kt` (1,464)।
- Push Android-এ FCM/device registration-নির্ভর; notification-এ Reply, Like, Mark as read এবং login alert Decline action আছে। Call notification, foreground service, full-screen incoming-call UI Android-native। Worker-এ generic device/FCM plumbing আছে; Web Push subscription/delivery pipeline দেখা যায়নি।

## ৩. Screen-by-screen / flow-by-flow coverage ও gap matrix

### ৩.১ App entry, account, navigation

| Android screen/flow | Android-এ audited capability | বর্তমান Web | Gap type | Web target / acceptance notes |
|---|---|---|---|---|
| Login / country picker | Bangladesh default, country list/search, E.164 formatting, phone verification | Existing-account phone login আছে; country picker/OTP/approval আছে | আংশিক; signup UI gap | একই country catalog/normalization, keyboard-first phone form, error/expiry/approval state। Browser সবসময় `sim: UNAVAILABLE`; SIM verification দাবি নয়। |
| New account + Google bind | Phone-first signup, Google bind/recovery, profile photo/name/username/about onboarding | নতুন নম্বরে signup না করে phone app-এ পাঠায় | UI gap; Worker route আছে বলে মনে হয়, contract test জরুরি | Worker-এর `verify-phone` → `google/bind` ব্যবহার করে Web onboarding; server-side Google ID-token verify বজায় রাখা। Avatar/profile save একই API contract-এ। |
| Existing-device approval / OTP | In-app login card, code entry, approve/decline, auto-login polling, expiry/locked states | OTP, polling, Google recovery, approval card action আছে | আংশিক parity | Desktop-এ split-pane-friendly sign-in; security card-এর device/location/IP; expire/decline/retry এবং no-account states পরীক্ষা। Existing case 48/49 বজায় রাখতে হবে। |
| Google recovery | Phone lookup, linked Google verification, recovery states | আছে | আংশিক | blocked script/cancel/offline states; কোনো Google secret client-এ নয়। Account enumeration Worker contract অনুসারে। |
| Account profile/edit | Self profile; Name, Username, About, Phone field; avatar edit | নেই | UI gap | Profile/settings forms, validation, optimistic save/rollback; profile photo editor reuse। |
| Device list / logout | Active/signed-out device, platform, last-seen, IP/place/sign-in; logout confirmation | নেই | UI gap | Web ও Android device row, current-device badge; Web logout শুধু Web session/device এবং local Web cache পরিষ্কার করবে, Android session নয়। Existing Android UI informational; revoke action আছে ধরে নেওয়া যাবে না। |
| Main navigation | Android app tabs: chats/status/calls; overflow: search, new chat/group, contacts, archive, settings/about | Conversation list/chat মাত্র | UI gap | Desktop left rail + pane nav; keyboard route shortcuts/visible focus; mobile bottom nav বা narrow rail। |
| App route handling | Main/new chat/group/chat/settings subroutes/profile/status/calls/search/media/viewers/archive/AI history/group media; share intake | Three screens | UI gap | Browser route + back/forward/deep-link behavior; refresh route Worker SPA fallback-এ কাজ করবে। Sensitive route-এ auth guard। |

### ৩.২ Home, chat list, contacts, profile, group

| Android screen/flow | Android-এ audited capability | বর্তমান Web | Gap type | Web target / acceptance notes |
|---|---|---|---|---|
| Chat list rows | Avatar/name, last message/media/call preview, timestamp, unread badge, sent/delivered/read hint, muted/hidden/group state | Basic conversation rows, preview/time/unread | আংশিক | All server row facts merge করা; live list updates; selected row state; accessible unread labels। |
| Chat list actions | Swipe delete/archive/hide/unarchive, row menu, multi-select, pin/unpin, mute, delete scope, create group from selection | নেই | UI gap | Desktop context menu + toolbar + checkboxes; touch swipe only as shortcut; no destructive action on accidental drag. Archive/hidden/pin rules mirror Android. |
| Archive | Archived conversations list, unarchive/delete | নেই | UI gap | Dedicated pane/list; archived row counts and restore actions; archive-pull gesture-এর desktop equivalent button/menu। |
| Hidden chats | Secret-key hash দিয়ে Search-এ hidden chat reveal/unhide; hidden calls বাদ; hidden chat silent | নেই | UI + privacy gap | Search-এ secret key attempt; hidden chat normal list/global results/notifications-এ leak নয়। Brute-force/privacy behavior Worker contract দিয়ে validate। |
| Global Search | Users, chats/messages, call/media-related result and hidden-key reveal | নেই | UI gap | Debounced search, result categories, keyboard navigation, query clear; secret key text search telemetry/log-এ নয়। |
| New chat / user search | Search users, open/create 1:1 conversation, profile peek | নেই | UI gap | Existing `/api/users/*`, `/api/search`, `/api/conversations` contract ব্যবহার; empty/loading/blocked/request state। |
| Contacts | PhoneBook permission/match, app contacts, invite/see who is here, contact row | নেই | UI + browser gap | Web Contact Picker যেখানে পাওয়া যায়; না হলে manual phone/user search ও vCard download; continuous phonebook access দাবি নয়। Permission ছাড়া upload নয়। |
| New contact | Name/phone input, number check/match, save to Android contacts | নেই | UI + browser gap | User lookup/form; Web-এ phonebook-এ silent write নয়—`.vcf` download/copy বা supported Contact Picker fallback। |
| User profile | Avatar/photo viewer, name/@username/about/phone/privacy, E2EE safety/key verification, shared media; Chat/voice/video actions | নেই | UI gap | Profile drawer/pane; Chat/call buttons; phone number privacy মেনে; shared media pagination; profile photo save/forward policy। |
| User profile menu | Add contact, block/unblock, hide/unhide, mute/unmute, report, badge display (authorized account) | নেই | UI gap | Confirm/report forms; block wall/request/unblock behavior; server response authoritative; report details accessibly collected। |
| Group creation | Title, member search/select, create with preselected users | নেই | UI gap | Multi-select user picker, selected chips, title validation, create/rollback, server errors; member list not browser contacts-only। |
| Group profile/info | Group avatar/title, member list, owner/admin/member actions, add/remove, leave, shared media | নেই | UI gap | Group info side pane; role-gated actions; confirmation for remove/leave; private group state always shown. |
| Group settings | Admin “Private group” toggle; Android source/server comments gate group media/add members and mention call recording | নেই | UI gap + verify | Mirror verified server gates. “Call recording” is mentioned in Worker comments, but a user-facing recorder was not found in the audited call surfaces; verify before claiming that control exists. |
| Profile peek / row shortcuts | Quick profile peek from list and create group with selected contacts | নেই | UI gap | Desktop hover card with keyboard focus equivalent; touch click opens profile; not hover-only. |

### ৩.৩ Chat, messages, attachments, media, AI

| Android screen/flow | Android-এ audited capability | বর্তমান Web | Gap type | Web target / acceptance notes |
|---|---|---|---|---|
| Chat header / menu | Profile/group, voice/video call, Search in chat, Scheduled messages, shared media, mute, disappearing messages, theme, privacy, leave group; AI history/new/incognito | Basic title/back only | UI gap | Header toolbar + overflow; actions by conversation type; preserve official one-way bot restrictions. |
| History / realtime | Paged message history, read marker, typing, reconnect, new message update, scroll-position restore | First message page + WebSocket live updates | আংশিক | Cursor pagination/older history, reconnect backoff + resync, exact read/typing state, list state restore, no duplicate messages after WS+GET reconciliation। |
| Text send / drafts | Optimistic echo, stable client ID, retry/refusal handling, durable Android outbox/draft, typing indicator | Text send + optimistic echo; no persistent outbox | আংশিক; state gap | IndexedDB outbox, idempotent `clientId`, pending/sent/delivered/failed state, retry/cancel, refusal returns draft; chat switch/tab close must not silently lose text। |
| 1:1 message E2EE | `KP1.` P-256 ECDH/HKDF-SHA256/AES-GCM; key backup KP1/KP2; cross-device key identity | Text body encryption + backup unlock/adoption আছে | আংশিক; storage security gap | Preserve byte-for-byte Android format and old backups; cross-client vectors; never silently make a new identity if old key cannot unlock. Group/AI E2EE দাবি নয়। |
| E2EE key backup/settings | Message-key backup state; automatic/locked backup; passphrase unlock | Unlock/automatic identity path exists; settings UI নেই | UI gap | Backup create/restore/change/reset flows; `KP2` passphrase clear warnings; encrypted backup verification; no silent irreversible overwrite. |
| Captions / media body | Android seals photo/video/file captions in 1:1; media bytes token-gated, not E2EE | Photo sends no caption; file captions absent | UI gap | Caption sealed with same E2EE rule; binary media encryption scope explicitly unchanged unless separately designed. |
| Reactions / emoji | Quick reactions + more-emoji picker, animated emoji/stickers | নেই | UI gap | Reaction row/emoji picker, remove/change reaction, server sync; motion respectful and keyboard-accessible. |
| Reply / quote | Reply from long-press; reply header in composer/bubble; swipe-to-reply gesture | নেই | UI gap | Reply toolbar and keyboard shortcut; touch swipe shortcut; quote persists on optimistic echo and server row; accessible quoted sender/text. |
| Edit / copy / message info | Text copy, edit eligible own message, sent/delivered/seen info sheet | নেই | UI gap | Selectable/copyable text, edit policy from Android/server, timestamp detail panel; avoid `navigator.clipboard` without gesture/permission fallback. |
| Forward / selection | Forward to one/multiple chats; multi-select; forward restricted for private/view-once | নেই | UI gap | Recipient picker, batch send results, preserve restrictions, prevent sending view-once/private items. |
| Delete | Delete for me/everyone scope, one delete dialog with optional peer checkbox, multi-delete, animated removal | নেই | UI gap | One confirmation flow, server-authoritative permissions, local hide vs server delete clearly distinguished; respect block wall and pending-send state. |
| Login-approval message | Security card, six-digit code, Accept/Decline in signed-in chat | আছে | Regression gate | Keep card state, expiry/code redaction, focus/keyboard, and current auth behavior when chat UI is restructured. |
| Scheduled messages | Schedule text and files/media; preset/custom date-time; list/cancel; server executes | নেই | UI gap | Server-side schedule APIs; Dhaka timezone display + explicit timezone; files upload before schedule; cancel/expiry; no browser tab required at send time. |
| Disappearing messages | Per-chat timer and history semantics | নেই | UI gap | Per-chat timer sheet, effective-since copy, worker state sync; no claim that it retroactively deletes older messages. |
| Mute / block wall | Message/call mute choices, block/unblock-request, blocked UI wall, request/ignore | নেই | UI gap | Separate message/call mute states and call actions; preserve server gating and notices. |
| Chat privacy | Screenshot/record/save permissions, peer consent, capture alerts and secure-window behavior | নেই | UI gap + browser gap | Keep save/forward consent and explain browser cannot reliably block/detect screen capture or guarantee alert. Do not render an “enforced” toggle that is not enforced. |
| Chat theme / wallpaper | Dark Blue, Cream, Mint, Rose, Night themes; chat wallpaper/coin background | Web fixed dark blue | UI gap | Theme picker + message bubble/header/composer/background preview; theme persists server-side/local rules as Android does; contrast checked for every palette. |
| Text rendering / links | Message formatting, links/previews, special content, delivery stamps | Simple escaped text/envelope placeholder | UI gap | Safe formatter/link preview; strict URL allowlist/sanitization; no raw HTML from messages; link fetch/privacy follows Android/Worker behavior. |
| Attach sheet | Photo, video, camera, location, contact, document; Poll/Event/AI images are placeholders | Photo button only | UI gap; 3 placeholders | All live attachments get a button and flow. Poll/Event/AI images remain disabled/“coming soon” until Android/backend functionality exists. |
| Gallery / multiple selection | Photo/video picker, multi-select album, chosen count, camera capture | One image input | UI + browser gap | `<input type=file multiple>` and drag/drop; camera `getUserMedia` or capture input with capability prompts; preserve file metadata/order; no hidden picker permission. |
| Image/video editor | Crop/presets, rotate, filters, pen/color/width, text/stickers/emoji overlays, undo/redo, caption, HD, view-once; video trim/export/progress | None | UI gap | Canvas/WebCodecs where available; safe fallback if codec unsupported; editor operations remain undoable; compare baked output/dimensions; route exit warns on unsaved edit. |
| Media upload | Images up to 100 MB, video 2 GB, docs 5 GB, audio/voice 100 MB; >25 MB chunked (8 MB pieces), progress/cancel | Small JPEG single POST; no large-file flow | UI + resilience gap | Stream/chunk using existing Worker upload contract, byte progress, cancel/retry; enforce per-type cap before upload; storage quota and closed-tab loss explained. |
| View-once | One-time text/photo/video/voice; single fetch/spend, no cache/forward, secure window | None | UI + browser gap | One-read server behavior; never prefetch/thumbnail/cache/SW-cache; purge RAM/IDB on close. Browser screenshot protection cannot match Android `FLAG_SECURE`; explicitly disclose. |
| Photo viewer / album | Fullscreen, album paging/count, hero open/close, pinch/double-tap zoom, pan, swipe-down close, tap chrome; Save/Forward/Edit/Delete; secure/view-once policies | None | UI gap + browser gap | Responsive lightbox/gallery; pointer pinch/keyboard zoom; Save via download; use exact consent rules; view-once data not cached. |
| Video player | In-app player, play/pause/replay, scrub, mute, auto-hide chrome after 3s; Save/Forward/Delete; view-once/privacy | None | UI gap | HTML video/custom controls; keyboard media controls, captions/seek; autoplay policy; browser codecs differ; maintain visibility pause and download consent. |
| Document viewer | PDF pages/zoom; selectable text/code; safe HTML/Markdown preview↔Code; images/SVG/TIFF/ZIP-RAR table; other formats Open with; Save/Forward/Delete | File chip only | UI gap + format limits | PDF/native/browser viewer with consistent fallback (bundled PDF.js only after dependency/license/security review); sandbox HTML/SVG; unknown office formats download/open externally. |
| Shared media/links/docs | Per-chat/group tabbed gallery and links/doc lists | None | UI gap | Filter/search/pagination, click into same photo/video/doc viewers; private group/profile/Save restrictions respected. |
| Voice note | Hold-to-record, live waveform/duration, drag-to-lock/cancel, pause/resume, send/view-once, upload/retry | None | UI + browser gap | `getUserMedia` + `MediaRecorder`; mouse click-to-start/stop and keyboard alternative; mobile press/hold; codec/MIME check; permission denial and tab-hidden interruption are explicit. |
| AI chat/history | AI bot conversation, scheduled/history/new session/incognito; AI API | None | UI gap | Match Android AI flow and privacy/session controls; AI is not E2EE; existing AI image attach tile remains placeholder. |

### ৩.৪ Status, calls, settings, device/system integration

| Android screen/flow | Android-এ audited capability | বর্তমান Web | Gap type | Web target / acceptance notes |
|---|---|---|---|---|
| Status feed | My status, recent/viewed groups, progress ring, unread state | নেই | UI gap | Feed pane, viewer entry, loading/empty states, hide list; update expiry and owner order from Worker. |
| Status composer/picker | Text status background/colors/font/alignment; photo/video picker and shared media editor; privacy | নেই | UI gap | Text/media creation, status-specific editor rules (no chat caption/HD/view-once where Android excludes them), audience preview and upload progress. |
| Status viewer | Segmented 24h progress, next/previous tap, hold pause, swipe down/close, swipe up reply, reaction, reply, views, delete, hide/report | নেই | UI gap + browser interaction | Click/keyboard navigation plus touch gestures; timer pauses when page hidden; viewers list and owner-only delete; action buttons remain reachable without swipe. |
| Status privacy | Who can view status, hide/mute/report users | নেই | UI gap | Reuse `/api/me` privacy and status routes; effective audience shown before posting; honor hidden users. |
| Calls tab/history | Date-grouped call history, direction/missed/duration, callback audio/video/group; opens chat | নেই | UI gap | Calls pane with callback buttons, filters/date groups, hidden-chat filtering, permission states. |
| 1:1 voice/video calls | Incoming/outgoing/active, answer/decline/end, mute, camera, speaker/headset/earpiece/Bluetooth route, timer, safety code | নেই | UI gap + browser/native gap | WebRTC `getUserMedia`/`RTCPeerConnection`, permission gating, active call panel; output select only when browser supports `setSinkId`, otherwise default audio and truthful label. |
| Group voice/video calls | Join/ringing members, participants, group grid, camera tiles, mute/camera/end | নেই | UI gap + capacity risk | Existing CallEngine uses peer mesh (per joined peer connection); retain current semantics/capacity unless a separate SFU/product decision is made. Validate participant/load limits and mobile-browser behavior. |
| Screen share | Local share, peer preview/fullscreen, share audio preference | নেই | UI gap + browser gap | `getDisplayMedia` behind user gesture, stop-sharing events, preview/fullscreen; system audio is browser/OS-dependent, not guaranteed. |
| Minimize/return-to-call | Android back/chevron minimize, ongoing notification, Return to call banner, call stays alive | নেই | Browser gap | In-app floating bar/pane when navigating; browser tab/PWA can be suspended/closed, so no guaranteed system-wide call survival. Never imply otherwise. |
| Incoming call alert | Android FCM notification, full-screen intent, call service, quick system actions, wake/proximity | নেই | UI + Worker + browser gap | Web Push notification can be best-effort doorbell; click opens call route. No guaranteed full-screen takeover, lock-screen answer, foreground service, proximity sensor or native Telecom. Foreground tab gets full incoming-call modal. |
| Call gesture/UI effects | Incoming swipe-up Accept/Decline, haptic threshold, voice/video controls, auto-hide, draggable PiP, feed swap, participant grid | নেই | UI + browser gap | Desktop buttons + Enter/Space and visible labels; mobile swipe optional. In-app draggable PiP and click-to-swap; browser OS-level PiP only optional enhancement. |
| Quick call actions | Incoming “Message” quick reply and “Remind me”; call reminders | None | UI + browser gap | Foreground call panel equivalents; browser notification text input/action support is inconsistent; reminder via in-app notification/calendar download only if authorized. |
| Add call | Button displays “Adding calls is coming in a future update.” | নেই | Placeholder | Do not claim/implement conferencing transfer as parity. Keep absent or disabled with same honest status. |
| Privacy settings | Phone/avatar/message/last-seen/group/status audience, read receipts, private profile, blocklist, E2EE backup | None | UI gap | All setting rows and value pickers; privacy change rollback and blocked list. |
| Appearance/settings | Dark Blue/Light Cream, chat theme, notification/call sounds/ringtones | None | UI + browser gap | Theme picker parity; Web sounds can play only when page is allowed/activated. No OS ringtone picker/background sound guarantee. |
| Permissions | Notifications, Camera, Microphone, Contacts, Phone, photos/videos, Location, Bluetooth, full-screen calls | None | UI + browser gap | Capability matrix and browser permission status; request only at action time; links to browser site settings; never ask for Android-only Phone/SIM permission on Web. |
| Voice isolation / audio | Voice-isolation levels, screen-share system-audio preference, output route | None | UI + browser gap | Use `echoCancellation`/`noiseSuppression`/`autoGainControl` if supported; disclose browser-defined behavior; no promise of Android’s exact isolation strength or device route. |
| App/about/crash/update | About, crash report opt-in, app update flow, local diagnostics | None | UI + hosting gap | About/version/build info; crash reporting only after privacy review and opt-in; static PWA update banner/cache refresh, never silently strand old shell. |
| Android app share intake | Other apps share text/image/file into `ShareIntake`; pick destination(s), send | None | Browser gap | Optional PWA `share_target` where supported (not broad desktop support), paste/drag/drop/file picker fallback. Outgoing `navigator.share` only in user gesture and where available. |
| Save/open external | Save photo to Pictures, video/doc to Downloads, Android “Open with” | None | Browser gap | Use download/Save As; optional File System Access API; external viewer/browser handles unsupported formats. No silent write to device gallery. |
| Capture privacy | `FLAG_SECURE`, screenshot/screen-record detection/alerts, private profile/call restrictions | None | Browser gap | Web cannot prevent or reliably detect screenshots/recording. Disable in-app Save/Forward per consent; warn users that browser/OS capture remains possible. |

## ૪. Desktop visual/interaction target

### ૪.૧ Desktop layout

Desktop design is a real multi-pane workstation, not a 390px phone shell centered on a wide screen:

- **≥ 1200px:** 64–72px navigation rail; 320–380px list pane; flexible conversation/content pane with 560px minimum; optional 300–360px profile/details drawer that overlays or narrows the conversation intentionally. Default chat screen shows list and selected conversation side-by-side.
- **768–1199px (tablet/small laptop):** 72px rail + 300–340px list + remaining conversation; hide/collapse rail labels and details drawer; preserve minimum composer width.
- **< 768px:** one primary pane at a time with explicit Back; bottom navigation or compact top navigation; maintain the same actions, not a reduced feature set.
- Large monitors: cap reading width for message column while leaving margins/workspace; do not stretch message lines across the whole monitor. Support resize/split panes and browser zoom to 200% without clipped core actions.
- Global chrome: app identity/account switch/profile, Chats, Status, Calls, Search, New chat/group, Contacts, Settings; unread/active indicators; view transitions preserve selected route and scroll.

### ૪.૨ Design tokens / visual rules

Use audited `Theme.kt` as the source of truth and test actual composable measurements before freezing values:

- Global themes: **Dark Blue** (`#0D1524` base, `#16213A` card, `#E9EDF6` primary text, `#8A97B2` muted, `#233150` line) and **Light Cream** (`#F7F6F4` base, white card, `#1C1917` text, `#7A6F63` muted, `#E8E4DE` line).
- Shared accents: gold/amber (`#F59E0B`), blue (`#2F6FED` / `#60A5FA`), green (`#16A34A`), red (`#DC2626`); state meaning must not depend on color alone.
- Chat themes: `darkblue`, `default`/Cream, `mint`, `rose`, `night`; status text backgrounds and editor filters/overlay colors also need explicit tokens and contrast review.
- Recreate rounded cards/sheets, pill composer, bubble spacing, line heights, avatar rings, read/unread badges, status rings and call-control circles; use CSS variables instead of duplicate hard-coded colors.
- Typography: system font stack that handles Bangla + Latin + emoji; preserve line breaks/emoji clusters; use browser CSS px/rem and user zoom rather than copying Android `dp` as desktop pixels. No remote font required for offline shell.
- Minimum interactive target 44×44 CSS px where practical; icon-only buttons need `aria-label`, tooltip, visible keyboard focus and stable hit target. Destructive actions need confirmation and non-color label.
- Desktop right-click/context menu is an additional shortcut only; same actions available by toolbar/menu button, keyboard (`Shift+F10` where relevant) and touch/long-press.

### ૪.૩ Effect/animation inventory to port

Do not simply sprinkle CSS transitions over screens. Build a motion inventory and compare each effect against its Android source/trigger:

| Surface | Audited Android motion/effect | Web mapping |
|---|---|---|
| Navigation | Nav push/pop fade + short horizontal slide; separate status-viewer vertical transition | Web route transition/WAAPI; preserve state and avoid animating large lists; reduced-motion fallback is instant/fade. |
| Sheets/dialogs | Bottom sheets, confirm sheets, selected-row/toggle feedback | Desktop anchored popover/dialog or side sheet; mobile bottom sheet; focus trap, Escape, return focus. |
| Chat send | Composer-to-bubble send-flight, optimistic echo, no second “arrival” flight when server row replaces echo | CSS transform/WAAPI from composer anchor; one stable `clientId`; reduced-motion becomes simple opacity/position update. |
| Message arrival/status | Blur/pop/progress/slot-open, unread badges, typing dots, send/read state, message effects | Port only verified effect-to-component mapping; never replay on pagination/reconnect; screen-reader live message is throttled. |
| Emoji/sticker/media | Animated emoji, sticker/GIF, reaction burst; image/video tile placeholders | Respect media/reduced-motion preferences; pause hidden content; no animated view-once thumbnail. |
| Archive/delete | Pull/hold-to-archive feedback, archive reveal, delete/dust exit | Desktop has explicit Archive/Delete buttons; touch retains optional pull; destructive animation cannot delay/cancel actual server response. |
| Photo/video viewer | Hero grow/shrink from/to tile, 320ms photo flight, pinch/double tap/pan, swipe close; chrome fades; video controls auto-hide after 3s | `ViewTransition`/WAAPI when supported, otherwise opacity/scale; pointer zoom/keyboard alternative; no double tile or stale scroll-seat artifact. |
| Media editor | Filter preview, crop handles, pen strokes, overlays, undo/redo, video trim/export progress | Canvas/WebCodecs where supported; stable crop/overlay coordinates at varied viewport; deterministic baked output and visible export progress. |
| Status | Segmented progress, pause-on-hold, viewer slide, reaction/reply animation | Timer pauses on hidden page; click/keyboard/touch navigation; progress exposed as accessible text/state, not animation-only. |
| Call | Swipe circles/chevrons, haptic arm threshold, 3s control auto-hide, draggable self-view, feed swap, camera-off avatar backdrop | Buttons are primary desktop action; swipe optional on touch; visible keyboard controls; browser vibration only best effort. |
| Toggle/press | `AnimatedToggleSwitch` custom movement/color/state feedback; haptics | CSS transform/color with semantic switch state; no fake haptic; reduced-motion uses instant state change. |

**Motion rules:** follow `prefers-reduced-motion`; avoid parallax/continuous animation when hidden; do not make a user wait for a decorative animation before reading or using an action; handle `document.visibilityState`; use opacity/transform (GPU-friendly) and one source of truth per animation. Sound/haptic feedback is optional, user-controlled and never the only confirmation.

## ૫. Android gesture/button → Web control mapping

| Android interaction | Desktop Web primary | Touch/mobile Web | Keyboard/accessibility equivalent |
|---|---|---|---|
| Tap row/button | Click | Tap | Enter/Space on semantic button/row |
| Long-press message/row | Visible `⋮` / context menu | Long-press | `Shift+F10`/menu key; toolbar action after selection |
| Swipe chat row (archive/delete/hide) | Row menu/toolbar; optional drag only if not conflict with text selection | Swipe shortcut + same visible menu | Focus row then open actions menu |
| Swipe message to reply | Reply button/menu | Swipe shortcut | Reply action in message menu / shortcut |
| Call accept/decline swipe-up | Green Accept / red Decline buttons | Buttons plus optional swipe | Enter/Space; focus order; confirmation label |
| Pinch/double tap photo/video | Scroll/zoom controls, `+`/`−`, Fit/100% | Pinch/double-tap/pan | Keyboard zoom and reset; Escape closes |
| Tap viewer left/right, swipe album | Prev/Next buttons, arrow keys | Tap edges/swipe | Left/Right arrow; Escape/back closes |
| Hold status to pause | Pause button | Hold gesture + Pause button | Space/Pause button |
| Drag PiP | Pointer drag with clamp | Touch drag | Move focusable tile via accessible position/bring-to-front control; avoid drag-only requirement |
| Hold mic to record, slide to cancel/lock | Click-to-start/stop + visible Lock/Cancel/Send | Press/hold plus explicit buttons | Space starts/stops with clear state; Escape cancels |
| Android system Back/minimize call | App Back button/browser history with call-state guard | Back button/browser navigation guard | Escape only for dialog; explicit minimize/return-to-call control |
| System share intent | Paste, drag-drop, file picker; optional Web Share Target | Share target where browser supports; otherwise picker | File chooser and send destination picker |
| Haptic toggle/confirm | Visual state + optional sound (off by default) | Vibration API only if allowed/supported | Live-region status confirmation |

## ૬. Browser capability boundary ও fallback

| Native Android facility | Web capability | পরিকল্পিত substitute | parity status / সতর্কতা |
|---|---|---|---|
| SIM/phone state and automatic phone verification | Not exposed to a normal browser | Existing phone + in-app OTP/approval/Google recovery | Exact SIM parity অসম্ভব; Web must send `UNAVAILABLE`, never fake a match. |
| Runtime camera/mic | `getUserMedia` on HTTPS with browser permission | Ask at point of use; explain browser settings; disable only dependent actions if denied | Browser/OS controls prompt and device selection. |
| Photo/video system gallery | File picker; some installed mobile PWAs can use capture input | Multi-file picker, drag/drop; optional `capture` hint | No broad gallery permission/API; format/metadata availability varies. |
| Contact sync / write to Android contacts | Contact Picker is limited and user-triggered; support varies | Search by username/phone; manual input; `.vcf` download | Never imply full phonebook sync or silent write. |
| Geolocation | HTTPS + explicit browser permission | One-time location share after action/preview/confirm | No background location parity; provide manual location/text fallback. |
| Android notification/FCM | Web Push + Notification API on supported browser/PWA | Add VAPID subscription + Worker delivery; foreground reconnect as fallback | Permission can be denied; delivery/closed-app wake is not guaranteed. |
| Notification quick-reply/mark-read/like/login-decline | Notification action support differs; text input/action clicks not universal | Notification click opens exact chat/card; actions in foreground Web app | Do not promise Android-style quick reply or approval while app is closed. |
| Full-screen incoming call / Telecom / foreground service | No general Web equivalent | Best-effort generic push + foreground incoming-call screen; open call page | Cannot guarantee lock-screen takeover, answer from OS UI, background survival or call-waiting integration. |
| Audio route: earpiece/speaker/headset/Bluetooth | Browser owns route; `setSinkId` is limited/non-universal | Default output; optional output picker when API is present; clear unsupported label | Not a native route cycle; no Bluetooth permission behavior equivalent. |
| Call background/proximity/wake lock | WebRTC while page active; Screen Wake Lock only when available/visible | Keep call UI visible; warn before navigation/closing; in-app return-to-call bar | Browser may suspend/kill tab; no proximity sensor/guaranteed foreground execution. |
| Display capture / screen audio | `getDisplayMedia`, explicit user picker; audio varies by browser/OS | Select tab/window/screen, show stop-share; disclose whether audio captured | No silent capture; system-audio capture not consistently available. |
| Screenshot/screen-record blocking/detection (`FLAG_SECURE`) | No reliable control or detection | Honor Save/Forward/privacy policy and warn; avoid false “protected” state | Hard native parity impossible; user can still capture via OS/hardware/other camera. |
| System ringtone picker / background tones | Page audio subject to autoplay/background policy | In-app preview/volume choice after user gesture | Cannot replace Android ringtone/channel while tab is closed. |
| Save to Pictures/Downloads / Open with | Browser download, optional Save As/File System Access API | Download file; use browser/OS open flow | Cannot silently write to gallery or force an installed viewer. |
| OS share-in / PWA share target | Web Share Target partial, chiefly installed supported browsers | Paste/drag-drop/file picker | No cross-browser/desktop parity; outgoing Web Share also requires gesture. |
| Haptic feedback | Vibration API limited/permission-dependent | Visual/sound confirmation, optional vibration | Best effort only; do not make business logic depend on haptics. |
| App update/install | PWA install/update and service worker | Versioned assets, update notification/reload | No Android APK-style install/update flow in browser. |
| Background upload/task | Foreground fetch; background sync support varies | Persistent outbox while tab runs; resume on next open; OPFS/IDB quota-aware | Closing browser can pause/lose access to source file; disclose large-upload risk. |

## ૭. প্রস্তাবিত Web architecture ও security contract

### ৭.১ Structure/build

- **Hosting অপরিবর্তিত:** Cloudflare Worker + same-origin API/WS + PWA shell। API আলাদা করে browser-এ `localhost`/দ্বিতীয় origin ব্যবহার নয়। Static `/` ও deep-link SPA fallback, `/api/*` ও `/ws/*` Worker-first থাকবে।
- **Recommended frontend:** `TypeScript + React + Vite` modular client; build output `public/`-এ self-contained hashed assets। বর্তমান no-build `public/app.js` থেকে feature-by-feature migration; একসাথে rewrite নয়। Build step Worker deploy-এ যোগ হলেও output Worker assets path-এ থাকবে। Dependency/license/size audit আগে।
- **Feature modules:** `auth`, `shell/navigation`, `conversations`, `messages`, `contacts`, `profile/groups`, `media`, `statuses`, `calls`, `settings`, `notifications`; shared design tokens, API client, E2EE adapter, media cache/outbox। Screen route ↔ domain action mapping রাখুন; DOM থেকে business logic আলাদা।
- **Component/state boundary:** server state (Worker response) ও transient UI state (open pane/modal/editor) আলাদা; optimistic update/reconcile keyed by stable IDs; loading/empty/error/offline states প্রতিটি screen-এ বাধ্যতামূলক।

### ৭.২ API, real-time, persistence

- REST-এ বর্তমান `Authorization: Bearer` header এবং Worker routes; WebSocket `/ws/user`, `/ws/chat/:id`, `/ws/call/:id`। Browser close/reconnect, duplicate frame, stale marker, multi-tab case-এ REST resync authoritative।
- Browser WebSocket-এ custom header নেই; বর্তমান `?token=` শুধু WS-তে সীমাবদ্ধ এবং test 48 এটিকে pin করে। Security workstream-এ স্বল্পমেয়াদি, একবার ব্যবহারযোগ্য WS ticket route বিবেচনা (URL-এ long-lived session token নয়); Android header path untouched থাকবে। Ticket ship করার আগে Worker auth/expiry/replay tests আবশ্যক।
- Worker-এ `/api/auth/refresh` আছে; Web client-এ single-flight refresh, session-expiry notice, retry-on-401 semantics যোগ করার পরিকল্পনা। Refresh token/session cookie বনাম bearer persistence-এর নকশা Worker contract/security review ছাড়া বদলানো যাবে না; CSRF ও same-origin সীমা যাচাই হবে।
- IndexedDB-তে account-scoped conversation/message windows, drafts, unsent text/media queue, theme/local preferences, encrypted metadata; server data authoritative। Browser quota-aware eviction, account switch/logout isolation, explicit cache reset থাকতে হবে।
- PWA cache-এ কেবল static versioned shell/assets; API/auth/WS/private media/view-once কখনও cache নয়। Update এলে old shell ও new worker mismatch safe refresh/notice দিয়ে সামলাতে হবে।
- Outbox: persisted `clientId`, type/payload, queue state, retry/backoff, progress, cancel, permanent refusal; WebSocket/network ফিরলেই resume; server duplicate prevention test। Photo/media source bytes-এর জন্য IDB/OPFS quota ও browser lifetime সীমা; file handle পাওয়া গেছে ধরে নেওয়া যাবে না।

### ৭.৩ E2EE / security / privacy

- Android `E2eeMsg.kt` ও WebCrypto implementation-এর ECDH/HKDF/AES-GCM test vectors একসঙ্গে pin করা; existing KP1 plaintext-identity backup ও KP2 PBKDF2/AES-GCM passphrase backup restore compatibility বজায় রাখা। No silent key rotation/downgrade।
- বর্তমান plaintext-exported key `localStorage`-এ; লক্ষ্য IndexedDB structured-clone-এ non-extractable `CryptoKey` রাখার feasibility যাচাই, backup/export-এর প্রয়োজন হলে encrypted backup/passphrase flow-ই ব্যবহার। XSS হলে live session/key operation তবু ঝুঁকিতে—এটি আলাদাভাবে জানাতে হবে।
- CSP/Trusted Types, dependency pinning/audit, user content escaping, DOM sanitizer/URL allowlist, no raw message `innerHTML`, no bearer/OTP/secret in URL/log/analytics; third-party script সীমিত ও allowlist (Google sign-in-এর প্রয়োজন আলাদাভাবে পর্যালোচনা)।
- REST token, E2EE private key, OTP, contact list, view-once bytes, call SDP/ICE, private media log/telemetry-তে যাবে না। Session/device/logout cross-platform boundary Worker test-এ pin।
- View-once: server spend একবার, fetch one-shot, no thumbnail/prefetch/cache/automatic download; close/expiry-তে in-memory/IDB bytes revoke/remove; tab hidden হলে playback/visibility policy স্পষ্ট। Browser screenshot block সম্ভব নয়—consent UI এবং warning-এ সেটি সরাসরি বলা।
- Sign-out/cache clearing: bearer, account cache, media object URL, WS এবং pending UI teardown; E2EE key মুছবে/রাখবে কি না remote backup availability যাচাই করে explicit policy—key loss নীরবে নয়।

### ৭.৪ Web Push ও notifications

- Web Push-এর জন্য VAPID subscription, subscription refresh/expiry, device registry, user opt-in/revoke, Worker push fan-out, push-service failure cleanup এবং service-worker click routing আলাদা workstream। Android FCM route/token কখনও Web subscription হিসেবে reuse নয়।
- Push payload-এ private message plaintext/OTP/view-once media নয়; generic notification + authorized context fetch। User notification permission না দিলে in-app notification/realtime fallback।
- Android notification action-এর 1:1 port হিসেবে “background quick reply” প্রতিশ্রুতি নয়; supported Web notification action থাকলে progressive enhancement, otherwise click → matching chat/security card।

### ৭.৫ Media/calls

- Media adapter: native picker → browser file picker/drag-drop/camera; upload worker’s existing 25 MB single vs 8 MB chunk protocol, type limits; editor operations capability detect; every export sends measured `w/h/duration/metadata` matching Worker/Android contract।
- Voice recording: user gesture + mic prompt, supported MIME detection, MediaRecorder lifecycle, local waveform and upload retry; tab hidden/locked/permission revoked হলে clear paused/cancel state।
- Call client: existing Worker call lifecycle/signaling/`/ws/call/:id` reuse; browser RTCPeerConnection, offer/answer/ICE/reoffer, group mesh parity, permission revoke, ICE fail/reconnect, device change, page visibility, call cleanup. Re-architect to SFU only as explicit performance/product decision, not hidden within parity port.
- Group call mesh peer-count ceiling/load test is a prerequisite; Android source shows one connection per joined peer, but audited source did not establish a safe target participant cap. Do not launch group video until it is measured/limited.

## ૮. ধাপে ধাপে implementation sequence (এই turn-এ শুরু নয়)

| Phase | Logical deliverable | Dependencies / exit gate |
|---|---|---|
| **P0 — Freeze & traceability** | এই matrix-কে checkbox/issue inventory-তে ভাঙা; প্রতিটি route, Android button/action, API, browser fallback ও owner-verified test-এ ID; `Add call`, `Poll/Event/AI images`, private-group call-recording comment classification চূড়ান্ত। | Source re-read at implementation commit; no unclassified action; no implementation PR until owner accepts capability compromises. |
| **P1 — Web foundation** | TS/React/Vite migration decision/build, desktop app shell, routing/pane model, token-based design system, API client, error/offline handling, service-worker versioning, accessibility/Playwright harness, feature flags. | Keep Worker same-origin; current login/text/photo regression tests green; static preview works with deep routes. |
| **P2 — Account & navigation** | Signup/Google bind/profile, OTP/recovery regression, device/settings/privacy/appearance, home rail, chat list/archive/search, contacts/new chat/new group, user/group profile panes. | Auth/session policy, route guards, Worker contracts, cross-platform logout tests. |
| **P3 — Messaging foundation/parity** | Conversation state, pagination/realtime, E2EE keys/backup, drafts/outbox, text/reactions/reply/edit/info/delete/forward/select, scheduled/disappearing/mute/block/chat privacy/theme. | Android↔Web E2EE vectors, idempotent sends, offline/refusal/reconnect suite; do not add media until message contract stable. |
| **P4 — Media & status** | Attachments, upload/chunk progress, voice notes, editor, photo/video/doc viewers, shared media, view-once, status feed/composer/viewer/replies/privacy. | Browser capability tests, media metadata contract, view-once no-cache tests, sandboxed document preview review. |
| **P5 — Calls & notifications** | Calls tab, 1:1/group WebRTC, screen share, in-app incoming/return bar, Web Push delivery/action fallback, settings for notification/audio. | WebRTC topology/participant ceiling/TURN/codec/manual browser matrix; no claim of Android full-screen/background parity. |
| **P6 — Visual/motion parity & hardening** | Fine-grained animation/effect match; `prefers-reduced-motion`; keyboard/screen reader/contrast; CSP/XSS/IDB/logout review; performance/bundle optimization; migration/offline/PWA update polish. | Screenshot comparisons at all breakpoints; security/accessibility review; no regressions in existing Worker/auth tests. |
| **P7 — Controlled rollout** | Staged preview/QA, opt-in production rollout only after separate approval; telemetry limited to non-sensitive diagnostics; rollback to last static shell/Worker version. | No deploy/release is authorized by this planning document. |

**Logical-change discipline:** প্রতিটি future PR/commit-এ একটি coherent feature/change; Worker contract, Android contract, Web UI আলাদা করে reviewable; test failure থেকে unrelated cleanup নয়। Production deploy, APK release, signing key/secret operation-এর জন্য এই plan যথেষ্ট অনুমতি নয়—আলাদা approval লাগবে।

## ৯. Automated test, manual QA ও regression plan

### ৯.১ Automated gates

- Existing `test/cases/01–49`, `test/run.ts`, auth `48/49` contract coverage সবসময় চালু থাকবে; parity implementation এগুলোকে ভাঙলে feature complete নয়। Current turn-এ tests চালানো হয়নি।
- Worker behavioral regression: REST auth header-only; WS authorization/member gate/ticket expiry; auth OTP/approval/session/refresh/logout; conversation privacy/hidden/archive; schedules; view-once exactly-once spend; file chunk/progress/caps; statuses/viewers; call group membership/offer/ICE/reaper; Web Push subscription and generic payload privacy।
- Web unit/integration: E.164/country parity; reducers/state reconciliation; `clientId` retry; offline outbox; KP1/KP2 vectors; message escaping/XSS; media MIME/limit/chunk; settings optimistic rollback; route/back behavior.
- Browser end-to-end: Chromium, Firefox, WebKit desktop; mobile emulation + Android Chrome installed/uninstalled PWA; feature-detect API branches rather than assume equal support. Mock worker for UI tests; local Worker/D1 harness for contract tests.
- Visual regression sizes at minimum `390×844`, `768×1024`, `1366×768`, `1920×1080`; Dark Blue/Light Cream + each chat theme; lightbox/editor/status/call overlays; browser zoom 100/125/200%.
- Accessibility: axe/automated scan + keyboard-only + screen-reader manual spot check; semantic headings/landmarks, focus traps, live regions, `aria-label`, contrast/WCAG 2.2 AA target; reduced-motion test.
- Security: CSP/Trusted Types, stored/reflected XSS, dangerous links/HTML/Markdown/SVG, token/OTP URL leak scan, IDB/logout account isolation, view-once/SW cache inspection, notification data minimization, dependency audit.

### ৯.২ Manual journey checklist

1. **Auth:** new Web signup + Google bind; known account approval by Android and by Web; OTP success/wrong/locked/expired; Google recovery; refresh/401; Web logout leaves Android signed in; device row accurate.
2. **Desktop chat:** 1440px three-pane; open profile/group/details without losing selection; keyboard route; new chat/group; global/search-in-chat; archive/hide secret reveal; multi-select/pin/mute/delete.
3. **Messaging:** Android↔Web direct E2EE text + caption/key restore; group behavior stated correctly; reply/edit/react/info/forward/delete scopes; scheduled text/media after browser closed; offline queue/reconnect and duplicate submit.
4. **Media:** multiple photos/video/doc, camera allowed/denied, 25MB boundary and chunk upload, progress/cancel/resume, editor crop/filter/pen/text/sticker/trim, album hero/open/close, save/open, one-time no second fetch/cache; large-file quota/tab-close warning.
5. **Status:** create text/photo/video; privacy audience; viewer timer hidden-tab; next/previous, pause, reply/reaction, viewers, hide/report/delete; reduced motion.
6. **Calls:** foreground 1:1 audio/video, permission denied/re-enable, headset change, screen share start/stop/audio support, network switch/ICE restart, Web↔Android, incoming foreground/background/closed-tab limitation, group mesh at approved cap, call history/callback.
7. **System limits:** screenshot/capture warning, browser notification denied, Web Push click when supported, contact picker absent fallback, no Web Bluetooth audio route, download/open external app, PWA update while offline.

## ১০. Completion / acceptance criteria

- **Coverage:** every Android route plus every audited menu/button/gesture/module has a matrix/issue ID and outcome: implement, browser substitute, Android-only limitation, or verified Android placeholder. No blank/unclassified cell; no “parity complete” based on assumption.
- **Feature:** all genuinely live Android account/chat/media/status/profile/group/settings/call workflows are available in Web or explicitly documented as impossible/limited with an actionable fallback. Android placeholders are not sold as completed features.
- **Desktop:** at 1366×768 and 1920×1080 chat list and open conversation coexist; no phone-width centered shell; core actions reachable by mouse and keyboard; panels do not cover message composer or call controls.
- **Responsive/accessibility:** mobile/tablet routes remain usable; 200% zoom, screen reader labels/focus, reduced motion, non-hover access, color contrast pass acceptance suite.
- **No regression:** existing login/OTP/approval, current Web text/photo send, 1:1 E2EE, Android login approvals, Worker API contracts and Android session remain correct.
- **Data/security:** 1:1 E2EE interoperates; no silent key loss/downgrade; hidden/private/view-once restrictions upheld; no view-once caching/prefetch; auth/OTP/private content absent from logs/URLs; session logout/cache isolation works.
- **Network/reliability:** reconnect/resync does not duplicate/loss messages; outbox survives refresh/reopen within browser storage limits; schedule relies on Worker, not an open tab; large uploads show progress/failure/retry.
- **Honest capability:** Web Push/call, screenshot prevention, native audio route, contacts, share target, background work and save-to-gallery claims accurately reflect the actual browser capability of that runtime.
- **Release:** no deployment/APK release or PR merge without a separate approval and release checklist; plan completion alone does not authorize production changes.

## ১১. Implementation শুরুর আগে খোলা যাচাই

1. `CallEngine.kt`/Worker group-call flow audited as peer mesh; **participant limit/acceptable load** এখনও নির্ধারিত নয়। Browser group-video implementation-এর আগে measured ceiling বা separate SFU decision দরকার।
2. Web Push-এর VAPID/public key, subscription schema, delivery/retry/expiration and browser support policy এই audit-এ configured পাওয়া যায়নি; implementation phase-এ dedicated backend design/test দরকার।
3. Android source/Worker comments private group-এর “call recording” restriction বলে; user-facing active recorder control পাওয়া যায়নি। Code/route search করে feature status নিশ্চিত না হওয়া পর্যন্ত matrix-এ “verify” থাকবে, active parity item নয়।
4. Browser WS short-lived-ticket design ও Web session token storage/refresh model Worker auth review-এ অনুমোদন/পরীক্ষা করতে হবে; বর্তমান WS query-token fallback ভেঙে ফেলা যাবে না, কিন্তু long-lived bearer query-তে না রাখাই লক্ষ্য।
5. Browser editor-এর video trim/export, HEIC/TIFF/large archive/document format browser-ভেদে আলাদা; প্রতিটি MIME/codec-এর fallback এবং licensing/security যাচাই phase P0/P4-এ pin করতে হবে।
6. Web account signup Worker flow contract tests-এ account creation/Google bind আছে; বর্তমান Web UI তা reject করে। Onboarding-এর exact Android field/ordering/avatar-size/error constraints P2 coding-এর আগে route-level acceptance test হবে।

## ১২. প্রধান source-of-truth files

- Android app/navigation: `native-android/app/src/main/java/app/kuchupuchu/android/KpApp.kt`, `LoginScreen.kt`, `ChatListScreen.kt`, `ChatScreen.kt`।
- Media/status/calls: `AttachSheet.kt`, `MediaEditScreen.kt`, `MediaViewer.kt`, `DocViewerScreen.kt`, `ChatMediaScreen.kt`, `StatusScreens.kt`, `StatusPickScreen.kt`, `CallScreens.kt`, `CallsTabScreen.kt`, `CallEngine.kt`, `KpCallConnection.kt`।
- Account/system/security/state: `ProfileScreen.kt`, `GroupInfoScreen.kt`, `ContactsScreens.kt`, `CreateGroupScreen.kt`, `SettingsScreen.kt`, `E2eeMsg.kt`, `E2eeBackup.kt`, `Cache.kt`, `OutboxPolicy.kt`, `KpNotify.kt`, `KpPush.kt`, `KpCapture.kt`, `KpSecure.kt`, `AudioRouter.kt`, `VoiceIsolation.kt`, `Theme.kt`, `ChatFx.kt`, `AnimatedToggleSwitch.kt`।
- Current Web/PWA: `public/index.html`, `public/app.js`, `public/sw.js`, `public/manifest.webmanifest`, `public/login-utils.mjs`, `public/countries.json`।
- Worker/test/hosting: `src/worker/index.ts`, `src/worker/durable-objects/`, `src/shared/constants.ts`, `wrangler.toml`, `test/cases/01–49`, `test/run.ts`।
