# Web hardening review — Slice I (২০২৬-১০-০৯)

Parity plan §8 P6 ("Visual/motion parity & hardening") এর exit-gate রিভিউ। যা যা
নামলো: গ্লোবাল অ্যাপিয়ারেন্স থিম (Dark Blue / Light Cream), পাঁচটা পার-চ্যাট থিম,
`prefers-reduced-motion` টোকেনাইজেশন, CSP/XSS রিভিউ, IndexedDB অ্যাকাউন্ট
আইসোলেশন, ৪-ব্রেকপয়েন্ট × ২-থিম ভিজ্যুয়াল ম্যাট্রিক্স + axe গেট, আর একটা
প্রোডাকশন কন্ট্রাক্ট-ড্রিফট বাগ ফিক্স।

## ১. প্রোডাকশন ইনসিডেন্ট: `{ items }` কন্ট্রাক্ট ড্রিফট

- **লক্ষণ:** লাইভ ওয়েব (legacy PWA) সাইন-ইন সেশনেও "কোনো চ্যাট নেই" দেখাত;
  WS কানেক্টেড, `/api/me` ঠিক, `/api/conversations` 200 — ডায়াগনস্টিক সেশন
  দিয়ে প্রমাণ: সার্ভার ৬টা চ্যাট পাঠাচ্ছিল `{"items":[…]}` র‍্যাপারে।
- **রুট কজ:** দুই ক্লায়েন্টই পুরনো `conversations` কি পড়ছিল; E2E মকও একই
  ভুল কি ফেরত দিত, তাই স্যুট সবুজ থাকত অথচ লাইভ সার্ভারের সাথে কন্ট্রাক্ট মিলত
  না। hotfix PR #90 (legacy) + এই স্লাইস (React ক্লায়েন্ট ও সব মক) ফিক্স।
- **পিন:** case 04 (সার্ভার `items`), case 55 (legacy ক্লায়েন্ট), case 78
  (React ক্লায়েন্ট + চার মক)। ভবিষ্যতে কেউ আবার ভুল কি আনলে তিন দিক থেকে ধরা
  পড়বে।

## ২. থিম প্যারিটি

### গ্লোবাল অ্যাপিয়ারেন্স (Theme.kt ↔ appTheme.ts)
- Android: SharedPreferences `kp`/`app_theme`, values `dark_blue|light`, ডিফল্ট
  dark_blue; বদলালে activity রি-ক্রিয়েট। Web: একই key/values localStorage-এ
  (`kp.app_theme`), `<html data-kp-theme>` অ্যাট্রিবিউট; `main.tsx` ফার্স্ট
  পেন্টের **আগে** অ্যাপ্লাই করে (ডার্ক ফ্ল্যাশ নেই), React সাবস্ক্রাইব করে
  (`useAppTheme`)।
- সার্ভার রাউন্ড-ট্রিপ নেই — ফোনও থিম ডিভাইস-লোকাল রাখে; সেটিংস কার্ড সেটা
  স্পষ্ট লেখে ("the phone app keeps its own choice")।
- Light প্যালেট Theme.kt হুবহু: bg `#F7F6F4`, card `#FFF`, ink `#1C1917`,
  line `#E8E4DE`। একমাত্র ইচ্ছাকৃত বিচ্যুতি: light muted `#6B6156` (Theme.kt-র
  `#7A6F63` নয়) — 9px রেইল লেবেলে `#7A6F63` ক্রিমের ওপর 4.34:1, WCAG AA-র
  নিচে; axe গেট ধরায় এক শেড গাঢ় করা হয়েছে।

### পার-চ্যাট থিম (ChatScreen.kt ↔ chatTheme.ts)
- পাঁচ থিম: `darkblue` (ডিফল্ট), `default` (ক্লাসিক ক্রিম), `mint`, `rose`,
  `night` — wallpaper/accent/own-gradient/other-fill/night-ink সব মান
  ChatScreen.kt (round 14/19/20) থেকে value-for-value পোর্ট।
