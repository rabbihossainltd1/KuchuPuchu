# KuchuPuchu Web Login Parity & Multi-Device Authentication Plan

> **Status:** The requested implementation and local source/regression verification are complete. The owner explicitly approved a one-time Worker/Web deployment plus Android GitHub Release, including a one-time debug-key compatibility exception for v274. Worker/Web is deployed; APK publication is pending a rerun of the guarded GitHub workflow.
>
> **Prepared:** 2026-10-01
>
> **Basis:** `/home/user/uploads/kp-web.md` (r104 handoff), the current public repository, and the owner decisions recorded in §10.
>
> **Source-audit baseline:** audited `/home/user/KuchuPuchu` at `c5c109c370366432474f8a6629e5de30c9d731be` (`main`). The baseline findings below describe that audited commit, before feature changes.
>
> **Verified implementation:** platform-aware auth, OTP/approval claim logic, scheduled code expiry, Web country/OTP/recovery/card flows, Android OTP entry/card display, and Web/Android device labels are implemented. `npm run ci` passes all 49 cases (2,046 assertions), formatting, typecheck, secret scan and Android source validation; `bash scripts/ktlint-check.sh` passes.
>
> **Worker deployment:** deployed `kuchupuchu-api` on 2026-10-01 (version `22ddb1f5-3e34-45ef-b6ac-0ffa9d0fcc66`); `/api/health` and `/` both returned HTTP 200. The dedicated OTP HMAC secret is provisioned in Worker secrets.
>
> **Android release status:** The first GitHub Actions run (`36839205925`) passed source CI, Android unit tests, lint and APK build, then correctly refused publication because the configured production signer differs from published `v273`. Inspection confirmed v273 matches the tracked debug keystore, the only matching key available. The owner explicitly approved using that key for this one release to preserve update compatibility. `.github/workflows/release.yml` now requires the exact dispatch input `RELEASE-DEBUG-KEY`, disables production signing secrets for this build, and still verifies signer continuity. The guarded rerun is pending; no v274 APK is public yet. Local Gradle testing remains blocked by the sandbox's 1 GB `/tmp` limit.
>
> **Release gate:** this one-time v274 release is owner-approved; no later release is authorized by that approval.

## 1. Goal

Make web login behave consistently with the Android app while allowing one Android session and one web session for the same account to coexist. For a new-device login, offer two successful paths: enter a six-digit code delivered in the trusted KuchuPuchu app, or have an already logged-in device approve the request and let the new device log in automatically. The new-device screen must present code entry instead of a “Waiting for approval” screen, while still detecting approval in the background.

No SMS OTP is in scope. The browser cannot honestly verify a SIM; web requests must continue to send `sim: "UNAVAILABLE"`.

## 2. Source-audited baseline at the start of implementation

- The web client is the plain HTML/CSS/JavaScript in `public/`, served as Cloudflare Worker assets on the API origin. It has no build step. The browser correctly sends `sim: "UNAVAILABLE"` because it cannot inspect a SIM.
- Phone authentication is explicitly documented in `src/worker/index.ts` and Android `LoginScreen.kt` as OTP-less today. `POST /api/auth/verify-phone` creates an `APPROVAL_REQUIRED` request for an eligible new device; Android waits/polls, and Web currently shows “Waiting for approval” and polls `POST /api/auth/login/poll`.
- `LOGIN_REQUEST_TTL_MS` in `src/shared/constants.ts` is exactly five minutes. `login_requests` currently stores request/user/device/name/status/timestamps only; it has no platform, OTP verifier, or attempt counter.
- `deviceTransferStmts()` in `src/worker/index.ts` deletes **all** sessions for a user, revokes all active `auth_devices`, inserts/upserts the new device, and deletes FCM rows for other or unknown device IDs. It is called from phone verification, Google binding, the approved-login poll claim, recovery completion, and approval. This is the cross-platform sign-out root cause.
- Schema facts: `sessions` already has `device_id`; `auth_devices` is unique on `(user_id, device_id)` but has no platform column; the FCM `devices` table already has a `platform` column. Web device IDs use the `web-` prefix; Android IDs are UUIDs. Existing Web requests do not send a platform field, so old Web clients must not accidentally be classified as Android during rollout.
- `sendApprovalMessage()` writes a `LOGIN_APPROVAL` message to the official KuchuPuchu chat. Its metadata currently has request ID, device name, expiry, status, origin/IP and time; Android’s `LoginApprovalMessage` renders Accept/Decline only. The message body/push path is generic. The Web renderer has no dedicated `LOGIN_APPROVAL` card/action branch. The approved design keeps the code in the authenticated in-app card only—not the message body or push text—and adds Web card actions.
- Race-safety finding: `/api/auth/login/approve` and the `APPROVED` branch of `/api/auth/login/poll` batch a conditional status update with **unconditional** session/device-transfer statements. D1’s batch executes every statement even when the conditional update affects zero rows; the current sequential claim tests do not prove parallel/stale losers are side-effect-free. The shared final-claim path must guard every transfer/session write and add concurrency regressions before OTP is introduced.
- Android already has the complete country catalog and a Bangladesh default in `Countries.kt` / `LoginScreen.kt`. Web currently has one raw phone field and a small `normPhone()` helper, no country picker, and no Google fallback UI. The existing server Google verifier and recovery routes are available; `/api/config/firebase` exposes the public Web client ID, not a client secret.
- Baseline gates on this checkout: Prettier, TypeScript, all 48 test cases (1,989 assertions), secret scan, Android manifest/resource validation, and Kotlin import hygiene pass. The initial sparse checkout was expanded only with files required by those gates; the source working tree was clean before this plan update.

