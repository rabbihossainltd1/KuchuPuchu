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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import kotlin.math.PI
import kotlin.math.sin
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke

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
fun fxAnimatorScale(): Float = remember { fxScaleOf(LocalContext.current) }

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
@Composable
fun Modifier.fxFlyIn(active: Boolean, durMs: Int, onDone: () -> Unit = {}): Modifier {
    val scale = fxAnimatorScale()
    val t = remember { Animatable(if (active && scale > 0f) 0f else 1f) }
    var fired by remember { mutableStateOf(false) }
    LaunchedEffect(active) {
        if (active && !fired) {
            fired = true
            if (scale > 0f) t.animateTo(1f, tween(durMs, easing = FastOutSlowInEasing))
            onDone()
        }
    }
    val v = t.value
    return graphicsLayer {
        val arc = sin(v * PI).toFloat()
        translationY = (1f - v) * 150f * density - arc * 8f * density
        translationX = (1f - v) * 24f * density
        scaleX = 0.92f + 0.08f * v + arc * 0.05f
        scaleY = 0.92f + 0.08f * v + arc * 0.05f
        alpha = if (v < 0.08f) v / 0.08f else 1f
        transformOrigin = androidx.compose.ui.layout.TransformOrigin(1f, 1f)
    }
}

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
        transformOrigin = androidx.compose.ui.layout.TransformOrigin(1f, 1f)
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
            addStyle(SpanStyle(alpha = 0f), revealed, text.length)
        }
    }
}

/* --------------------------------------------------------- the emoji system */

enum class EmojiFx { NONE, FIRE, HEARTRING, HEARTRISE, TEARS, CONFETTI, SHOCK, SPARKLE, ZZZ, STEAM }

data class EmojiAnim(val inName: String, val idle: String, val fx: EmojiFx)

/**
 * The shared emoji registry (receive SPEC owns it; the send side reuses it).
 * Keys are grapheme clusters normalised by stripping U+FE0F and skin-tone
 * modifiers, so 👍🏽 uses 👍 and ❤ matches ❤️. Anything not listed falls back
 * to its Unicode category; unknown categories use the faces animation.
 */
object EmojiAnimationRegistry {
    private fun norm(s: String): String {
        val sb = StringBuilder()
        for (cp in s.codePoints()) {
            val c = cp.toInt()
            if (c == 0xFE0F) continue
            if (c in 0x1F3FB..0x1F3FF) continue
            sb.appendCodePoint(c)
        }
        return sb.toString()
    }

