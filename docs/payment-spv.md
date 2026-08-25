# KuchuPuchu — SPV Payment Specification

## Purpose
SPV is the payment service for purchasing KuchuPuchu coins.

## Architecture
Client → KuchuPuchu backend → SPV → verified payment state → KuchuPuchu backend → coin ledger.

## Required behavior
- Create internal payment order before redirect/request.
- Never credit coins from client success screens.
- Verify payment server-side.
- Validate amount, package, order ID and payment state.
- Handle retries and duplicate callbacks.
- Use idempotency.
- Record every state transition.
- Support failed, cancelled, pending and refunded states.

## Security
SPV credentials remain server-side.
Webhook/callback authenticity must be verified using the provider's official mechanism.

## Reconciliation
A scheduled reconciliation process should identify:
- paid orders without coin credit
- duplicate callbacks
- mismatched amounts
- stale pending orders

Any reconciliation adjustment must be auditable.