These are verified facts for the audited commit. Re-check affected source and the latest `memory.md` tail before each implementation/release step; the older OTP-less statements in `PHONE_AUTH_PLAN.md` and `PROJECT_UNDERSTANDING.md` are superseded by this plan and the owner decisions below.

## 3. Scope and non-goals

### In scope

1. Platform-aware session/device handling for Android and Web.
2. Six-digit in-app login code as an alternative to existing-device approval.
3. Approval-triggered auto-login while the new device is on the code-entry screen.
4. Web login UX parity: country selection, local number formatting, honest SIM handling, Google fallback, and consistent status/error copy.
5. Regression tests and a controlled release/verification plan.

### Not in scope

- SMS or email delivery, changing the phone-auth trust model beyond the approved flows, or changing account recovery semantics.
- Web voice/video calls, status, stickers, view-once composition, or other web-v1 limitations.
- Changing message E2EE, its key format, or its storage/backup protocol.
- Exposing credentials or OTP values in documentation, API responses unrelated to the login attempt, URLs, logs, or analytics.

## 4. User flows

### 4.1 Known account, another device wants to sign in

1. The new client sends the existing phone-verification request with a stable device ID and explicit platform. Android sends its real SIM result; Web sends `sim: "UNAVAILABLE"`.
2. If this is not already the same active device and any signed-in client exists, the server creates a five-minute request. The response returns request ID/expiry only—never the OTP.
3. The official KuchuPuchu chat receives a `LOGIN_APPROVAL` card whose metadata contains the six-digit code. Any signed-in Android or Web client can see the card and Accept/Decline. Push remains a generic doorbell with no code.
4. The requesting device shows the six-digit input immediately and continues polling quietly. Either correct OTP or approval by the other client completes login; approval still auto-logs in without OTP entry.
5. On final claim, only an existing session on the requesting client’s platform may be replaced. The other platform remains active. The winner consumes the request; the code is removed from the card/request on handling and expiry.
6. Decline, expiry, exhausted attempts and network errors have distinct concise states without disclosing unrelated account existence.

### 4.2 No eligible signed-in client

If no signed-in Android or Web client can receive the in-app card, preserve the existing Google lost-device recovery path. Do not imply that a code was delivered to an unavailable device or let a new device use an OTP that it supplied to itself as its own recovery factor. A live Web session counts as eligible even if it has no FCM token; “no recent push token” alone must not trigger `deviceGone`.

### 4.3 Existing session/platform slot

The same active device can continue through its existing session path. A new device on the other platform still goes through OTP/approval when another signed-in client exists; after it succeeds, it occupies the new platform’s slot without signing the existing platform out. A second device on an already-occupied platform replaces only that platform’s previous slot after OTP or approval.

## 5. Workstream A — platform-aware sessions (handoff Task 2)

### Confirmed session policy

The owner chose **at most one active Android session and one active Web session per account**. A new login replaces only the existing session on the same platform; Android and Web remain signed in together. A new device still uses the new-device approval/OTP flow when another signed-in client exists. Any signed-in client—Android or Web—may receive the card and approve. Approval authority is separate from which platform slot is replaced.

