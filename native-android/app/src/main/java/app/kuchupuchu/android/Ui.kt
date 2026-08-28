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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import coil.compose.AsyncImage
import coil.request.ImageRequest
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.concurrent.ConcurrentHashMap

/**
 * Shared image helpers. Avatars are data-URLs the worker stores inline, so
 * decoding them once into a memory map is cheap and offline-friendly.
 */
object Bitmaps {
    private val mem = ConcurrentHashMap<String, Bitmap>()

    fun load(url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        mem[url]?.let { return it }
        val bmp = decode(url) ?: return null
        if (mem.size > 60) mem.clear()
        mem[url] = bmp
        return bmp
    }

    private fun decode(url: String): Bitmap? = runCatching {
        if (url.startsWith("data:")) {
            val b64 = url.substringAfter(",", "")
            if (b64.isBlank()) null else {
                val decoded = Base64.decode(b64, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(decoded, 0, decoded.size)
            }
        } else if (url.startsWith("http") || url.startsWith("/")) {
            val bytes = Api.download(url)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } else null
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
@Composable
fun KpAvatar(
    name: String,
    url: String?,
    size: Dp,
    ring: Boolean = true,
    ringWidth: Dp = 2.5.dp,
) {
    val inner = size - if (ring) ringWidth * 2 else 0.dp
    val dataUrl = url?.startsWith("data:") == true
    val bmp = if (dataUrl) rememberBitmap(url) else null
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
                .background(Cream),
            contentAlignment = Alignment.Center,
        ) {
            when {
                bmp != null -> Image(
                    bmp,
                    contentDescription = name,
                    modifier = Modifier.size(inner),
                    contentScale = ContentScale.Crop,
                )
                !url.isNullOrBlank() && !dataUrl -> KpNetImage(
                    url,
                    name,
                    Modifier.size(inner),
                    ContentScale.Crop,
                )
                else -> Text(
                    initials(name),
                    // dp→sp at the current density (NOT fontScale): a raw
                    // dp-number-in-sp grew with the user's font setting and
                    // overflowed the fixed circle.
                    fontSize = with(LocalDensity.current) { (inner * 0.38f).toSp() },
                    fontWeight = FontWeight.SemiBold,
                    color = GoldDeep,
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
        model = ImageRequest.Builder(ctx).data(full).crossfade(true).build(),
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
