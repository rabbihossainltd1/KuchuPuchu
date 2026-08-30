# KuchuPuchu — Step Deploy Guide (self-deploy, no agent token needed)

Every step ends with one `wrangler deploy`. You can run it yourself in ~2 minutes —
then no token ever has to be shared with anyone.

## One-time setup (your laptop)

```bash
git clone https://github.com/rabbihossainltd1/KuchuPuchu.git   # or pull latest
cd KuchuPuchu
npm ci
```

## Deploy a step

```bash
npm run ci          # typecheck + tests + format + secret scan MUST be green
npx wrangler login  # opens browser once; token stays on your machine
npx wrangler deploy
```

Watch the output end with `Deployed kuchupuchu-api triggers` and the workers.dev URL.

## Verify after deploying

```bash
curl -s https://kuchupuchu-api.kuchupuchu.workers.dev/api/health
# {"ok":true,"service":"KuchuPuchu","version":"3.0",...}
```

Then on two phones: send messages, open a group chat, place a call — everything
must behave exactly as before, just snappier. If anything looks wrong:

```bash
npx wrangler rollback   # instantly back to the previous version
```

## Which step needs what

| Step | Changes | Extra permissions beyond `wrangler login`? |
| --- | --- | --- |
| 0 (this one) | query batching in the worker | none |
| 1 | DO bindings in wrangler.toml | none (bindings ride along with the deploy) |
| 2 | ChatRoom Durable Object | none |
| 3 | CallSignal Durable Object | none |
| 4 | Android app only — worker untouched | no deploy; APK via CI artifact or Android Studio |
| 5 | Android poll removal | no deploy |

Notes:
- `wrangler login` creates a token scoped to your account on YOUR machine — nothing
  to hand over, nothing to revoke afterwards.
- If you prefer giving the agent a token instead: it only needs **Workers Scripts
  Edit** (scoped to account `92081fac…544b` if the dashboard allows). Revoke it as
  soon as the step's deploy is confirmed — that is the agreed rule.
- Do not commit `.env`, tokens, or `wrangler` auth files. `npm run security:secrets`
  guards this in CI.

## Updating the app on phones

The worker deploys instantly for everyone. The Android app updates only when a new
APK is installed (bump `versionCode` in `native-android/app/build.gradle.kts`).
Worker-only steps (0–3) need no app update — the current APK keeps working.
