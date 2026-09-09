package app.kuchupuchu.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material.icons.filled.Check
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Shared image helpers. Avatars are data-URLs the worker stores inline, so
 * decoding them once into a memory map is cheap and offline-friendly.
 */
/**
 * `inSampleSize` for a source of `srcW`x`srcH` that will be drawn no bigger than
 * `maxSide`: the smallest power of two that brings the long side down to `maxSide`
 * or below. Powers of two are what `BitmapFactory` implements, and halving only while
 * the *result* still fits means the decoded side is always in `[maxSide, 2*maxSide)`
 * — crisp at 1:1 device pixels, never the quarter-size blur an over-eager
 * `ceil` would give. `maxSide <= 0` (a caller that does not care) samples nothing.
 *
 * Top level, not a member of `Bitmaps`, so it is unit-testable on the JVM: the object's
 * `LruCache` field cannot be constructed under the mockable `android.jar`.
 */
internal fun bitmapSampleSize(srcW: Int, srcH: Int, maxSide: Int): Int {
    if (srcW <= 0 || srcH <= 0 || maxSide <= 0) return 1
    var sample = 1
    var side = maxOf(srcW, srcH)
    while (side / 2 >= maxSide) {
        sample *= 2
        side /= 2
    }
    return sample
}

object Bitmaps {
    // Byte-budgeted LRU (KB units). The old map dumped ALL ~60 avatars at
    // once when full — a re-decode storm that hit mid-scroll exactly when the
    // chat was busiest. LRU evicts one bitmap at a time instead.
    private val mem = object : android.util.LruCache<String, Bitmap>(16 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    /**
     * Second tier, on disk. Without it every cold start of the app meant "the
     * profile is loading again" and a chat's photos re-decoding (or
     * re-downloading) from scratch, because the memory cache dies with the
     * process — that is precisely what the owner reported.
     *
     * In filesDir, not cacheDir: the system (and ColorOS-style storage
     * managers) purge cacheDir, which is how "we have a cache" turned into
     * "the cache is empty again after every background kill". We cap and evict
     * it ourselves below.
     */
    private var dir: java.io.File? = null
    private const val DISK_CAP = 192L * 1024 * 1024

    /** Above these a disk entry is only read off the IO dispatcher, never inline:
     * a full-size photo must never be decoded during composition. */
    private const val INLINE_PAINT_MAX_BYTES = 400 * 1024L
    private const val INLINE_PAINT_MAX_PIXELS = 400_000

    fun init(ctx: android.content.Context) {
        dir = java.io.File(ctx.filesDir, "kp-bitmaps").apply { mkdirs() }
    }

    /** Idempotent: the push service can be the first code in a fresh process,
     *  before any Activity ran Store.init — without a dir the disk tier is off. */
    fun ensureInit(ctx: android.content.Context) {
        if (dir == null) init(ctx)
    }

    private fun fileFor(url: String): java.io.File? {
        val d = dir ?: return null
        if (url.length < 8) return null
        return java.io.File(d, sha1(url) + ".img")
    }

    /** Keys are data-URIs (megabytes long) and content-addressed file urls. */
    private fun sha1(url: String): String =
        java.security.MessageDigest.getInstance("SHA-1")
            .digest(url.toByteArray())
            .joinToString("") { "%02x".format(it) }

    /**
     * The largest side a decode is asked to produce when the caller does not care
     * (a viewer, a preview). Anything drawn from a data-URI at list size passes a
     * real target instead — see [bitmapSampleSize].
     */
    const val FULL = 1080

    /** Memory-cache key: the same bytes drawn at two sizes are two different bitmaps. */
    private fun memKey(url: String, maxSide: Int): String =
        if (maxSide >= FULL) url else "$url@$maxSide"

    /** Cache hit only, never decodes: lets a row that re-enters a list paint on frame one. */
    fun peek(url: String?, maxSide: Int = FULL): Bitmap? =
        if (url.isNullOrBlank()) null else mem.get(memKey(url, maxSide))

    /**
     * Hit the memory cache, then a SMALL disk entry, decoded inline.
     *
     * The profile header and the list rows are a few tens of KB — cheaper than the
     * placeholder frame they replace, and what makes a cold start paint the photo
     * immediately instead of showing "loading". Anything bigger stays on the
     * async path below so a full-size photo can never jank a frame.
     */
    fun paint(url: String?, maxSide: Int = FULL): Bitmap? {
        if (url.isNullOrBlank()) return null
        val key = memKey(url, maxSide)
        mem.get(key)?.let { return it }
        val f = fileFor(url) ?: return null
        if (!f.exists() || f.length() > INLINE_PAINT_MAX_BYTES) return null
        // Header read only (no pixel work) to decide whether decoding inline is
        // safe: avatars and grid thumbs yes, a 12MP photo no.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        runCatching { BitmapFactory.decodeFile(f.absolutePath, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        if (bounds.outWidth.toLong() * bounds.outHeight > INLINE_PAINT_MAX_PIXELS) return null
        val opts =
            BitmapFactory.Options().apply { inSampleSize = bitmapSampleSize(bounds.outWidth, bounds.outHeight, maxSide) }
        val bmp = runCatching { BitmapFactory.decodeFile(f.absolutePath, opts) }.getOrNull() ?: return null
        mem.put(key, bmp)
        return bmp
    }

    /**
     * Owner round 32 (item 35): cache-first like [load], but a network miss is
     * fetched under a hard time cap and stored for the chat to reuse. Built for
     * the push handler, whose whole budget is a few seconds; null on timeout.
     */
    fun fetchWithin(url: String, millis: Long, maxSide: Int = 720): Bitmap? {
        val key = memKey(url, maxSide)
        mem.get(key)?.let { return it }
        val f = fileFor(url)
        if (f != null && f.exists()) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            runCatching { BitmapFactory.decodeFile(f.absolutePath, bounds) }
            val opts =
                BitmapFactory.Options().apply {
                    inSampleSize = bitmapSampleSize(bounds.outWidth, bounds.outHeight, maxSide)
                }
            runCatching { BitmapFactory.decodeFile(f.absolutePath, opts) }.getOrNull()?.let {
                mem.put(key, it)
                return it
            }
        }
        val bytes = Api.downloadWithin(url, millis) ?: return null
        val bmp = decodeBytes(bytes, maxSide) ?: return null
        mem.put(key, bmp)
        store(url, bytes)
        return bmp
    }

