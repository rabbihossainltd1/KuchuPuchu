package app.kuchupuchu.android

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.roundToInt
import androidx.compose.material3.Text

/**
 * Owner round 36 (item 4): the view-once ① mark — one clean ring + the
 * digit "1" dead center. (Round 34 traced the owner's SVG: a 260° arc
 * clipped past its viewBox + a dotted gap + a 6sp digit — mush at the
 * 20.dp caption size, the "venge" icon. This reads at every size.)
 * Shared: the chat bubble (16a) and the editor's caption bar (16b), so
 * the mark is identical in both places.
 */
@Composable
internal fun ViewOnceOneIcon(iconSize: Dp, tint: Color = Color.White) {
    Box(Modifier.size(iconSize), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val d = size.minDimension
            if (d <= 0f) return@Canvas
            val stroke = (d * 0.09f).coerceAtLeast(2f)
            drawCircle(tint, radius = d / 2f - stroke / 2f, style = Stroke(width = stroke))
        }
        Text(
            "1",
            fontSize = (iconSize.value * 0.52f).sp,
            fontWeight = FontWeight.Bold,
            color = tint,
        )
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
