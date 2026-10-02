# Cloudflare preview build for `kuchupuchu`

The repository's root `wrangler.toml` is the source of truth for the `kuchupuchu-api` Worker. Do not rename it to satisfy the separate Cloudflare `kuchupuchu` build integration; doing so would retarget the API Worker.

## Non-production Workers Builds trigger

Configure only the `kuchupuchu` non-production trigger as follows:

- Branches: include `*`, exclude `main`.
- Root directory: `/`.
- Build command: blank. Workers Builds installs the root npm dependencies; this repository has no root `npm run build` script.
- Deploy command: `npx wrangler versions upload --config wrangler.kuchupuchu-preview.toml`.

`wrangler.kuchupuchu-preview.toml` matches the `kuchupuchu` target without changing the root API Worker config. It disables both `workers_dev` and Version URLs. The command uploads an immutable Worker version only; it does not assign traffic or deploy to production. The `main` production trigger (`npx wrangler deploy`) is intentionally unchanged.

The preview configuration retains the Worker entry point and current D1, R2, Durable Object, and asset bindings for build parity. Since the preview has no worker.dev route or public Version URL, it is not an externally reachable test environment.

## Build token permissions

The Workers Builds token must be backed by an active **user-scoped** API token scoped to this Cloudflare account. The build token is a user-scoped API token restricted to this Cloudflare account. The verified preview upload uses:

- User Details: Read; Memberships: Read.
- Account Settings: Read.
- Workers Scripts: Read and Write.
- Workers R2 Storage: Read and Metadata Read.

The version-upload command does not query or modify D1, so the preview token does not receive D1 permissions. Do not store the token secret in this repository or print it in logs. Store it only in Cloudflare Workers Builds. The token expires after one year and must be rotated before expiry. Do not update the `kuchupuchu-api` production trigger as part of this preview setup.

## Local contract check

`npm test` includes `test/cases/54-cloudflare-preview-build.mjs`, which verifies that the API config remains named `kuchupuchu-api`, while the separate preview config targets `kuchupuchu` and cannot publish public preview URLs.
