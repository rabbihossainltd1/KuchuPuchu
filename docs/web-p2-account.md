# Web P2 — account, authentication and navigation

## Scope

This opt-in Web slice wires account flows to the existing Worker contract. It does not change the production `public/` PWA, add Worker routes, or enable messages, statuses, media, calls, or WebRTC. `VITE_KP_WEB_ACCOUNT_INTEGRATION` remains `false` by default; with the flag off, `/account` shows a rollout gate and the browser makes no account API requests.

## Worker contract used

| User flow | Existing endpoint(s) |
|---|---|
| Phone sign-in / signup | `POST /api/auth/verify-phone` |
| New-account Google binding | `GET /api/config/firebase`, then `POST /api/auth/google/bind` |
| Existing-device approval | `POST /api/auth/login/poll` (bounded 3–15 second backoff, limited by the Worker expiry) |
| In-app one-time code | `POST /api/auth/login/otp`; cancel via `POST /api/auth/login/cancel` |
| Lost-device Google recovery | `POST /api/auth/recovery/lookup`, `POST /api/auth/recovery/start`, `POST /api/auth/recovery/complete` |
| Session restore / refresh / logout | `GET /api/me`, `POST /api/auth/refresh`, `POST /api/auth/logout` |
| Profile and privacy | `GET /api/me`, `PATCH /api/me`, `GET /api/users/username-available` |
| Device settings | `GET /api/auth/devices` |

All requests use the same-origin JSON client. Bearer tokens are sent only in the `Authorization` header, never in paths or query parameters. Phone formatting and OTP validation are covered against the legacy pure helper so the new UI uses the same Worker-facing normalization rules.

## Browser-specific safety

- A browser cannot inspect an Android SIM. Web always reports `sim: "UNAVAILABLE"` and `platform: "WEB"`; the UI says so. New-account setup follows the Worker’s existing device-only grace policy and still requires Google binding.
- Google ID tokens stay in memory and are submitted directly to the Worker. The client ID comes from `/api/config/firebase`; when missing, the UI explains that Google sign-in is not configured rather than rendering a fake button.
- Existing sessions use the shared PWA-compatible `kp.token` and `kp.device` storage keys. The bearer is validated by `GET /api/me` before protected content appears, restored sessions fail closed on network/401 errors, logout clears local bearer/profile/E2EE state, and the server logout is attempted with the captured bearer. The device identifier is non-secret and remains after logout for this browser install.
- The opaque bearer is stored in `localStorage` for reload persistence, as the existing PWA does. This keeps the existing contract but means same-origin XSS can access it; the browser flag is not an authorization boundary. Worker authorization is still mandatory.
- The device route currently supports listing sessions, not remote revocation. The UI does not invent a revocation action; users can sign out on the corresponding device or sign out this browser.

## Protected routes and capability boundaries

`/account` and `/chats/:conversationId` are protected when the account flag is on. A saved session is checked before either route can show account/conversation UI. The conversation shell remains a placeholder: no conversation, message, media, status, or call endpoint is called by this slice. The remaining product flags stay default-off.

## Verification

```sh
npm run typecheck
npm run typecheck:web
npm run build:web                 # account flag defaults off
npm run verify:web-sw
npm run test
npm run test:web:e2e              # default-off foundation and rollout-gate checks
npm run test:web:account:e2e      # opt-in Worker-mocked signup/login/recovery/settings flows
```

The account Playwright suite builds a separate opt-in preview and mocks Worker responses; it never uses real credentials or contacts the production Worker.
