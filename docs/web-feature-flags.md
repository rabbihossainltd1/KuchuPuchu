# Web feature flags

The separate Vite app reads these values at **build time**. They are public client configuration, not secrets or authorization controls. Server-side Worker/API authorization remains mandatory regardless of a browser flag.

`serviceWorker` controls registration, and `accountIntegration` gates the opt-in browser account experience. `messaging` gates the opt-in chat experience and requires `accountIntegration`, because messaging has no meaning without a session. Both stay default-off. Statuses, media, and calls remain reserved gates; setting one to `true` does not create or enable an unimplemented feature.

| Environment variable | Flag | Default | Current effect |
|---|---|---:|---|
| `VITE_KP_WEB_SERVICE_WORKER` | `serviceWorker` | `true` | Controls registration of the generated `/sw.js`; it does not affect build-time worker generation. |
| `VITE_KP_WEB_ACCOUNT_INTEGRATION` | `accountIntegration` | `false` | Gates phone sign-in/signup, device approval/OTP, Google binding/recovery, session restore/logout, protected account routes, profile/privacy and device listing. |
| `VITE_KP_WEB_MESSAGING` | `messaging` | `false` | Gates the conversation list, open chat, text send/receive, KP1 end-to-end encryption for 1:1 text, read/typing/delivered, reactions, edit, delete-for-everyone and IndexedDB drafts. Ignored unless `accountIntegration` is also `true`. See `docs/web-messaging.md`. |
| `VITE_KP_WEB_STATUSES` | `statuses` | `false` | Reserved; status data/actions are not connected. |
| `VITE_KP_WEB_MEDIA` | `media` | `false` | Reserved; media features are not connected. |
| `VITE_KP_WEB_CALLS` | `calls` | `false` | Reserved; call history/WebRTC are not connected. |

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
