package app.kuchupuchu.android

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * N3b: emoji with REAL insides. Each face below is drawn part by part on a
 * Canvas — eyes, mouth, tears, hearts, brows are separate shapes with their
 * own motion, so a laughing face actually laughs (chomping mouth, squinting
 * eyes, falling tears) instead of the whole glyph being zoomed or shaken.
 * The face outline itself never moves; only the objects inside it do.
 *
 * Ten faces ship now (the owner's set, step one); anything else renders as
 * the plain system glyph, static. Reduced motion (animator scale 0) freezes
 * every face at its rest pose.
 */
internal enum class FaceKind {
    JOY, // 😂 laugh-cry: chomping mouth, squint pulse, falling tears
    ROLL, // 🤣 rolling laugh: scrunched eyes, faster chomp, shake ticks
    GRIN, // 😃 open grin: blinking ovals, breathing smile
    SMILE, // 😊 happy: widening smile, pulsing blush, ∪ eyes
    HEART, // 😍 heart-eyes: alternating heartbeat, steady smile
    CRY, // 😢 sad: sliding tear, downcast pupils, wobbling frown
    WOW, // 😮 gasp: pulsing O mouth, widening eyes, rising brows
    ANGRY, // 😡 fuming: jittering brows, pulsing vein, trembling frown
    FLAT, // 😑 flat: darting pupils, flat line, slow blink
    SLEEP, // 😴 dozing: shut eyes, breathing lips, rising Z's
}

private val GLYPH_TO_FACE =
    mapOf(
        "😂" to FaceKind.JOY,
        "🤣" to FaceKind.ROLL,
        "😃" to FaceKind.GRIN,
        "😊" to FaceKind.SMILE,
        "😍" to FaceKind.HEART,
        "😢" to FaceKind.CRY,
        "😮" to FaceKind.WOW,
        "😡" to FaceKind.ANGRY,
        "😑" to FaceKind.FLAT,
        "😴" to FaceKind.SLEEP,
    )

internal fun faceKindOf(ch: String): FaceKind? = GLYPH_TO_FACE[ch.replace("\uFE0F", "")]

/** Splits a body into emoji clusters (bases keep their joiners / modifiers). */
internal fun splitEmojiClusters(body: String): List<String> {
    val t = body.trim()
    if (t.isEmpty()) return emptyList()
    val out = ArrayList<String>()
    var cur = StringBuilder()
    var lastCp = -1
    var i = 0
    fun flush() {
        if (cur.isNotEmpty()) {
            out.add(cur.toString())
            cur = StringBuilder()
        }
    }
    while (i < t.length) {
        val cp = t.codePointAt(i)
        val chunk = t.substring(i, i + Character.charCount(cp))
        if (cp == ' '.code) {
            flush()
        } else if (lastCp == 0x200D || cp == 0x200D || cp == 0xFE0F || cp in 0x1F3FB..0x1F3FF) {
            cur.append(chunk)
        } else {
            flush()
            cur.append(chunk)
        }
        lastCp = cp
        i += Character.charCount(cp)
    }
    flush()
    return out
}

/**
 * One emoji-only row: curated faces animate, everything else is the plain
 * glyph. Siblings run phase-shifted so a row of laughers does not laugh in
 * lockstep.
 */
@Composable
internal fun EmojiGlyphRow(
    body: String,
    sizeSp: Float,
    active: Boolean,
) {
    Row(
        Modifier.fxPopIn(active).padding(start = 2.dp, end = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        splitEmojiClusters(body).forEachIndexed { i, ch ->
            val kind = faceKindOf(ch)
            if (kind != null) AnimatedFace(kind, sizeSp.dp, i * 0.23f)
            else Text(ch, fontSize = sizeSp.sp)
        }
    }
}

/**
 * A face with three looping clocks (fast beat, mid flow, slow drift). No
 * whole-glyph motion anywhere here — every clock only feeds the shapes drawn
 * inside the fixed face circle.
 */
@Composable
internal fun AnimatedFace(
    kind: FaceKind,
    faceSize: Dp,
    phase: Float = 0f,
) {
    if (fxAnimatorScale() <= 0f) {
        Canvas(Modifier.size(faceSize)) { drawFace(kind, 0.25f, 0.55f, 0.3f, phase, faceSize.toPx()) }
        return
    }
    val trans = rememberInfiniteTransition(label = "face")
    val beat by trans.animateFloat(0f, 1f, infiniteRepeatable(tween(640, easing = LinearEasing)), label = "beat")
    val flow by trans.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = LinearEasing)), label = "flow")
    val slow by trans.animateFloat(0f, 1f, infiniteRepeatable(tween(3600, easing = LinearEasing)), label = "slow")
    Canvas(Modifier.size(faceSize)) { drawFace(kind, beat, flow, slow, phase, faceSize.toPx()) }
}

