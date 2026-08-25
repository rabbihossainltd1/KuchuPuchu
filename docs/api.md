# KuchuPuchu — API Contract

## General
- HTTPS only.
- Auth required unless explicitly marked public.
- JSON request/response where applicable.
- Consistent error envelope.
- Pagination for collections.
- Idempotency keys for financial mutations.

## Authentication
- POST /auth/session
- POST /auth/logout
- POST /auth/logout-all
- POST /auth/password-reset
- DELETE /account

## Profile
- GET /me
- PATCH /me/profile
- PATCH /me/preferences
- PATCH /me/privacy
- GET /users/:id
- GET /users/:id/reputation

## Discovery
- GET /discover
- GET /discover/recommendations
- GET /players/search

## Matching
- POST /duo-requests
- GET /duo-requests
- POST /duo-requests/:id/accept
- POST /duo-requests/:id/decline
- POST /duo-requests/:id/cancel

## Social
- POST /users/:id/follow
- DELETE /users/:id/follow
- POST /friend-requests
- POST /friend-requests/:id/accept
- POST /friend-requests/:id/decline
- POST /users/:id/block
- DELETE /users/:id/block

## Messaging
- GET /conversations
- POST /conversations
- GET /conversations/:id/messages
- POST /conversations/:id/messages

## Wallet
- GET /wallet
- GET /wallet/transactions
- GET /wallet/referrals

## Payments
- POST /payments/orders
- GET /payments/orders/:id
- POST /payments/orders/:id/cancel
- POST /payments/webhooks/spv

Webhook authentication must use the provider's official verification mechanism.

## Store
- GET /store/products
- GET /store/products/:id
- POST /store/orders
- GET /store/orders
- GET /inventory
- POST /inventory/:id/equip
- POST /gifts

## Moderation
- POST /reports
- GET /me/blocks

## Admin
All admin endpoints require role-based authorization and audit logging.

## Error format
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe human-readable message",
    "requestId": "..."
  }
}

Never return stack traces or secrets to clients.
