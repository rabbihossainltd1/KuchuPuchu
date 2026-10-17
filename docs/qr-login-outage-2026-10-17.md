# QR login is missing on production (Firebase) — root-cause report

**Date:** 2026-10-17
**Production web:** `https://kuchupuchu.web.app` (Firebase Hosting)
**Preview web:** `https://kuchupuchu-api.kuchupuchu.workers.dev` (Cloudflare Workers Assets)
**API (both):** `https://kuchupuchu-api.kuchupuchu.workers.dev` → D1 `kuchupuchu-v3-apac`

---

## 0. TL;DR

There are **two independent faults**, and the QR screen is the visible symptom of both.

1. **The Firebase deployment is three days behind `main`.** The QR feature (phase R9) landed
   on 2026-10-17; the live Firebase build is from 2026-10-14 03:22 UTC. The QR login code
   is **not in the deployed bundle at all** — the screen literally does not exist on
   production. *(verified: 0 occurrences of `weblogin` in the live Firebase bundle)*

2. **D1 writes are failing right now — the account blew the D1 free-tier daily quota.**
   Every write path answers `503 BUSY` (or `500 CLOUD`), so QR login cannot work even
   after the frontend is redeployed. Reads still work. The quota resets at **00:00 UTC**.

3. **A code-level death spiral makes the quota incident self-sustaining** (see §3):
   the schema walk re-runs on *every cold isolate* — ~90 DDL statements, several of which
   build an index over a full production table — because the write that records the
   "schema already applied" fingerprint is itself blocked by the quota. The walk keeps
   burning the row-read budget that is already exhausted.

---

## 1. Fault #1 — production has no QR login (frontend is stale)

### Evidence

| Check | Result |
|---|---|
| Firebase `last-modified` on `/` | `Wed, 14 Oct 2026 03:22:32 GMT` |
| Firebase main bundle | `/assets/index-kh1TWpWx.js` |
| Cloudflare preview bundle | `/assets/index-COwVkRD0.js` |
| `weblogin` string in Firebase bundle | **0 hits** (0/0/0 across all 3 chunks) |
| `weblogin` string in Cloudflare bundle | **1 hit** in `index-COwVkRD0.js` |

### Why

```
4a7382c1  2026-10-17 14:21  feat(worker): QR login + QR profile-share backend (phase R9)
07b55d33  2026-10-17 14:30  feat(web): QR-first login screen (phase R9)
345cd9b1  2026-10-17 15:13  feat(android): QR scan/share
39df976c  2026-10-17 09:25  release: bump Android to v283 (3.9.206) for the QR scan/share (#150)
```

`main` is at `39df976c` (Oct 17). The Firebase Hosting upload is from Oct 14 — three days
and four feature commits earlier. Cloudflare preview is on the current `main`.

### Fix

```bash
npm ci
npm run build:web:firebase     # prod flags + VITE_KP_API_ORIGIN=<worker url>
firebase deploy --only hosting
```

Prereqs (both currently missing in this checkout):

* `firebase` CLI — `npm i -g firebase-tools && firebase login`
* `.firebaserc` — the file is **not in the repo**; `firebase use --add` → project
  `kuchupuchuff2026`, alias `default` (per `FIREBASE-SETUP.md`)

A fresh `build:web:firebase` was produced in this workspace and **verified**:

* `weblogin` present in `web/dist/assets/index-DT2vxvqA.js` ✅
* `web/dist/index.html` CSP `connect-src 'self' https://kuchupuchu-api.kuchupuchu.workers.dev ws: wss: https://accounts.google.com` ✅ (cross-origin API reachable)
* `sw.js` build id `c2f21c66ef4c5b83`, precache + the 7 static site pages regenerated ✅

### Also fixed by the same redeploy

The live Firebase site is missing headers the committed `firebase.json` already declares —
no `Content-Security-Policy` response header, no `X-Content-Type-Options`, no
`Referrer-Policy`, and the `/download/apk` redirect is absent (it serves the SPA shell).
Because the meta CSP cannot carry `frame-ancestors`, the Firebase-hosted shell currently
has **no clickjacking protection**, while the Cloudflare preview has
`frame-ancestors 'self' <panel origins>` stamped by the worker.