private fun DrawScope.drawFace(
    kind: FaceKind,
    beat: Float,
    flow: Float,
    slow: Float,
    phase: Float,
    d: Float,
) {
    when (kind) {
        FaceKind.JOY -> faceJoy(beat, flow, phase, d)
        FaceKind.ROLL -> faceRoll(beat, flow, phase, d)
        FaceKind.GRIN -> faceGrin(slow, phase, d)
        FaceKind.SMILE -> faceSmile(flow, phase, d)
        FaceKind.HEART -> faceHeart(beat, phase, d)
        FaceKind.CRY -> faceCry(flow, slow, phase, d)
        FaceKind.WOW -> faceWow(slow, phase, d)
        FaceKind.ANGRY -> faceAngry(beat, flow, phase, d)
        FaceKind.FLAT -> faceFlat(slow, phase, d)
        FaceKind.SLEEP -> faceSleep(flow, slow, phase, d)
    }
}

/* ---------------- palette + small parts ---------------- */

private val FaceLight = Color(0xFFFFE082)
private val FaceDeep = Color(0xFFFFC93C)
private val FaceRim = Color(0xFFE8A020)
private val FaceInk = Color(0xFF3D2B1F)
private val MouthDark = Color(0xFF7A2A20)
private val Tongue = Color(0xFFE2607C)
private val TearBlue = Color(0xFF5EB7FF)
private val HeartRed = Color(0xFFE63A54)
private val BlushPink = Color(0xFFF5A3C0)

private fun DrawScope.faceBase(d: Float) {
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    drawCircle(
        Brush.radialGradient(
            listOf(FaceLight, FaceDeep),
            center = Offset(c.x - r * 0.35f, c.y - r * 0.4f),
            radius = r * 1.9f,
        ),
        radius = r,
        center = c,
    )
    drawCircle(FaceRim, radius = r, center = c, style = Stroke(width = max(1.5f, d * 0.008f)))
}

private fun frac(x: Float): Float = x - floor(x)

/** 0 at the loop ends, 1 mid-loop. */
private fun tri(p: Float): Float = 1f - abs(2f * frac(p) - 1f)

/** 0 = open .. 1 = shut, a short blink once per slow loop. */
private fun blink(p: Float): Float {
    val w = frac(p)
    return if (w < 0.06f) sin(w / 0.06f * PI.toFloat()) else 0f
}

/** Lub-dub: a strong thump plus its smaller echo. */
private fun thump(p: Float): Float {
    val q = frac(p)
    val a = max(0f, sin(q * 2f * PI.toFloat()))
    val b = max(0f, sin((q - 0.16f) * 2f * PI.toFloat()))
    return (a * a * 0.75f + b * b * 0.45f).coerceIn(0f, 1f)
}

private fun tearPath(at: Offset, rad: Float): Path {
    val p = Path()
    p.moveTo(at.x, at.y - rad * 1.35f)
    p.lineTo(at.x + rad * 0.72f, at.y + rad * 0.28f)
    p.quadraticBezierTo(at.x + rad * 0.72f, at.y + rad * 1.02f, at.x, at.y + rad * 1.02f)
    p.quadraticBezierTo(at.x - rad * 0.72f, at.y + rad * 1.02f, at.x - rad * 0.72f, at.y + rad * 0.28f)
    p.close()
    return p
}

