# KuchuPuchu — Development Plan

## Mission
Build a complete, production-ready application without shortcuts. Work in small verifiable phases.

## Phase 0 — Repository foundation
- [ ] Define application architecture.
- [ ] Define frontend/backend boundaries.
- [ ] Configure environment handling.
- [ ] Add linting and formatting.
- [ ] Add test framework.
- [ ] Add CI.
- [ ] Add secret scanning.
- [ ] Add dependency checks.
- [ ] Add README and contribution rules.

Exit criteria: clean repository, reproducible local build, CI passes.

## Phase 1 — Authentication
- [ ] Google login.
- [ ] Email/password.
- [ ] Email verification.
- [ ] Password reset.
- [ ] Session management.
- [ ] Logout.
- [ ] Account deletion.

Exit criteria: auth flows work and unauthorized API access is rejected.

## Phase 2 — User profile
- [ ] Profile creation.
- [ ] Free Fire details.
- [ ] Preferences.
- [ ] Availability.
- [ ] Privacy settings.
- [ ] Profile editing.
- [ ] Profile validation.

Exit criteria: complete profile can be created, edited, viewed, and privacy-tested.

## Phase 3 — Discovery
- [ ] Player search.
- [ ] Filters.
- [ ] Online/active indicators.
- [ ] Profile cards.
- [ ] Pagination.
- [ ] Block filtering.
- [ ] Recommendation engine.

Exit criteria: recommendations are deterministic/testable and respect privacy/block rules.

## Phase 4 — Duo/Squad matching
- [ ] Create request.
- [ ] Accept/decline.
- [ ] Cancel.
- [ ] Expire.
- [ ] Match history.
- [ ] Availability matching.
- [ ] Anti-spam limits.

Exit criteria: two compatible users can successfully form a match.

## Phase 5 — Social
- [ ] Follow/friend system.
- [ ] Relationship status.
- [ ] Messaging.
- [ ] Notifications.
- [ ] Block/mute.
- [ ] Report.

Exit criteria: social actions respect block/privacy/authorization rules.

## Phase 6 — Reputation and verification
- [ ] Verified badges.
- [ ] Interaction-based reputation.
- [ ] Abuse-resistant feedback.
- [ ] Reputation visibility.

Exit criteria: reputation cannot be arbitrarily manipulated by a single client request.

## Phase 7 — Economy
- [ ] Coin ledger.
- [ ] Earn rules.
- [ ] Daily rewards.
- [ ] Referral system.
- [ ] Transaction history.
- [ ] Anti-abuse rules.

Exit criteria: every balance change has an auditable ledger entry.

## Phase 8 — Store and inventory
- [ ] Product catalog.
- [ ] Store UI.
- [ ] Purchase flow.
- [ ] Inventory.
- [ ] Equip/unequip.
- [ ] Limited items.
- [ ] Giftable items.

Exit criteria: purchases are atomic and inventory cannot duplicate items.

## Phase 9 — SPV payments
- [ ] Coin packages.
- [ ] Internal payment orders.
- [ ] SPV integration.
- [ ] Server-side verification.
- [ ] Callback/idempotency handling.
- [ ] Payment history.
- [ ] Failure/refund handling.

Exit criteria: successful verified payment credits coins exactly once.

## Phase 10 — Admin
- [ ] Admin authentication.
- [ ] Role-based permissions.
- [ ] User management.
- [ ] Reports.
- [ ] Moderation.
- [ ] Store management.
- [ ] Coin/finance audit.
- [ ] Referral management.
- [ ] System settings.
- [ ] Audit log.

Exit criteria: every sensitive admin operation is authorized and logged.

## Phase 11 — Security hardening
- [ ] Rate limits.
- [ ] Abuse detection.
- [ ] Authorization audit.
- [ ] Database rules audit.
- [ ] Secret scan.
- [ ] Dependency audit.
- [ ] Payment abuse tests.
- [ ] Referral abuse tests.
- [ ] Account takeover tests.

Exit criteria: security checklist passes.

## Phase 12 — QA
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] API tests.
- [ ] Auth tests.
- [ ] Payment tests.
- [ ] Economy tests.
- [ ] Matching tests.
- [ ] UI smoke tests.
- [ ] Accessibility checks.
- [ ] Offline/error-state checks.

## Phase 13 — CI/CD
Every pull request:
1. install dependencies
2. lint
3. type-check
4. unit tests
5. integration tests
6. build
7. security/dependency checks

Never merge a failing required check.

Deployment:
- build immutable artifact
- deploy
- run smoke tests
- monitor
- rollback on failed health checks

## Definition of Done
A feature is done only when:
- UI exists.
- Backend exists where required.
- Database rules exist.
- Validation exists.
- Error states exist.
- Authorization exists.
- Tests exist.
- Documentation exists.
- CI passes.
- No TODO/placeholder remains.
