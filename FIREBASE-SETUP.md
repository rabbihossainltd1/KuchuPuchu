# 🔔 FCM Push Setup — 10 Minute (Ekbar Korlei Hoy)

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