---

## 2. Fault #2 — D1 writes are failing (free-tier daily quota exhausted)

### Evidence (live, `https://kuchupuchu-api.kuchupuchu.workers.dev`)

| Request | Result |
|---|---|
| `GET /api/health` | `200` (read ✅) |
| `POST /api/auth/logout` + bearer | `200` — runs `SELECT … FROM sessions` (read ✅) |
| `POST /api/auth/qr/start` | **`503 BUSY`** `retry-after: 45` (write ❌) |
| `POST /api/auth/verify-phone` | **`503 BUSY`** `retry-after: 45` (write ❌) |
| `POST /api/auth/login/poll` | `400` — validation rejects before any DB call |

The `503 BUSY` + `Retry-After: 45` body is the worker's own quota branch
(`src/worker/index.ts` ~line 6870), which fires when the thrown D1 error matches
`/free tier|row read limit|read limit/i`. That is Cloudflare's message for
**"Your account has exceeded D1's free tier daily row read/write limit."**

Per the D1 changelog (effective 2026-09-01), on the Workers **Free** plan the account
gets **5 M rows read/day** and **100 k rows written/day**, and once either is crossed
**every D1 query is refused** until 00:00 UTC.

### Blast radius

This is not a QR-only problem. **Every write in the product is currently refused**:
sign-up, OTP, message send, media upload, status post, call signalling, push
registration. The app is read-only right now.

### Operational fixes (pick one)

| Option | Effect |
|---|---|
| **Wait for 00:00 UTC** (~7 h from the time of this report) | Quota resets, writes recover — *unless* the walk in §3 burns it again |
| **Upgrade the Cloudflare account to a paid plan** | Removes the daily cap (25 B rows read/month, 50 M written/month) — the only durable fix |
| Cut read amplification | See §3 |

---

## 3. Fault #3 — the schema-walk death spiral (why the quota incident persists)

### The mechanism

`ensureSchema()` (`src/worker/index.ts` ~3677) is meant to run its DDL walk **once** per
schema change. It is fingerprinted: after a successful walk the fingerprint is stored in
`schema_meta`, and a later isolate that finds the same fingerprint does a single `SELECT`
and returns.

The fingerprint is written by a **write**:

```js
if (allApplied) {
  try { await run(db, "INSERT OR REPLACE INTO schema_meta (key, value, updated_at) VALUES (?, ?, ?)"); }
  catch (err) { console.error("schema fingerprint not recorded: …"); }
}
```

When D1 writes are refused (the quota), that write fails, `schema_meta` never gets the
fingerprint, and **every cold isolate re-walks the entire list** — ~90 statements, of which
several are `CREATE INDEX`/`CREATE UNIQUE INDEX` over full production tables
(`users`, `messages`, `calls`, `files`, `statuses`, …). Each of those scans a whole table.
The walk therefore *consumes* the row-read budget that is already exhausted, and keeps
the incident alive instead of letting it heal at 00:00 UTC.

### Evidence

* Cold isolate → **25–29 s** per request. Warm isolate → **0.4 s**.
  A matching fingerprint would make `ensureSchema` one `SELECT` (~0.3 s). The 25 s gap
  *is* the walk. It is not being skipped.
* `schemaReady` is module-scope, so it is per-isolate; the walk repeats for each new one.
* The repo already documents this failure mode in the worker's own comments: *"placed any
  earlier it fails the walk and skips the schema fingerprint … which would re-walk the
  whole list on every cold boot."* The `linked` backfill migration is pinned LAST for
  exactly this reason.

### Proposed fix (not yet applied)

1. **Abort the walk on a quota error.** Detect the limit error in the migration loop and
   stop immediately instead of running the remaining ~90 statements — each one costs row
   reads. This is the single change that breaks the spiral.
2. **Write the fingerprint before the expensive index builds.** Split `migrations` into
   cheap DDL (record fingerprint here) and index builds (tracked separately), so a burst
   of cold isolates cannot each rebuild every index.
3. **Cooldown.** On a quota error, stamp a module-level `schemaBlockedUntil` and skip the
   walk entirely for a few minutes instead of retrying it per request.

The fingerprint-walk invariant is pinned by contract case 27; any change must keep that
test green.