private fun heartPath(c: Offset, w: Float): Path {
    val h = w * 1.5f
    val p = Path()
    p.moveTo(c.x, c.y + h * 0.55f)
    p.cubicTo(c.x - w * 1.5f, c.y - h * 0.15f, c.x - w * 0.85f, c.y - h * 0.85f, c.x, c.y - h * 0.25f)
    p.cubicTo(c.x + w * 0.85f, c.y - h * 0.85f, c.x + w * 1.5f, c.y - h * 0.15f, c.x, c.y + h * 0.55f)
    p.close()
    return p
}

/** An open laughing mouth: dark hollow, tongue low, teeth high. */
private fun DrawScope.openMouth(
    c: Offset,
    top: Float,
    w: Float,
    h: Float,
) {
    drawOval(MouthDark, Offset(c.x - w / 2f, top), Size(w, h))
    drawOval(Tongue, Offset(c.x - w * 0.25f, top + h * 0.60f), Size(w * 0.5f, h * 0.40f))
    drawOval(Color.White, Offset(c.x - w * 0.34f, top), Size(w * 0.68f, h * 0.30f))
}

private fun DrawScope.smileArc(
    c: Offset,
    r: Float,
    sweep: Float,
    width: Float,
) {
    drawArc(
        FaceInk,
        25f,
        sweep,
        false,
        Offset(c.x - 0.40f * r, c.y - 0.38f * r),
        Size(0.80f * r, 0.80f * r),
        style = Stroke(width, cap = StrokeCap.Round),
    )
}

/* ---------------- the ten faces ---------------- */

private fun DrawScope.faceJoy(
    beat: Float,
    flow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    val laugh = abs(sin((beat + ph) * 2f * PI.toFloat()))
    // Squinting arches press tighter on every "ha".
    val eyeW = r * (0.085f + 0.035f * laugh)
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.36f * r
        val ey = c.y - 0.10f * r
        drawArc(FaceInk, 200f, 140f, false, Offset(ex - 0.20f * r, ey - 0.20f * r), Size(0.40f * r, 0.40f * r), style = Stroke(eyeW, cap = StrokeCap.Round))
    }
    openMouth(c, c.y + 0.16f * r, r * 0.62f, r * (0.34f + 0.30f * laugh))
    // Tears well at the outer corners, drop and fade, sides staggered.
    listOf(0f, 0.5f).forEachIndexed { i, off ->
        val p = frac(flow + ph + off)
        val sx = c.x + (if (i == 0) -1f else 1f) * 0.60f * r
        val fall = p * p
        val tr = r * 0.105f * min(1f, p / 0.18f) * (1f - 0.45f * p)
        if (tr > 0.5f) {
            drawPath(tearPath(Offset(sx, c.y - 0.08f * r + fall * 1.05f * r), tr), TearBlue.copy(alpha = (1f - fall).coerceIn(0f, 1f)))
        }
    }
}

