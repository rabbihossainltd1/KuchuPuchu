# Project Memory

## Round 56 User Directives & Status
- Directive 1: See more / See less toggle fix:
  - User feedback: "see more text er upor click korle expand hoi ar massage er upore click korle collapse hoi but see less text er upor click korle collapse hoi na. eita thik koro jeno exact see more ar see less a click korle expand collapse work hoi massage body te na."
  - Root Cause:
    1. Message body was collapsing because `Box.combinedClickable` had `else if (!pendingEcho && longBody && !typing && msgExpanded) msgExpanded = false`.
    2. 'See less' row had nested clickables (`Row.clickable` and `Text.clickable`) using snapshot `val isExpandedNow = msgExpanded` which interfered with each other and Compose tap dispatch.
  - Fix:
    1. Removed collapse logic from `Box.combinedClickable` so tapping the message body never collapses or expands the message.
    2. Streamlined See more / See less row to a single `.clickable { msgExpanded = !msgExpanded; runCatching { haptics.tap() } }` on the `Row` toggle, with `Text` as a clean child (no nested clickable).
- Directive 2: Voice indicator compact size: FIXED and verified in v184/v185.
- Directive 3: Media editor pinch-zoom centered at focal/pinch point: FIXED and verified in v185.
- Directive 4: In-app update red error: "holds no newer build — try again later"
  - Root cause: `versionCode` in `native-android/app/build.gradle.kts` was still 185, matching the installed version on the user's phone, causing `archiveCode <= installedVersionCode(ctx)` in `KpUpdate.kt:198` to throw.
  - Fix: Bumped `versionCode = 187` and `versionName = "3.9.110"` in `build.gradle.kts` and `test/cases/36-v166-round.mjs`.
- Directive 5: 10 unique message send animations for different items (photo, video, documents, voice, text, sticker, audio, contact, location, view-once) with interactive preview.

## Test Gates
- All 37/37 test cases passing (1611 assertions).
- ktlint clean.
- TypeScript / typecheck clean.
- Prettier clean.
- Secret scan passed.
- Android validation passed.
