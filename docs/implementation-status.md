# Implementation status

The application in this repository implements the documented MVP and the required engineering controls.

## Delivered

- Email/password authentication, verification, password reset, sessions, logout-all, account deletion
- Optional Google OAuth when server credentials exist
- Profiles, privacy, discovery filters, deterministic recommendations
- Duo/Squad requests, friends, follows, blocks, reports, messaging
- Reputation events that cannot be set by the client
- Coin ledger, daily reward, referrals with anti-abuse holds
- Store, inventory, equip, gifting
- SPV live client plus server-side sandbox that still settles through the ledger
- Notifications and preferences
- Role-based admin, grants, moderation, audit log
- CI: format, lint, typecheck, tests, build, secret scan, dependency audit

## Not mocked

There are no client-side coin credits and no fake payment success handlers. If Google or live SPV is unconfigured, those entry points fail closed instead of pretending to work.
