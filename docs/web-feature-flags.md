# Web feature flags

The separate Vite app reads these values at **build time**. They are public client configuration, not secrets or authorization controls. Server-side Worker/API authorization remains mandatory regardless of a browser flag.

`serviceWorker` controls registration, and `accountIntegration` gates the browser account experience. `messaging` gates the chat experience and requires `accountIntegration`, because messaging has no meaning without a session. Statuses (slice F), media viewers/attachments (slices D/E), push (slice H) and calls (slice G) are implemented behind their gates; every gate still defaults to `false` in a plain `npm run build:web`. Setting a gate to `true` never bypasses server-side authorization.

Since the slice J production cutover the production build is `npm run build:web:prod` (account + messaging + statuses + push + calls on; the reserved `media` gate stays unflipped) and it is what the Worker serves at `/` — `public/` is retired (see `docs/web-cutover.md` and `public/RETIRED.md`).

| Environment variable | Flag | Default | Current effect |
|---|---|---:|---|
| `VITE_KP_WEB_SERVICE_WORKER` | `serviceWorker` | `true` | Controls registration of the generated `/sw.js`; it does not affect build-time worker generation. |
| `VITE_KP_WEB_ACCOUNT_INTEGRATION` | `accountIntegration` | `false` | Gates phone sign-in/signup, device approval/OTP, Google binding/recovery, session restore/logout, protected account routes, profile/privacy and device listing. |
| `VITE_KP_WEB_MESSAGING` | `messaging` | `false` | Gates the conversation list, open chat, text send/receive, KP1 end-to-end encryption for 1:1 text, read/typing/delivered, reactions, edit, delete-for-everyone and IndexedDB drafts. Ignored unless `accountIntegration` is also `true`. See `docs/web-messaging.md`. |
| `VITE_KP_WEB_STATUSES` | `statuses` | `false` | Status feed, composers, viewer and privacy (slice F). On in `build:web:prod` since slice K. |
| `VITE_KP_WEB_MEDIA` | `media` | `false` | Reserved: the attachment/viewer/album features (slices D/E) ship inside the messaging surface and nothing reads this gate yet, so production leaves it unflipped. |
| `VITE_KP_WEB_CALLS` | `calls` | `false` | Flag-gated 1:1 voice/video (slice G). On in `build:web:prod` since slice Q (owner-approved); browser limits stay documented in `docs/web-calls.md`. |
| `VITE_KP_WEB_PUSH` | `push` | `false` | Web Push settings card and subscription registry (slice H). On in `build:web:prod` since slice P — the server's VAPID secret is provisioned, so the card now offers a real doorbell instead of the honest "not configured" line. |

Values accept `true` or `false` (case-insensitive, surrounding whitespace ignored). Any other value uses that flag's safe default. Example:

```sh
# Verify the default-off production build
npm run build:web

# Build an opt-in account preview; other feature flags remain off
VITE_KP_WEB_ACCOUNT_INTEGRATION=true npm run build:web

# Build an opt-in account + messaging preview
VITE_KP_WEB_ACCOUNT_INTEGRATION=true VITE_KP_WEB_MESSAGING=true npm run build:web
```

Do not place credentials in `VITE_*` variables: Vite embeds them in browser-delivered output.