- পার্সার Android-র `cTheme()`-এর মতো blank→`darkblue` নরমালাইজ করে।
- স্টোরেজ সার্ভার-সাইড (বিদ্যমান `PATCH /api/conversations/:id {theme}`);
  optimistic flip + 403/নেটওয়ার্ক ফেইলে রোলব্যাক + honest notice। GROUP-এ
  non-owner পিকারই পায় না ("Only the group owner…") — Worker-এর গেটের হুবহু
  মিরর।
- রেন্ডার CSS কাস্টম প্রপার্টিতে (`--chat-*`), chat pane-এ স্কোপড — দুই খোলা
  চ্যাট কখনও রঙ লিক করে না; ফলব্যাকসহ, তাই থিম ছাড়া পুরনো চেহারা অক্ষত।

### ইচ্ছাকৃত গ্যাপ (ভবিষ্যৎ স্লাইস)
- light মোডে Android-র action accent গোল্ড; Web এখনো দুই মোডেই নীল রাখে
  (নীল `#2F6FED` সাদার ওপর ≈4.6:1 — AA পাস করে, তাই এটা কসমেটিক পছন্দ, বাগ নয়)।
- মিডিয়া ওভারলে/এডিটর-স্টেজ ইচ্ছাকৃতভাবে দুই থিমেই ডার্ক (YouTube-স্টাইল well)।

## ৩. মোশন

- সব অ্যানিমেশন দুই টোকেনে (`--kp-motion-fast/normal`); `prefers-reduced-motion:
  reduce`-এ টোকেন `0ms` + styles.css-এ গ্লোবাল কিল-সুইচ (`animation-duration:
  0.01ms !important` ইত্যাদি) — টোকেন ভুলে যাওয়া সারফেসও থেমে যায়।
- E2E (`motion.spec.ts`): reduce-এ টোকেন 0 ও রো-এর computed duration ≤0.01ms;
  no-preference-এ 150/220ms ফিরে আসে।

## ৪. অ্যাক্সেসিবিলিটি গেট

- `themeMatrix.spec.ts`: ৪ ব্রেকপয়েন্ট (390×844, 768×1024, 1366×768, 1920×1080)
  × ২ গ্লোবাল থিম — প্রতি কম্বোতে লিস্ট স্ক্রিনের স্ক্রিনশট আর্টিফ্যাক্ট +
  axe (wcag2a/2aa/21a/21aa/22aa) **শূন্য ভায়োলেশন**; ডেস্কটপে খোলা চ্যাটও
  দুই থিমে স্ক্যান।
- পিকার: নেটিভ radio semantics (`role=radiogroup/radio`), কীবোর্ড-নাভিগেবল,
  প্রতিটা সোয়াচে বাংলা+ইংরেজি aria-label।
- নোট: axe gradient ব্যাকগ্রাউন্ডে contrast নোড "incomplete" করে বাদ দেয় —
  সেই অন্ধত্ব দূর করতেই লাইট থিমের স্ট্রাকচারাল সারফেস টোকেন/ওভাররাইডে আনা
  হয়েছে, যাতে প্রতিটা দৃশ্যমান জোড়া computable হয়।
- স্ক্রিনশট গেটের সীমা: `maxDiffPixelRatio 0.01` ছোট এলাকার রঙ-ভুল
  (যেমন একটা হেডার টেক্সট) নীরবে পাশ করিয়ে দিতে পারে — তাই প্রতি রি-জেনারেশনে
  বেসলাইনগুলো চোখে রিভিউ বাধ্যতামূলক; এই স্লাইসে একটা পুরনো বেসলাইন এভাবেই
  ধরা পড়ে ঠিক করা হয়েছে। গেট = পিক্সেল-ডিফ + axe + মানুষের চোখ, তিনটা মিলে।

## ৫. CSP / XSS

- React শেলে (`web/index.html`) meta CSP:
  `default-src 'self'; script-src 'self' https://accounts.google.com;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
  media-src 'self' blob:; connect-src 'self' ws: wss: https://accounts.google.com;
  frame-src https://accounts.google.com; font-src 'self' data:;
  object-src 'none'; base-uri 'self'; form-action 'self'`