    fun load(url: String?, maxSide: Int = FULL): Bitmap? {
        if (url.isNullOrBlank()) return null
        val key = memKey(url, maxSide)
        mem.get(key)?.let { return it }
        val f = fileFor(url)
        if (f != null && f.exists()) {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            runCatching { BitmapFactory.decodeFile(f.absolutePath, bounds) }
            val opts =
                BitmapFactory.Options().apply {
                    inSampleSize = bitmapSampleSize(bounds.outWidth, bounds.outHeight, maxSide)
                }
            val fromDisk = runCatching { BitmapFactory.decodeFile(f.absolutePath, opts) }.getOrNull()
            if (fromDisk != null) {
                mem.put(key, fromDisk)
                return fromDisk
            }
            runCatching { f.delete() } // unreadable entry: re-fetch rather than stay blank
        }
        val bytes = sourceBytes(url) ?: return null
        val bmp = decodeBytes(bytes, maxSide) ?: return null
        mem.put(key, bmp)
        store(url, bytes)
        return bmp
    }

    /**
     * The disk tier holds the source bytes, verbatim.
     *
     * It used to hold a re-encode of the bitmap we had just decoded — a PNG/JPEG
     * compress of a 512x512 avatar costs more than the decode that produced it, and
     * it was paid once per row on the very first pass through a list (the "first
     * scroll is laggy, the second is smooth" report). The bytes are already a
     * compressed image, they are smaller than what we used to write, and keeping
     * them lossless lets the same file serve a 40dp row and a full-screen viewer at
     * their own sizes instead of whatever size happened to be drawn first.
     */
    private fun store(url: String, bytes: ByteArray) {
        val f = fileFor(url) ?: return
        if (f.exists()) return
        runCatching {
            val tmp = java.io.File(f.parentFile, f.name + ".tmp")
            java.io.FileOutputStream(tmp).use { it.write(bytes) }
            if (!tmp.renameTo(f)) runCatching { tmp.delete() }
            trim()
        }
    }

    /** Own budget, own eviction: delete oldest until the directory fits again. */
    private fun trim() {
        val files = dir?.listFiles()?.filter { it.name.endsWith(".img") } ?: return
        if (files.sumOf { it.length() } <= DISK_CAP) return
        val sorted = files.sortedBy { it.lastModified() }
        var freed = 0L
        val target = files.sumOf { it.length() } - DISK_CAP
        for (f in sorted) {
            if (freed >= target) break
            freed += f.length()
            runCatching { f.delete() }
        }
    }

