package app.kuchupuchu.android

/**
 * r43 (owner's animation pack — ChatAnimationsComplete.zip): the chat's
 * receive / send animations as one Compose-only system. The HTML demos that
 * shipped with the pack are the look-and-feel source; the timings below are
 * ported 1:1 from receive/SPEC.md + send/SPEC.md.
 *
 * Everything animates through graphicsLayer / draw phase (no per-frame
 * recomposition in the hot loops), respects the system animator duration
 * scale (0 = skip to the final state), and only messages that arrive while
 * the chat is open play — history never replays.
 */
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import kotlin.math.PI
import kotlin.math.sin

/** Plain (non-composable) animator-scale read for queue decisions. */
fun fxScaleOf(ctx: android.content.Context): Float = runCatching {
    android.provider.Settings.Global.getFloat(
        ctx.contentResolver,
        android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    )
}.getOrDefault(1f)

/** The system animator scale; 0 means "remove animations" - skip to the end. */
@Composable
fun fxAnimatorScale(): Float {
    val ctx = LocalContext.current
    return remember { fxScaleOf(ctx) }
}

/** Received media reveal: de-blur + fade + settle, 900 ms (SPEC #3). */
@Composable
fun Modifier.fxBlurIn(active: Boolean): Modifier {
    val scale = fxAnimatorScale()
    val t = remember { Animatable(if (active && scale > 0f) 0f else 1f) }
    LaunchedEffect(active) {
        if (active && scale > 0f) t.animateTo(1f, tween(900, easing = FastOutSlowInEasing))
    }
    val v = t.value
    return graphicsLayer {
        alpha = 0.35f + 0.65f * v
        scaleX = 0.96f + 0.04f * v
        scaleY = 0.96f + 0.04f * v
    }.then(if (v < 1f) Modifier.blur((10 * (1f - v)).dp) else Modifier)
}

/* --------------------------------------------------- arrival bookkeeping */

/**
 * r44 (owner: "age message giye pore animation hoi duplicate vabe"): a row
 * id is marked ONCE, synchronously, at the row's FIRST composition - so an
 * animation is always part of frame one and can never be a replay. History
 * composes before the screen arms (and gets null), re-composed rows find
 * their id already seen, and paintSent pre-marks the id its pending row
 * flew in with, so the painted row just replaces it silently.
 */
object FxArrivals {
    var armed = false
    private val seen =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, Long>(64, 0.75f, false) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > 500
            },
        )

    fun mark(id: String): Long? {
        if (id.isEmpty()) return null
        synchronized(seen) {
            if (seen.containsKey(id)) return null
            val now = android.os.SystemClock.uptimeMillis()
            seen[id] = now
            return if (armed) now else null
        }
    }

    fun markSeen(id: String) {
        if (id.isNotEmpty()) seen[id] = android.os.SystemClock.uptimeMillis()
    }
}

/** r58: Track only messages born LIVE during this session so history scrolling never triggers animations. */
object LiveArrivals {
    private val liveIds = java.util.Collections.synchronizedSet(HashSet<String>())

    fun markLive(id: String) {
        if (id.isNotBlank()) liveIds.add(id)
    }

    fun isLive(id: String): Boolean = id.isNotBlank() && liveIds.contains(id)
}

/** Pop entry for the multi-glyph emoji cluster and the document tile. */
@Composable
fun Modifier.fxPopIn(active: Boolean): Modifier {
    val scale = fxAnimatorScale()
    val t = remember { Animatable(if (active && scale > 0f) 0f else 1f) }
    LaunchedEffect(active) {
        if (active && scale > 0f) t.animateTo(1f, tween(650, easing = FastOutSlowInEasing))
    }
    val v = t.value
    return graphicsLayer {
        val s = 0.3f + 0.7f * v + sin(v * PI).toFloat() * 0.08f
        scaleX = s
        scaleY = s
        alpha = (v * 4f).coerceAtMost(1f)
    }
}