### Design requirements

- Carry a validated platform (`ANDROID` or `WEB`) through login request, device registration, session claim, logout, and device-list rendering. Existing Android clients omit the field, so omission must remain Android-compatible. Existing Web v1 requests also omit it; infer `WEB` for the existing `web-` device-ID namespace, and send explicit `platform: "WEB"` from updated Web code. Do not use user-agent sniffing as the source of truth.
- Preserve each platform’s stable device identity. Android currently uses a persisted UUID; Web stores a `web-…` identifier in local storage. Keep the namespaces distinct and test the legacy-Web inference path.
- Separate (a) finding any live signed-in client eligible to approve from (b) replacing the target platform’s one active slot. A new Web login may be approved by Android (and vice versa), but claiming it must not delete/revoke the other platform.
- Audit every `deviceTransferStmts()` caller and every session/device/logout/revoke route. Phone verification, Google bind, login poll, recovery completion and approval must all follow the same platform policy; do not fix only Web’s login route.
- Keep logout/revoke scoped to the exact session/device and its platform. Logging out Web must not delete Android’s session, revoke its auth device, or remove its FCM registration; Android logout must leave Web signed in.
- Show both platforms accurately in the existing `/api/auth/devices` response and Android Settings device list. The current screen is informational (no revoke action); do not add a new revoke workflow unless implementation discovers an existing supported route. The FCM `devices.platform` metadata can help identify push tokens but must not be confused with the authenticated-session registry.
- Clean up push registrations only for the replaced device/platform. Do not delete NULL/unknown or cross-platform FCM rows merely because a login happened elsewhere.

### Schema/migration approach

1. Use `auth_devices.platform` as the authoritative platform label unless the route audit proves a session-column is necessary; `sessions.device_id` already joins a session to its device. Keep FCM token platform as separate push metadata.
2. Add the column/indexes using the repo’s additive migration convention. Backfill `web-` IDs as Web and known legacy Android UUIDs as Android; leave genuinely ambiguous legacy rows non-destructively classified rather than revoking them.
3. Enforce one active slot per `(user_id, platform)` only after the migration safely handles existing rows (for example, a partial unique index for ACTIVE rows after duplicate-state verification). A migration or login must never clear another platform to make the constraint pass.
4. Preserve compatibility for pre-upgrade Android and Web clients. Missing platform must not turn an old Web login into an Android replacement; unknown values must be rejected or safely classified, never silently treated as an account-wide transfer.

### Acceptance criteria

- Logging in on Web leaves the Android session active and usable.
- Logging in on Android leaves the Web session active and usable.
- A second Web login replaces only the previous Web session; a second Android login replaces only the previous Android session, per the approved one-per-platform policy.
- Logging out of Web leaves Android signed in; logging out of Android leaves Web signed in. Do not introduce an unrelated revoke-management feature.
- The device list reflects the true platform/session state after login, replacement, logout, and revoke.
- Existing approval and recovery behavior still works for pre-upgrade Android clients.

## 6. Workstream B — OTP plus approval

### Approved behavior and API/state machine

