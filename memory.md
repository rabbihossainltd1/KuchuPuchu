# Project Memory

## Round 57 User Directives & Status
- Directive 1: See more / See less collapse fix:
  - User feedback: "see less button ekhono work kore na"
  - Root Cause:
    1. In Compose, parent `Box` had `.combinedClickable(...)` and `.pointerInput(...)` which consume gesture pointer events (`requireUnconsumed = true` by default in child `.clickable`), preventing the child "See less" tap from firing reliably on device.
  - Fix:
    1. Added `pointerInput(Unit) { detectTapGestures { msgExpanded = !msgExpanded; runCatching { haptics.tap() } } }` on both `Row` and child `Text` with minimum height 40.dp and fillMaxWidth, capturing gestures directly via `detectTapGestures` without being swallowed by parent `combinedClickable`.
- Directive 2: 10 unique item send animations natively implemented in Android Kotlin app:
  - User feedback: "animation amay jemon ta dekhale temon ta apply o hoini fake update koro keno?"
  - Implementation:
    1. `native-android/app/src/main/java/app/kuchupuchu/android/ChatFx.kt`:
       - `fxShutterFlash(trigger)`: Soft white lens gleam sweeps across photo / image bubbles.
       - `fxSonicRipple(trigger, tint)`: Concentric soundwave ring pulses from playhead for voice notes and audio.
       - `fxPlayheadPing(trigger)`: Center playhead bounces and settles with elastic spring for video bubbles.
       - `fxCardSheen(trigger)`: Diagonal metallic reflection shimmer sweeps across document and contact cards.
       - `fxPadlockSnap(trigger)`: Padlock rotation snap and spring settle for view-once media.
    2. `native-android/app/src/main/java/app/kuchupuchu/android/ChatScreen.kt`:
       - Wired `fxShutterFlash` to `ImageMessageRow`.
       - Wired `fxPlayheadPing` to `VideoMessageRow`.
       - Wired `fxPadlockSnap` to `ViewOnceRow`.
       - Wired `fxSonicRipple` to voice messages in `MessageRow`.
       - Wired `fxCardSheen` to document/file messages in `MessageRow`.
       - All animations run on RenderThread / `graphicsLayer` with hardware acceleration for 60/120fps buttery smoothness.
- Directive 3: Bumped version to `v189` (`versionCode = 189`, `versionName = "3.9.112"`).

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.
