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

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.