- Add the six-digit OTP to the existing new-device login request. A correct, unexpired OTP **or** approval from any already signed-in client independently completes login. Approval continues to auto-log in the requesting device through background polling; OTP entry replaces the waiting screen, it does not replace the approval path.
- Use the existing `login_requests` lifecycle and five-minute request TTL. Add a dedicated endpoint (provisionally `POST /api/auth/login/otp {requestId, deviceId, code}`) with the repo’s normal rate-limit/error conventions. The verify-phone response returns the request ID/expiry but never the OTP.
- Use one shared, race-safe final-claim helper for OTP and approval/poll. It must bind the request to its user, request ID, target device ID, platform, status and expiry. Exactly one final claimant may perform platform-scoped replacement and session creation. A race loser must have **no** session, auth-device, FCM, approval-card or audit side effects beyond its safe response.
- Refactor approval so `/login/approve` records the decision but does not revoke the current device before the requesting client claims the session. The approved client then receives `SESSION` from the poll path. OTP and approval races converge on the same one-time finalization.
- Generate six decimal digits with a cryptographically secure random source, including leading zeroes. Store only a keyed verifier/attempt count on `login_requests`; use a dedicated worker secret such as `LOGIN_OTP_HMAC_SECRET` (never the Google client ID, debug key, or any uploaded credential). If not provisioned, fail closed for OTP rather than accepting an unverifiable code. Acquire fresh secrets through a private environment mechanism before deployment.
- Keep the plaintext code only in the pending official-account `LOGIN_APPROVAL` card metadata needed by signed-in clients to display it. Never put it in the new-device API response, message body/preview, push title/body, URL, log, metric, or analytics. The card remains a generic “new sign-in” push doorbell; opening the app/Web reveals the code.
- The owner approved a five-minute lifetime and **five wrong attempts per request**. Persist attempts in D1 and increment/check atomically across isolates; retain the existing IP/global limits and add request/device limits as appropriate. Reject wrong request/device, wrong code, expiry, decline, cancellation, replay and exhausted attempts.
- Clear the card’s plaintext code and the stored verifier when the request is handled, cancelled, superseded, exhausted, or expired. Expiry must clear both the server-side card metadata and what every client renders; use the existing cron/lazy-expiry path as needed, not just a client-side timer. Use `expiresAt` as the deadline source.
- Keep the Google lost-device recovery route intact. “No active signed-in client” is different from “no Android FCM token”: a live Web session is eligible to receive/approve, so `deviceGone` must not suppress that path simply because Web has no FCM registration.

### Android and Web UI requirements

- Android approval card: show the code prominently inside the existing official-account card while retaining Accept/Decline and origin details. The new-device LoginScreen shows a six-digit numeric input immediately and keeps polling in the background. Correct OTP completes login; approval still auto-logs in. Retire the old waiting screen, but preserve the existing Google recovery fallback for a genuinely unavailable trusted client.
- Web: add a dedicated approval-card renderer with code plus Accept/Decline actions, using the existing authenticated routes. Replace the approval-wait copy with a six-digit entry screen and quiet polling. Prevent duplicate submits, disable input on terminal states, and clear the code on success/expiry/handling.
- Both clients must distinguish incorrect code, locked/exhausted attempts, expired, declined, unavailable/network and Google recovery states in concise Bangla/English copy. A retry must not accidentally mint duplicate platform sessions.

### Acceptance criteria

- A valid new-device request produces one six-digit code visible only in the official in-app approval card on every signed-in Android/Web client; no SMS is sent and no notification text contains the code.
- Correct OTP logs in only the requesting device; incorrect, expired, wrong-device/request, replayed and fifth-failure submissions cannot log in.
- Approving from Android or Web still auto-logs in the requesting device without code entry. Either path can win a race, but only one final session is issued and no losing claim mutates sessions/devices.
- The code disappears from the card and is erased from request/card storage after handling, cancellation or expiry.
- Known-device login, Google bind/recovery, no-client `deviceGone`, Web `sim: "UNAVAILABLE"`, and WebSocket query-token behavior remain correct.

## 7. Workstream C — Web login parity

### Phone entry and country behavior

- Replace the raw field with a searchable country selector sourced from the Android `Countries.kt` list and formatting rules. Default to Bangladesh (`+880`) to match Android’s current default; keep the selection editable. If browser locale is used as a hint, it must be overridable and must not be treated as identity or SIM evidence.
- Browser login always sends `sim: "UNAVAILABLE"`. Do not request SIM, contacts, or location permissions and never claim the browser verified the number.
- Build a canonical E.164 number from the selected country and local input. Keep client formatting separate from the API value; match the worker’s authoritative normalization (Bangladesh local `01[3-9]XXXXXXXX` → `+880…`; international 8–15 digits). Test country change, pasted international numbers, leading zeroes, whitespace and repeated country prefixes.
- Keep the page dependency-free/no-build unless a real need is established. Add a parity test or shared data source so the country list does not drift from Android.

### Google fallback and consistent states

