# 🔔 FCM Push Setup — ✅ DONE (2026-08-27)

> **STATUS: COMPLETE!** FCM_CONFIG + FCM_CREDENTIALS secrets set on `kuchupuchu-api` worker.
> Live check: `GET /api/config/firebase` returns full config. OAuth mint test: Google accepted ✓.
> Ei document ta future reference er jonno rakha — apnar abar korte hobe na.

## Original guide (already completed)

Ei setup korle **permanent "KuchuPuchu connected" notification completely off** hoye jabe, ar message/call notification **Facebook Messenger er moto** app closed thakleo instant ashbe.

Apnar lagbe: ekta **Google account** (Gmail). Baki sob code ami already kore diyechi.

## Step 1 — Firebase Project banaun (free)

1. Browser e jan: **https://console.firebase.google.com**
2. Gmail diye login korun
3. **"Add project"** (ba "Create a project") e click korun
4. Project name: `KuchuPuchu` → **Continue**
5. "Google Analytics" toggle **off** kore din (lagbe na) → **Continue** → **Create project**
6. Project toiri hole **Continue** click korun

## Step 2 — Android app add korun

1. Project overview page e **Android icon** ( `</>` shokol jinish er upor koyekta icon thakbe, Android botam ta) e click korun
2. **Android package name** box e exact ei ta likhun:
   ```
   app.kuchupuchu.android
   ```
   (Ekdom thik eivabe — extra space ba capital hote parbe na!)
3. App nickname: `KuchuPuchu` → **Register app**
4. **Download `google-services.json`** button e click kore file ta download korun
5. "Next" gulo skip kore **Continue to console**

## Step 3 — google-services.json ta Worker e din

1. Download kora `google-services.json` ta **Notepad** (ba jekono text editor) diye open korun
2. **Puro content select kore copy korun** (Ctrl+A, Ctrl+C)
3. Terminal e KuchuPuchu project folder giye likhun:
   ```
   npx wrangler secret put FCM_CONFIG
   ```
   Enter chaple ekta prompt ashbe — **paste korun** (right-click > paste) → Enter

## Step 4 — Server key download korun

1. Firebase console e **⚙️ Project settings** e jan (top-left "Project overview" er pashe gear icon)
2. **Service accounts** tab e click korun
3. **"Generate new private key"** button e click → **Generate key** → ekta `.json` file download hobe
4. File ta Notepad diye open kore **puro content copy korun**
5. Terminal e:
   ```
   npx wrangler secret put FCM_CREDENTIALS
   ```
   → paste → Enter

## Step 5 — Deploy + Enjoy

```
npx wrangler deploy
```

Ekhon phone e app khule dekhen:
- ✅ Permanent notification **ar nai**
- ✅ App closed/killed thakleo message ashlei notification ashe
- ✅ Call ashle phone baje (full-screen ringing)

## Jodi kono problem hoy

| Symptom | Check |
|---|---|
| Notification ashe na | Phone e Settings → Apps → KuchuPuchu → Battery → **"No restrictions"** + Notifications **on** |
| Setup korao kaj korchhe na | `npx wrangler secret list` — `FCM_CONFIG` ar `FCM_CREDENTIALS` dutai ache kina dekhen |
| Wrong package name dile | Step 2 e `app.kuchupuchu.android` thik likha hoyechhe kina abar check korun |
| Push chhere service mode e phire jete chan | Worker theke `FCM_CONFIG` secret delete korun (`npx wrangler secret delete FCM_CONFIG`) — app automatic service mode e phire jabe |

**Note:** FCM na thakle app automatic bhabe aager system e cholbe (foreground service + silent notification) — kichu vangbe na. Migration 100% safe.


---

# 📱 Phone Auth Google Setup (v3.9 — REQUIRED for new sign-ups)

Email/password login was removed (see `PHONE_AUTH_PLAN.md`). Every NEW account
now binds a Gmail for recovery, and lost-device recovery uses it too. Ei setup
ta chara **notun account create hobe na** (Google bind 503 dibe).

## Step 1 — Google sign-in enable korun

1. https://console.firebase.google.com → **KuchuPuchu** project
2. **Build → Authentication → Get started** (age kore thakle skip)
3. **Sign-in method** tab → **Google** → Enable → Save

## Step 2 — Web Client ID copy korun

1. Same Authentication page e **Sign-in method → Google** row te
   **Web SDK configuration** section dekhben
2. **Web client ID** ta copy korun (`.apps.googleusercontent.com` diye shesh)

## Step 3 — Worker e secret din

```bash
npx wrangler secret put GOOGLE_WEB_CLIENT_ID
# paste korun oi Web client ID ta, Enter
npx wrangler deploy
```

## Verify

```bash
curl https://kuchupuchu-api.kuchupuchu.workers.dev/api/config/firebase
# "googleWebClientId":"....apps.googleusercontent.com" asha uchit
```

App e: phone number diye Continue → notun hole **Continue with Google** button
kaj korbe. Jodi "not set up" error ashe → Step 3 check korun.

## Legacy account (email/password) owners

Prothom bar phone diye login korar somoy **oi email er Gmail** diye Google
sign-in korun — purano account-ta (chats soho) automatic migrate hoye jabe,
phone bind hoye jabe. Onno Gmail dile notun alada account hobe.


---

## 🔄 v3.9 cutover notes (2026-09-03)

- Firebase project switched to **kuchupuchuff2026** (old FCM config/credentials
  replaced on the worker). App nimoy — it pulls the config from
  `/api/config/firebase` at runtime, no APK-side change needed.
- `GOOGLE_WEB_CLIENT_ID` secret set from this project's Web OAuth client
  (client_type 3 in google-services.json).
