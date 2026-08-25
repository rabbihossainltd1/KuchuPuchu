# KuchuPuchu — Admin Panel

## Modules
- Dashboard
- Users
- Reports
- Moderation
- Products
- Inventory review
- Payments
- Coin ledger
- Referrals
- Verification
- Notifications
- System settings
- Audit logs

## RBAC
### Super Admin
Full controlled access.

### Moderation Admin
Users, reports, moderation.

### Finance Admin
Payments, coin ledger, reconciliation.

### Catalog Admin
Products and store catalog.

### Support Admin
User support and limited account assistance.

## Rules
- Admin accounts require stronger authentication.
- Sensitive operations require explicit confirmation.
- Every privileged mutation is audited.
- Never expose secrets in admin UI.
