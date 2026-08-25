# KuchuPuchu

KuchuPuchu is a social discovery app for Free Fire players. It helps people find compatible Duo and Squad partners, message safely, and use a server-authoritative coin economy.

This repository is the production implementation described in `docs/`.

## Stack

- TypeScript
- Express API
- React + Vite web app
- Prisma + SQLite (swap `DATABASE_URL` to Postgres for production)
- Vitest, ESLint, Prettier, GitHub Actions

## Local setup

```bash
cp .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

The API and web app share port `4000` in development.

Default bootstrap admin, only created when no admin exists:

- email: `admin@localhost` (or `ADMIN_BOOTSTRAP_EMAIL`)
- password: value of `ADMIN_BOOTSTRAP_PASSWORD` (local default `AdminPass123`)

Change these before any shared environment.

## Authentication

- Email and password
- Email verification and password reset
- Google OAuth when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set

Without Google credentials the Google button is disabled. That is intentional.

## Payments

SPV is the coin purchase provider.

- `SPV_MODE=sandbox` uses a server-side sandbox checkout. Completing it still settles through the same ledger path.
- `SPV_MODE=live` calls `https://spv-payment-api.pages.dev/api/v1` with `SPV_API_KEY`.
- The client success page never credits coins.

## Tests

```bash
npm test
npm run ci
```

## Architecture

See `docs/architecture.md`, `docs/api.md`, `docs/database.md`, and `docs/security.md`.

Financial mutations are transactional, idempotent, and written to `coin_ledger`.