    private fun sourceBytes(url: String): ByteArray? = runCatching {
        when {
            url.startsWith("data:") -> {
                val b64 = url.substringAfter(",", "")
                if (b64.isBlank()) null else Base64.decode(b64, Base64.DEFAULT)
            }
            url.startsWith("http") || url.startsWith("/") -> Api.download(url)
            else -> null
        }
    }.getOrNull()

    /**
     * Bounds-decode then sample: a 4000x3000 data-URI photo is ~48MB decoded whole —
     * that transient spike OOM-crashed heavy chats even with a bounded cache. The
     * ceiling is now the caller's, so a 40dp avatar row stops paying for 512x512
     * (a quarter of the pixels at `maxSide` 256, a sixteenth of the memory).
     */
    private fun decodeBytes(bytes: ByteArray, maxSide: Int): Bitmap? = runCatching {
        if (bytes.isEmpty()) return@runCatching null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val opts =
            BitmapFactory.Options().apply { inSampleSize = bitmapSampleSize(bounds.outWidth, bounds.outHeight, maxSide) }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }.getOrNull()
}

@Composable
fun rememberBitmap(url: String?, maxSidePx: Int = Bitmaps.FULL): ImageBitmap? {
    // Seed synchronously from the cache — memory first, then a small disk entry.
    // Starting at null meant every row that re-entered composition (scroll-back,
    // reopen after the app was killed, a chat-list poll) painted the placeholder
    // for a frame and then the photo — that flash is what read as "the profile
    // keeps loading again", and it is also why a photo looked uncached after a
    // cold start even though the bytes were on the phone.
    val state = remember(url, maxSidePx) { mutableStateOf(Bitmaps.paint(url, maxSidePx)?.asImageBitmap()) }
    LaunchedEffect(url, maxSidePx) {
        if (url.isNullOrBlank()) return@LaunchedEffect
        if (state.value != null) return@LaunchedEffect
        val bmp =
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Bitmaps.load(url, maxSidePx) }
        state.value = bmp?.asImageBitmap()
    }
    return state.value
}

/**
 * The signature avatar: amber gradient ring (locked Chat List #7 look)
 * with initials or photo inside.
 */
/**
 * Resolves an avatar reference (`"<userId>@v<version>"` from the worker's light
 * list responses) to the full data-URI. The URI is fetched once per ref and
 * cached in SharedPreferences, so a contact's avatar costs one fetch for its
 * lifetime instead of being inlined into every 2s chat-list poll.
 */
private const val AVATAR_PREFS = "kp_avatars"

/**
 * avatarRef → data-URI, served from MEMORY.
 *
 * The values still live in SharedPreferences (that is what makes a photo survive
 * a restart), but they must not be READ from there during composition:
 * `getSharedPreferences` deserialises the whole file on first touch and every row
 * entering the viewport asked it for its own key — a main-thread disk read per
 * avatar, right in the middle of the first scroll after a cold start. The file is
 * now slurped once, off the main thread, and rows read a concurrent map.
 */
internal object AvatarRefs {
    private val mem = java.util.concurrent.ConcurrentHashMap<String, String>()
    @Volatile private var loaded = false
    @Volatile private var loading = false

    private fun prefs(ctx: android.content.Context) = ctx.getSharedPreferences(AVATAR_PREFS, 0)

    fun warm(ctx: android.content.Context) {
        if (loaded || loading) return
        loading = true
        val app = ctx.applicationContext
        Thread {
            runCatching {
                prefs(app).all.forEach { (k, v) ->
                    if (v is String && v.isNotEmpty()) mem[k] = v
                }
            }
            loaded = true
            loading = false
        }
            .apply {
                isDaemon = true
                priority = Thread.MIN_PRIORITY
                start()
            }
    }

    fun get(ctx: android.content.Context, ref: String): String? {
        // Self-healing for the rare "first frame before the warm read finished"
        // race: a miss costs one fetch, never a wrong picture.
        if (!loaded && !loading) warm(ctx)
        return mem[ref]
    }

    fun put(ctx: android.content.Context, ref: String, url: String) {
        mem[ref] = url
        runCatching { prefs(ctx).edit().putString(ref, url).apply() }
    }
}

