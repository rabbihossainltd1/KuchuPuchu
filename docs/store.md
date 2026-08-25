# KuchuPuchu — Store Specification

## Categories
- banners
- frames
- badges
- name styles
- profile decorations
- boosts
- limited items

## Product lifecycle
draft → active → paused → retired.

## Purchase
1. Client selects product.
2. Server re-fetches current product.
3. Server validates availability and price.
4. Server verifies balance.
5. Transaction executes atomically.
6. Inventory is created.
7. Ledger records debit.
8. Order completes.

## Never trust
- client price
- client balance
- client product ownership
- client discount
- client inventory ID

## Inventory
Items have:
- ownerId
- productId
- quantity or unique instance
- giftable
- equipped
- acquiredAt

## Limited items
Use server-controlled availability and purchase limits.
