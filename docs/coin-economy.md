# KuchuPuchu — Coin Economy

## Objective
Create a useful virtual economy without making coin inflation or abuse easy.

## Sources
- Referral rewards
- Daily login/reward
- Approved tasks/events
- Promotional grants
- Verified campaign rewards

## Sinks
- Store purchases
- Profile boosts
- Gifts
- Premium profile items

## Rules
- All balance changes use the coin ledger.
- Client cannot choose the final credited balance.
- Reward eligibility is checked server-side.
- Suspicious accounts can have rewards held for review.
- Referral rewards have cooldown/eligibility rules.
- Admin grants require an audit record.
- Refund/reversal creates a compensating ledger entry rather than editing history.

## Transaction types
credit, debit, referral, reward, purchase, gift, boost, admin_grant, reversal, adjustment.

## Idempotency
Each financial mutation has a unique idempotency key. Repeating the same request must not duplicate the transaction.
