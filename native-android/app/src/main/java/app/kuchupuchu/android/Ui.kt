package app.kuchupuchu.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
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
object Bitmaps {
    // Byte-budgeted LRU (KB units). The old map dumped ALL ~60 avatars at
    // once when full — a re-decode storm that hit mid-scroll exactly when the
    // chat was busiest. LRU evicts one bitmap at a time instead.
    private val mem = object : android.util.LruCache<String, Bitmap>(16 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun load(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        mem.get(url)?.let { return it }
        val bmp = decode(url) ?: return null
        mem.put(url, bmp)
        return bmp
    }

    private fun decode(url: String): Bitmap? = runCatching {
        val bytes =
            when {
                url.startsWith("data:") -> {
                    val b64 = url.substringAfter(",", "")
                    if (b64.isBlank()) return null
                    Base64.decode(b64, Base64.DEFAULT)
                }
                url.startsWith("http") || url.startsWith("/") -> Api.download(url)
                else -> return null
            }
        // Bounds-decode then sample: a 4000x3000 data-URI photo is ~48MB
        // decoded whole — that transient spike OOM-crashed heavy chats even
        // with a bounded cache. Avatars/bubbles never draw beyond ~1080px.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        var side = maxOf(bounds.outWidth, bounds.outHeight)
        while (side / 2 >= 1080) {
            sample *= 2
            side /= 2
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }.getOrNull()
}

@Composable
fun rememberBitmap(url: String?): ImageBitmap? {
    val state = remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) {
        if (url.isNullOrBlank()) return@LaunchedEffect
        val bmp = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Bitmaps.load(url) }
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

private val avatarRefCache = object {
    fun get(ctx: android.content.Context, ref: String): String? =
        runCatching { ctx.getSharedPreferences(AVATAR_PREFS, 0).getString(ref, null) }.getOrNull()
    fun put(ctx: android.content.Context, ref: String, url: String) =
        runCatching { ctx.getSharedPreferences(AVATAR_PREFS, 0).edit().putString(ref, url).apply() }.getOrNull()
}

@Composable
private fun rememberAvatarUrl(url: String?, avatarRef: String?): String? {
    // Inline data-URI / http URL: use directly (old response shapes and the
    // full profile endpoint). When a stable avatarRef is ALSO present (the
    // worker now sends it on the full shape too), prefer the persistent
    // per-version cache so a detail/profile re-open renders instantly instead
    // of re-decoding a data-URI that was already shown once this session.
    if (!url.isNullOrBlank()) {
        if (!avatarRef.isNullOrBlank() && avatarRef.contains("@v")) {
            val ctx = LocalContext.current
            val cached = avatarRefCache.get(ctx, avatarRef)
            if (cached != null) return cached
        }
        return url
    }
    if (avatarRef.isNullOrBlank() || !avatarRef.contains("@v")) return null
    val ctx = LocalContext.current
    val state = remember(avatarRef) { mutableStateOf(avatarRefCache.get(ctx, avatarRef)) }
    LaunchedEffect(avatarRef) {
        if (state.value != null) return@LaunchedEffect
        val fetched =
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    val userId = avatarRef.substringBefore("@v")
                    val data = Api.get("/api/users/$userId/avatar", force = true)
                    data.optString("avatarUrl").takeIf { it.startsWith("data:") }
                }.getOrNull()
            }
        if (fetched != null) {
            avatarRefCache.put(ctx, avatarRef, fetched)
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
    ring: Boolean = true,
    ringWidth: Dp = 2.5.dp,
    avatarRef: String? = null,
) {
    val inner = size - if (ring) ringWidth * 2 else 0.dp
    val resolved = rememberAvatarUrl(url, avatarRef)
    val dataUrl = resolved?.startsWith("data:") == true
    val bmp = if (dataUrl) rememberBitmap(resolved) else null
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
                Icon(
                    Icons.Filled.Person,
                    contentDescription = name,
                    tint = Color(0xFFC9C5BE),
                    modifier = Modifier
                        .size(inner * 0.75f)
                        .align(Alignment.BottomCenter),
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
        Text(text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
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
                .background(GoldSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = title, tint = GoldDeep, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Spacer(Modifier.height(6.dp))
        Text(note, fontSize = 14.sp, color = Muted, textAlign = TextAlign.Center)
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
) {
    val ringColor = if (seen) Color(0xFFD6D3D1) else Gold
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
        KpAvatar(name, url, size - ringWidth * 2, ring = false)
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
    val now = java.time.ZonedDateTime.now()
    val z = t.atZone(java.time.ZoneId.systemDefault())
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
    val now = java.time.ZonedDateTime.now()
    val z = t.atZone(java.time.ZoneId.systemDefault())
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
