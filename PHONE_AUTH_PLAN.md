# Phone Auth Implementation Plan — email/password বাদ, OTP-less phone auth ইন

> Spec: `PHONE_AUTH_COMPLETE_SPEC.md` (OTP-less phone authentication + single-device + Google binding).
> Ei doc ta spec-ta **ei repo-r upor map** kore — ki ache, ki jabe, ki ashche, ki kivabe implement hobe.

---

## 0. Current system (aj ja ache)

| Piece | File | Ki kore |
| --- | --- | --- |
| `POST /api/auth/register` | `src/worker/index.ts` | email + password → bcrypt-style hash → `users` row + 90-day session |
| `POST /api/auth/login` | `src/worker/index.ts` | email + password verify → session |
| `POST /api/auth/logout` | `src/worker/index.ts` | session delete + oi device-r FCM row delete |
| `POST /api/auth/refresh` | `src/worker/index.ts` | sliding expiry (thakbe) |
| `LoginScreen.kt` | `native-android/.../LoginScreen.kt` | Email/Password/Display-name form + login/signup toggle |
| `sessions` table | D1 | opaque bearer token (hashed), 90 din — **thakbe, system-er bhitor ei token-i cholbe** |
| `devices` table | D1 | FCM push token registry (auth na, push) — thakbe |

Legacy schema: `users(id, email UNIQUE NOT NULL, password_hash, username, display_name, ...)`.
Test suite-r 19 ti case `/api/auth/register` diye user banay — shob update korte hobe.

---

## 1. Locked product flow (spec onujayi)

```text
OPEN → PHONE NUMBER → CONTINUE
  → OTP-less SIM verification (client-side, SubscriptionManager/TelephonyManager)
  → account lookup (server)
     ├─ no account           → PENDING account → BIND GMAIL (Google) → device ACTIVE → session → HOME
     ├─ account, same device → session → HOME
     ├─ account, new device  → login_request PENDING → KuchuPuchu push (old device)
     │                           ACCEPT  → old device revoked, new session → HOME
     │                           DECLINE/EXPIRE → login cancelled
     └─ old device hariye geche → "Can't access my previous device?" → Google
                                 → verified google_subject == bound subject → transfer → HOME
```

- **No OTP, no OTP provider.** E.164 normalization (`libphonenumber`-style BD-aware normalizer, app + worker dutay).
- **Backend authoritative** — client kokhono "verified:true" pathalei hobe na; SIM result ekta *signal*, decision worker-r.

## 2. CRITICAL product decision — SIM number UNAVAILABLE hole ki hobe?

Android guarantee kore na je SIM-er number app pore dekhate parbe (BD carrier-er majority expose kore **na**).
Spec strict mode: `UNAVAILABLE → VERIFICATION_UNAVAILABLE` (blocked). Ei app e strictly block korle **BD-r boro
ongsoto user login-i korte parbe na**. Tai policy:

| SIM result | Server behavior | `phone_verification_method` |
| --- | --- | --- |
| `MATCH` (exposed number == entered number) | verified | `SIM_MATCH` |
| `MISMATCH` (exposed number ache, alada) | **403 BLOCK** — number match kore na | — |
| `UNAVAILABLE` / `NO_SIM` / `PERMISSION_DENIED` | **allow (grace)** — device-only attestation | `DEVICE_ONLY` |

Protection je ache:
1. New device e login → **old device approval** lage (UNAVAILABLE holeo).
2. Account takeover-r kono rasta nai — notun account create holeo phone-ta identity na (username/QR e identity),
   ar `MISMATCH` (number ache ebong onno number) always blocked.
3. Phone **change** korar jonno strict `MATCH` **mandatory** (grace nei) — bhul number e account hijack bondho.
4. One Google subject ↔ one account (DB unique index), pending-account hijack block by MATCH-takeover rule.

Ei deviation spec-e cleanly documented thakbe (PLAN + code comments).

## 3. Ki REMOVE hobe

- Worker: `POST /api/auth/register`, `POST /api/auth/login`, `hashPassword()`, `verifyPassword()`
  (`password_hash` column DB-te thakbe — legacy rows, kono route pathabe na).
- Android: email/password UI (`LoginScreen.kt` full rewrite → phone flow).
- Docs: README/ARCHITECTURE auth line update.

## 4. New DB schema (ensureSchema te idempotent)

