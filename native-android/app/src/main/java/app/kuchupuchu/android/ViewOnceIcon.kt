package app.kuchupuchu.android

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import androidx.compose.material3.Text

/**
 * Owner round 34 (item 16a): the view-once ① mark, drawn from the owner's SVG
 * (a near-full ring with a dotted gap on the right + the digit "1" left of
 * center). Shared: the chat bubble (16a) and the attach editor's caption bar
 * (16b), so the mark is identical in both places.
 */
@Composable
internal fun ViewOnceOneIcon(iconSize: Dp, tint: Color = Color.White) {
    Box(Modifier.size(iconSize), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            // px per SVG unit (the source viewBox is 100x100).
            val u = size.minDimension / 100f
            if (u <= 0f) return@Canvas
            // The solid arc: circle center (81.2, 50), r 32, from 130°
            // sweeping 260° counter-clockwise (the long way around the left).
            drawArc(
                color = tint,
                startAngle = 130f,
                sweepAngle = -260f,
                useCenter = false,
                topLeft = Offset((81.2f - 32f) * u, (50f - 32f) * u),
                size = Size(64f * u, 64f * u),
                style = Stroke(width = 5.5f * u, cap = StrokeCap.Round),
            )
            // The dotted gap on the right (x, y, r triples from the SVG).
            val dots =
                floatArrayOf(
                    60.6f, 25.5f, 2.5f,
                    69f, 36.5f, 3.6f,
                    72f, 50f, 4.2f,
                    69f, 63.5f, 3.6f,
                    60.6f, 74.5f, 2.5f,
                )
            var i = 0
            while (i < dots.size) {
                drawCircle(tint, radius = dots[i + 2] * u, center = Offset(dots[i] * u, dots[i + 1] * u))
                i += 3
            }
        }
        // The digit, centered at x = 38 like the SVG's text anchor: the box
        // keeps the left 76 units, whose center is exactly 38.
        Box(Modifier.fillMaxSize().padding(end = iconSize * 0.24f), contentAlignment = Alignment.Center) {
            Text(
                "1",
                fontSize = (iconSize.value * 0.32f).sp,
                fontWeight = FontWeight.Bold,
                color = tint,
            )
        }
    }
}

/**
 * Owner round 34 (item 16a): coil transformation for the view-once bubble —
 * the photo downscaled to 48 px and triple-box-blurred, unrecognizable on
 * EVERY API level. (Modifier.blur is API 31+ and silently no-ops below,
 * which would leak the pixels on older devices.)
 */
internal object ViewOnceBlur : coil.transform.Transformation {
    override val key: String = "kp-viewonce-blur-v1"

    override suspend fun transform(input: Bitmap, size: coil.size.Size): Bitmap {
        val w = input.width
        val h = input.height
        if (w <= 0 || h <= 0) return input
        val scale = 48f / max(w, h)
        val sw = max(1, (w * scale).roundToInt())
        val sh = max(1, (h * scale).roundToInt())
        val small = Bitmap.createScaledBitmap(input, sw, sh, true)
        val pix = IntArray(sw * sh)
        small.getPixels(pix, 0, sw, 0, 0, sw, sh)
        repeat(3) { boxBlurPass(pix, sw, sh, 4) }
        small.setPixels(pix, 0, sw, 0, 0, sw, sh)
        return small
    }
}

/** One separable box-blur pass (sliding window, edge pixels replicate). */
private fun boxBlurPass(pix: IntArray, w: Int, h: Int, radius: Int) {
    val n = radius * 2 + 1
    val tmp = IntArray(pix.size)
    for (y in 0 until h) {
        var rs = 0
        var gs = 0
        var bs = 0
        for (x in -radius..radius) {
            val p = pix[y * w + x.coerceIn(0, w - 1)]
            rs += p shr 16 and 0xFF
            gs += p shr 8 and 0xFF
            bs += p and 0xFF
        }
        for (x in 0 until w) {
            tmp[y * w + x] = -0x1000000 or (rs / n shl 16) or (gs / n shl 8) or bs / n
            val out = pix[y * w + (x - radius).coerceIn(0, w - 1)]
            val inn = pix[y * w + (x + radius + 1).coerceIn(0, w - 1)]
            rs += (inn shr 16 and 0xFF) - (out shr 16 and 0xFF)
            gs += (inn shr 8 and 0xFF) - (out shr 8 and 0xFF)
            bs += (inn and 0xFF) - (out and 0xFF)
        }
    }
    for (x in 0 until w) {
        var rs = 0
        var gs = 0
        var bs = 0
        for (y in -radius..radius) {
            val p = tmp[y.coerceIn(0, h - 1) * w + x]
            rs += p shr 16 and 0xFF
            gs += p shr 8 and 0xFF
            bs += p and 0xFF
        }
        for (y in 0 until h) {
            pix[y * w + x] = -0x1000000 or (rs / n shl 16) or (gs / n shl 8) or bs / n
            val out = tmp[(y - radius).coerceIn(0, h - 1) * w + x]
            val inn = tmp[(y + radius + 1).coerceIn(0, h - 1) * w + x]
            rs += (inn shr 16 and 0xFF) - (out shr 16 and 0xFF)
            gs += (inn shr 8 and 0xFF) - (out shr 8 and 0xFF)
            bs += (inn and 0xFF) - (out and 0xFF)
        }
    }
}
