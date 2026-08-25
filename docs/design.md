# KuchuPuchu — Design System

## Product direction
KuchuPuchu is a clean, premium social discovery app focused on helping Free Fire players find compatible Duo/Squad partners and build trusted connections.

## Visual principles
- Clean, restrained, premium.
- Light mode is the default.
- Neutral whites, warm grays, charcoal text, and one restrained accent.
- No neon gradients.
- No purple/blue gaming palette.
- No excessive Free Fire imagery.
- No glowing cards, particle backgrounds, futuristic fonts, or AI-looking layouts.
- Use Lucide/Material-style icons consistently.
- Every visible control must perform a real action.
- No placeholder sections or dummy production data.

## Navigation
Primary navigation:
1. Home
2. Discover
3. Requests
4. Messages
5. Profile

Secondary destinations:
- Store
- Inventory
- Wallet
- Referrals
- Notifications
- Settings
- Help & Safety

Admin is a separate protected application area.

## Core screens
### Onboarding
Collect only information needed for matching and account setup. Explain why location/preferences are requested.

### Home
- Recommended players
- Online/available players
- Active duo/squad requests
- Quick actions
- Wallet balance
- Referral shortcut

### Discover
Filters:
- Server/region
- District/country
- Rank range
- Game mode
- Play style
- Language
- Availability
- Mic preference
- Age range
- Gender preference
- Online status
- Verified status

### Player profile
- Avatar
- Display name
- IGN/UID
- Verification
- Rank/level
- Preferred modes
- Play style
- Languages
- Availability
- Approximate location
- Reputation
- Relationship status
- Add/follow
- Message
- Invite
- Gift
- Report/block

Never expose exact private location.

### Store
Categories:
- Profile banners
- Frames
- Badges
- Name styles
- Premium profile decorations
- Limited items
- Boosts

### Wallet
- Coin balance
- Buy coins
- Earn coins
- Transaction history
- Pending transactions
- Referral earnings

### Inventory
- Owned items
- Equipped items
- Giftable items
- Purchase history

## Interaction rules
- Destructive actions require confirmation.
- Loading, empty, error, success, and offline states must be designed.
- Forms must show validation close to the relevant field.
- Use accessible contrast and touch targets.
- Avoid modal overload; prefer dedicated screens for complex workflows.
- Never hide important security or payment information.

## Responsive behavior
The app must work on small Android phones, tablets, and desktop web/admin views where applicable.

## Motion
Use short, purposeful transitions only. No continuous animations or decorative motion.

## Accessibility
- Semantic labels for controls.
- Screen-reader friendly structure.
- Keyboard navigation for web/admin.
- Respect reduced-motion preferences.
- Do not encode meaning using color alone.