/**
 * org.json's `optString()` maps a JSON null to the STRING "null" (that is why
 * `optIso()` exists — see Api.kt). Every LIGHT payload the worker sends carries
 * `"avatarUrl": null`, so a raw `optString` hands the renderer the four-letter
 * text "null", which is not blank: the avatarRef lookup got skipped and Coil was
 * aimed at `<BASE>null` (404). Chat-list and call-history rows sat on the
 * placeholder forever because of that. Anything that does not look like an image
 * reference is therefore treated as absent here, at the one choke point.
 */
private fun avatarValue(raw: String?): String? =
    raw?.trim()?.takeUnless { it.isEmpty() || it == "null" }

/** An inline avatar only if it is something `Bitmaps`/Coil can actually fetch. */
private fun inlineAvatar(raw: String?): String? =
    avatarValue(raw)?.takeIf { it.startsWith("data:") || it.startsWith("http") || it.startsWith("/") }

/** `<userId>@v<version>` — the cache token the light endpoints send. */
private fun avatarRefOf(raw: String?): String? = avatarValue(raw)?.takeIf { it.contains("@v") }

/**
 * Resolve what an avatar should actually render: the persistent per-version cache
 * first, the payload's inline value second, and a single fetch to fill the gap.
 *
 * `internal`, not private, because a screen that shows the same picture twice (the
 * 88dp profile circle and its full-screen viewer) must resolve once and share the
 * answer — a call site that renders the raw payload field instead of this bypasses
 * the cache, and that is what made the profile picture reload on every app start.
 */
@Composable
fun rememberAvatarUrl(url: String?, avatarRef: String?): String? {
    val inline = inlineAvatar(url)
    val ref = avatarRefOf(avatarRef)
    // No cache token (a group, or a full payload with no ref): render the inline
    // value, whatever it is.
    if (ref == null) return inline
    val ctx = LocalContext.current
    // The persistent per-version cache wins, so a contact's photo survives an app
    // restart and a light row resolves to the bytes fetched for the FULL shape.
    val state = remember(ref) { mutableStateOf(AvatarRefs.get(ctx, ref) ?: inline) }
    LaunchedEffect(ref) {
        val have = state.value
        if (have != null) {
            // We are rendering an inline data-URI (chat box header, /api/me):
            // file it under the ref so the next open — and every light row that
            // shows the same person — paints from cache instead of re-decoding
            // and re-fetching. That is the "profile loads over and over" fix.
            // Only the immutable data-URI belongs in the persistent cache — an
            // http URL may carry an expiring query and must not be pinned.
            if (have.startsWith("data:") && AvatarRefs.get(ctx, ref) == null) {
                AvatarRefs.put(ctx, ref, have)
            }
            return@LaunchedEffect
        }
        val fetched =
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    val ownerId = ref.substringBefore("@v")
                    // Owner round 31: `g:<convId>@v<n>` is a GROUP picture — same
                    // cache, different endpoint.
                    val data =
                        if (ownerId.startsWith("g:")) {
                            Api.get("/api/conversations/${ownerId.removePrefix("g:")}/avatar", force = true)
                        } else {
                            Api.get("/api/users/$ownerId/avatar", force = true)
                        }
                    data.optString("avatarUrl").takeIf { it.startsWith("data:") }
                }.getOrNull()
            }
        if (fetched != null) {
            AvatarRefs.put(ctx, ref, fetched)
            state.value = fetched
        }
    }
    return state.value
}

