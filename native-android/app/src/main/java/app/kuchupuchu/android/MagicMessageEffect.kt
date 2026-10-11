package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** A one-shot, low-key sparkle on live /magic rows; history stays still. */
@Composable
internal fun Modifier.magicMessageEffect(enabled: Boolean, accent: Color): Modifier {
    if (!enabled) return this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(enabled) {
        progress.snapTo(0f)
        progress.animateTo(1f, tween(1_800, easing = FastOutSlowInEasing))
    }
    val value by remember(progress) { androidx.compose.runtime.derivedStateOf { progress.value } }
    return drawBehind {
        val fade = (1f - value).coerceIn(0f, 1f)
        if (fade <= 0f || size.width <= 1f || size.height <= 1f) return@drawBehind
        val sparkles = listOf(0.12f to 0.28f, 0.82f to 0.20f, 0.66f to 0.78f, 0.24f to 0.84f)
        sparkles.forEachIndexed { index, (baseX, baseY) ->
            val phase = value * 2.0f + index * 1.6f
            val x = (baseX + 0.06f * sin(phase)).coerceIn(0.04f, 0.96f) * size.width
            val y = (baseY + 0.06f * cos(phase * 0.8f)).coerceIn(0.08f, 0.92f) * size.height
            val radius = (2.3f + 1.8f * (0.5f + 0.5f * sin(phase * PI.toFloat()))).dp.toPx()
            val tint = if (index % 2 == 0) Color(0xFFC4B5FD) else accent
            val alpha = (fade * (0.45f + 0.4f * (0.5f + 0.5f * cos(phase)))).coerceIn(0f, 0.85f)
            val center = Offset(x, y)
            drawLine(tint.copy(alpha = alpha), Offset(x - radius, y), Offset(x + radius, y), radius * 0.48f)
            drawLine(tint.copy(alpha = alpha), Offset(x, y - radius), Offset(x, y + radius), radius * 0.48f)
            drawCircle(tint.copy(alpha = alpha * 0.55f), radius * 0.22f, center, style = Stroke(radius * 0.12f))
        }
    }
}
