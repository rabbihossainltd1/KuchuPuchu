# KuchuPuchu — Database Specification

## Core collections/tables

### users
Identity and account metadata.

### profiles
Public/profile preferences separated from authentication identity.

### privacy_settings
Field visibility and interaction controls.

### player_preferences
Matching-related preferences.

### player_activity
Last-active and availability signals.

### relationships
Follow/friend/connection state.

### blocks
Block relationships.

### duo_requests
Duo/Squad requests and their states.

### matches
Accepted matches/history.

### conversations
Conversation metadata.

### messages
Messages with pagination indexes.

### notifications
User notifications.

### reports
User safety reports.

### reputation_events
Evidence for reputation calculations.

### referrals
Referral attribution and status.

### coin_ledger
Immutable financial-style coin events.

### coin_packages
Coin purchase packages.

### payment_orders
SPV payment orders and state.

### products
Store catalog.

### inventory
Owned items.

### store_orders
Store purchase records.

### gifts
Gift transfers.

### admin_users
Admin role assignments.

### audit_logs
Sensitive administrative/system events.

### system_settings
Controlled configurable values.

## Database rules
- Every record has an immutable primary ID.
- createdAt and updatedAt where appropriate.
- Server timestamps preferred.
- Sensitive fields are protected by authorization.
- Users can access only their own private records unless explicitly permitted.
- Admin access is role-scoped.
- Financial records are append-only where practical.
- Add indexes based on real query patterns.
- Never expose database credentials to clients.

## Atomic operations
Must be atomic:
- coin credit
- coin debit
- store purchase
- inventory ownership
- gift transfer
- referral reward
- payment settlement

## Deletion
Prefer soft deletion for audit-sensitive records. Personal data deletion must follow the documented privacy workflow.