@Composable
fun KpAvatar(
    name: String,
    url: String?,
    size: Dp,
    // Owner round 22: NO border on profile pictures in any theme — the
    // ring only draws where the caller passes ring=true (status rings).
    ring: Boolean = false,
    ringWidth: Dp = 2.5.dp,
    avatarRef: String? = null,
) {
    val inner = size - if (ring) ringWidth * 2 else 0.dp
    val resolved = rememberAvatarUrl(url, avatarRef)
    val dataUrl = resolved?.startsWith("data:") == true
    // Decode for the box it is drawn in. An 88dp avatar on a 3x screen needs ~264px;
    // without this every row in a list paid for the source's full 512x512 (and 1MB of
    // bitmap) on the first pass, which is what made that first scroll jank while the
    // second one — a memory-cache hit — was smooth.
    val px = (inner.value * LocalDensity.current.density).toInt().coerceAtLeast(64)
    val bmp = if (dataUrl) rememberBitmap(resolved, px) else null
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        if (ring) {
            Box(
                Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(goldRing()),
            )
        }
        Box(
            Modifier
                .size(inner)
                .clip(CircleShape)
                .background(Card),
            contentAlignment = Alignment.Center,
        ) {
            if (bmp == null) {
                // Default "no photo" placeholder: light circle + person glyph.
                // Also visible WHILE a photo decodes/downloads, so the circle
                // is never just an empty ring.
                // Owner round 32 (item 39): the glyph sits in the CENTRE of
                // the circle (it was pinned to the bottom edge, so every
                // photo-less avatar looked cut off / dropped).
                Icon(
                    Icons.Filled.Person,
                    contentDescription = name,
                    tint = Color(0xFFC9C5BE),
                    modifier = Modifier
                        .size(inner * 0.62f)
                        .align(Alignment.Center),
                )
            }
            when {
                bmp != null -> Image(
                    bmp,
                    contentDescription = name,
                    modifier = Modifier.size(inner),
                    contentScale = ContentScale.Crop,
                )
                !resolved.isNullOrBlank() && !dataUrl -> KpNetImage(
                    resolved,
                    name,
                    Modifier.size(inner),
                    ContentScale.Crop,
                )
            }
        }
    }
}

@Composable
fun KpNetImage(
    url: String?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    if (url.isNullOrBlank()) return
    if (url.startsWith("data:")) {
        val bmp = rememberBitmap(url)
        if (bmp != null) {
            Image(bmp, contentDescription = contentDescription, modifier = modifier, contentScale = contentScale)
        }
        return
    }
    val full = if (url.startsWith("http")) url else Api.BASE + url
    val ctx = LocalContext.current
    AsyncImage(
        // Bounded decode: the fullscreen viewer used to decode a 12MP photo
        // whole (~48MB spike) — tap a photo in a heavy chat and the app died.
        model = ImageRequest.Builder(ctx).data(full).crossfade(true).size(1200).build(),
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
    )
}

/** Solid gold pill button — the app's primary action. */
@Composable
fun GoldBtn(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    // Owner round 22: in dark-blue mode primary buttons ride the blue accent.
    if (KpThemeMode.darkBlue) {
        ActionBtn(text, modifier, enabled, onClick)
        return
    }
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
            containerColor = Gold,
            contentColor = AmberInk,
        ),
    ) {
        Text(
            text,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
        )
    }
}

/** Quiet circular icon button used in top bars. */
@Composable
fun IconBtn(
    icon: ImageVector,
    contentDescription: String,
    tint: Color = Ink,
    size: Dp = 26.dp,
    onClick: () -> Unit,
) {
    androidx.compose.material3.IconButton(onClick = onClick) {
        Icon(
            icon,
            contentDescription = contentDescription,
            tint = tint,
            modifier = Modifier.size(size),
        )
    }
}

/**
 * Icon-only empty state (gold-soft circle + icon + title + note) —
 * replaces the old emoji placeholders everywhere.
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    note: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.then(Modifier.padding(32.dp)),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(76.dp)
                .clip(CircleShape)
                // Owner round 21: empty states ("No calls", "No messages"…)
                // ride the blue accent in dark-blue mode.
                .background(if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.16f) else GoldSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = title, tint = ActionBlueDeep, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Spacer(Modifier.height(6.dp))
        Text(note, fontSize = 14.sp, color = Muted, textAlign = TextAlign.Center)
    }
}

/**
 * Owner round 30: the ONE compact search / input pill every list screen uses
 * (New chat, New group members, global Search, All contacts). Same shape as
 * the in-chat search bar: 24dp radius, 1dp accent border, 10dp vertical
 * padding — never a thick outlined field, never a long placeholder.
 */
@Composable
fun CompactSearchBar(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Search",
    icon: ImageVector = Icons.Filled.Search,
    imeAction: ImeAction = ImeAction.Search,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Card)
            .border(1.dp, ActionBlue, RoundedCornerShape(24.dp))
            .padding(horizontal = 16.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = Muted, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = Ink, fontSize = 15.sp),
            cursorBrush = SolidColor(ActionBlue),
            keyboardOptions = KeyboardOptions(imeAction = imeAction, keyboardType = keyboardType),
            modifier = Modifier.weight(1f).padding(vertical = 10.dp),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, color = Muted, fontSize = 15.sp, maxLines = 1)
                inner()
            },
        )
        if (value.isNotEmpty()) {
            Spacer(Modifier.width(6.dp))
            Icon(
                Icons.Filled.Close,
                null,
                tint = Muted,
                modifier = Modifier.size(20.dp).clip(CircleShape).clickable { onValueChange("") }.padding(2.dp),
            )
        }
    }
}

