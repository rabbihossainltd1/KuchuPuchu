package app.kuchupuchu.android

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Owner round 37 (item 1): the view-once ① mark IS the owner's SVG
 * (kuchupuchu-r34.md item 16a) — traced exactly, unit for unit. Round 34
 * traced it with the arc center wrong (81.2 instead of 40, clipped past
 * the viewBox = the mush); round 36 redrew it as a plain ring instead
 * of fixing the math. Both wrong. The arc: center (40, 50), r 32, from
 * 49.9° sweeping 260.2° clockwise (endpoints (60.6, 74.5) → (60.6,
 * 25.5), exactly the SVG's A 32 32 0 1 1); the 5 gap dots verbatim; the
 * "1" at x 38 / baseline 62, 32 units, bold — the SVG's text element.
 * Shared: the chat bubble (16a) and the editor's caption bar (16b), so
 * the mark is identical in both places.
 */
@Composable
internal fun ViewOnceOneIcon(iconSize: Dp, tint: Color = Color.White) {
    ViewOnceOneIcon(iconSize, tint, 0f)
}

@Composable
internal fun ViewOnceOneIcon(iconSize: Dp, tint: Color = Color.White, ringRotation: Float = 0f) {
    Canvas(Modifier.size(iconSize)) {
        // px per SVG unit (the source viewBox is 100x100).
        val u = size.minDimension / 100f
        if (u <= 0f) return@Canvas
        val pivot = Offset(40f * u, 50f * u)
        withTransform({
            rotate(ringRotation, pivot)
        }) {
            drawArc(
                color = tint,
                startAngle = 49.9f,
                sweepAngle = 260.2f,
                useCenter = false,
                topLeft = Offset(8f * u, 18f * u),
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
        // The digit: the SVG's <text> element, same anchor/baseline/size.
        drawContext.canvas.nativeCanvas.drawText(
            "1",
            38f * u,
            62f * u,
            android.graphics.Paint().apply {
                color = tint.toArgb()
                textSize = 32f * u
                textAlign = android.graphics.Paint.Align.CENTER
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                isAntiAlias = true
            },
        )
    }
}

/**
 * Owner round 40 (item 4): the ① glyph's ink sits LEFT of its 100-unit box
 * (x 5→76, ink center 40.6 vs box 50), so the select ring reads off-center
 * and oversized in the small buttons. Layout-only fix — the traced geometry
 * stays verbatim: draw at 0.85 scale about the box center, then nudge right
 * by the exact remainder (7.99 units) so the ink centers. Same seat size.
 */
@Composable
internal fun CenteredOnceIcon(iconSize: Dp, tint: Color = Color.White) {
    CenteredOnceIcon(iconSize, tint, 0f)
}

@Composable
internal fun CenteredOnceIcon(iconSize: Dp, tint: Color = Color.White, ringRotation: Float = 0f, fillBounds: Boolean = false) {
    val px = with(LocalDensity.current) { iconSize.toPx() }
    Box(
        Modifier
            .size(iconSize)
            .graphicsLayer {
                if (fillBounds) {
                    // r66: the source ink is 70.95% of its SVG viewBox.
                    // Fill this seat without clipping or altering other uses.
                    scaleX = 1.40f
                    scaleY = 1.40f
                    translationX = px * 0.1316f
                } else {
                    scaleX = 0.85f
                    scaleY = 0.85f
                    translationX = px * 0.0799f
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        ViewOnceOneIcon(iconSize, tint, ringRotation)
    }
}

/**
 * Owner round 34 (item 16a): coil transformation for the view-once bubble —
 * the photo downscaled to 48 px and triple-box-blurred, unrecognizable on
 * EVERY API level. (Modifier.blur is API 31+ and silently no-ops below,
 * which would leak the pixels on older devices.)
 */
internal object ViewOnceBlur : coil.transform.Transformation {
    override val cacheKey: String = "kp-viewonce-blur-v1"

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
