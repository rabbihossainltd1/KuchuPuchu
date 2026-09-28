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
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import kotlin.math.PI
import kotlin.math.sin

/**
 * Plain (non-composable) animator-scale read for queue decisions.
 *
 * r76-26 (owner: "app ta aro smooth fast koro ... kothao jeno laggy na
 * lage"): this is a Settings GLOBAL binder call, and it used to run on every
 * composition of every chat row that animates - hundreds of binder hops while
 * a long list settles. The value is now cached process-wide for 2s: long
 * enough to collapse the per-frame chatter, short enough that flipping the
 * developer-options animation scale still lands almost immediately.
 */
@Volatile
private var fxScaleCache = 1f

@Volatile
private var fxScaleAt = -10_000L

fun fxScaleOf(ctx: android.content.Context): Float {
    val now = android.os.SystemClock.uptimeMillis()
    if (now - fxScaleAt < 2_000L) return fxScaleCache
    val v = runCatching {
        android.provider.Settings.Global.getFloat(
            ctx.contentResolver,
            android.provider.Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        )
    }.getOrDefault(1f)
    fxScaleCache = v
    fxScaleAt = now
    return v
}

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

/**
 * r67-3 (owner: "massage send hole agei chat a place hoye abar animate hoye
 * right side er niche theke ashe taile to animation er moja tai haray jabe so
 * all items ... jeno agei place na hoi chat a animation hoyei massage asbe
 * send sending sent shob sync Hobe alada na").
 *
 * ONE message = ONE flight. A row is composed twice in its life: first as the
 * optimistic echo that is still SENDING, then as the row the server accepted —
 * a different LazyColumn item (the echo lives in the pending block, the
 * accepted row in the thread block), so its composition is rebuilt and a
 * plain `remember` cannot tell them apart. Both compositions carry the same
 * stable key (the row's clientId, else its server id), so the claim below is
 * what makes them the same flight: the echo claims it ON THE FRAME IT IS BORN
 * and flies in from the bottom-right; the swap finds it taken and simply takes
 * the seat, with no second animation and no visible jump between the three
 * states (sending → sent, received rows alike).
 *
 * The claim is not released on purpose: history scrolling, loadOlder, a chat
 * re-open and the echo→sent swap must all find it gone. The map is bounded, so
 * a long session cannot grow it without limit.
 */
object FxFlights {
    private val claimed =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, Boolean>(64, 0.75f, false) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean = size > 800
            },
        )

    /** True exactly once per key. A blank key (no clientId and no id) never flies. */
    fun claim(key: String): Boolean {
        if (key.isBlank()) return false
        synchronized(claimed) {
            if (claimed.containsKey(key)) return false
            claimed[key] = true
            return true
        }
    }
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
    // r76-19 (owner: emojis arrive with their bottom cut): the slot used to
    // translate the row -30dp..+8dp while it faded. Combined with the flight
    // offsets below the list's bottom edge, the bubble's own body was clipped
    // by the viewport during the whole entrance. The slot now only FADES —
    // all movement lives in fxFlyIn, which never leaves the row's bounds.
    return graphicsLayer { alpha = v }
}

/**
 * r78-6/r78-8 (owner: "emoji send korle 0.2 seconds flicking kore halka kata
 * pore" + "emojis send korle first time animate hobe just ekbar"): an emoji
 * row IS its glyph - there is no bubble to hide the composer flight's start,
 * and that flight begins its travel below the LazyColumn viewport, so the
 * first ~30% of the entrance drew a glyph chopped by the list edge. An emoji
 * row takes THIS instead: one grow+fade entirely inside its own bounds, so
 * nothing can clip it - exactly once per message (clientId-keyed, the
 * first-arm-wins Flight), and the echo->server swap can never re-run it.
 */
@Composable
fun Modifier.fxEmojiEntrance(active: Boolean, key: String, ms: Int = 300): Modifier {
    val scale = fxAnimatorScale()
    if (!active || scale <= 0f) return this
    // r79-8 (owner retest: "emoji first time animates hoi na"): the r78 clock
    // ticked FROM THE ARM (wall time). Between the arm and the row's first
    // pixels sit message composition + the glyph's own first raster, and that
    // jank ate almost the whole 260 ms - the pop finished nearly off-screen,
    // so it READ as "no entrance, appears instantly". The sprint now starts
    // when the row is LAID OUT (perception time): the full grow+fade always
    // plays in front of the owner, once per message (clientId-keyed - the
    // echo->server swap keeps the remember, it can never replay).
    val t = remember(key) { androidx.compose.animation.core.Animatable(0f) }
    var laidOut by remember(key) { mutableStateOf(false) }
    LaunchedEffect(laidOut) {
        if (!laidOut) return@LaunchedEffect
        t.animateTo(1f, tween(ms, easing = FastOutSlowInEasing))
        FlightAnims.markDone(key)
    }
    val v = t.value
    // Always return this modifier chain (never early-return `this` after the
    // remembers exist - changing the modifier LAYOUT each frame is how tap /
    // hold targets drift under a running animation).
    return this
        .onGloballyPositioned { laidOut = true }
        .graphicsLayer {
            val g = 0.55f + 0.45f * v
            alpha = 0.25f + 0.75f * v
            scaleX = g
            scaleY = g
            transformOrigin = androidx.compose.ui.graphics.TransformOrigin.Center
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
        // r76-20 (owner: arrival animation "smooth na"): the landing used to
        // SNAP the bubble to (1.05, 0.94) the instant the flight ended — a
        // visible jerk on the handoff. The settle is gentle now: a barely-there
        // (1.02, 0.98) released over 360 ms.
        sx.snapTo(1.02f); sy.snapTo(0.98f)
        sx.animateTo(1f, tween(360, easing = FastOutSlowInEasing))
        sy.animateTo(1f, tween(360, easing = FastOutSlowInEasing))
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
    val p = remember(active) { Animatable(if (active && scale > 0f) 0f else 1f) }

    LaunchedEffect(active) {
        if (active && scale > 0f) {
            p.snapTo(0f)
            p.animateTo(1f, tween(durMs, easing = FastOutSlowInEasing))
        } else {
            p.snapTo(1f)
        }
    }

    // r76-19 (owner: arriving emojis lose part of their body): this used to
    // slide the bubble +68dp/+84dp OUT of the viewport edges on top of the
    // row's own flight - the last row started fully below the list's bottom
    // and its content came back visibly CUT. The bubble now only fades while
    // the row's fxFlyIn grows it in from its bottom corner (one motion, zero
    // translation, nothing can be clipped).
    return graphicsLayer { alpha = p.value }
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