/**
 * Owner round 32 (item 24): the ONE compact text input for forms (login phone,
 * profile details, country search). A 46dp pill — 14dp radius, 1dp border
 * (accent while focused), the hint INSIDE the field. Never the thick M3
 * outlined field with its floating "second line" label.
 */
@Composable
fun KpInputField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: androidx.compose.foundation.text.KeyboardActions = androidx.compose.foundation.text.KeyboardActions.Default,
    leading: (@Composable () -> Unit)? = null,
    /** Fixed border (e.g. the username live-check green / red); null = focus-driven. */
    borderColor: Color? = null,
) {
    var focused by remember { mutableStateOf(false) }
    Row(
        modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Card)
            .border(1.dp, borderColor ?: if (focused) ActionBlue else Muted.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            leading()
            Spacer(Modifier.width(8.dp))
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = Ink, fontSize = 15.sp),
            cursorBrush = SolidColor(ActionBlue),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            modifier = Modifier.weight(1f).onFocusChanged { focused = it.isFocused },
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, color = Muted.copy(alpha = 0.7f), fontSize = 15.sp, maxLines = 1)
                    inner()
                }
            },
        )
    }
}

/* ---------------- bottom sheets (owner round 31) ---------------- */

/**
 * Owner round 31: EVERY popup in the app is a bottom sheet on the theme
 * surface — the status ⋮ sheet is the reference. `KpSheet` is that surface;
 * `KpSheetRow` one tappable line; `KpConfirmSheet` the yes/no popup.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun KpSheet(
    onDismiss: () -> Unit,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Card,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 8.dp)
                .padding(bottom = 10.dp),
        ) {
            if (title != null) {
                Text(
                    title,
                    color = Ink,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
            content()
        }
    }
}

@Composable
fun KpSheetRow(
    icon: ImageVector?,
    label: String,
    tint: Color = Ink,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) ActionBlue.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = if (tint == Red) Red else ActionBlueDeep, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(14.dp))
        }
        Text(label, color = tint, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.weight(1f))
        if (selected) Icon(Icons.Filled.Check, null, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
    }
}

/** Yes/no popup as a sheet: title, optional one-liner, Cancel + action. */
@Composable
fun KpConfirmSheet(
    title: String,
    text: String? = null,
    confirmLabel: String,
    danger: Boolean = false,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    KpSheet(onDismiss = onDismiss) {
        Column(Modifier.padding(horizontal = 14.dp)) {
            Spacer(Modifier.height(4.dp))
            Text(title, color = Ink, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            if (!text.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(text, color = Muted, fontSize = 13.5.sp)
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Line)
                        .clickable(onClick = onDismiss)
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = Ink, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (danger) Red else ActionBlue)
                        .clickable(onClick = onConfirm)
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        confirmLabel,
                        color = if (danger) Color.White else ActionBlueInk,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

/** Scales down slightly while pressed — attach to any clickable's modifier. */
@Composable
fun Modifier.pressScale(interactionSource: MutableInteractionSource): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        if (pressed) 0.92f else 1f,
        animationSpec = spring(stiffness = 800f),
        label = "press",
    )
    return this.scale(scale)
}

/**
 * WhatsApp-style status glyph drawn on canvas: a ring with a dot in the
 * middle. (The old tab icon was Icons.Filled.Circle — literally just a dot.)
 */
@Composable
fun StatusGlyphIcon(tint: Color, size: Dp) {
    androidx.compose.foundation.Canvas(Modifier.size(size)) {
        val s = size.toPx()
        val stroke = s / 9f
        drawCircle(color = tint, radius = stroke / 2f) // center dot
        drawCircle(
            color = tint,
            radius = (s - stroke) / 2f,
            style = androidx.compose.ui.graphics.drawscope.Stroke(width = stroke),
        )
    }
}

/**
 * Segmented ring around a status avatar — one arc per status update,
 * WhatsApp-style. Gold when unseen, gray once everything's been viewed.
 */
@Composable
fun StatusRingAvatar(
    name: String,
    url: String?,
    size: Dp,
    segments: Int,
    seen: Boolean,
    ringWidth: Dp = 2.5.dp,
    avatarRef: String? = null,
) {
    // Owner round 25: unseen status ring is DARK BLUE on every theme; once
    // the viewer has seen all of that user's statuses it turns gray.
    val ringColor = if (seen) Color(0xFF9CA3AF) else Color(0xFF2F6FED)
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Canvas(Modifier.size(size)) {
            val stroke = ringWidth.toPx()
            val r = (size.toPx() - stroke) / 2f
            val n = segments.coerceAtLeast(1)
            val circumference = 2.0 * Math.PI * r
            val gapPx = if (n == 1) 0.0 else 5.dp.toPx().toDouble()
            val segAngle = (circumference - gapPx * n) / n / r // radians
            val gapAngle = if (n == 1) 0.0 else gapPx / r
            var start = -Math.PI / 2.0 + gapAngle / 2.0
            repeat(n) {
                drawArc(
                    color = ringColor,
                    startAngle = Math.toDegrees(start).toFloat(),
                    sweepAngle = Math.toDegrees(segAngle).toFloat(),
                    useCenter = false,
                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                        width = stroke,
                        cap = androidx.compose.ui.graphics.StrokeCap.Round,
                    ),
                    topLeft = androidx.compose.ui.geometry.Offset(stroke / 2f, stroke / 2f),
                    size = androidx.compose.ui.geometry.Size(r * 2f, r * 2f),
                )
                start += segAngle + gapAngle
            }
        }
        KpAvatar(name, url, size - ringWidth * 2, ring = false, avatarRef = avatarRef)
    }
}

