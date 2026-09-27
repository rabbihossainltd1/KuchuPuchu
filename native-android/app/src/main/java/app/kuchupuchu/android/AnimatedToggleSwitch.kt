package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * r76-23 (owner: "amar app er shob buttons toggle switch same thakbe but ami
 * ekta animation add korechi ... just animation ta add Hobe"): the owner's
 * own toggle, verbatim — EVERY switch in the app is this one now.
 *
 * Shape: pill track, no border, white circular knob.
 * OFF: light gray track (#D8DAE0)
 * ON: blue track (#3D72F6)
 * Animation: blue fill wipes in from the left as the track turns on,
 * knob slides to the opposite side and spins 360 degrees while sliding.
 */
private val TrackWidth = 54.dp
private val TrackHeight = 30.dp
private val KnobSize = 24.dp
private val KnobPadding = 3.dp

private val TrackOffColor = Color(0xFFD8DAE0)
private val TrackOnColor = Color(0xFF3D72F6)
private val KnobColor = Color.White

private val SwitchEasing = CubicBezierEasing(0.6f, 0f, 0.2f, 1f)
private val KnobEasing = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)
private const val AnimDurationMs = 500

@Composable
fun AnimatedToggleSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    // Added for the app's real rows (group privacy, chat privacy): a disabled
    // switch dims and refuses the tap — the animation spec is untouched.
    enabled: Boolean = true,
) {
    val fillProgress = remember { Animatable(if (checked) 1f else 0f) }
    val knobProgress = remember { Animatable(if (checked) 1f else 0f) }
    val knobRotation = remember { Animatable(if (checked) 360f else 0f) }
    val interactionSource = remember { MutableInteractionSource() }

    LaunchedEffect(checked) {
        launch {
            fillProgress.animateTo(
                targetValue = if (checked) 1f else 0f,
                animationSpec = tween(AnimDurationMs, easing = SwitchEasing),
            )
        }
        launch {
            knobProgress.animateTo(
                targetValue = if (checked) 1f else 0f,
                animationSpec = tween(AnimDurationMs, easing = KnobEasing),
            )
        }
        launch {
            val target = if (checked) knobRotation.value + 360f else knobRotation.value - 360f
            knobRotation.animateTo(
                targetValue = target,
                animationSpec = tween(AnimDurationMs, easing = KnobEasing),
            )
        }
    }

    Box(
        modifier =
            modifier
                .size(TrackWidth, TrackHeight)
                .alpha(if (enabled) 1f else 0.4f)
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    enabled = enabled,
                ) {
                    onCheckedChange(!checked)
                },
    ) {
        Canvas(modifier = Modifier.size(TrackWidth, TrackHeight)) {
            val cornerRadius = CornerRadius(size.height / 2f, size.height / 2f)
            val trackPath =
                Path().apply {
                    addRoundRect(
                        RoundRect(
                            rect = Rect(Offset.Zero, size),
                            cornerRadius = cornerRadius,
                        ),
                    )
                }

            clipPath(trackPath) {
                drawRect(color = TrackOffColor, size = size)

                if (fillProgress.value > 0f) {
                    val fillWidth = size.width * fillProgress.value
                    drawRect(
                        color = TrackOnColor,
                        topLeft = Offset.Zero,
                        size = Size(fillWidth, size.height),
                    )
                }
            }

            val knobPaddingPx = KnobPadding.toPx()
            val knobDiameterPx = KnobSize.toPx()
            val travel = size.width - knobDiameterPx - knobPaddingPx * 2f
            val knobLeft = knobPaddingPx + travel * knobProgress.value
            val knobCenter =
                Offset(
                    x = knobLeft + knobDiameterPx / 2f,
                    y = size.height / 2f,
                )

            rotate(degrees = knobRotation.value, pivot = knobCenter) {
                drawCircle(
                    color = KnobColor,
                    radius = knobDiameterPx / 2f,
                    center = knobCenter,
                )
            }
        }
    }
}
