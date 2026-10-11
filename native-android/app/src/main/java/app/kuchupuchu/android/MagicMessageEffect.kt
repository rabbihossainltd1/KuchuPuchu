package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color

/** One-shot text-only color shimmer for live /magic messages; the bubble frame stays still. */
@Composable
internal fun magicMessageTextColor(enabled: Boolean, base: Color, accent: Color): Color {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(enabled, base, accent) {
        progress.snapTo(0f)
        if (enabled) {
            progress.animateTo(0.68f, tween(420, easing = FastOutSlowInEasing))
            progress.animateTo(0f, tween(1_380, easing = FastOutSlowInEasing))
        }
    }
    return blendColor(base, accent, progress.value)
}

private fun blendColor(from: Color, to: Color, amount: Float): Color {
    val t = amount.coerceIn(0f, 1f)
    return Color(
        red = from.red + (to.red - from.red) * t,
        green = from.green + (to.green - from.green) * t,
        blue = from.blue + (to.blue - from.blue) * t,
        alpha = from.alpha + (to.alpha - from.alpha) * t,
        colorSpace = from.colorSpace,
    )
}