/** Status-list timestamp: "Today at 4:39 PM" / "Yesterday at …" / "12 Aug". */
fun statusStamp(iso: String): String {
    if (iso.isBlank()) return ""
    val t = try {
        java.time.Instant.parse(iso)
    } catch (e: Exception) {
        return ""
    }
    val now = dhakaNow()
    val z = atDhaka(t)
    return when {
        z.toLocalDate() == now.toLocalDate() ->
            "Today at ${String.format("%d:%02d %s", (z.hour % 12f).toInt().let { if (it == 0) 12 else it }, z.minute, if (z.hour >= 12) "PM" else "AM")}"
        z.toLocalDate() == now.toLocalDate().minusDays(1) ->
            "Yesterday at ${String.format("%d:%02d %s", (z.hour % 12f).toInt().let { if (it == 0) 12 else it }, z.minute, if (z.hour >= 12) "PM" else "AM")}"
        now.toLocalDate().toEpochDay() - z.toLocalDate().toEpochDay() < 7 ->
            // Within a week, show the weekday like the chat list does — this
            // branch used to be a copy of the "else" date format.
            z.dayOfWeek.toString().take(3).let { d -> d[0] + d.substring(1).lowercase() }
        else ->
            "${z.dayOfMonth} ${z.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
    }
}

/**
 * Compact status-list timestamp for one-line rows (e.g. "3 updates · 4:39 PM")
 * — same buckets as [statusStamp] but drops the "Today/Yesterday at" prefix
 * so it never wraps onto a second line next to the update count.
 */
fun statusStampShort(iso: String): String {
    if (iso.isBlank()) return ""
    val t = try {
        java.time.Instant.parse(iso)
    } catch (e: Exception) {
        return ""
    }
    val now = dhakaNow()
    val z = atDhaka(t)
    fun clock() =
        String.format("%d:%02d %s", (z.hour % 12f).toInt().let { if (it == 0) 12 else it }, z.minute, if (z.hour >= 12) "PM" else "AM")
    return when {
        z.toLocalDate() == now.toLocalDate() -> clock()
        z.toLocalDate() == now.toLocalDate().minusDays(1) -> "Yesterday"
        now.toLocalDate().toEpochDay() - z.toLocalDate().toEpochDay() < 7 ->
            z.dayOfWeek.toString().take(3).let { d -> d[0] + d.substring(1).lowercase() }
        else ->
            "${z.dayOfMonth} ${z.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
    }
}

/** The two system accounts: official notifications + the AI helper. They
 *  carry no call buttons, no block option, and their chat headers keep the
 *  full display name. */
fun isKpBot(id: String?): Boolean = id == "kp_official_bot" || id == "kp_ai_bot"

/**
 * Moderator badge (owner round 2026-09-04): the owner-supplied crossed-tools
 * icon (@fsleader), rendered from the vector drawable converted from the
 * source SVG. Independent of [VerifiedBadge] — an account can carry either
 * or both.
 */
