# Voice recorder — ship-time self-check (r76-7, owner mandate)

Owner (2026-09-26): "why do you fix bugs only after I report them? check every
system yourself before I have to tell you." From now on, BEFORE every commit
that touches the recorder, trace each line of this table in the code and tick
it. A row whose wiring cannot be named end-to-end is a shipped bug.

## Wiring traces (state -> publisher -> consumer -> draw)
1. HOLD start: mic press -> onStartRecord -> recording=true -> bar branch in
   Composer Row (real child) AND RecorderAnchors.columnOn via LaunchedEffect.
2. LOCK column: overlay reads columnOn + FlightAnchors.micBounds; offset from
   the overlay's OWN onGloballyPositioned origin (never chatRootOrigin).
3. Mic (idle AND recording): ONE permanent instance in the overlay, ON TOP
   of the column (z6>z5); seat keeps only the 50x46 fxMicAnchor spacer. A mic
   that changes home on press remounts mid-gesture and kills the drag
   (r76-8: 'press first then slide' bug). Overlay hides with composerShown.
4. Lock arm visual: HoldMicButton drag -> onLockVisual -> RecorderAnchors.
   columnArmed/columnDim (mic writes directly; bar reads columnDim tracked).
5. LOCK release: decide()=LOCK -> onLockRecord -> lockRecording() ->
   voiceLocked=true -> Composer locked branch = RecorderLockedPanel (real
   weighted Row child) + columnOn=false + overlay mic hidden.
6. CANCEL release: decide()=CANCEL -> onFinishRecord(true) + flyDx/flyDy
   captured -> swallowT anim -> RecorderAnchors.swallowOn/V -> flyer over bar.
7. SEND release: decide()=SEND -> onFinishRecord(false).

## Draw-order contract (HTML v5.8 stacking)
wallpaper < messages < bar < lock column < mic < swallow flyer.
Both overlays are children of the ROOT BOX after the content Column; the
column mount and the mic/flyer mount share ONE overlay composable so their
relative order is column -> mic -> flyer.

## Zeros
- No new icon, no extra button, no gate/fade the HTML lacks.
- No layout space claimed by any overlay child (root-Box stacking only).