    private val custom = mapOf(
        "🔥" to EmojiAnim("fire-in", "fire-idle", EmojiFx.FIRE),
        "❤" to EmojiAnim("heart-in", "heart-idle", EmojiFx.HEARTRING),
        "😂" to EmojiAnim("shake-in", "shake", EmojiFx.TEARS),
        "🤣" to EmojiAnim("shake-in", "shake-fast", EmojiFx.TEARS),
        "😭" to EmojiAnim("sob-in", "sob", EmojiFx.TEARS),
        "👍" to EmojiAnim("thumb-in", "tilt", EmojiFx.NONE),
        "🎉" to EmojiAnim("party-in", "tilt", EmojiFx.CONFETTI),
        "🎊" to EmojiAnim("party-in", "tilt", EmojiFx.CONFETTI),
        "🥳" to EmojiAnim("party-in", "tilt", EmojiFx.CONFETTI),
        "👋" to EmojiAnim("wave-in", "wave", EmojiFx.NONE),
        "💪" to EmojiAnim("flex-in", "flex", EmojiFx.NONE),
        "👏" to EmojiAnim("clap-in", "clap", EmojiFx.NONE),
        "🙏" to EmojiAnim("pray-in", "pray", EmojiFx.NONE),
        "💯" to EmojiAnim("zoom-in", "pulse", EmojiFx.SHOCK),
        "💥" to EmojiAnim("explode-in", "pulse", EmojiFx.SHOCK),
        "✨" to EmojiAnim("twinkle-in", "twinkle", EmojiFx.SPARKLE),
        "⭐" to EmojiAnim("twinkle-in", "twinkle", EmojiFx.SPARKLE),
        "🌟" to EmojiAnim("twinkle-in", "twinkle", EmojiFx.SPARKLE),
        "💫" to EmojiAnim("spin-in", "twinkle", EmojiFx.SPARKLE),
        "⚡" to EmojiAnim("zoom-in", "twinkle", EmojiFx.SHOCK),
        "😴" to EmojiAnim("float-in", "snore", EmojiFx.ZZZ),
        "😡" to EmojiAnim("anger-in", "anger", EmojiFx.STEAM),
        "🤬" to EmojiAnim("anger-in", "anger", EmojiFx.STEAM),
        "😠" to EmojiAnim("anger-in", "anger", EmojiFx.STEAM),
        "🥶" to EmojiAnim("shiver-in", "shiver", EmojiFx.NONE),
        "😱" to EmojiAnim("zoom-in", "shiver", EmojiFx.NONE),
        "🥵" to EmojiAnim("melt-in", "melt", EmojiFx.STEAM),
        "😎" to EmojiAnim("cool-in", "tilt", EmojiFx.SPARKLE),
        "🤯" to EmojiAnim("explode-in", "pulse", EmojiFx.SHOCK),
        "😍" to EmojiAnim("heart-in", "heart-idle", EmojiFx.HEARTRISE),
        "🥰" to EmojiAnim("heart-in", "heart-idle", EmojiFx.HEARTRISE),
        "😘" to EmojiAnim("pop-in", "tilt", EmojiFx.HEARTRISE),
        "💔" to EmojiAnim("heart-in", "shiver-slow", EmojiFx.SHOCK),
        "🚀" to EmojiAnim("fly-in", "fly", EmojiFx.NONE),
        "💀" to EmojiAnim("drop-in", "tilt", EmojiFx.NONE),
        "👻" to EmojiAnim("float-in", "float", EmojiFx.NONE),
        "🤔" to EmojiAnim("pop-in", "tilt", EmojiFx.NONE),
        "🙄" to EmojiAnim("pop-in", "tilt", EmojiFx.NONE),
        "🔔" to EmojiAnim("pop-in", "ring", EmojiFx.NONE),
        "⏰" to EmojiAnim("pop-in", "ring-fast", EmojiFx.NONE),
        "📱" to EmojiAnim("pop-in", "ring-fast", EmojiFx.NONE),
        "🎁" to EmojiAnim("bounce-in", "bounce", EmojiFx.SPARKLE),
        "🏆" to EmojiAnim("rise-in", "twinkle", EmojiFx.SPARKLE),
        "👑" to EmojiAnim("drop-in", "twinkle", EmojiFx.SPARKLE),
        "💎" to EmojiAnim("spin-in", "twinkle", EmojiFx.SPARKLE),
        "🌈" to EmojiAnim("grow-in", "pulse-slow", EmojiFx.NONE),
        "🐶" to EmojiAnim("bounce-in", "tilt", EmojiFx.NONE),
        "🐬" to EmojiAnim("bounce-in", "swim", EmojiFx.NONE),
        "🐱" to EmojiAnim("pop-in", "tilt", EmojiFx.NONE),
        "🦋" to EmojiAnim("fly-in", "fly", EmojiFx.NONE),
        "🐝" to EmojiAnim("fly-in", "fly", EmojiFx.NONE),
        "🐠" to EmojiAnim("swim-in", "swim", EmojiFx.NONE),
        "🐟" to EmojiAnim("swim-in", "swim", EmojiFx.NONE),
        "🐳" to EmojiAnim("swim-in", "swim-slow", EmojiFx.NONE),
        "🌹" to EmojiAnim("grow-in", "sway", EmojiFx.NONE),
        "🌻" to EmojiAnim("grow-in", "sway", EmojiFx.NONE),
        "🌸" to EmojiAnim("drift-in", "drift", EmojiFx.NONE),
        "☀" to EmojiAnim("spin-in", "pulse", EmojiFx.SPARKLE),
        "🌙" to EmojiAnim("drift-in", "sway", EmojiFx.NONE),
        "❄" to EmojiAnim("drift-in", "drift", EmojiFx.NONE),
        "🍕" to EmojiAnim("bounce-in", "tilt", EmojiFx.NONE),
        "🍔" to EmojiAnim("bounce-in", "tilt", EmojiFx.NONE),
        "☕" to EmojiAnim("rise-in", "float", EmojiFx.STEAM),
        "🎵" to EmojiAnim("float-in", "sway-fast", EmojiFx.NONE),
        "🎶" to EmojiAnim("float-in", "sway-fast", EmojiFx.NONE),
        "💡" to EmojiAnim("pop-in", "twinkle", EmojiFx.SPARKLE),
        "✅" to EmojiAnim("pop-in", "pulse", EmojiFx.SHOCK),
        "❌" to EmojiAnim("zoom-in", "shiver-slow", EmojiFx.NONE),
    )