@Composable
fun ModeratorBadge(size: Dp = 16.dp) {
    Image(
        painter = painterResource(R.drawable.ic_moderator_badge),
        contentDescription = "Moderator",
        modifier = Modifier.size(width = size, height = size * (1199f / 1312f)),
    )
}

/** Blue verified seal (starburst + check) drawn on Canvas: a vector glyph at
 *  14dp rendered soft on several devices, a Canvas path stays crisp at every
 *  density — same shape as the standard verified badge. */
@Composable
fun VerifiedBadge(size: Dp = 16.dp) {
    val badgeSize = size
    androidx.compose.foundation.Canvas(Modifier.size(badgeSize)) {
        val r = this.size.minDimension / 2f
        val c = center
        val path = androidx.compose.ui.graphics.Path()
        val steps = 24 // 12 scallops, like the classic verified seal
        for (i in 0 until steps) {
            val ang = (i * 2.0 * Math.PI / steps).toFloat()
            val rad = if (i % 2 == 0) r else r * 0.84f
            val x = c.x + rad * kotlin.math.cos(ang)
            val y = c.y + rad * kotlin.math.sin(ang)
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        drawPath(path, Color(0xFF1D9BF0))
        val w = r * 0.34f
        val cap = androidx.compose.ui.graphics.StrokeCap.Round
        drawLine(
            Color.White,
            androidx.compose.ui.geometry.Offset(c.x - r * 0.40f, c.y + r * 0.04f),
            androidx.compose.ui.geometry.Offset(c.x - r * 0.10f, c.y + r * 0.32f),
            strokeWidth = w,
            cap = cap,
        )
        drawLine(
            Color.White,
            androidx.compose.ui.geometry.Offset(c.x - r * 0.10f, c.y + r * 0.32f),
            androidx.compose.ui.geometry.Offset(c.x + r * 0.44f, c.y - r * 0.28f),
            strokeWidth = w,
            cap = cap,
        )
    }
}

/* ------------------------------------------------------------------ */
/* Owner round 13 (2026-09-05): loading skeletons — Facebook-feed      */
/* style placeholders so loading states never look dead.               */
/* Owner round 14: the per-row moving gradient ran SEVERAL infinite   */
/* animations per screen and read as cold-start lag; one shared alpha */
/* pulse per screen is ~free.                                         */
/* ------------------------------------------------------------------ */

/** One shared shimmer pulse — hoist once per screen, pass down. */
@Composable
fun rememberShimmerAlpha(): Float {
    val t = rememberInfiniteTransition(label = "shimmer")
    val a by t.animateFloat(
        initialValue = 0.45f,
        targetValue = 0.95f,
        animationSpec = androidx.compose.animation.core.infiniteRepeatable(
            animation = androidx.compose.animation.core.tween(650, easing = androidx.compose.animation.core.LinearEasing),
            repeatMode = androidx.compose.animation.core.RepeatMode.Reverse,
        ),
        label = "sa",
    )
    return a
}

/** One chat-bubble-sized skeleton row (left or right aligned). */
@Composable
fun KpShimmerRow(alignedEnd: Boolean = false, widthDp: Int = 200, heightDp: Int = 44, alpha: Float = 0.6f) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = if (alignedEnd) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            Modifier
                .width(widthDp.dp)
                .height(heightDp.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Line.copy(alpha = alpha)),
        )
    }
}

/** One list-item skeleton: avatar circle + two text lines. */
@Composable
fun KpShimmerListItem(alpha: Float = 0.6f) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(48.dp).clip(CircleShape).background(Line.copy(alpha = alpha)),
        )
        Spacer(Modifier.width(12.dp))
        Column {
            Box(
                Modifier.width(150.dp).height(15.dp)
                    .clip(RoundedCornerShape(6.dp)).background(Line.copy(alpha = alpha)),
            )
            Spacer(Modifier.height(7.dp))
            Box(
                Modifier.width(96.dp).height(12.dp)
                    .clip(RoundedCornerShape(6.dp)).background(Line.copy(alpha = alpha)),
            )
        }
    }
}


/** Owner round 22: the dark-blue primary button (GoldBtn routes here). */
@Composable
fun ActionBtn(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(
            containerColor = ActionBlue,
            contentColor = ActionBlueInk,
        ),
    ) {
        Text(
            text,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}
