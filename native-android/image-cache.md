# Image and profile cache — what has to be true

The owner's report was "opening a profile loads it again every time the app is
started, and the chat's photos do the same — nothing seems saved locally". The
bytes were already local (avatars in a per-`<id>@v<n>` prefs cache, media urls
content-addressed); what was missing was a place for the *decoded pixels*, so
every cold start paid a re-decode or a re-download and the UI showed its loader
for it.

## Rule 1 — two cache tiers, and the disk one is ours to manage

| Tier | Where | Lifetime |
| --- | --- | --- |
| `Bitmaps.mem` (LRU, 16 MB) | process memory | dies with the process |
| `Bitmaps` disk tier | `filesDir/kp-bitmaps`, 192 MB cap, oldest-first eviction | survives restarts, kills, OTA-free |
| Coil disk cache (http media) | `filesDir/kp-image-cache`, 256 MB cap | same |

`cacheDir` is deliberately **not** used: the system purges it under storage
pressure, and OEM storage managers (ColorOS/Realme in this app's target audience)
purge it aggressively — a cache there is a cache that is empty exactly when the
user reopens the app. The stale `cacheDir/kp-image-cache` left by the old build
is deleted once, on a MIN_PRIORITY daemon thread, so startup does not pay for the
move.

`Bitmaps.store()` writes what was actually drawn (already downsampled by
`decode()`), staged as `.tmp` and renamed, so a process death mid-write cannot
leave a half-decoded file that paints as a grey box. `load()` deletes an entry
that fails to decode rather than trusting it forever.

## Rule 2 — cold start paints, network revalidates

`rememberBitmap` seeds its state from `Bitmaps.paint(url)` — memory, then a disk
entry — so a row that composes after a cold start does not begin at "placeholder".

Inline decoding is bounded twice (`INLINE_PAINT_MAX_BYTES`, `INLINE_PAINT_MAX_PIXELS`,
decided from a header-only `inJustDecodeBounds` read) so avatars and grid thumbs
paint on frame one **and** a 12 MP photo can never be decoded during composition.
Bigger entries still go through the IO dispatcher; they just no longer hit the
network.

## Rule 3 — snapshots are painted stale, then forced fresh

`Cache.ttl("/api/users/…")` is 24 hours, which looks wrong for a contact card
until you read `ProfileScreen`: it renders `profileSnapshot(userId)` immediately,
reads the cached payload first, and *always* follows with
`Api.get(path, force = true)`. Staleness is impossible because the refresh is
unconditional; the TTL only decides whether the first frame is the profile or a
spinner. That is the whole difference between "cached" and "loading…" as the user
experiences it.

## Rule 4 — content-addressed keys make revalidation pointless

`/api/files/<key>` and `<userId>@v<version>` never change under the same key: a
new photo means a new version in the ref, which is the cache key. So Coil runs
with `respectCacheHeaders(false)` — a `max-age` that has expired must not cost a
round trip on every open for something that cannot have changed. Invalidation is
by key, so no explicit busting is needed anywhere.

## Contract 5 — a photo bubble is laid out at its real size on frame one

The other half of the report was not about bytes at all but about layout:
"first scroll laggy, second scroll smooth". A `LazyColumn` row that changes height
while it is on screen re-lays-out every row after it — and after a cold start that
happened for EVERY photo, because the ratio lived only in a process-wide
`HashMap` (`ImageRatios`) and in a decoded image the app had not decoded yet.

Three things make the snap impossible rather than rarer:

1. **The payload carries the size.** The sender already bounds-decodes the JPEG
   before sending it (`inJustDecodeBounds`, ~0.1 ms, on the IO pass it was already
   doing), and posts `meta.w/h`. The worker clamps the pair (1..20000, both
   required, `kind` must be IMAGE/FILE with media) and stores it in
   `meta_json`; `msgFrom` echoes `mediaW`/`mediaH` on every read, so the
   recipient, the list endpoint, the realtime broadcast and a retried
   (idempotent) send all agree. Nothing fetched yet, exact box already.
2. **The ratio map is persisted** (`filesDir/kp-ratios.json`, access-ordered and
   capped at 8000 entries, written off the main thread in 1.2 s coalesced
   batches). Scrolling back through a chat on the same device therefore never
   re-snaps either — and it never clobbers history: a save is refused until the
   file has actually been read, and puts that landed in that window are flushed
   right after.
3. **Every cold-start read is off the UI thread.** `Cache.init` runs from
   `Activity.onCreate`, i.e. directly in front of the first frame, and it used to
   `loadDisk()` (parse every cached conversation and message page), `Bitmaps.init`,
   `ImageRatios.init` and — for avatars — deserialize a prefs file **per row**
   inside composition. Now those four run on one MIN_PRIORITY thread and the
   avatar refs are served from a concurrent map, so a row that composes before the
   warm-up finishes simply misses the cache and fetches; it never blocks.

Deliberately NOT done: shrinking the Coil request from `size(720)`. The bubble is
225 dp wide with a 280 dp height cap, which is already ~700–780 px on the densities
this app targets, so a smaller request would trade the reported lag (which is
layout, not decode) for visibly soft photos. Decoding happens off the main thread;
what hurt was the resize, and that is fixed above.

## Regression guard

`test/cases/15-image-cache-contract.mjs` pins rules 1-4 and the app half of 5
against the sources
(the files are read, not simulated, because CI has no Android SDK): the two
tiers' locations and caps, the size-guarded inline paint path, the scoped
`filesDir`-only check on Coil's `.directory(...)`, the profile read order
(cached before forced), and the 24 h TTL. Deleting any of them fails CI.