    private fun category(s: String): EmojiAnim {
        val cp = s.codePoints().findFirst().orElse(0).toInt()
        val faces = EmojiAnim("pop-in", "tilt", EmojiFx.NONE)
        return when {
            cp == 0x2764 || cp in 0x1F490..0x1F49F -> EmojiAnim("heart-in", "heart-idle", EmojiFx.HEARTRING)
            cp in 0x1F600..0x1F64F -> faces
            cp in 0x1F900..0x1F92F -> faces
            cp in 0x1F641..0x1F64F -> faces
            cp in 0x1F440..0x1F4AA or (cp in 0x1F90C..0x1F91F) or (cp in 0x1F930..0x1F93F) or
                (cp in 0x1F970..0x1F97F) -> EmojiAnim("thumb-in", "tilt", EmojiFx.NONE)
            cp in 0x1F400..0x1F43F || cp in 0x1F980..0x1F9BF -> EmojiAnim("bounce-in", "bounce", EmojiFx.NONE)
            cp in 0x1F32D..0x1F37F || cp in 0x2615..0x2616 || cp == 0x1F37A -> EmojiAnim("drop-in", "tilt", EmojiFx.NONE)
            cp in 0x1F300..0x1F32B || cp in 0x1F330..0x1F33F || cp in 0x1F340..0x1F353 ->
                EmojiAnim("grow-in", "sway", EmojiFx.NONE)
            cp in 0x2B50..0x2B55 || cp in 0x2700..0x27BF || cp in 0x1F380..0x1F39F ->
                EmojiAnim("zoom-in", "pulse", EmojiFx.SHOCK)
            else -> faces
        }
    }

    fun forEmoji(raw: String): EmojiAnim = custom[norm(raw)] ?: category(norm(raw))
}

/* ------------------------------------------------- keyframe entry + idle */

private data class Kf(val t: Float, val sx: Float = 1f, val sy: Float = sx, val rot: Float = 0f, val tx: Float = 0f, val ty: Float = 0f, val a: Float = 1f)