```sql
-- users: ALTER-added (fresh CREATE teo thakbe)
ALTER TABLE users ADD COLUMN phone_e164 TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
ALTER TABLE users ADD COLUMN phone_verification_method TEXT;   -- SIM_MATCH | DEVICE_ONLY
ALTER TABLE users ADD COLUMN google_subject TEXT;
ALTER TABLE users ADD COLUMN google_email TEXT;
ALTER TABLE users ADD COLUMN auth_status TEXT NOT NULL DEFAULT 'ACTIVE';
-- legacy users DEFAULT ACTIVE; phone-signup PENDING theke shuru hoy.
CREATE UNIQUE INDEX idx_users_phone  ON users(phone_e164)  WHERE phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX idx_users_gsub   ON users(google_subject) WHERE google_subject IS NOT NULL;

ALTER TABLE sessions ADD COLUMN device_id TEXT;

CREATE TABLE IF NOT EXISTS auth_devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
  device_name TEXT, status TEXT NOT NULL DEFAULT 'PENDING',      -- PENDING|ACTIVE|REVOKED
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT,
  UNIQUE (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS login_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|APPROVED|CLAIMED|DECLINED|EXPIRED|CANCELLED
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS recovery_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, new_device_id TEXT NOT NULL,
  google_subject TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|COMPLETED|EXPIRED
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, completed_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_audit (
  id TEXT PRIMARY KEY, user_id TEXT, device_id TEXT, event TEXT NOT NULL,
  meta TEXT, created_at TEXT NOT NULL
);
```

Notes:
- `CLAIMED` status = spec-r APPROVED handoff ta single-use korte (poll session mint kore ekbar).
- Placeholder email for phone-only users: `<phone_e164>@phone.kuchupuchu.invalid` (email column NOT NULL; userSelf
  e placeholder kokhono expose hoy na, phone expose kore). Phone change e placeholder-o update hoy.
- Pending-signup GC: 24h-r PENDING user + tar auth_devices rows sweep (throttled, index-backed).

## 5. New API (repo convention: `/api/auth/*`)

| Route | Auth | Ki kore |
| --- | --- | --- |
| `POST /api/auth/verify-phone` `{phone, sim, deviceId, deviceName?}` | — | normalize → MISMATCH block → account lookup → `SESSION` \| `APPROVAL_REQUIRED{requestId,expiresAt}` \| `ACCOUNT_CREATED` \| `BIND_REQUIRED` |
| `POST /api/auth/google/bind` `{phone, idToken, deviceId, displayName?}` | — | Google ID token verify (server-side) → PENDING account ke ACTIVE + google bind → device ACTIVE → session → `{token,user}`. Legacy email-migration: google email == kono legacy account-r email hole SHEI account-e phone bind hoy (chat hote). |
| `POST /api/auth/login/poll` `{requestId, deviceId}` | — | `PENDING`\|`APPROVED→session mint (single-use CLAIMED)`\|`DECLINED`\|`EXPIRED` |
| `POST /api/auth/login/approve` `{id}` | old device | atomic D1 batch: request PENDING+unexpired → old session/device revoke, device row ACTIVE, request APPROVED |
| `POST /api/auth/login/decline` `{id}` | old device | PENDING → DECLINED |
| `POST /api/auth/login/cancel` `{requestId, deviceId}` | new device | PENDING → CANCELLED |
| `POST /api/auth/recovery/start` `{phone, idToken}` | — | google verify + `sub == users.google_subject` check → recovery_request (5 min, single-use) |
| `POST /api/auth/recovery/complete` `{requestId, deviceId}` | — | atomic: old session/device revoke → new device ACTIVE → session → `{token,user}` |
| `POST /api/auth/phone/change` `{phone, sim}` | session | **MATCH mandatory** → unique check → `phone_e164` update (+placeholder email) |
| `POST /api/auth/logout` | session | age ja chilo + ei device-r `auth_devices` row REVOKED |
| `GET /api/config/firebase` | — | + `googleWebClientId` |
| `GET /api/me` | session | + `phone`, `googleEmail` (self only) |

Rate limits (existing `rateLimit()`): verify-phone 15/10min/IP, bind 10/5min/IP, poll 120/60min/IP,
approve/decline 15/10min/user, recovery 5/2min/IP + per-phone, phone change 5/2min/user, cancel 15/10/IP.
Login/recovery request TTL 5 min, single-use, `resolved_at`/`completed_at` stamped.

## 6. Google ID token verification (no Firebase Admin SDK on Workers)