private fun DrawScope.faceRoll(
    beat: Float,
    flow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    val shake = 0.5f + 0.5f * sin((beat + ph) * 2f * PI.toFloat())
    // Scrunched >< eyes squeeze with the shake.
    val w = r * (0.07f + 0.03f * shake)
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.36f * r
        val ey = c.y - 0.10f * r
        val q = 0.09f * r
        drawLine(FaceInk, Offset(ex - q, ey - q), Offset(ex + q, ey + q), w, StrokeCap.Round)
        drawLine(FaceInk, Offset(ex + q, ey - q), Offset(ex - q, ey + q), w, StrokeCap.Round)
    }
    val chomp = abs(sin((beat + ph) * 3f * PI.toFloat()))
    openMouth(c, c.y + 0.14f * r, r * 0.70f, r * (0.38f + 0.32f * chomp))
    // A stream of tears, two drops per side, quarter-loop apart.
    listOf(0f, 0.25f, 0.5f, 0.75f).forEachIndexed { i, off ->
        val p = frac(flow + ph + off)
        val sx = c.x + (if (i % 2 == 0) -1f else 1f) * 0.62f * r
        val fall = p * p
        val tr = r * 0.09f * min(1f, p / 0.18f) * (1f - 0.45f * p)
        if (tr > 0.5f) {
            drawPath(tearPath(Offset(sx, c.y - 0.08f * r + fall * 1.05f * r), tr), TearBlue.copy(alpha = (1f - fall).coerceIn(0f, 1f)))
        }
    }
    // Shake ticks flash at the cheeks on the hard laughs.
    val tick = tri((beat + ph) * 2f)
    if (tick > 0.55f) {
        val a = ((tick - 0.55f) * 2f).coerceIn(0f, 1f)
        listOf(-1f, 1f).forEach { side ->
            drawArc(
                FaceInk.copy(alpha = a * 0.6f),
                if (side < 0f) 100f else 260f,
                40f,
                false,
                Offset(c.x + side * 1.02f * r - 0.16f * r, c.y - 0.16f * r),
                Size(0.32f * r, 0.32f * r),
                style = Stroke(r * 0.06f, cap = StrokeCap.Round),
            )
        }
    }
}

private fun DrawScope.faceGrin(
    slow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // Oval eyes that blink shut every few seconds.
    val shut = blink(slow + ph)
    val eh = r * (0.17f * (1f - shut) + 0.015f)
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.34f * r
        drawOval(FaceInk, Offset(ex - 0.10f * r, c.y - 0.14f * r - eh / 2f), Size(0.20f * r, eh))
    }
    val breathe = 0.5f + 0.5f * sin((slow + ph) * 2f * PI.toFloat())
    openMouth(c, c.y + 0.16f * r, r * 0.50f, r * (0.28f + 0.10f * breathe))
}

private fun DrawScope.faceSmile(
    flow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    val glow = 0.5f + 0.5f * sin((flow + ph) * 2f * PI.toFloat())
    // Happy ∪ eyes.
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.34f * r
        drawArc(FaceInk, 25f, 130f, false, Offset(ex - 0.17f * r, c.y - 0.31f * r), Size(0.34f * r, 0.34f * r), style = Stroke(r * (0.075f + 0.02f * glow), cap = StrokeCap.Round))
    }
    // The smile widens and narrows.
    smileArc(c, r, 130f + 14f * glow, r * 0.085f)
    // Blush blooms with the same glow.
    listOf(-1f, 1f).forEach { side ->
        drawOval(BlushPink.copy(alpha = 0.30f + 0.22f * glow), Offset(c.x + side * 0.52f * r - 0.11f * r, c.y + 0.08f * r), Size(0.22f * r, 0.15f * r))
    }
}

private fun DrawScope.faceHeart(
    beat: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // The hearts beat one after the other, lub on the left, dub on the right.
    listOf(0f to -1f, 0.5f to 1f).forEach { (off, side) ->
        val hw = r * 0.20f * (1f + 0.30f * thump(beat + ph + off))
        val hc = Offset(c.x + side * 0.32f * r, c.y - 0.12f * r)
        drawPath(heartPath(hc, hw), HeartRed)
        drawCircle(Color.White.copy(alpha = 0.85f), radius = hw * 0.16f, center = Offset(hc.x - hw * 0.30f, hc.y - hw * 0.30f))
    }
    smileArc(c, r, 132f, r * 0.085f)
}