/** The entry phase values for a named `in` animation at progress p (0..1). */
private fun inSample(name: String, p: Float, dp: Float): Kf {
    // small linear interpolation over the named keyframes - the shapes match
    // the SPEC table (overshoot, bounce, spin, drop, fly ...).
    fun lerp(a: Kf, b: Kf, q: Float) = Kf(
        t = p,
        sx = a.sx + (b.sx - a.sx) * q,
        sy = a.sy + (b.sy - a.sy) * q,
        rot = a.rot + (b.rot - a.rot) * q,
        tx = a.tx + (b.tx - a.tx) * q,
        ty = a.ty + (b.ty - a.ty) * q,
        a = a.a + (b.a - a.a) * q,
    )
    val keys: List<Kf> = when (name) {
        "fire-in" -> listOf(Kf(0f, 0.1f, 0.05f, a = 0f), Kf(0.35f, 0.7f, 1.25f), Kf(0.65f, 1.05f, 0.92f), Kf(1f))
        "heart-in" -> listOf(Kf(0f, 0.2f, a = 0f), Kf(0.2f, 1.25f), Kf(0.35f, 0.95f), Kf(0.52f, 1.18f), Kf(0.7f), Kf(1f))
        "shake-in" -> listOf(Kf(0f, 0.4f, a = 0f), Kf(1f))
        "sob-in" -> listOf(Kf(0f, 0.85f, ty = 10 * dp / 56f, a = 0f), Kf(1f))
        "thumb-in" -> listOf(Kf(0f, 0.7f, rot = 20f, ty = 60 * dp / 56f, a = 0f), Kf(0.45f, 1.08f, rot = -16f, ty = -10 * dp / 56f), Kf(0.65f, 1f, rot = 6f), Kf(0.82f, rot = -3f), Kf(1f, rot = 0f))
        "party-in" -> listOf(Kf(0f, 0.5f, rot = -30f, tx = -30 * dp / 56f, ty = 40 * dp / 56f, a = 0f), Kf(0.4f, 1.15f, rot = 0f), Kf(0.55f, 1f, rot = -14f), Kf(0.7f, rot = 10f), Kf(1f, rot = 0f))
        "wave-in" -> listOf(Kf(0f, tx = -30 * dp / 56f, a = 0f), Kf(1f))
        "flex-in" -> listOf(Kf(0f, 0.3f), Kf(0.5f, 1.3f), Kf(0.7f, 0.9f), Kf(1f))
        "clap-in" -> listOf(Kf(0f, 0.4f, a = 0f), Kf(1f))
        "pray-in" -> listOf(Kf(0f, 0.8f, ty = 30 * dp / 56f, a = 0f), Kf(1f))
        "zoom-in" -> listOf(Kf(0f, 2.4f, a = 0f), Kf(0.55f, 0.88f), Kf(0.75f, 1.08f), Kf(1f))
        "explode-in" -> listOf(Kf(0f, 0.1f, a = 0f), Kf(0.45f, 1.6f), Kf(0.7f, 0.9f), Kf(1f))
        "twinkle-in" -> listOf(Kf(0f, 0f, rot = -90f, a = 0f), Kf(0.6f, 1.3f, rot = 20f), Kf(1f))
        "spin-in" -> listOf(Kf(0f, 0.1f, rot = -360f, a = 0f), Kf(0.7f, 1.15f, rot = 15f), Kf(1f))
        "float-in" -> listOf(Kf(0f, 0.5f, ty = 40 * dp / 56f, a = 0f), Kf(0.6f, 1.1f, ty = -10 * dp / 56f), Kf(1f))
        "anger-in" -> listOf(Kf(0f, 0.3f, a = 0f), Kf(0.6f, 1.25f), Kf(1f))
        "shiver-in" -> listOf(Kf(0f, 0.5f, a = 0f), Kf(1f))
        "melt-in" -> listOf(Kf(0f, 1.4f, 0.5f, a = 0f), Kf(1f))
        "cool-in" -> listOf(Kf(0f, 1.2f, ty = -40 * dp / 56f, a = 0f), Kf(0.6f, 0.96f, ty = 4 * dp / 56f), Kf(1f))
        "pop-in" -> listOf(Kf(0f, 0f, a = 0f), Kf(0.55f, 1.25f), Kf(0.75f, 0.92f), Kf(1f))
        "bounce-in" -> listOf(Kf(0f, 0.7f, ty = -60 * dp / 56f, a = 0f), Kf(0.5f, 1.15f, 0.85f), Kf(0.7f, 0.95f, 1.05f, ty = -22 * dp / 56f), Kf(0.85f, 1.05f, 0.95f), Kf(1f))
        "drop-in" -> listOf(Kf(0f, 0.8f, ty = -70 * dp / 56f, a = 0f), Kf(0.55f, 1.1f, 0.88f), Kf(0.75f, 0.96f, 1.04f, ty = -8 * dp / 56f), Kf(1f))
        "rise-in" -> listOf(Kf(0f, 0.5f, ty = 50 * dp / 56f, a = 0f), Kf(0.7f, 1.08f, ty = -6 * dp / 56f), Kf(1f))
        "fly-in" -> listOf(Kf(0f, 0.5f, rot = -30f, tx = -80 * dp / 56f, ty = 50 * dp / 56f, a = 0f), Kf(0.6f, 1.1f, rot = 8f, tx = 8 * dp / 56f, ty = -6 * dp / 56f), Kf(1f))
        "swim-in" -> listOf(Kf(0f, 0.6f, tx = -60 * dp / 56f, a = 0f), Kf(1f))
        "grow-in" -> listOf(Kf(0f, 0f, ty = 20 * dp / 56f, a = 0f), Kf(0.7f, 1.15f), Kf(1f))
        "drift-in" -> listOf(Kf(0f, rot = -20f, ty = -30 * dp / 56f, a = 0f), Kf(1f))
        else -> listOf(Kf(0f, 0.3f, a = 0f), Kf(0.7f, 1.1f), Kf(1f))
    }
    if (p <= 0f) return keys.first()
    if (p >= 1f) return keys.last()
    var i = 0
    while (i < keys.lastIndex && keys[i + 1].t < p) i++
    val a = keys[i]
    val b = keys[(i + 1).coerceAtMost(keys.lastIndex)]
    val q = if (b.t > a.t) (p - a.t) / (b.t - a.t) else 1f
    return lerp(a, b, q)
}

