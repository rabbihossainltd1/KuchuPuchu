# Call audio routing — what "correct" means here

The in-call audio button and the ring must agree on one route at a time. Three
bugs hid behind that sentence, and all three were in the code rather than the
device; this file records the contracts so they do not come back quietly.

## Contract 1 — a connected output wins, alone

Detection must accept every profile a real accessory exposes, not just the one
that happens to be in a call already:

| Route | Device types that count |
| --- | --- |
| BLUETOOTH | `TYPE_BLUETOOTH_SCO`, `TYPE_BLUETOOTH_A2DP`, `TYPE_BLE_HEADSET` (33+), `TYPE_BLE_SPEAKER` (33+) |
| WIRED | `TYPE_WIRED_HEADSET`, `TYPE_WIRED_HEADPHONES`, `TYPE_USB_HEADSET`, `USB_DEVICE` |

On API 31+ the set is unioned with `getAvailableCommunicationDevices()`, and the
route is committed with `setCommunicationDevice()` — which is *exclusive*: while
it is set, nothing else plays. Below 31 the same exclusivity comes from
`isSpeakerphoneOn = false` plus an open SCO link.

Missing an A2DP-only pair of buds used to be the whole "audio comes out of the
headset AND the speaker" report: the call stayed on the phone while the tones
went to the buds.

## Contract 2 — Bluetooth needs BLUETOOTH_CONNECT, and the prompt is part of the feature

From API 31, `setCommunicationDevice()` on a headset and `startBluetoothSco()`
throw `SecurityException` without `BLUETOOTH_CONNECT`. Routing calls sit inside
`runCatching`, so an ungranted permission fails silently and the call stays on
the phone hardware — it looks exactly like a routing bug. Hence:

- the permission is in `AndroidManifest.xml` (with `BLUETOOTH` capped at
  `maxSdkVersion="30"`, which is the last API where `startBluetoothSco` needs it);
- `CallScreens.rememberRouteAction` requests it when the route the user tapped
  (or the route the call started on) is Bluetooth and the grant is missing;
- `AudioRouter.blockedByPermission()` is what the UI asks, and
  `CallEngine.retryBluetoothRoute()` re-applies after the answer.

Never let a refused permission become a silent fallthrough: the user gets one
toast saying the call stayed on the phone.

## Contract 3 — SCO is a link, not a flag

`startBluetoothSco()` is asynchronous. `AudioRouter` keeps an
`ACTION_SCO_AUDIO_STATE_UPDATED` receiver registered for the whole call and
re-commits the Bluetooth device when the state arrives, because on several
OEM stacks `setCommunicationDevice(scoDevice)` succeeds before the SCO link is
up and then gets dropped.

## Contract 4 — hot-plug follows, for voice and video alike

`AudioDeviceCallback` fires on add *and* removal. A newly connected output takes
over immediately regardless of call kind; unplugging falls back to the phone
(speaker for video, earpiece for voice). The first cut of this gate was
`active?.kind != "VIDEO"`, which made video calls ignore a headset plugged in
mid-call.

## Contract 5 — the ring follows the route

`CallNotify` plays ring and ringback on `STREAM_ALARM` with `USAGE_ALARM` so the
phone stays loud and DND-immune. That stream ignores communication routing, so
both builders additionally set `AudioAttributes.Builder.setPreferredDevice` from
`AudioRouter.tonePlaybackDevice(ctx)`. An incoming ring (no call object yet) is
pinned to the connected headset over A2DP — the same thing a dialer does — and
SCO is only opened once the call is answered.

## Contract 6 — the icon states the truth

`routeIcon` maps BLUETOOTH → `Bluetooth`, WIRED → `Headset`, SPEAKER → `Speaker`,
EARPIECE → `PhoneInTalk`. When the stack exposes one, `AudioRouter.label()` uses the device's own
`productName` (accepted between 3 and 18 characters, so junk like "USB" or a
20-char model string does not wreck the row), so the strip says "Galaxy Buds"
rather than just "Bluetooth".

The button lives on the voice grid, the connecting screen and the video strip —
one tap advances `AudioRouter.next()` over the routes that physically exist.
`apply()` returns the route that actually took effect, so the UI can never claim
a route the framework refused.

## Regression guard

`test/cases/14-audio-routing-contract.mjs` asserts each contract against the
sources (no Android SDK in CI, so it checks the code, not a device): every
device type present, the permission in the manifest *and* requested at runtime,
the SCO receiver registered, no call-kind gate on hot-plug, the tone pinning,
and a route button on all three call surfaces.
