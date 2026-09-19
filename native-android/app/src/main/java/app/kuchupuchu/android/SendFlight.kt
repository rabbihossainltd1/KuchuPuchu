package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first

/**
 * Where the composer pill (typing bar) is on screen, in WINDOW coordinates.
 * The composer writes it once via [Modifier.fxComposerAnchor]. Rows read it when they start flying.
 * Plain object, not State: reading it never recomposes anything.
 */
object FlightAnchors {
    @Volatile var composerBounds: Rect? = null
}

/** Put this on the composer pill (the rounded input bar that holds the typed text). */
fun Modifier.fxComposerAnchor(): Modifier =
    onGloballyPositioned { FlightAnchors.composerBounds = it.boundsInWindow() }

private val FlightEase = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)

private fun bezier(p0: Offset, p1: Offset, p2: Offset, t: Float): Offset {
    val u = 1f - t
    return Offset(
        u * u * p0.x + 2f * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2f * u * t * p1.y + t * t * p2.y,
    )
}

/**
 * Drop-in replacement for the old fxFlyIn(active, durMs, x0dp, y0dp, onDone).
 *
 * The row lifts off the composer pill and settles in its own seat along a curved path.
 * Start point is MEASURED (pill bounds -> this row's seat bounds), not a fixed dp offset.
 *
 * SENT rows start over the pill's right edge (the bubble's right edge aligns with the pill's right edge).
 * RECEIVED rows (isSent = false) start over the pill's left edge and land on the left seat.
 *
 * Only graphicsLayer translation/alpha is animated. Size, text and line breaks are never touched.
 * If the animator scale is 0, or the composer has not been measured, the row simply appears in place.
 *
 * r53 (owner: "send korle message hide hoye jai, sent hole abar show hoi"): the seat is
 * tracked LIVE. The chat scrolls to the bottom while the bubble is in the air, so the
 * seat moves during the flight; the translation is recomputed against the CURRENT seat
 * every frame, so the bubble always lands exactly on it - no stale target, no snap.
 */
@Composable
fun Modifier.fxFlyIn(
    active: Boolean,
    durMs: Int,
    isSent: Boolean = true,
    onDone: () -> Unit = {},
): Modifier {
    val scale = fxAnimatorScale()
    val density = LocalDensity.current.density
    val progress = remember { Animatable(if (active && scale > 0f) 0f else 1f) }
    var seat by remember { mutableStateOf<Rect?>(null) }
    var fired by remember { mutableStateOf(false) }
    var startAbs by remember { mutableStateOf(Offset.Zero) }

    // The seat keeps updating while the row flies: the send-time scroll is moving it.
    val measure = Modifier.onGloballyPositioned { c ->
        if (active && !fired) seat = c.boundsInWindow()
    }

    LaunchedEffect(active) {
        if (!active || fired) return@LaunchedEffect
        val pill = FlightAnchors.composerBounds
        if (pill == null || scale <= 0f) {
            fired = true
            progress.snapTo(1f)
            onDone()
            return@LaunchedEffect
        }
        // Wait for the first real seat measurement, then freeze the pill-side
        // start point (the pill itself does not move during the flight).
        val s = snapshotFlow { seat }.filterNotNull().first()
        fired = true
        val startX = if (isSent) pill.right - s.width else pill.left
        val startY = pill.top + (pill.height - s.height) / 2f
        startAbs = Offset(startX, startY)
        progress.snapTo(0f)
        progress.animateTo(1f, androidx.compose.animation.core.tween((durMs * scale).toInt(), easing = FlightEase))
        onDone()
    }

    return this
        .then(measure)
        .graphicsLayer {
            val v = progress.value
            val s = seat
            if (s == null) {
                // Not measured yet: a flying row stays invisible, a settled one paints.
                alpha = if (v >= 1f) 1f else 0f
            } else {
                // Quadratic bezier in translation space: P0 = pill start measured
                // against the CURRENT seat, P2 = 0 (the seat), P1 = lifted control.
                val p0 = Offset(startAbs.x - s.left, startAbs.y - s.top)
                val p2 = Offset.Zero
                val ctrlX = max(p0.x, p2.x) + 22f * density * (if (isSent) 1f else -1f)
                val ctrlY = min(p0.y, p2.y) - 48f * density
                val pos = bezier(p0, Offset(ctrlX, ctrlY), p2, v)
                val lift = sin(v * PI.toFloat()) * 8f * density
                translationX = pos.x
                translationY = pos.y - lift
                alpha = if (v < 0.06f) v / 0.06f else 1f
            }
        }
}