private fun inDurationMs(name: String): Int = when (name) {
    "fire-in" -> 900
    "heart-in" -> 1400
    "shake-in" -> 500
    "sob-in" -> 900
    "thumb-in" -> 1100
    "party-in" -> 900
    "wave-in" -> 500
    "flex-in" -> 800
    "clap-in" -> 400
    "pray-in" -> 800
    "zoom-in" -> 600
    "explode-in" -> 650
    "twinkle-in" -> 800
    "spin-in" -> 950
    "float-in" -> 850
    "anger-in" -> 600
    "shiver-in" -> 500
    "melt-in" -> 600
    "cool-in" -> 800
    "pop-in" -> 650
    "bounce-in" -> 1000
    "drop-in" -> 900
    "rise-in" -> 850
    "fly-in" -> 900
    "swim-in" -> 850
    "grow-in" -> 900
    "drift-in" -> 900
    else -> 700
}

/** The idle loop's transform at wall-clock [tMs] for a named idle animation. */
private fun idleSample(name: String, tMs: Long): Kf {
    fun phase(dur: Long, delay: Long = 0): Float {
        if (tMs < delay) return -1f
        return ((tMs - delay) % dur).toFloat() / dur.toFloat()
    }
    return when (name) {
        "fire-idle" -> {
            val p = phase(520)
            val w = sin(p * 2 * PI).toFloat()
            Kf(0f, 1f + 0.03f * w, 1f - 0.04f * w, rot = 2f * w)
        }
        "heart-idle" -> {
            val p = phase(1300)
            val s = when {
                p < 0.12f -> 1f + 0.16f * (p / 0.12f)
                p < 0.24f -> 1.16f - 0.18f * ((p - 0.12f) / 0.12f)
                p < 0.36f -> 0.98f + 0.12f * ((p - 0.24f) / 0.12f)
                else -> 1f
            }
            Kf(0f, s, s)
        }
        "shake" -> {
            val p = phase(420)
            val w = sin(p * 2 * PI).toFloat()
            Kf(0f, 1.04f, 1.02f, rot = -8f * w, tx = -3f * w)
        }
        "shake-fast" -> {
            val p = phase(320)
            val w = sin(p * 2 * PI).toFloat()
            Kf(0f, 1.05f, 1.02f, rot = -8f * w, tx = -3f * w)
        }
        "sob" -> {
            val p = phase(1600)
            Kf(0f, 1f - 0.02f * sin(p * 2 * PI).toFloat() * 0.5f, ty = 2 * sin(p * 2 * PI).toFloat())
        }
        "tilt" -> {
            val p = phase(3000, 1000)
            val r = when {
                p < 0f -> 0f
                p < 0.3f -> -8f * (p / 0.3f)
                p < 0.6f -> -8f + 14f * ((p - 0.3f) / 0.3f)
                else -> 6f - 6f * ((p - 0.6f) / 0.4f)
            }
            Kf(0f, rot = r)
        }
        "wave" -> {
            val p = phase(1400, 500)
            Kf(0f, rot = 16f * sin(p * 3 * PI).toFloat())
        }
        "flex" -> {
            val s = 1f + 0.12f * sin(phase(1400) * 2 * PI).toFloat() * 0.5f
            Kf(0f, s, s)
        }
        "clap" -> {
            val p = phase(500, 400)
            val w = sin(p * 2 * PI).toFloat()
            Kf(0f, 1f + 0.15f * kotlin.math.abs(w), rot = 6f * w)
        }
        "pray" -> Kf(0f, 1f + 0.04f * sin(phase(2400) * 2 * PI).toFloat() * 0.5f, ty = -4 * sin(phase(2400) * 2 * PI).toFloat())
        "pulse" -> {
            val s = 1f + 0.08f * sin(phase(1200, 1000) * 2 * PI).toFloat() * 0.5f
            Kf(0f, s, s)
        }
        "pulse-slow" -> {
            val s = 1f + 0.08f * sin(phase(3000, 1000) * 2 * PI).toFloat() * 0.5f
            Kf(0f, s, s)
        }
        "twinkle" -> {
            val p = phase(1600)
            val s = 1f + 0.12f * sin(p * 2 * PI).toFloat() * 0.5f
            Kf(0f, s, s, rot = 10f * sin(p * 2 * PI).toFloat() * 0.5f)
        }
        "snore" -> {
            val w = sin(phase(2600) * 2 * PI).toFloat()
            Kf(0f, 1f + 0.05f * w * 0.5f, 1f - 0.05f * w * 0.5f)
        }
        "anger" -> {
            val p = phase(280, 600)
            val w = sin(p * 2 * PI).toFloat()
            Kf(0f, tx = 3f * w, ty = -1f * w)
        }
        "shiver" -> {
            val w = sin(phase(200) * 2 * PI).toFloat()
            Kf(0f, tx = 2f * w)
        }
        "shiver-slow" -> {
            val p = phase(2400, 1000)
            val w = if (p < 0.15f) sin(p / 0.15f * 4 * PI).toFloat() else 0f
            Kf(0f, tx = 2f * w)
        }
        "melt" -> {
            val w = sin(phase(1200) * 2 * PI).toFloat()
            Kf(0f, 1f + 0.04f * w * 0.5f, 1f - 0.06f * w * 0.5f)
        }
        "float" -> Kf(0f, ty = -5 * sin(phase(2200) * 2 * PI).toFloat() * 0.5f)
        "fly" -> {
            val p = phase(1000)
            Kf(0f, tx = 4 * sin(p * 2 * PI).toFloat(), ty = -5 * sin(p * 4 * PI).toFloat() * 0.5f)
        }
        "swim" -> {
            val w = sin(phase(2200) * 2 * PI).toFloat()
            Kf(0f, tx = -4f * w, rot = 3f * w)
        }
        "swim-slow" -> {
            val w = sin(phase(2600) * 2 * PI).toFloat()
            Kf(0f, tx = -4f * w, rot = 3f * w)
        }
        "sway" -> {
            val w = sin(phase(2600) * 2 * PI).toFloat()
            Kf(0f, rot = 5f * w)
        }
        "sway-fast" -> {
            val w = sin(phase(1200) * 2 * PI).toFloat()
            Kf(0f, rot = 5f * w)
        }
        "drift" -> {
            val w = sin(phase(2500) * 2 * PI).toFloat()
            Kf(0f, ty = 5f * w * 0.5f, rot = 6f * w)
        }
        "ring" -> {
            val p = phase(1200, 600)
            val r = if (p < 0.5f) 18f * sin(p / 0.5f * 3 * PI).toFloat() else 0f
            Kf(0f, rot = r)
        }
        "ring-fast" -> {
            val p = phase(800, 400)
            val r = if (p < 0.5f) 18f * sin(p / 0.5f * 3 * PI).toFloat() else 0f
            Kf(0f, rot = r)
        }
        "bounce" -> {
            val p = phase(1800, 1200)
            val y = when {
                p < 0.55f -> 0f
                p < 0.7f -> -10f * ((p - 0.55f) / 0.15f)
                p < 0.85f -> -10f + 10f * ((p - 0.7f) / 0.15f)
                else -> 0f
            }
            Kf(0f, ty = y)
        }
        else -> Kf(0f)
    }
}

