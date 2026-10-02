# Web feature flags

The separate Vite app reads these values at **build time**. They are public client configuration, not secrets or authorization controls. Server-side Worker/API authorization remains mandatory regardless of a browser flag.

Only `serviceWorker` currently gates shipped behavior. Account, messaging, statuses, media, and calls are reserved rollout gates for future implementation; setting one to `true` does not create or enable an unimplemented feature.

| Environment variable | Flag | Default | Current effect |
|---|---|---:|---|
| `VITE_KP_WEB_SERVICE_WORKER` | `serviceWorker` | `true` | Controls registration of the generated `/sw.js`; it does not affect build-time worker generation. |
| `VITE_KP_WEB_ACCOUNT_INTEGRATION` | `accountIntegration` | `false` | Reserved; account flows are not connected. |
| `VITE_KP_WEB_MESSAGING` | `messaging` | `false` | Reserved; message data/actions are not connected. |
| `VITE_KP_WEB_STATUSES` | `statuses` | `false` | Reserved; status data/actions are not connected. |
| `VITE_KP_WEB_MEDIA` | `media` | `false` | Reserved; media features are not connected. |
| `VITE_KP_WEB_CALLS` | `calls` | `false` | Reserved; call history/WebRTC are not connected. |

Values accept `true` or `false` (case-insensitive, surrounding whitespace ignored). Any other value uses that flag's safe default. Example:

```sh
VITE_KP_WEB_SERVICE_WORKER=false npm run build:web
```

Do not place credentials in `VITE_*` variables: Vite embeds them in browser-delivered output.