- Add the same lost-device Google recovery path the Android app uses, only when appropriate (for example, when no signed-in client can receive/approve, or the user explicitly chooses account recovery). Fetch the public `googleWebClientId` from `GET /api/config/firebase`; use Google Identity Services for credential acquisition and submit the ID token to existing recovery routes (`recovery/lookup`, `recovery/start`, `recovery/complete`) or the existing server-verified bind route. The worker—not browser-decoded claims—must verify the token and audience.
- Update the worker’s `deviceGone` decision to account for a live Web session as an eligible signed-in client, not only recent FCM activity. An active Web client must be able to receive the card, display the code and approve through authenticated routes.
- Handle a blocked/unavailable Google script, cancelled sign-in, no recoverable account and server refusal without exposing secrets or leaking more account information than the existing API permits. Never put a Google client secret in `public/`.
- Keep login/recovery state and error copy consistent with the Android flow, including OTP entry, automatic approval login, expiry, decline, retry and account-created/bind states.

### Acceptance criteria

- A Bangladesh user can enter a local number without manually typing `+880`; other supported countries can be selected and formatted correctly.
- The browser sends `sim: "UNAVAILABLE"` and never claims SIM verification.
- Web OTP entry, background approval polling, Web approval-card actions and Google recovery work on mobile browsers/PWA.
- The number format matches the worker/app; REST auth remains Bearer-header-only and `?token=` remains restricted to `/ws/*`.

## 8. Test and verification plan

### Baseline already recorded

- `npm run ci`: passed—Prettier, TypeScript, all 48 worker/source-contract cases (1,989 assertions), secret scan and Android validator.
- `bash scripts/ktlint-check.sh`: passed.
- `npm ci`: installed successfully; npm reported 6 dependency vulnerabilities (1 low, 5 high). Do not “fix” unrelated versions without a separate review.
- These are local source gates, not a deployed/live login test or a full Android Gradle/device build.

### Worker tests

Add behavioral regressions using the existing D1/R2 harness. Keep current source-literal pins valid and update only the lock affected by the same logical change.

- Session isolation: one Android + one Web coexist; a new Android replaces only Android, a new Web replaces only Web; platform is present in device list; logout and FCM cleanup remain platform/device-scoped; the existing device list labels each platform; old Android omission defaults to Android; existing `web-` IDs from Web v1 remain Web.
- OTP lifecycle: correct and leading-zero code, wrong code, 5-minute expiry, attempt count 1–5, lockout, wrong device/request, decline/cancel/supersede, replay, code clearing from message metadata and request verifier, and rate limits.
- Delivery/privacy: `/verify-phone` never returns the code; the code exists only in pending card metadata, never body/preview/push/log/URL; normal push remains generic; Android and Web see a redacted card after terminal state.
- Concurrency: OTP vs approval, approval vs poll, two polls and duplicate OTP submits; exactly one final claim/session, with no session/device/FCM mutation by a losing or stale claimant. `test/cases/31-phone-auth.mjs` currently covers sequential claims only, so add a dedicated regression (or extend it) that exercises parallel calls and inspects every affected table.
- Regression: known-device login, new account + Google bind, lost-device Google recovery, no-active-client recovery, approval expiry/decline/cancel, and case 48’s WebSocket query-token constraints.

### Web tests

- Add focused tests for country-number normalization, country metadata parity and the OTP/login state machine using current Node tooling; do not add a heavy browser dependency without checking cost first.
- Verify background polling remains active on the OTP screen; approval logs in without typing; duplicate submits are blocked; Web approval buttons work; terminal states redact the code; layout/accessibility work on narrow mobile screens.
- Preserve header-only REST auth; no OTP or session bearer may appear in URLs.

### Android and release verification

- Run `npm run ci` and `bash scripts/ktlint-check.sh` after each logical change. For Android UI changes, also run the documented Android Gradle/CI build when the environment supports it; source-shape/Kotlin formatting alone is not a full build.
- Manual phone checklist, only after an explicitly authorized test release: Android card shows code + Accept/Decline; Android OTP entry works; approval auto-login works; Web can receive/approve; Web login leaves Android signed in; Android login leaves Web signed in; same-platform replacement behaves as approved; logout/revoke affects only that platform; Google recovery works.
- Do not use a production owner account or send live test codes without explicit approval. No deployment/APK release is authorized by “let’s start.”

## 9. Implementation order and release gates