/* ------------------------------------------------------ the emoji canvas fx */

/** Deterministic pseudo-random in [0,1) from two ints. */
private fun rnd(seed: Int, i: Int): Float {
    val x = (seed * 374761393L + i * 668265263L).toInt()
    val y = (x xor (x ushr 13)) * 1274126177
    return ((y xor (y ushr 16)) and 0x7FFFF).toFloat() / 0x80000.toFloat()
}

private fun DrawScope.drawFx(fx: EmojiFx, tMs: Long, seed: Int) {
    val cx = size.width / 2f
    val cy = size.height / 2f
    val dp = size.height / 56f
    when (fx) {
        EmojiFx.FIRE -> {
            // radial glow + rising embers
            val gp = ((tMs % 1400f) / 1400f)
            val r = (0.3f + 1.0f * gp.coerceAtMost(1f)) * 45f * dp
            drawCircle(
                brush = Brush.radialGradient(listOf(Color(0x8CEF9F27), Color(0x00EF9F27)), center = Offset(cx, cy), radius = r),
                radius = r,
                center = Offset(cx, cy),
            )
            for (i in 0 until 9) {
                val life = 1100 + (rnd(seed, i) * 700).toInt()
                val start = 300 + i * 140
                val tt = ((tMs - start) % (life * 3)) / life.toFloat()
                if (tt in 0f..1f) {
                    val x = cx + (rnd(seed, i + 40) - 0.5f) * 40 * dp + (rnd(seed, i + 80) - 0.5f) * 60 * dp * tt
                    val y = cy + 20 * dp - (50 + rnd(seed, i + 7) * 50) * dp * tt
                    drawCircle(Color(0xCCEF9F27), radius = 2.5f * dp * (1 - tt), center = Offset(x, y))
                }
            }
        }
        EmojiFx.HEARTRING -> {
            val p = ((tMs - 500).coerceAtLeast(0) % 1300) / 1300f
            drawCircle(
                color = Color(0x8CD4537E).copy(alpha = 0.55f * (1 - p)),
                radius = (0.7f + 1.4f * p) * 32 * dp,
                center = Offset(cx, cy),
                style = Stroke(2 * dp),
            )
        }
        EmojiFx.HEARTRISE -> for (i in 0 until 6) {
            val life = 1600 + (rnd(seed, i) * 600).toInt()
            val tt = ((tMs - i * 260) % (life * 2)) / life.toFloat()
            if (tt in 0f..1f) {
                val x = cx + (rnd(seed, i + 3) - 0.5f) * 50 * dp
                val y = cy + 20 * dp - (60 + rnd(seed, i + 9) * 50) * dp * tt
                val a = if (tt < 0.2f) tt / 0.2f else 1 - (tt - 0.2f) / 0.8f
                drawHeart(Offset(x, y), (6 + rnd(seed, i + 5) * 5) * dp, Color(0xE0D4537E).copy(alpha = a))
            }
        }
        EmojiFx.TEARS -> for (side in 0..1) for (i in 0 until 3) {
            val tt = ((tMs - 500 - i * 450 - side * 200) % 2800) / 1400f
            if (tt in 0f..1f) {
                val x0 = if (side == 0) size.width * 0.22f else size.width * 0.72f
                val x = x0 + (if (side == 0) -18f else 18f) * dp * tt
                val y = size.height * 0.52f + 50 * dp * tt
                drawDrop(Offset(x, y), 4 * dp, Color(0xB0378ADD).copy(alpha = 1 - tt))
            }
        }
        EmojiFx.CONFETTI -> {
            val colors = listOf(Color(0xFFD4537E), Color(0xFF378ADD), Color(0xFFEF9F27), Color(0xFF1D9E75), Color(0xFF7F77DD), Color(0xFFD85A30))
            for (i in 0 until 22) {
                val life = 1400 + (rnd(seed, i) * 600).toInt()
                val tt = ((tMs - 380) % (life + 2600)) / life.toFloat()
                if (tt in 0f..1f) {
                    val ang = (-90 + (rnd(seed, i + 1) - 0.5f) * 70) * PI / 180
                    val v = (60 + rnd(seed, i + 2) * 60) * dp
                    val x = size.width * 0.22f + (v * kotlin.math.cos(ang) * tt).toFloat()
                    val y = size.height * 0.72f + (v * sin(ang) * tt + 90 * dp * tt * tt).toFloat()
                    drawCircle(colors[i % 6].copy(alpha = 1 - tt), radius = 3 * dp, center = Offset(x, y))
                }
            }
        }
        EmojiFx.SHOCK -> {
            val tt = ((tMs - 200).coerceAtLeast(0) % 2600) / 700f
            if (tt in 0f..1f) {
                drawCircle(
                    color = Color(0xB0378ADD).copy(alpha = 0.7f * (1 - tt)),
                    radius = (0.4f + 1.8f * tt) * 35 * dp,
                    center = Offset(cx, cy),
                    style = Stroke(2 * dp),
                )
            }
        }
        EmojiFx.SPARKLE -> for (i in 0 until 8) {
            val tt = ((tMs - i * 220) % 2400) / 1200f
            if (tt in 0f..1f) {
                val x = (0.1f + rnd(seed, i) * 0.8f) * size.width
                val y = (0.1f + rnd(seed, i + 11) * 0.8f) * size.height
                val s = (5 + rnd(seed, i + 21) * 6) * dp * sin(tt * PI).toFloat()
                drawSparkle(Offset(x, y), s, Color(0xFFEF9F27).copy(alpha = sin(tt * PI).toFloat()))
            }
        }
        EmojiFx.ZZZ -> for (i in 0 until 3) {
            val tt = ((tMs - i * 600) % 3600) / 1800f
            if (tt in 0f..1f) {
                val x = cx + 10 * dp + 34 * dp * tt
                val y = cy - 10 * dp - 34 * dp * tt
                drawCircle(Color(0xFF9A9A93).copy(alpha = 1 - tt), radius = (3 + i * 2) * dp, center = Offset(x, y))
            }
        }
        EmojiFx.STEAM -> for (i in 0 until 3) {
            val tt = ((tMs - i * 300) % 3000) / 1500f
            if (tt in 0f..1f) {
                val x = cx + (i - 1) * 8 * dp
                val y = cy - 14 * dp - 30 * dp * tt
                drawCircle(Color(0x80999999).copy(alpha = 0.5f * (1 - tt)), radius = 3 * dp * (1 + tt), center = Offset(x, y))
            }
        }
        EmojiFx.NONE -> {}
    }
}