private fun DrawScope.faceCry(
    flow: Float,
    slow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // Sad brows, inner ends lifted.
    listOf(-1f, 1f).forEach { side ->
        drawLine(FaceInk, Offset(c.x + side * 0.16f * r, c.y - 0.44f * r), Offset(c.x + side * 0.46f * r, c.y - 0.30f * r), r * 0.08f, StrokeCap.Round)
    }
    // Downcast eyes that still blink.
    val shut = blink(slow + ph + 0.4f)
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.33f * r
        val ey = c.y - 0.08f * r
        if (shut > 0.5f) {
            drawLine(FaceInk, Offset(ex - 0.11f * r, ey), Offset(ex + 0.11f * r, ey), r * 0.075f, StrokeCap.Round)
        } else {
            drawOval(Color.White, Offset(ex - 0.12f * r, ey - 0.14f * r), Size(0.24f * r, 0.28f * r))
            drawCircle(FaceInk, radius = 0.075f * r, center = Offset(ex, ey + 0.06f * r))
        }
    }
    // One tear at a time, alternating cheeks: wells, slides, fades.
    val half = frac(flow + ph)
    val side = if (half < 0.5f) -1f else 1f
    val p = frac((flow + ph) * 2f)
    val sx = c.x + side * 0.33f * r
    val rad = r * 0.11f * min(1f, p / 0.25f)
    val slide = if (p < 0.25f) 0f else ((p - 0.25f) / 0.55f).coerceIn(0f, 1f)
    val alpha = if (p < 0.8f) 1f else 1f - (p - 0.8f) / 0.2f
    if (rad > 0.5f && alpha > 0f) {
        drawPath(tearPath(Offset(sx, c.y + 0.06f * r + slide * slide * 0.75f * r), rad), TearBlue.copy(alpha = alpha.coerceIn(0f, 1f)))
    }
    // The frown's ends tremble.
    val wob = sin((flow + ph) * 2f * PI.toFloat()) * 5f
    drawArc(FaceInk, 200f, 140f + wob, false, Offset(c.x - 0.30f * r, c.y + 0.30f * r), Size(0.60f * r, 0.60f * r), style = Stroke(r * 0.08f, cap = StrokeCap.Round))
}

private fun DrawScope.faceWow(
    slow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    val gasp = 0.5f + 0.5f * sin((slow + ph) * 2f * PI.toFloat())
    // Brows climb as the gasp grows.
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.33f * r
        val by = c.y - 0.46f * r - gasp * 0.08f * r
        drawArc(FaceInk, 200f, 140f, false, Offset(ex - 0.16f * r, by - 0.10f * r), Size(0.32f * r, 0.24f * r), style = Stroke(r * 0.07f, cap = StrokeCap.Round))
    }
    // Eyes widen with it.
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.33f * r
        val ey = c.y - 0.10f * r
        drawCircle(Color.White, radius = r * (0.19f + 0.05f * gasp), center = Offset(ex, ey))
        drawCircle(FaceInk, radius = r * 0.085f, center = Offset(ex, ey))
    }
    // The O opens and closes.
    drawCircle(MouthDark, radius = r * (0.13f + 0.09f * gasp), center = Offset(c.x, c.y + 0.38f * r))
}

private fun DrawScope.faceAngry(
    beat: Float,
    flow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // Heavy brows, inner ends down, jittering with fury.
    val jit = sin((beat + ph) * 8f * PI.toFloat()) * 0.05f
    listOf(-1f, 1f).forEach { side ->
        drawLine(
            FaceInk,
            Offset(c.x + side * 0.12f * r, c.y - (0.26f + jit) * r),
            Offset(c.x + side * 0.48f * r, c.y - (0.46f - jit) * r),
            r * 0.11f,
            StrokeCap.Round,
        )
    }
    // Glaring eyes under the brows.
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.31f * r
        val ey = c.y - 0.04f * r
        drawOval(Color.White, Offset(ex - 0.11f * r, ey - 0.12f * r), Size(0.22f * r, 0.24f * r))
        drawCircle(FaceInk, radius = 0.07f * r, center = Offset(ex, ey + 0.03f * r))
    }
    // The anger vein throbs on the brow.
    val v = 1f + 0.18f * thump(flow + ph)
    val vc = Offset(c.x + 0.45f * r, c.y - 0.55f * r)
    val vw = r * 0.13f * v
    val vst = Stroke(r * 0.07f, cap = StrokeCap.Round)
    drawArc(HeartRed, 90f, 180f, false, Offset(vc.x - vw, vc.y - vw * 0.7f), Size(vw, vw * 0.9f), style = vst)
    drawArc(HeartRed, 270f, 180f, false, Offset(vc.x, vc.y - vw * 0.7f), Size(vw, vw * 0.9f), style = vst)
    drawArc(HeartRed, 90f, 180f, false, Offset(vc.x - vw, vc.y - vw * 0.2f), Size(vw, vw * 0.9f), style = vst)
    drawArc(HeartRed, 270f, 180f, false, Offset(vc.x, vc.y - vw * 0.2f), Size(vw, vw * 0.9f), style = vst)
    // A trembling frown.
    val trem = sin((beat + ph) * 8f * PI.toFloat()) * 0.012f * r
    drawArc(FaceInk, 200f, 140f, false, Offset(c.x - 0.28f * r + trem, c.y + 0.32f * r), Size(0.56f * r, 0.56f * r), style = Stroke(r * 0.08f, cap = StrokeCap.Round))
}