/** The document row's arrival progress underline (1100 ms fill). */
@Composable
fun Modifier.fxProgressLine(active: Boolean, tint: Color): Modifier {
    val scale = fxAnimatorScale()
    var clock by remember(active) { mutableStateOf(-1L) }
    LaunchedEffect(active) {
        if (active && scale > 0f) {
            val t0 = android.os.SystemClock.uptimeMillis()
            while (android.os.SystemClock.uptimeMillis() - t0 < 1300L) {
                clock = android.os.SystemClock.uptimeMillis() - t0
                kotlinx.coroutines.delay(16)
            }
            clock = -1L
        }
    }
    return drawBehind {
        val el = clock
        if (el >= 0L) {
            val p = (el / 1100f).coerceIn(0f, 1f)
            val y = size.height - 1.dp.toPx()
            drawLine(
                color = tint,
                start = Offset(0f, y),
                end = Offset(size.width * FastOutSlowInEasing.transform(p), y),
                strokeWidth = 2.dp.toPx(),
            )
        }
    }
}

/* ---------------------------------------------------------------- slot open */

/**
 * The slot a new bubble lands in: top margin -30dp to 8dp while alpha 0 to 1,
 * 480 ms cubic-bezier(0.22, 1, 0.36, 1) (received) / -34dp & 420 ms (sent).
 */
@Composable
fun Modifier.fxSlotOpen(active: Boolean, fromDp: Float = -30f, ms: Int = 480): Modifier {
    val scale = fxAnimatorScale()
    val t = remember { Animatable(if (active && scale > 0f) 0f else 1f) }
    LaunchedEffect(active) {
        if (active && scale > 0f) t.animateTo(1f, tween(ms, easing = FastOutSlowInEasing))
    }
    val v = t.value
    return graphicsLayer {
        alpha = v
        translationY = (fromDp + (8f - fromDp) * v) * density
    }
}

/* -------------------------------------------------------- the send flight */

/**
 * The sent bubble's flight (send/SPEC.md, ported pragmatically): the row IS
 * the final bubble - only translation / scale / alpha animate (never width
 * or height, so text never re-wraps mid-flight). It rises from the composer
 * with a small arc, settles at full size, and hands off to the landing
 * squash + shine via [onDone]. Durations: text 680, media 700-720, chip 560.
 */
/* ------------------------------------------------------- landing (squash) */

/**
 * The landing squash on the REAL bubble the moment its clone arrives (sent)
 * or the reveal completes (received): (1.05, 0.94) -> (0.97, 1.05) ->
 * (1.02, 0.99) -> (1, 1), 520 ms, origin bottom-end (sent) / bottom-start.
 */
@Composable
fun Modifier.fxLanding(trigger: Any?): Modifier {
    val scale = fxAnimatorScale()
    val sx = remember { Animatable(1f) }
    val sy = remember { Animatable(1f) }
    LaunchedEffect(trigger) {
        if (trigger == null || scale <= 0f) return@LaunchedEffect
        sx.snapTo(1.05f); sy.snapTo(0.94f)
        sx.animateTo(1f, tween(520, easing = FastOutSlowInEasing))
        sy.animateTo(1f, tween(520, easing = FastOutSlowInEasing))
    }
    return graphicsLayer {
        scaleX = sx.value
        scaleY = sy.value
    }
}

/* ------------------------------------------- shine + ripple overlay (draw) */

/**
 * One-shot shine band (white 0.4, 45% wide, left-to-right, 900-1000 ms) plus
 * the corner ripple (white / accent 0.25 growing from a corner, 800-900 ms),
 * drawn over the bubble content - keyed by [trigger].
 */
@Composable
fun Modifier.fxShineRipple(trigger: Any?, tint: Color = Color.White): Modifier {
    val scale = fxAnimatorScale()
    var clock by remember(trigger) { mutableStateOf(-1L) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            clock = 0L
            val t0 = android.os.SystemClock.uptimeMillis()
            while (android.os.SystemClock.uptimeMillis() - t0 < 1100L) {
                clock = android.os.SystemClock.uptimeMillis() - t0
                kotlinx.coroutines.delay(16)
            }
            clock = -1L
        }
    }
    return drawWithContent {
        drawContent()
        val el = clock
        if (el >= 0L) {
            // shine: 200 ms delay, 1000 ms sweep
            val sp = ((el - 200f) / 1000f).coerceIn(0f, 1f)
            if (el in 200L..1200L) {
                val w = size.width
                val band = w * 0.45f
                val x = -band + (w + 2 * band) * FastOutSlowInEasing.transform(sp)
                drawRect(
                    brush = Brush.horizontalGradient(
                        listOf(Color(0x00FFFFFF), tint.copy(alpha = 0.4f), Color(0x00FFFFFF)),
                        startX = x,
                        endX = x + band,
                    ),
                )
            }
            // ripple: from the bottom-right corner, 800 ms
            val rp = (el / 800f).coerceIn(0f, 1f)
            if (el <= 900L) {
                val maxR = kotlin.math.hypot(size.width, size.height)
                drawCircle(
                    color = tint.copy(alpha = 0.25f * (1f - rp)),
                    radius = maxR * FastOutSlowInEasing.transform(rp),
                    center = Offset(size.width, size.height),
                )
            }
        }
    }
}