private fun DrawScope.drawHeart(c: Offset, s: Float, col: Color) {
    val p = Path()
    p.moveTo(c.x, c.y + s * 0.4f)
    p.cubicTo(c.x - s, c.y - s * 0.4f, c.x - s * 0.5f, c.y - s, c.x, c.y - s * 0.3f)
    p.cubicTo(c.x + s * 0.5f, c.y - s, c.x + s, c.y - s * 0.4f, c.x, c.y + s * 0.4f)
    drawPath(p, col)
}

private fun DrawScope.drawDrop(c: Offset, s: Float, col: Color) {
    val p = Path()
    p.moveTo(c.x, c.y - s * 1.4f)
    p.cubicTo(c.x + s, c.y - s * 0.2f, c.x + s * 0.8f, c.y + s * 0.8f, c.x, c.y + s * 0.8f)
    p.cubicTo(c.x - s * 0.8f, c.y + s * 0.8f, c.x - s, c.y - s * 0.2f, c.x, c.y - s * 1.4f)
    drawPath(p, col)
}

private fun DrawScope.drawSparkle(c: Offset, s: Float, col: Color) {
    val p = Path()
    p.moveTo(c.x, c.y - s)
    p.quadraticBezierTo(c.x + s * 0.15f, c.y - s * 0.15f, c.x + s, c.y)
    p.quadraticBezierTo(c.x + s * 0.15f, c.y + s * 0.15f, c.x, c.y + s)
    p.quadraticBezierTo(c.x - s * 0.15f, c.y + s * 0.15f, c.x - s, c.y)
    p.quadraticBezierTo(c.x - s * 0.15f, c.y - s * 0.15f, c.x, c.y - s)
    drawPath(p, col)
}