---

## 4. Fault #4 — the scanning phone needs Android v283

The web shows a QR encoding `kuchupuchu://weblogin/<token>`
(`web/src/auth/QrLoginPanel.tsx`). The phone side that resolves it —
`native-android/…/QrScreen.kt`, hitting `POST /api/auth/qr/:token/confirm` and
`GET /api/users/by-qr/:code` — was added in `345cd9b1` and shipped as **v283 (3.9.206)**.
An APK older than v283 cannot scan the web-login code at all.

`native-android/app/build.gradle.kts` is already at `versionCode = 283` / `versionName = 3.9.206`.

So after redeploying the web, the phone must also be on v283 — CI artifact `app-release.apk`
from the latest run, or a local `./gradlew assembleDebug`.

---

## 5. Checklist

- [ ] Wait for 00:00 UTC (quota reset) **or** upgrade the Cloudflare plan → writes recover
- [ ] Apply the §3 schema-walk fix so the next quota event heals instead of spiralling
- [ ] `npm run build:web:firebase` + `firebase deploy --only hosting` → QR login appears on `kuchupuchu.web.app`
- [ ] Confirm the live Firebase response carries the CSP / `nosniff` / `Referrer-Policy` headers and that `/download/apk` redirects
- [ ] Install Android **v283** on the phone that will scan the code
- [ ] Add `https://kuchupuchu.web.app` to the Google OAuth client's *Authorized JavaScript origins* (otherwise the "Continue with Google" button answers `400 origin_mismatch`)

## 6. Local code is not at fault

* `node --import tsx test/cases/99-qr-login-and-share.mjs` → **23/23 OK** against the real
  worker on an in-memory D1 (mint → poll → confirm → claim → single-use → expiry → share
  code → reset).
* A production-shaped reproduction (old pre-QR worker creates the schema, new worker then
  serves it) mints a QR token with `201` and polls `PENDING` — the migration path from the
  live database's older schema is correct.
* `test/repro-qr-prod.mjs` in this workspace holds that reproduction.

---

## 7. What was deployed on 2026-10-17 (same day)

| # | Change | Where | Result |
|---|---|---|---|
| 1 | `src/worker/index.ts` — the schema walk stops at a quota refusal; a 5-minute per-isolate cooldown; a refused batch no longer 500s every endpoint; a blocked walk answers 503 BUSY + `Retry-After` | `kuchupuchu-api` Worker, versions `ebe79bf3` then `2be44941` | **Cold-start 25–29 s → 3.8 s** (measured live) |
| 2 | `native-android/app/build.gradle.kts` — `versionCode 284`, `versionName 3.9.207`; `release.yml` + three contract cases re-pinned to v284 | commit `b834a7d2` | the in-app updater has a newer release to find |
| 3 | **Firebase production** — `npm run build:web:firebase` + `firebase deploy --only hosting --project kuchupuchuff2026` | `https://kuchupuchu.web.app` | **QR login is live on production**; CSP + `frame-ancestors 'self'` + `nosniff` + `Referrer-Policy` now served; `/download/apk` redirects (302) instead of serving the SPA |
| 4 | GitHub APK Release `v284` (debug keystore, v274 certificate continuity verified in CI) | `github.com/rabbihossainltd1/KuchuPuchu/releases` | the phone-side QR scanner (`QrScreen.kt`, shipped in v283 but never released) reaches phones for the first time |

### Still open

* **D1 writes stay refused until 00:00 UTC** (the daily row budget). The fix stops the
  incident from spreading and makes the app answer honestly (`503 BUSY` + `Retry-After`,
  so the Android pollers back off), but it cannot refund a spent budget. A paid plan
  removes the ceiling entirely.
* **`https://kuchupuchu.web.app` must be added to the Google OAuth client's
  *Authorized JavaScript origins*** in the Google Cloud console
  (`458576897499-1khrecq3eli0obsr6vc3q2k0q1e86rpg.apps.googleusercontent.com`), or the
  "Continue with Google" button answers `400 origin_mismatch`. That is a console step
  only the owner can take.
* **v283 was never published as a release** — the repo's version code said 283 while
  GitHub's latest release was v282, so the QR scanner had never reached a phone.