- **Fresh start:** all old accounts/chats/media/files were erased from D1 and
  R2 — everyone signs up anew with a phone number. Legacy email-migration code
  stays but has nothing to migrate against.

---

## 🌐 Web on Firebase Hosting (kuchupuchu.web.app) — 2026-10-12

The shell lives on Firebase Hosting while the API stays on the Worker.
The build reads `VITE_KP_API_ORIGIN` (https-only) and points every `/api`
request and `/ws` socket at that origin; the Worker already answers `/api`
with permissive CORS headers, so no Worker change is needed.

The Firebase project is **kuchupuchuff2026** (same project as the Android
app). Its *default* hosting site would be `kuchupuchuff2026.web.app`, so
`kuchupuchu.web.app` must be added as a second site (step 2 below).

### One-time manual steps (console + CLI)

1. **Install the CLI once:** `npm i -g firebase-tools && firebase login`.
2. **Create the site id:** console.firebase.google.com → project
   **kuchupuchuff2026** → Hosting → **Add another site** → site id
   `kuchupuchu` → Create. This reserves `https://kuchupuchu.web.app`.
3. **Point the CLI at the project** (from this repo root, where
   `firebase.json` lives): `firebase use --add` → pick
   `kuchupuchuff2026`, alias `default`. This writes `.firebaserc`.
4. **Authorize the origin for Google verify:** console.cloud.google.com →
   project **kuchupuchuff2026** → APIs & Services → Credentials → open the
   Web client `458576897499-1khrecq3eli0obsr6vc3q2k0q1e86rpg.apps.googleusercontent.com`
   → **Authorized JavaScript origins** → Add URI `https://kuchupuchu.web.app`
   → Save (propagates in a few minutes). Without it the Google popup answers
   `Error 400: origin_mismatch`. Add `https://kuchupuchuff2026.web.app` too if
   you ever open the default site. The Worker secret `GOOGLE_WEB_CLIENT_ID`
   is already set (live `/api/config/firebase` returns the client id), so no
   wrangler step is needed for verify.
5. Optional niceties: Hosting → `kuchupuchu` site → Settings → add
   `www.kuchupuchu.web.app` etc. only if you want extra domains.

### Every deploy after that

```bash
npm run build:web:firebase     # prod flags + VITE_KP_API_ORIGIN=<worker url>
firebase deploy --only hosting # uses firebase.json (web/dist + SPA rewrite)
```

`firebase.json` (committed) serves `web/dist`, falls back to `index.html`
for SPA routes like `/chats` or `/account`, keeps `sw.js`/`index.html`
no-store so a fresh shell always wins, and caches hashed `/assets/*`
for a year.

The proof screen pulls `googleWebClientId` from `/api/config/firebase` at
runtime — with the API origin configured it reaches the Worker cross-origin,
so once step 4 propagates the "Continue with Google" button mints a token
from `kuchupuchu.web.app` and the H2 phone-proof completes in the browser.

## ⚠️ 2026-10-18 — the worker secret store was lost (owner action needed)

Ekta operator mistake-e `kuchupuchu-api` script-er delete hoye gelo, tar sathe
**secret store** o chole gelo (Cloudflare secret **likha** jay, **pore** jay
na — tai purono value ghono kora jay ni). Script-ta 1 minute-eo porer bar
redeploy kora hoye gelo, TURN key gulo o abar bosha hoye gelo (call relay
thik ache, `docs/call-relay-2026-10-18.md`), kintu **nicher owner secrets
gulo ekhon edge-e nai**:

| Secret | Ki kaj kore | Kivabe fothobe |
| --- | --- | --- |
| `FCM_CREDENTIALS` | Firebase service account (private key) — FCM push | Firebase console → Project settings → **Service accounts** → *Generate new private key* → JSON ta download kore `npx wrangler secret put FCM_CREDENTIALS` |
| `FEDERATION_PUSH_KEY` | core-er push relay (`/api/internal/federation/push`) er shared key | **same value** ta core-eo lagbe, tai core-er deployment-e o `npx wrangler secret put FEDERATION_PUSH_KEY` korte hobe |
| `WS_TICKET_KEY` | `/api/ws/ticket` signing | `npx wrangler secret put WS_TICKET_KEY` (ekta random 32-byte base64) |
| `LOGIN_OTP_HMAC_SECRET` | OTP login | `npx wrangler secret put LOGIN_OTP_HMAC_SECRET` |
| `VAPID_PRIVATE_KEY` | web push | `npx wrangler secret put VAPID_PRIVATE_KEY` |
| `GEMINI_API_KEY` | AI reply | `npx wrangler secret put GEMINI_API_KEY` |
| `HF_TOKEN` | AI image | `npx wrangler secret put HF_TOKEN` |
| `CF_AI_TOKEN` | Workers AI | `npx wrangler secret put CF_AI_TOKEN` |
| `LARAVEL_BRIDGE_KEY` | classroom entitlement bridge | `npx wrangler secret put LARAVEL_BRIDGE_KEY` |

Already restored (ebar): `FCM_CONFIG` (core-er `/api/config/firebase` theke
rebuilt) ar `GOOGLE_WEB_CLIENT_ID` (same source theke) — eider jonno abar
kono download lagbe na.

**Bhalo khobor:** cutover-er por live host **core-e proxy kore**, tai ei
secret-gulo na thakle o message/chat/web/call relay kaj kore — shudhu
**edge-er nijer FCM push path** (core relay korle) break hobe. Tar jonno
`FCM_CREDENTIALS` + `FEDERATION_PUSH_KEY` age bosano bhalo.

**Secret upload ekta request-e ekta secret**:
`{"name":"…","text":"…","type":"secret_text"}` — `{"body":{…}}` dile
`400 Binding must have a name` ashbe.