/* -------------------------------------------- one animated emoji (in+idle+fx) */

/**
 * A single emoji with its entry, idle loop and effect overlay - driven by one
 * wall clock so nothing recomposes per frame: a 16 ms ticker only feeds the
 * draw phase + one graphicsLayer read.
 */
@Composable
fun AnimatedEmoji(
    ch: String,
    sp: Float,
    active: Boolean,
    staggerMs: Int = 0,
) {
    val spec = remember(ch) { EmojiAnimationRegistry.forEmoji(ch) }
    val scale = fxAnimatorScale()
    val play = active && scale > 0f
    var now by remember { mutableStateOf(0L) }
    val t0 = remember { android.os.SystemClock.uptimeMillis() }
    LaunchedEffect(play) {
        if (!play) return@LaunchedEffect
        while (true) {
            now = android.os.SystemClock.uptimeMillis() - t0
            kotlinx.coroutines.delay(16)
        }
    }
    val el = (now - staggerMs).coerceAtLeast(0L)
    val inMs = inDurationMs(spec.inName)
    val p = if (play) (el.toFloat() / inMs).coerceIn(0f, 1f) else 1f
    val k = inSample(spec.inName, p, 1f)
    val idle = if (p >= 1f) idleSample(spec.idle, el) else Kf(0f)
    androidx.compose.foundation.layout.Box {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier.graphicsLayer {
                scaleX = k.sx * idle.sx
                scaleY = k.sy * idle.sy
                rotationZ = k.rot + idle.rot
                translationX = (k.tx + idle.tx) * 56f * density
                translationY = (k.ty + idle.ty) * 56f * density
                alpha = k.a
            },
        ) {
            androidx.compose.material3.Text(ch, fontSize = androidx.compose.ui.unit.sp(sp))
        }
        androidx.compose.foundation.Canvas(Modifier.matchParentSize()) {
            if (play && el > 100) drawFx(spec.fx, el - 100, ch.hashCode())
        }
    }
}
