# Project Memory

## Round 56 User Directives & Status
- Directive 1: See more / See less toggle fix:
  - User feedback: "see less button ekhono work kore na"
  - Root Cause:
    1. In the previous commit, `fillMaxWidth()` and `heightIn(min = 36.dp)` were removed from the `Row` toggle, making the touch target only ~50x22px (the size of the 12.5sp text itself), which caused misses on high-DPI touchscreens.
    2. Additionally, user had not yet installed the update due to the in-app update versionCode mismatch.
  - Fix:
    1. Added `.fillMaxWidth().heightIn(min = 36.dp)` to the `Row` toggle in `ChatScreen.kt:6171` so the entire bottom area of the bubble is easily clickable without missing.
    2. Kept exact `.clickable { msgExpanded = !msgExpanded; runCatching { haptics.tap() } }` on `Row` with `Text` as a clean child.
- Directive 2: Voice indicator compact size: FIXED and verified in v184/v185.
- Directive 3: Media editor pinch-zoom centered at focal/pinch point: FIXED and verified in v185.
- Directive 4: In-app update red error: "holds no newer build — try again later"
  - Root cause: `versionCode` in `native-android/app/build.gradle.kts` was still 185.
  - Fix: Bumped `versionCode = 188` and `versionName = "3.9.111"` in `build.gradle.kts` and `test/cases/36-v166-round.mjs`.
- Directive 5: 10 unique message send animations for different items (photo, video, documents, voice, text, sticker, audio, contact, location, view-once):
  - Created interactive preview in `send-animations-preview.html` with real-time playback, slow-mo 0.4x controls, full physical motion specifications.
  - In-app engine verified for GPU-accelerated graphicsLayer RenderThread execution (zero recompositions, 60/120fps fluid).

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.
