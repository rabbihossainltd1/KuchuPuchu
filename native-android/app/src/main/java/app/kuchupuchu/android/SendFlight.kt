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
    @Volatile var micBounds: Rect? = null
    @Volatile var attachBounds: Rect? = null
}

/**
 * r76-4 (owner's phone, three rounds running): the lock column and the
 * swallow flyer never painted when they overflowed the composer row — the
 * device only draws them at WINDOW level, positioned from boundsInWindow
 * anchors (the same trick the flights use). Snapshot state so the top-level
 * overlay recomposes on every change.
 */
object RecorderAnchors {
    var columnOn by mutableStateOf(false)
    var columnArmed by mutableStateOf(false)
    var columnDim by mutableStateOf(false)
    var barBounds: Rect? by mutableStateOf(null)
    var swallowOn by mutableStateOf(false)
    var swallowV by mutableStateOf(-1f)
    // r76-9: how far the mic has risen (px, >=0) — the column shrinks from
    // its bottom by exactly this, riding the button.
    var micRise by mutableStateOf(0f)
    var flyDx by mutableStateOf(0f)
    var flyDy by mutableStateOf(0f)
}

/** Put this on the composer pill (the rounded input bar that holds the typed text). */
fun Modifier.fxComposerAnchor(): Modifier =
    onGloballyPositioned { FlightAnchors.composerBounds = it.boundsInWindow() }

/** Put this on the mic/voice button so voice notes lift off the exact mic button. */
fun Modifier.fxMicAnchor(): Modifier =
    onGloballyPositioned { FlightAnchors.micBounds = it.boundsInWindow() }

/** Put this on the attach button/panel so photos, videos, and documents jump out from the attach anchor. */
fun Modifier.fxAttachAnchor(): Modifier =
    onGloballyPositioned { FlightAnchors.attachBounds = it.boundsInWindow() }

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
    var done by remember { mutableStateOf(false) }
    var startAbs by remember { mutableStateOf(Offset.Zero) }

    // r55 (owner: flight "same ache ager moto"): the seat MUST keep updating
    // for the WHOLE flight - the send-time scroll moves the row while the
    // bubble is in the air. The old gate (!fired) froze it at the first
    // measurement, so the arc played against a stale seat and read as no
    // flight at all.
    val measure = Modifier.onGloballyPositioned { c ->
        if (active && !done) seat = c.boundsInWindow()
    }

    LaunchedEffect(active) {
        if (!active || fired) return@LaunchedEffect
        fired = true
        if (scale <= 0f) {
            progress.snapTo(1f)
            onDone()
            return@LaunchedEffect
        }
        val pill = FlightAnchors.composerBounds
        if (pill != null && false) {
            val s = snapshotFlow { seat }.filterNotNull().first()
            val startY = pill.top - s.height
            startAbs = Offset(s.left, startY)
        }
        progress.snapTo(0f)
        progress.animateTo(1f, androidx.compose.animation.core.tween((durMs * scale).toInt().coerceIn(280, 550), easing = FlightEase))
        done = true
        onDone()
    }

    return this
        .then(measure)
        .graphicsLayer {
            val v = progress.value
            val s = seat
            if (s != null && false) {
                val p0 = Offset(0f, startAbs.y - s.top)
                val lift = sin(v * PI.toFloat()) * 8f * density
                translationX = 0f
            }
            // r60 (owner: "massage bolechilam nicher corner theke asbe aro niche theke asbe eita fix koro. shob items . sender receiver same update hobe"):
            // Sent items smoothly glide in diagonally from bottom-right (+68dp X, +84dp Y); received glide in from bottom-left (-68dp X, +84dp Y).
            val sideOffset = (if (isSent) 68f else -68f) * density * (1f - v)
            val bottomOffset = 84f * density * (1f - v)
            translationX = if (active) sideOffset else 0f
            translationY = if (active) bottomOffset else 0f
            alpha = if (v < 0.05f) (v / 0.05f).coerceIn(0f, 1f) else 1f
        }
}
