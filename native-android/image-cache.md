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

## Regression guard

`test/cases/15-image-cache-contract.mjs` pins all four rules against the sources
(the files are read, not simulated, because CI has no Android SDK): the two
tiers' locations and caps, the size-guarded inline paint path, the scoped
`filesDir`-only check on Coil's `.directory(...)`, the profile read order
(cached before forced), and the 24 h TTL. Deleting any of them fails CI.
