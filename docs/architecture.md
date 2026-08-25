# KuchuPuchu — Architecture

## Architecture principles
Use a modular architecture with clear separation between UI, application logic, data access, external services, and security boundaries.

## Logical layers
1. Presentation
2. Application/use cases
3. Domain
4. Data/repositories
5. Infrastructure/integrations

## Modules
- auth
- users
- profiles
- discovery
- matchmaking
- social
- messaging
- notifications
- reputation
- referrals
- wallet
- store
- inventory
- gifting
- payments
- moderation
- admin
- analytics
- audit

## External integrations
- Google authentication
- Email authentication provider
- SPV payment service
- Push notification provider where required
- Cloud storage where required

External providers must be wrapped behind internal interfaces so provider changes do not require rewriting business logic.

## Data flow
UI → authenticated API/use case → authorization → validation → domain rules → repository/integration → audit/event → response.

Never:
UI → direct privileged database mutation.

## Failure handling
Every external dependency must support:
- timeout
- retry where safe
- idempotency
- structured errors
- user-safe error messages
- logging without secrets

## Scalability
Use pagination for lists, indexed queries, cached read-heavy data where appropriate, and asynchronous processing for non-critical notifications/events.

## Consistency
Financial and inventory operations require transactional consistency. Do not use eventual consistency for coin crediting or ownership transfer unless a reconciliation mechanism exists.