Credential Manager (`androidx.credentials` + `googleid`) → Google ID token (aud = Web Client ID) →
worker `GET https://oauth2.googleapis.com/tokeninfo?id_token=…` → check:

- `aud === env.GOOGLE_WEB_CLIENT_ID` (unset hole bind/recovery 503 fail-closed — prod e secret set korte hobe)
- `iss` ∈ {`accounts.google.com`, `https://accounts.google.com`}, `exp > now`, `email_verified`

→ trusted `sub` (google_subject) + `email`. Service-account key APK/worker kono jaygay lagbe na.
Tests: `test/helpers/googlestub.mjs` global fetch stub `fake.<b64>` token → payload; worker real tokeninfo
path-i use kore, test-e network lagbe na.

## 7. Android changes

| File | Change |
| --- | --- |
| `LoginScreen.kt` | **rewrite**: phone input (+880 hint) → verify → Google bind / approval wait / done; "Can't access my previous device?" → recovery |
| `PhoneVerifier.kt` (new) | E.164 normalizer (BD-first), `PhoneVerificationResult` sealed, `SubscriptionManager`/`TelephonyManager` SIM check, runtime permission handling |
| `GoogleAuth.kt` (new) | Credential Manager + `GetGoogleIdOption`, webClientId worker theke |
| `KpPush.kt` / `KpNotify.kt` | `type=login_request` data message → Accept/Decline action notification (new `KpLoginApprovalReceiver`) |
| `SettingsScreen.kt` | "Change phone number" (SIM MATCH + `/api/auth/phone/change`), phone display |
| `AndroidManifest.xml` | `READ_PHONE_STATE` + receiver entry |
| `build.gradle.kts` | credentials/googleid deps, versionCode 76, versionName 3.9.0 |

Device ID: existing `KpPush.deviceId()` (per-install UUID) — re-install e notun ID, flow support kore (recovery/login-request).

## 8. Test plan

- **Sweep**: 19 ti existing case-r `reg()` helper → shared `makeReg(call)` (verify-phone MATCH + google bind,
  deterministic phone from email hash, fake google token via fetch stub). Env e `GOOGLE_WEB_CLIENT_ID` add.
- **New `test/cases/31-phone-auth.mjs`**: new account happy path · MISMATCH blocked · UNAVAILABLE grace (DEVICE_ONLY) ·
  same-device re-login session · new-device approval (approve/poll/token, old session dead, one-active-device) ·
  decline · expiry (lazy) · cancel · claim single-use · recovery (right google OK, wrong google 401, request expiry) ·
  one google ↔ one account · phone change (MATCH ok, taken number 409, grace denied) · pending-signup MATCH takeover ·
  legacy email migration · logout revokes device · placeholder email never leaked · rate limit 429 · audit rows.
- `npm run typecheck && npm test && npm run format:check && npm run validate:android` — shob green.
- Android unit test: normalizer-r jonno `PhoneNormalizerTest.kt` (pure JVM).

## 9. Deploy / setup (owner steps)

1. Firebase console → Authentication → Sign-in method → **Google** enable → **Web client ID** copy.
2. `npx wrangler secret put GOOGLE_WEB_CLIENT_ID` → `npx wrangler deploy`.
3. APK: CI build (versionCode 76). Legacy user der jonno: phone+Google first login e email-migration automatic.

## 10. Spec acceptance checklist mapping

Spec-r protita checkbox ei plan e map hoyeche: single phone screen ✓ (§3), no OTP ✓, E.164 ✓ (§5 worker + app),
unavailable fail-safe ✓ (grace policy, §2 decision), google mandatory ✓, google typed-input nai ✓, server-side
google verify ✓ (§6), 1 google = 1 account ✓ (unique index), 1 active device ✓ (auth_devices + atomic batch),
KuchuPuchu approval push ✓ (§5/§7), accept/decline/timeout ✓, lost-device recovery ✓, phone change protected ✓,
backend authoritative ✓, rate limited ✓, single-use expiring requests ✓, secrets APK te nai ✓ (worker secret),
atomic transfer ✓ (D1 batch), audit logs ✓ (auth_audit).


---

## 11. Production cutover (2026-09-03)

- Fresh start by owner decision: purbo D1 user data + R2 media erase kora hoyeche.
  Shob user phone number diye notun account banabe.
- Firebase project: `kuchupuchuff2026` (FCM + Google sign-in + GOOGLE_WEB_CLIENT_ID).
- Legacy email-migration path (§ google/bind) kaj korbe na — migrate korar moto
  kono legacy row ar nai.
