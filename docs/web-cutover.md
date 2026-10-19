# Slice J — Production cutover: React PWA এখন লাইভ ওয়েব ক্লায়েন্ট

> অবস্থা: মার্জড (PR #92 + #93 এক parallel session থেকে; PR #94 integration-এ
> header মেকানিজম বদল)। মালিক সরাসরি প্রতিস্থাপন (replace) অনুমোদন করেছেন;
> দুটো session-এর দ্বন্দ্বে মালিক worker-stamped হেডার বেছে নিয়েছেন।

## ০. দুই implementation-এর ইতিহাস

একই দিনে দুই session একই cutover বানিয়ে ফেলে: প্রথমটা (#92) `_headers`
ফাইলে হেডার দেয়, #93-এ সেটা polish; দ্বিতীয়টা (#94, এই branch) Worker-এর
`serveShellAsset()`-এ হেডার ছাপে। মালিকের সিদ্ধান্তে #94-ই চূড়ান্ত মেকানিজম;
`_headers` ফাইল আর `[[assets.rules]]` দুটোই অবসর। কারণ:

- `[[assets.rules]]` হেডারের জন্য **নীরবে উপেক্ষিত** — লাইভ ডিপ্লয়ে প্রমাণিত
  (#93-এর কমিট বার্তা)।
- `_headers` কাজ করছিল, কিন্তু দুটো আলাদা source of truth (meta + ফাইল +
  ভবিষ্যতের worker) রাখার চেয়ে একটা পরীক্ষাযোগ্য worker-পথ পরিষ্কার।
- worker-stamp contract case 79-এ সরাসরি পিন করা যায়; `_headers`-এর runtime
  আচরণ wrangler-এর খেয়ালখুশির ওপর থাকে।

### সংশোধনী (2026-10-19): stale-edge-cache বাগ — মেকানিজম `serve-directly`-তে ফেরত

লাইভে ব্র্যান্ড কাটওভার মনিটর করে পাওয়া গেল: `/`, `/logo.png`, `/assets/*`
ক্লায়েন্টকে নতুন বিল্ডের বদলে **আগের বিল্ড** দেখাচ্ছিল। ডিবাগ রুট দিয়ে ভেতরে
দেখা গেল `env.ASSETS` নতুন বিল্ডই সার্ভ করছে — শুধু পাবলিক পথে পুরোনোটা। অর্থাৎ
`run_worker_first = ["/*"]` করলে প্রতিটা স্ট্যাটিক রিকোয়েস্ট worker-এর ওপর
দিয়ে যায়, আর Cloudflare-এর ক্যাশে worker-stamped আগের উত্তরটা URL-চাবিতে বসে
থাকে — তাতে version ভাগ নেই, তাই ডিপ্লয়েও আপডেট মেলে না। পরীক্ষা:

- ৫+ `wrangler deploy` (একবার ১৭টা সত্যিকার নতুন অ্যাসেট ব্রাউনফিল্ডে);
- `run_worker_first = true` (serve_directly বন্ধ);
- `[assets]` পুরোপুরি সরিয়ে ডিপ্লয়;

— প্রতিটার পরেও পাবলিক আগেরই সামগ্রীর `cf-cache-status: HIT` দেখাচ্ছিল; শুধু
মিরর (`run_worker_first = ["/api/*","/ws/*"]`) নতুন বিল্ড পেয়েছিল। Cloudflare
কমিউনিটিতেও এটা পুরনো অমীমাংসিত সমস্যা (serve-directly স্ট্যাটিক ম্যানিফেস্ট
বাগ + পার-ডিসি ক্যাশ সপ্তাহজুড়ে), workers.dev এ zone না থাকায় purge করা যায় না।

**স্থির ব্যবস্থা:** স্ট্যাটিকরা এখন Cloudflare-এর asset layer সরাসরি সার্ভ করে
(single source of truth = assets `_headers` ফাইল — নিজের রেসপন্সেও cache-এ
আঁটকে না), আর রিসার্ভ কোড চাওয়া রুটগুলো ( `/api/*`, `/ws/*`, `/download/apk`)
worker-এই থাকে (R2-তেই). case 79 এখন এটাই পিন করে; worker-এর `serveShellAsset()`
/`shellCsp()` মিরর-জাতীয় binding-free প্রিভিউয়ের fallback হিসেবে থাকে।
আবার worker-stamped হেডারে ফিরতে চাইলে আগে നিশ্চিত করতে হবে worker-রেসপন্স
ক্যাশ version-চাবিতে আঁটকছে কিনা (আজ যাচাইযোগ্য ছিল না)।

বাকি সব ভালো অংশ দুই পক্ষ থেকে নেওয়া হয়েছে: `LEGACY_CACHE_PREFIXES` সুইপ,
precache-এ icon/manifest, `/sw.js`-এ `no-store`, cutover E2E সুট (service
worker সহ একমাত্র সুট), voice player-এর honest `ended` স্টেট, sourcemap বন্ধ,
`public/RETIRED.md`।

## ১. সার্ভিং মেকানিজম

- `wrangler.toml`: `[build] command = "npm run build:web:prod"` — প্রতি
  `wrangler deploy`/`versions upload`-এর আগে বিল্ড; ড্যাশবোর্ড ছোঁয়া লাগেনি।
- `[assets] directory = "./web/dist"`, `binding = "ASSETS"`,
  `run_worker_first = ["/api/*", "/ws/*", "/download/apk"]`,
  `not_found_handling = "single-page-application"`। (2026-10-19-এর আগে এটা
  `["/*"]` ছিল; উপরের সংশোধনীটা দেখো।)
- Worker-এর `fetch()`: `/api/*` ও `/ws/*` আগের মতো REST/সকেট পাথ; বাকিটা স্ট্যাটিক
  এখন Cloudflare asset layer সরাসরি দেয়। নিরাপত্তা হেডার assets `_headers`
  ফাইল থেকে আসে (meta বহন করতে পারে না বলেই frame-ancestors লাগত।)
- preview কনফিগ এখন একই React বিল্ড সার্ভ করে (একই `[build]` হুক), তবে
  production বাইন্ডিং ছাড়া — case 54 সেটা পিন করে।

### প্রোডাকশন রেসিপি

`build:web:prod` = `VITE_KP_WEB_ACCOUNT_INTEGRATION=true
VITE_KP_WEB_MESSAGING=true VITE_KP_WEB_STATUSES=true VITE_KP_WEB_PUSH=true
VITE_KP_WEB_CALLS=true` — অ্যাকাউন্ট + চ্যাট + স্ট্যাটাস + ওয়েব-পুশ + ১:১ কল।
স্ট্যাটাস slice K-তে চালু (ফোন-প্যারিটি; slice F-এর গেটেড + টেস্টেড সারফেস,
২৩-টেস্টের সুট সহ); পুশ slice P-তে চালু (সার্ভারে `VAPID_PRIVATE_KEY` সিক্রেট
বসানো হয়েছে, তাই সেটিংস-কার্ড এখন সত্যিকারের সাবস্ক্রিপশন অফার করে); কলস
slice Q-তে মালিক-অনুমোদনে চালু (১:১ WebRTC; ব্রাউজার-সীমা `docs/web-calls.md`-এ,
TURN ক্রেডেনশিয়াল সার্ভারে আগে থেকেই বসানো)। `media` ফ্ল্যাগ reserved — কিছুই গেট
করে না, চালু করার কিছু নেই (#92 সেটা উল্টেছিল; integration-এ ফেরানো)। ভিট কনফিগে `sourcemap: false` — ডিপ্লয়ের পর `web/dist`-এর সব ফাইল
world-readable, লেগ্যাসি কখনো `.map` ছাপেনি।

## ২. সিকিউরিটি হেডার

HTML ডকুমেন্টে Worker ছাপে `Content-Security-Policy` — meta-র একই ডিরেক্টিভ +
`frame-ancestors 'self'` (meta বহন করতে পারে না বলেই হেডার লাগত); সব
রেসপন্সে `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`;
`/sw.js`-এ `Cache-Control: no-store` — ক্যাশ করা SWই লেগ্যাসি খালি-লিস্ট বাগটাকে
ইনস্টলগুলোর মধ্যে বাঁচিয়ে রেখেছিল, তাই প্রতি আপডেট-চেকে রিভ্যালিডেশন।
meta CSP `index.html`-এ থেকে যায় — worker-বিহীন প্রিভিউয়ের বেল্ট; লাইভে
কার্যকর চুক্তি হেডারটি।

## ৩. সার্ভিস-ওয়ার্কার মাইগ্রেশন (বিদ্যমান ইনস্টল)

বিদ্যমান ইনস্টলে লেগ্যাসি `public/sw.js` (`kp-shell-v1/v2`, cache-first)।
টাইমলাইন:

1. আপডেট-চেকে `/sw.js`-এর নতুন বাইট (no-store, তাই প্রতি চেকে তাজা) →
   React SW (`kp-web-shell-<buildId>`) ইনস্টল, অপেক্ষমাণ (no-skip-waiting —
   খোলা ট্যাব মাঝ-সেশনে ভাঙে না)।
2. ক্লায়েন্ট খালি হলে activate: `LEGACY_CACHE_PREFIXES = ["kp-shell-"]`
   ঝেড়ে ফেলা + ক্লায়েন্ট claim; precache-এ `index.html` + হ্যাশড js/css +
   `icon.svg` + `manifest.webmanifest` (এদের বাইট build-id ঘোরায়)।
3. পরের খোলায় React শেল; navigate network-first, অফলাইনে precached শেল।

SW স্ক্রিপ্টের আপডেট-ফেচ নিয়ন্ত্রিত SW-এর fetch হ্যান্ডলার দিয়ে যায় না, তাই
লেগ্যাসির runtime cache-put বিষ নয়।

### রোলব্যাক সিমেট্রি

রিভার্ট = `public/` আবার সার্ভ; React SW-এর ইনস্টলগুলোর আপডেট-চেকে লেগ্যাসি
`sw.js`-এর ভিন্ন বাইট → লেগ্যাসি SW-এর activate "নিজেরটা ছাড়া বাকি সব"
(`kp-web-shell-*` সহ) মুছবে → লেগ্যাসি ফিরবে। দুই দিকই সেলফ-হিলিং।

## ৪. ইনস্টল মেটাডেটা

React শেল লেগ্যাসির একই `manifest.webmanifest` + `icon.svg` বহন করে
(`web/public/` → বিল্ডে কপি), হোম-স্ক্রিন ইনস্টলের আইকন/নাম অপরিবর্তিত।

## ৫. গেট

- কেস ৭ (integration): সার্ভিং কনফিগ, worker-stamp হেডার, `_headers`/
  `[[assets.rules]]`-এর অনুপস্থিতি, রেসিপির ফ্ল্যাগ সেট, SW মাইগ্রেশন পিন,
  ইনস্টল মেটাডেটা, preview-এর বাইন্ডিংহীনতা।
- `verify:web-sw`: activate-এ `kp-shell-*` ঝাড়ু, no-skip-waiting, precache-এ
  identity ফাইল।
- `test:web:cutover:e2e` (৩ টেস্ট): লেগ্যাসি ক্যাশ seed করে activate-এর ঝাড়ু +
  প্রিক্যাশ-থেকে অফলাইন শেল — একমাত্র সুট যেখানে service worker allowed,
  বিল্ড হয় হুবহু prod স্ক্রিপ্টে।
- full `npm run ci` সবুজ (prod বিল্ড + দ্বিতীয় `verify:web-sw` সহ)।
- মার্জ-পরবর্তী লাইভ: `/`-এ React শেল + CSP হেডার (frame-ancestors সহ),
  `/sw.js`-এ no-store + নতুন worker, `/api/health` 200।

## ৬. যা ইচ্ছে করে ছোঁয়া হয়নি

- `public/` রিপোতে থেকে যাচ্ছে (কন্ট্রাক্ট কেস ০/৫৫ + রোলব্যাক রেফারেন্স,
  `public/RETIRED.md`)।
- Worker-এর const এক্সপোর্ট (কেস ২৭ ইত্যাদি) অক্ষত — লোকাল `wrangler dev`-এর
  workerd সেগুলোতে আগে থেকেই কড়া; প্রোডাকশন রানটাইম (compat 2025-08-01)
  মেনে চলে। লোকাল ডেভ আলাদা সমস্যা, এই স্লাইসের নয়।
