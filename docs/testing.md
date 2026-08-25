# KuchuPuchu — Testing Strategy

## Unit tests
Test:
- matching score
- eligibility
- coin calculations
- referral rules
- product pricing
- privacy rules
- validation

## Integration tests
Test:
- authentication
- database rules
- store purchase
- gifting
- referral
- payment state transitions
- admin authorization

## Security tests
- unauthorized access
- IDOR
- privilege escalation
- replayed payment callback
- duplicate idempotency key
- negative coin manipulation
- referral abuse
- blocked-user bypass

## UI tests
Test critical flows:
- sign in
- profile setup
- discover
- request/accept
- message
- store purchase
- wallet
- payment result
- report/block

## Release gate
No release if required tests or CI checks fail.