private fun DrawScope.faceFlat(
    slow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // Pupils look left, hold, sweep right, hold — never still.
    val q = frac(slow + ph)
    val look =
        when {
            q < 0.4f -> -1f
            q < 0.5f -> -1f + 20f * (q - 0.4f)
            q < 0.9f -> 1f
            else -> 1f - 20f * (q - 0.9f)
        }
    val shut = blink(slow + ph + 0.2f)
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.32f * r
        val ey = c.y - 0.10f * r
        if (shut > 0.5f) {
            drawLine(FaceInk, Offset(ex - 0.11f * r, ey), Offset(ex + 0.11f * r, ey), r * 0.075f, StrokeCap.Round)
        } else {
            drawOval(Color.White, Offset(ex - 0.12f * r, ey - 0.14f * r), Size(0.24f * r, 0.28f * r))
            drawCircle(FaceInk, radius = 0.075f * r, center = Offset(ex + look * 0.055f * r, ey))
        }
    }
    // The flat line never joins in.
    drawLine(FaceInk, Offset(c.x - 0.22f * r, c.y + 0.38f * r), Offset(c.x + 0.22f * r, c.y + 0.38f * r), r * 0.075f, StrokeCap.Round)
}

private fun DrawScope.faceSleep(
    flow: Float,
    slow: Float,
    ph: Float,
    d: Float,
) {
    faceBase(d)
    val c = Offset(d / 2f, d / 2f)
    val r = d * 0.46f
    // Shut, gently curved eyes.
    listOf(-1f, 1f).forEach { side ->
        val ex = c.x + side * 0.33f * r
        drawArc(FaceInk, 30f, 120f, false, Offset(ex - 0.14f * r, c.y - 0.24f * r), Size(0.28f * r, 0.28f * r), style = Stroke(r * 0.07f, cap = StrokeCap.Round))
    }
    // Lips breathe a small O.
    val breath = 0.5f + 0.5f * sin((slow + ph) * 2f * PI.toFloat())
    drawCircle(MouthDark, radius = r * (0.055f + 0.025f * breath), center = Offset(c.x, c.y + 0.36f * r))
    // Z's climb out of the head, growing and dissolving, staggered.
    listOf(0f, 0.5f).forEach { off ->
        val p = frac(flow + ph + off)
        val zx = c.x + 0.52f * r + p * 0.30f * r
        val zy = c.y - 0.30f * r - p * 0.75f * r
        val zs = r * (0.16f + 0.14f * p)
        val zw = zs * 0.18f
        val zc = Color.White.copy(alpha = (1f - p).coerceIn(0f, 1f))
        drawLine(zc, Offset(zx, zy), Offset(zx + zs, zy), zw, StrokeCap.Round)
        drawLine(zc, Offset(zx + zs, zy), Offset(zx, zy + zs), zw, StrokeCap.Round)
        drawLine(zc, Offset(zx, zy + zs), Offset(zx + zs, zy + zs), zw, StrokeCap.Round)
    }
}
