package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** One-shot vertical motion on message glyphs only; the bubble frame stays still. */
@Composable
internal fun magicMessageTextModifier(enabled: Boolean): Modifier {
    val offset = remember { Animatable(0f) }
    val density = LocalDensity.current
    LaunchedEffect(enabled) {
        offset.snapTo(0f)
        if (enabled) {
            offset.animateTo(-2.5f, tween(180, easing = FastOutSlowInEasing))
            offset.animateTo(1.8f, tween(210, easing = FastOutSlowInEasing))
            offset.animateTo(-1.0f, tween(170, easing = FastOutSlowInEasing))
            offset.animateTo(0f, tween(220, easing = FastOutSlowInEasing))
        }
    }
    return Modifier.graphicsLayer {
        translationY = with(density) { offset.value.dp.toPx() }
    }
}