/* ------------------------------------------- unique item send animations */

/** Photo / Image shutter flash: soft white lens gleam sweeps across the media on send/arrival. */
@Composable
fun Modifier.fxShutterFlash(trigger: Any?): Modifier {
    val scale = fxAnimatorScale()
    val alpha = remember(trigger) { Animatable(if (trigger != null && scale > 0f) 0.65f else 0f) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            alpha.animateTo(0f, tween(360, easing = FastOutSlowInEasing))
        }
    }
    return drawWithContent {
        drawContent()
        val a = alpha.value
        if (a > 0.01f) {
            drawRect(Color.White.copy(alpha = a))
        }
    }
}

/** Voice note acoustic ripple: concentric soundwave ring pulses from the playhead on send/arrival. */
@Composable
fun Modifier.fxSonicRipple(trigger: Any?, tint: Color = Color(0xFF60A5FA)): Modifier {
    val scale = fxAnimatorScale()
    var clock by remember(trigger) { mutableStateOf(-1L) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            clock = 0L
            val t0 = android.os.SystemClock.uptimeMillis()
            while (android.os.SystemClock.uptimeMillis() - t0 < 650L) {
                clock = android.os.SystemClock.uptimeMillis() - t0
                kotlinx.coroutines.delay(16)
            }
            clock = -1L
        }
    }
    return drawBehind {
        val el = clock
        if (el in 0L..650L) {
            val p = (el / 650f).coerceIn(0f, 1f)
            val r = size.height * 0.4f + p * size.width * 0.45f
            drawCircle(
                color = tint.copy(alpha = 0.3f * (1f - p)),
                radius = r,
                center = Offset(size.height * 0.6f, size.height / 2f),
                style = Stroke(width = 2.dp.toPx() * (1f - p * 0.5f)),
            )
        }
    }
}

/** Video playhead ping: center play icon pops with an elastic bounce on send/arrival. */
@Composable
fun Modifier.fxPlayheadPing(trigger: Any?): Modifier {
    val scale = fxAnimatorScale()
    val s = remember(trigger) { Animatable(if (trigger != null && scale > 0f) 0.4f else 1f) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            s.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.6f, stiffness = 420f))
        }
    }
    return graphicsLayer {
        scaleX = s.value
        scaleY = s.value
    }
}

/** Document / Contact card sheen: diagonal metallic reflection streak across the card. */
@Composable
fun Modifier.fxCardSheen(trigger: Any?): Modifier {
    val scale = fxAnimatorScale()
    var clock by remember(trigger) { mutableStateOf(-1L) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            clock = 0L
            val t0 = android.os.SystemClock.uptimeMillis()
            while (android.os.SystemClock.uptimeMillis() - t0 < 550L) {
                clock = android.os.SystemClock.uptimeMillis() - t0
                kotlinx.coroutines.delay(16)
            }
            clock = -1L
        }
    }
    return drawWithContent {
        drawContent()
        val el = clock
        if (el in 0L..550L) {
            val p = (el / 550f).coerceIn(0f, 1f)
            val w = size.width
            val x = -w + 2f * w * p
            drawRect(
                brush = Brush.linearGradient(
                    listOf(Color.Transparent, Color.White.copy(alpha = 0.28f), Color.Transparent),
                    start = Offset(x, 0f),
                    end = Offset(x + w * 0.35f, size.height),
                ),
            )
        }
    }
}

/** View-once media lock snap: padlock rotation and settle on send/arrival. */
@Composable
fun Modifier.fxPadlockSnap(trigger: Any?): Modifier {
    val scale = fxAnimatorScale()
    val rot = remember(trigger) { Animatable(if (trigger != null && scale > 0f) -22f else 0f) }
    LaunchedEffect(trigger) {
        if (trigger != null && scale > 0f) {
            rot.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = 0.58f, stiffness = 480f))
        }
    }
    return graphicsLayer {
        rotationZ = rot.value
    }
}

