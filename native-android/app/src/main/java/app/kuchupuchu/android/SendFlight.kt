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
        // r54 (owner: "halka left theke jump kore message position a jai"):
        // the rise is STRAIGHT VERTICAL - the bubble keeps its own seat's x
        // and lifts from the composer bar's height. Rounds 46-49 all rejected
        // sideways flights; aligning the start to the pill's edges always
        // left a horizontal slide for narrow bubbles.
        val startY = pill.top + (pill.height - s.height) / 2f
        startAbs = Offset(s.left, startY)
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
                // Quadratic bezier in translation space: P0 = bar-height start
                // measured against the CURRENT seat (pure y), P2 = 0 (the
                // seat), P1 = lifted control - translationX stays ZERO so the
                // bubble rises in a straight vertical line, never a side-jump.
                val p0 = Offset(0f, startAbs.y - s.top)
                val p2 = Offset.Zero
                val ctrlY = min(p0.y, p2.y) - 48f * density
                val pos = bezier(p0, Offset(0f, ctrlY), p2, v)
                val lift = sin(v * PI.toFloat()) * 8f * density
                translationX = 0f
                translationY = pos.y - lift
                alpha = if (v < 0.06f) v / 0.06f else 1f
            }
        }
}
