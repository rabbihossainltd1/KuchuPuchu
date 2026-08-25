# KuchuPuchu — System Specification

## 1. System goal
Build a production-ready social discovery platform for Free Fire players with authentication, matching, social connections, gifting, virtual coins, referrals, store purchases, SPV payment integration, moderation, and administration.

## 2. Non-negotiable engineering rules
- No shortcuts.
- No fake implementations.
- No placeholder API calls.
- No hardcoded user balances.
- No client-authoritative coin changes.
- No sensitive secrets in client code.
- Every server mutation must validate authorization.
- Every payment must be verified server-side.
- Every important action must be auditable.
- No production dummy data.
- CI must pass before merge/release.
- Do not mark a feature complete until its acceptance criteria pass.

## 3. Authentication
Supported:
- Google OAuth
- Email/password
- Email verification
- Password reset
- Session/token management
- Logout current/all sessions
- Account deletion

Store provider IDs securely. Never store plaintext passwords.

## 4. User profile
Fields:
- userId
- displayName
- username
- avatar
- bio
- country
- district
- approximate location
- Free Fire UID
- Free Fire IGN
- server/region
- level
- rank
- preferred modes
- play style
- languages
- availability
- mic preference
- age range
- gender preference
- relationship status
- verification flags
- reputation summary
- createdAt
- updatedAt
- lastActiveAt

Privacy settings control visibility of each sensitive field.

## 5. Matching
The recommendation engine ranks candidates using configurable weights.

Example signals:
- mode compatibility
- server compatibility
- rank similarity
- language
- availability overlap
- play style
- mic preference
- location proximity at coarse granularity
- user preferences
- activity/recency
- reputation
- safety eligibility

Never use protected/sensitive information as an unfair ranking signal. Exact location must never be required for matching.

A recommendation must be explainable at a high level, e.g. "Same mode + similar rank + active now."

## 6. Duo/Squad requests
A request contains:
- requester
- mode
- preferred rank range
- availability
- message
- expiry
- status

Statuses:
pending, accepted, declined, cancelled, expired, blocked.

Rate-limit request creation and prevent spam.

## 7. Social graph
Support:
- follow
- friend/request
- accept/decline
- remove
- block
- mute

Blocking must override discovery, messaging, requests, and gifting.

## 8. Messaging
Requirements:
- authenticated participants only
- block enforcement
- rate limits
- message status
- abuse reporting
- pagination
- notification controls

Do not expose private message content to admins by default. Access must follow documented moderation/legal procedures.

## 9. Relationship status
User-selected status with privacy controls. It is informational only and does not create legal/social claims. Users can hide it.

## 10. Gifting
A gift:
- references an owned/giftable inventory item
- creates a transaction record
- transfers ownership atomically
- generates notification
- cannot duplicate an item transfer

Prevent gifting to blocked users and prevent self-gifting where prohibited.

## 11. Virtual economy
Coin balance must be represented through a ledger, not only a mutable number.

Ledger entries:
- transactionId
- userId
- type
- amount
- source/reference
- status
- createdAt
- idempotencyKey

Balance is derived or updated transactionally from the ledger.

Negative balances are prohibited unless explicitly supported by a future credit system.

## 12. Referral system
Each user can receive a unique referral code.

Flow:
1. User shares referral code/link.
2. New user registers.
3. Referral attribution is recorded.
4. Eligibility checks run.
5. Reward becomes pending.
6. Anti-abuse checks pass.
7. Reward is credited through the coin ledger.

Do not reward duplicate/self referrals.

## 13. Store
Products:
- id
- name
- description
- category
- priceCoins
- image
- rarity
- active
- giftable
- limited
- stock/availability rules
- createdAt
- updatedAt

Purchase must be atomic and idempotent.

## 14. SPV coin purchase
Client requests a payment session from backend.
Backend creates an internal order.
SPV payment is initiated.
Payment status is verified using trusted server-side integration.
Only verified successful payments credit coins.
Every order has an idempotency key.
Duplicate callbacks must not duplicate coins.

States:
created, pending, paid, failed, cancelled, refunded, disputed.

## 15. Notifications
Events:
- friend request
- request accepted
- message
- gift
- referral reward
- payment success/failure
- store purchase
- moderation action
- security alert

Users can control non-essential notifications.

## 16. Moderation
Users can report:
- spam
- harassment
- impersonation
- inappropriate content
- scam/fraud
- cheating-related behavior
- other safety issues

Admin actions:
- warn
- restrict
- suspend
- ban
- restore
- remove content
- investigate transaction abuse

Every admin action is audited.

## 17. Security
- TLS in transit.
- Secure password hashing through trusted auth provider/library.
- Server-side authorization.
- Input validation.
- Output encoding.
- Rate limiting.
- Abuse detection.
- Secure secrets management.
- Least-privilege database rules.
- Audit logging.
- Dependency scanning.
- Secret scanning.
- Backup/recovery plan.

## 18. Privacy
- Exact location is never public.
- Users can delete their account.
- Data export/deletion workflows should be supported where applicable.
- Collect minimum required data.
- Do not sell private user data.
- Clearly explain data usage.

## 19. Admin
Admin roles should be granular:
- super admin
- moderation admin
- finance admin
- support admin
- catalog admin

Do not give every admin full access.

## 20. Observability
Track:
- authentication failures
- API errors
- payment state changes
- coin ledger anomalies
- abuse spikes
- CI/deployment health
- application crashes

Never log passwords, tokens, payment secrets, or unnecessary private data.
