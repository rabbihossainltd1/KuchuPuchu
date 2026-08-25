# KuchuPuchu — Referral System

## Flow
1. Existing user receives a unique referral code.
2. New user registers using the code.
3. Attribution is stored.
4. Eligibility rules are evaluated.
5. Reward is pending.
6. Anti-abuse checks run.
7. Reward is credited if eligible.

## Anti-abuse
- One referral relationship per new account.
- Prevent self-referral.
- Detect repeated device/IP/account patterns where legally appropriate.
- Do not reward immediately for suspicious activity.
- Rate-limit referral claims.
- Keep referral audit records.

## Reward configuration
Reward values must be server-configurable and versioned. Never hardcode reward amounts in the client.
