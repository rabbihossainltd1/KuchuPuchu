# Project Memory

## Round 58 User Directives & Status
- Directive 1: See more expand, message body collapse with animation:
  - User feedback: "not fixed+ tumi expand animation taw remove korcho but why? tumi ager motoi rakho see more a click korle expand hobe massage body te click korle collapse hobe animation er sathe hobe shob."
  - Fix:
    1. Re-enabled message body collapse on expanded messages: in `Box.combinedClickable.onClick`, when `msgExpanded` is true, clicking anywhere on the message body collapses it back (`msgExpanded = false`).
    2. Maintained smooth spring collapse/expand animation via `.animateContentSize(animationSpec = spring(dampingRatio = 0.85f, stiffness = 400f))`.
    3. Clicking "See more" expands the message; clicking the message body or "See less" collapses it.
- Directive 2: Message send animation starting points & physics:
  - User feedback: "ar all massage items sending animation er start point thik nai . massage text er start point hobe massage composer pill er upor theke niche theke na. ar baki items gula jemon voice massage ta voice voice button theke choto theke original voice massage er size a joye nijer position a chole jabe. ar photo video documents attach panel theke jump korbe."
  - Fix:
    1. Text message flight start point: In `SendFlight.kt`, updated `startY = pill.top - s.height` so the bubble lifts off directly from the top of the composer pill, never from below the screen or below the pill.
    2. Voice message launch: Added `fxVoiceLaunch` in `ChatFx.kt` and anchored to `FlightAnchors.micBounds`. Starts at the mic button, scales up from small (0.28f) to full original size (1.0f), and glides smoothly into its seat position.
    3. Media & document jump: Added `fxAttachJump` in `ChatFx.kt` and anchored to `FlightAnchors.attachBounds`. Photos, videos, and documents execute an upward parabolic jump arc from the attach panel / paperclip button to their bubble seat.
- Directive 3: Bumped version to `v190` (`versionCode = 190`, `versionName = "3.9.113"`).

## Round 60 User Directives & Status
- Directive 1: Diagonal slide send/receive flight animation:
  - Sent messages: animate smoothly into chat diagonally from the bottom-right (+44dp X, +18dp Y to 0,0) with soft spring ease and alpha ramp.
  - Received messages: animate smoothly into chat diagonally from the bottom-left (-44dp X, +18dp Y to 0,0).
  - Chat history scrolling and paging remain quiet with no sliding animation.
- Directive 2: View-once media bubble refinements:
  - Center the view-once icon perfectly within the bubble border (`CenteredOnceIcon(40.dp)` on `Alignment.Center`).
  - View-once card size reduced (`widthIn(max = 138.dp)`, `heightIn(max = 175.dp)`, min fallback `widthIn(min = 108.dp).height(138.dp)`).
  - Sending echo retains media aspect ratio while keeping verbatim `metaWith` pattern and test assertions intact.
- Directive 3: Received short message bubble sizing:
  - Compact bubble width `requiredWidthIn(min = if (!mine) 78.dp else 79.dp)` applied to both received and sent short messages.
- Directive 4: Last seen text & presence:
  - 3-letter abbreviations (`yes`, `sun`, `mon`, etc.) implemented across `ChatScreen.kt`, `Theme.kt`, `Ui.kt`, `SettingsScreen.kt`.
  - `ONLINE_WINDOW_MS` reduced to 35s in `src/shared/constants.ts`.
  - Background push media fetches and `/api/calls/active` excluded from updating `last_active_at` in `src/worker/index.ts`.
  - `conv.value` assignment and metadata refresh on message arrival/polling enhanced in `ChatScreen.kt`.
- Directive 5: Version bumped to `v192` (`versionCode = 192`, `versionName = "3.9.115"`), released on GitHub, and Cloudflare Worker deployed.

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.
