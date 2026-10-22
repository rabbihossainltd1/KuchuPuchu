# AI bot answers the same canned line (2026-10-22, owner round 7) — the diagnosis and the one dashboard fix

## What the owner reported

The AI chat answers the *exact same greeting* to every question
("bar bar same massage dei, question er answer kore na").

## Which script actually answers (live proof, 2026-10-22 ~15:25 UTC)

| Probe (no auth needed) | Answer |
| --- | --- |
| `GET https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev/api/ai/diag` | `401 UNAUTHENTICATED` — the route does not exist there → **stale code** |
| `GET https://vintoxbd-comm-core.../sw.js` | `BUILD_ID = b9e6fe424cb76b27` ≠ the current main build |
| `GET https://kuchupuchu.kuchupuchu.workers.dev/api/ai/diag` | `{"self":"edge","gemini":false,"workersAi":true}` — fresh build |
| `GET https://kuchupuchu-api.../api/ai/diag` | proxied to the comm core → same stale `401` |

The AI bot's replies are written by the **communication authority** —
`vintoxbd-comm-core` on the *vintoxbdinstitute* Cloudflare account, the
deployment that owns the sessions/messages (the same script that the edge's
`FEDERATED_CORE_ORIGIN` secret points at, see `docs/call-relay-2026-10-18.md`).
That script is running a pre-Workers-AI build: its only brain was the Gemini
key, its `GEMINI_API_KEY` is unset, and its `ai` (Workers-AI) binding was
never added, so every text turn fell to the static greeting — exactly the
"bar bar" line.

Its own *Settings → Variables and Secrets* listed neither `ai` nor
`GEMINI_API_KEY` when the cutover was set up; the current live responses
confirm nothing has changed since.

## The one thing to fix (one-time, owner/Vintox dashboard)

1. **Deploy the current `main` to `vintoxbd-comm-core`** (their Workers-Builds
   project watches this repo — trigger a build, or `wrangler deploy` from the
   Vintox account). The build today carries `self`/`diag` fingerprints from
   round 124, so after the redeploy the same two URLs instantly tell which
   script answers and which brain it can see.
2. In *vintoxbdinstitute → Workers & Pages → `vintoxbd-comm-core` → Settings →
   Variables and Secrets*:
   - add an **AI binding**: type *AI*, variable name `AI` (the free Workers-AI
     lane; enough for text answers — this is what serves every text question),
   - *optional*: add secret **`GEMINI_API_KEY`** (voice-note/photo/picture
     turns; the free lane has been 503 for a day, so this is nice-to-have),
   - make sure the plain vars the code reads survive the redeploy:
     `SELF_ORIGIN = https://vintoxbd-comm-core.vintoxbdinstitute.workers.dev`,
     `LARAVEL_CLASSROOM_ORIGIN = https://vintoxbd.online`,
     `CF_ACCOUNT = <vintox account id>`, `KP_SELF = "core"`.

After (1) the same greeting gets a fingerprint suffix when both brains are
missing, so a single screenshot would prove the lane state (`g0 a0` = both
blind, `g0 a1` = Workers-AI present but the run failed, real answers =
everything is healthy again).

No repo change is strictly required — the current `main` already contains the
Workers-AI fallback from round 120; the comm core is simply an older build
behind the 401 wall.