- যুক্তি: একমাত্র থার্ড-পার্টি Google Identity Services (লগইন); ইনলাইন
  `<script>` কোথাও নেই, তাই script-src-এ `'unsafe-inline'` লাগেনি;
  style-src-এ `'unsafe-inline'` কারণ GSI স্টাইল অ্যাট্রিবিউট ইনজেক্ট করে এবং
  legacy index.html-এর ইনলাইন `<style>`; `frame-ancestors` meta-তে অচল —
  Worker-ডিপ্লয়ের দিন সার্ভার হেডারে যোগ করতে হবে (এখনো production-এ React
  অ্যাপ শিপ হয়নি, তাই হেডার-পথ পরের সিদ্ধান্ত)।
- XSS অডিট: `web/src`-এ `innerHTML`/`dangerouslySetInnerHTML` শূন্য (React
  ডিফল্ট এস্কেপিং); legacy `public/app.js` `esc()` দিয়েই রেন্ডার করে (আগের
  স্লাইসের অডিট অক্ষত); মিডিয়া URL same-origin `/api/files/:key` allowlist।
- পিন: case 78 — CSP উপস্থিতি, directive সেট, আর ক্লায়েন্টদের রেফারেন্স করা
  প্রতিটা https অরিজিন পলিসিতে কভার্ড কি না (আজ: শুধু accounts.google.com)।

## ৬. IndexedDB ও অ্যাকাউন্ট আইসোলেশন

- এক DB (`kp-web-messaging`, stores: outbox + drafts) — আনসেন্ট টেক্সট/ড্রাফ্ট;
  বাইনারি মিডিয়া কখনও পারসিস্ট হয় না (কোটা-ঝুঁকি নেই; বড় ফাইল সরাসরি
  আপলোড)।
- যেকোনো সাইন-আউট — ম্যানুয়াল বা 401-ফোর্সড — পুরো DB `deleteDatabase` করে
  (`deleteMessagingDatabase()`, best-effort: blocked handle-ও সাইন-আউট আটকায়
  না)। পরের লগইন কখনও আগের অ্যাকাউন্টের আনসেন্ট বাইট পায় না।
- IDB unavailable (private mode) হলে মেমোরি ফলব্যাক — আচরণ আগেই ছিল, অক্ষত।
- E2E (`isolation.spec.ts`): ড্রাফট লিখে সাইন-আউট → DB সত্যিই ডিলিটেড;
  401-রিলোডেও একই।

## ৭. বান্ডল

- রুট-স্প্লিট ইতিমধ্যে আছে: entry 300.89 kB (gzip 91.84 kB); ভারী সারফেস আলাদা
  চাঙ্কে — MessagingWorkspace 95.56 kB, CallsLayer 48.64 kB, StatusWorkspace
  38.13 kB, PhotoEditor/DocViewer/StickerPicker 7–12 kB। 500 kB ওয়ার্নিং
  থ্রেশহোল্ডের নিচে; নতুন কোড (theme/chatTheme) ≈3 kB। প্রতি স্লাইসে মাপ
  রেকর্ড করার নিয়ম থাকল; আজ অ্যাকশন লাগেনি।

## ৮. গেট সারাংশ

- নতুন স্যুট `playwright.hardening.config.ts` → `web/e2e-hardening/` ২০ টেস্ট
  (ম্যাট্রিক্স ৮ + চ্যাট-ভিউ ২ + অ্যাপিয়ারেন্স ১ + চ্যাট-থিম ৪ + আইসোলেশন ২ +
  মোশন ৩), সব সবুজ; স্ক্রিনশট বেসলাইন রিপোতে কমিটেড।
- case 78 (১৯ চেক) + বিদ্যমান সব স্যুট `npm run ci`-তে।
- Worker/Android/legacy `public/`-এর রুট কোডে এই স্লাইসের কোনো পরিবর্তন নেই
  (legacy-র এক লাইন PR #90-এ আগেই শিপ হয়েছে)।
