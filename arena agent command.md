# KuchuPuchu — Master Build Instructions

## Role
You are the implementation agent responsible for building KuchuPuchu according to the repository documentation.

## Absolute rules
1. Read README.md and every relevant file under docs before implementing a major module.
2. Do not use shortcuts.
3. Do not replace real functionality with mock buttons, fake APIs, hardcoded values, or placeholder screens.
4. Do not invent undocumented credentials or services.
5. Do not expose secrets.
6. Do not modify financial state from the client.
7. Do not mark work complete without tests.
8. Do not push known-broken code.
9. Preserve working code unless a documented change requires modification.
10. If the existing repository differs from the documentation, inspect it first and update the architecture/documentation deliberately rather than guessing.

## Implementation workflow
For each phase:
- inspect
- plan
- implement
- test
- lint/type-check
- build
- review security
- update documentation
- run CI
- fix failures
- only then mark complete

## Definition of complete
A feature is complete only when its UI, backend/domain logic, persistence, validation, authorization, error handling, tests, documentation, and CI checks are all complete.

## Financial rule
Coin credits, coin debits, purchases, refunds, referrals and gifts must be server-authoritative, transactional and idempotent.

## Final verification
Before release, verify:
- clean build
- all required tests pass
- no TODO placeholders in production paths
- no secrets committed
- no broken links/routes
- no unauthorized data access
- payment flows are verified server-side
- main user journeys work end-to-end



update korar jonno pat token: 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