1. **Plan/source audit:** complete—the repository at the audited base is present, the baseline gates pass, and the owner decisions below are recorded.
2. **Workstream A — session isolation:** implement platform metadata and one-active-session-per-platform semantics first; add worker regressions for coexistence, same-platform replacement, logout/revoke, legacy IDs and race safety.
3. **Workstream B — OTP + approval:** implement the worker’s keyed OTP verifier/attempt policy and a single race-safe claim path; then add Android card/code entry and Web card/actions/code entry. Preserve approval auto-login.
4. **Workstream C — Web parity:** country selector/number handling, honest SIM value, Google recovery fallback, consistent Bangla/English states and accessibility.
5. **Per-item discipline:** make one coherent change at a time; run relevant tests and full local gates; update `memory.md` after implementation steps actually land. Do not report code as shipped until it is.
6. **Release gate:** the owner explicitly approved this one-time Worker/Web production deploy plus GitHub APK Release `v274` (`3.9.197`) on 2026-10-01. Worker/Web is deployed and live health checks returned 200. After confirming v273 uses the tracked debug keystore, the owner explicitly approved that same signer for this one APK only to preserve update compatibility. The manual release workflow requires `RELEASE-DEBUG-KEY`, reruns Android checks, and verifies signer continuity; future releases still require separate approval.

## 10. Owner-approved decisions and remaining gates

| #   | Decision                                                                            | Confirmed policy                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does a correct OTP independently authorize login, with approval as the alternative? | Yes—either path completes login.                                                                                                                                                                                                                                                            |
| 2   | OTP lifetime and failed-attempt limit?                                              | Five minutes; five wrong attempts.                                                                                                                                                                                                                                                          |
| 3   | Where is the code delivered, and may push include it?                               | In-app approval-card metadata only; never push text/body. Erase it after expiry or handling.                                                                                                                                                                                                |
| 4   | Which clients can receive/approve?                                                  | Any signed-in client, Android or Web; Web gets approval-card actions.                                                                                                                                                                                                                       |
| 5   | How many sessions per platform?                                                     | One active Android + one active Web per account; same-platform login replaces only that platform.                                                                                                                                                                                           |
| 6   | Is SMS OTP in scope?                                                                | No. Browser SIM stays `UNAVAILABLE`; no SMS delivery.                                                                                                                                                                                                                                       |
| 7   | May local dependencies be installed for verification?                               | Yes; `npm ci` completed.                                                                                                                                                                                                                                                                    |
| 8   | Is production release/deploy approved?                                              | Yes, one-time approval on 2026-10-01: deploy Worker/Web and publish Android APK as GitHub Release `v274` (`3.9.197`). After finding v273 was debug-signed, owner explicitly approved the same tracked debug signer for this release only, contingent on green checks and signer continuity. |

**No additional product-policy decision is blocking the first implementation phase.** The Google/OTP HMAC secret and any deployment credentials are operational secrets, not plan text; obtain fresh values privately only if/when a separately authorized deployment requires them.

## 11. Preconditions and risks

- **Source drift:** this plan is verified against base commit `c5c109c370366432474f8a6629e5de30c9d731be`. Re-read the latest `memory.md` tail and re-audit auth call-sites before each logical change; older OTP-less docs are not the current product requirement.
- **Credential hygiene:** the supplied consolidated handoff contains exposed credential values. Do not use, copy or print them. Rotation is unconfirmed; no push/deploy is authorized. Fresh credentials must arrive through a private environment mechanism and the owner must separately approve release work.
- **OTP secret:** a six-digit code needs a dedicated server-side HMAC key, distributed attempt counters, request binding and short expiry. The secret must never be committed or reused from unrelated credentials. Until configured, OTP verification must fail closed.
- **One-time claim/races:** existing D1 batches execute later statements even when a conditional update changes zero rows. Guard all session/device writes with the winning claim identity and add parallel/stale-claim behavioral tests before relying on the flow.
- **Message cleanup:** the code has to be displayed in the in-app approval card, so the transient card metadata is the only plaintext location. The message body/preview/push must remain code-free, and server/client card metadata must be cleared when terminal or expired.
- **Legacy platform identity:** old Android requests omit `platform`; old Web v1 requests do too but use `web-` device IDs. Classify those compatibly and do not make ambiguous legacy rows log out another platform.
- **Browser limits:** a browser cannot inspect the SIM. Country detection/defaulting is a UX hint, not identity verification.
- **External Google script:** Google Identity Services depends on allowed origins and network availability; test blocked-script, cancel and server-rejection paths. Never place a client secret in public assets.
- **Dependency audit:** the baseline `npm ci` reported six vulnerabilities. Keep dependency changes out of the authentication patch unless a reviewed, necessary fix is approved.