/**
 * Clean unified send/receive animation (r58):
 * - Live SENT messages (including documents/media/text/voice) animate in from the RIGHT side (+64dp -> 0f).
 * - Live SENT messages animate in from the bottom-right (+44dp X, +18dp Y -> 0f).
 * - Live RECEIVED messages animate in from the bottom-left (-44dp X, +18dp Y -> 0f).
 * - Chat history (scrolling or loading older): NO side animation, quiet and stable with gentle fade.
 */
@Composable
fun Modifier.fxSideSlide(
    active: Boolean,
    isSent: Boolean,
    durMs: Int = 300,
): Modifier {
    val scale = fxAnimatorScale()
    val density = LocalDensity.current.density
    val p = remember(active) { Animatable(if (active && scale > 0f) 0f else 1f) }

    LaunchedEffect(active) {
        if (active && scale > 0f) {
            p.snapTo(0f)
            p.animateTo(1f, tween(durMs, easing = FastOutSlowInEasing))
        } else {
            p.snapTo(1f)
        }
    }

    return graphicsLayer {
        val v = p.value
        if (v < 1f) {
            val dist = 68f * density
            val yDist = 84f * density
            translationX = if (isSent) dist * (1f - v) else -dist * (1f - v)
            translationY = yDist * (1f - v)
            alpha = v.coerceIn(0f, 1f)
        } else {
            translationX = 0f
            translationY = 0f
            alpha = 1f
        }
    }
}

/**
 * E7: the old-history entrance — a soft one-shot unfurl (fade + 14dp rise,
 * 260ms), UNIQUE to loadOlder rows and deliberately unlike the live slide
 * (directional), fly (700ms travel) and pop. It overrides the standing
 * "history stays quiet" rule (r45 item 1 / r50 / r58 / ChatScreen:6074) by
 * explicit owner ask — flicker-proof by construction: the key is consumed
 * on first composition (no replay, like bornKeys), GPU-only (no relayout),
 * and reduced-motion gated like every other fx here.
 */
@Composable
fun Modifier.fxHistoryUnfurl(
    active: Boolean,
    durMs: Int = 260,
): Modifier {
    val scale = fxAnimatorScale()
    val density = LocalDensity.current.density
    val p = remember(active) { Animatable(if (active && scale > 0f) 0f else 1f) }

    LaunchedEffect(active) {
        if (active && scale > 0f) {
            p.snapTo(0f)
            p.animateTo(1f, tween(durMs, easing = FastOutSlowInEasing))
        } else {
            p.snapTo(1f)
        }
    }

    return graphicsLayer {
        val v = p.value
        if (v < 1f) {
            translationY = 14f * density * (1f - v)
            alpha = v.coerceIn(0f, 1f)
        } else {
            translationY = 0f
            alpha = 1f
        }
    }
}

/* ------------------------------------------------------ letter-by-letter */

/**
 * The received TEXT reveal: the full body is laid out once (its real size is
 * reserved from the first frame) and letters fade / spring in with an 18 ms
 * stagger - per-character alpha spans, so line breaks never move.
 */
@Composable
fun fxLetterSpans(text: String, active: Boolean): AnnotatedString {
    val scale = fxAnimatorScale()
    var revealed by remember { mutableStateOf(if (active && scale > 0f) 0 else text.length) }
    LaunchedEffect(active, text) {
        if (!active || scale <= 0f) {
            revealed = text.length
            return@LaunchedEffect
        }
        revealed = 0
        var i = 0
        while (i < text.length) {
            kotlinx.coroutines.delay(18)
            i++
            revealed = i
        }
    }
    return buildAnnotatedString {
        if (revealed >= text.length) {
            append(text)
        } else {
            append(text)
            addStyle(SpanStyle(color = Color(0x00000000)), revealed, text.length)
        }
    }
}

/* --------------------------------------------------------- the emoji system */

/**
 * Emoji animations — v200 rewrite per owner item 2:
 * Old custom Canvas/registry system (EmojiFx, EmojiAnim, EmojiAnimationRegistry,
 * AnimatedEmoji, Kf, inSample, idleSample, drawFx) removed.
 *
 * Single-emoji messages now use Noto animated emoji (Lottie JSON from
 * googlefonts.github.io/noto-emoji-animation — 881 assets, 68M).
 * See EmojiAnim.kt -> NotoAnimatedEmoji + NotoEmojiGlyph.
 *
 * One-shot on send/receive, tap replays locally + POSTs /fx to replay on other side.
 * Offline-first: assets bundled in assets/noto-emoji/{codepoint}.json.
 */
