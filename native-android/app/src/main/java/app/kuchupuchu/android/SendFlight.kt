package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
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
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import kotlin.math.PI
import kotlin.math.sin
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Where the composer pill (typing bar) is on screen, in WINDOW coordinates.
 * The composer writes it once via [Modifier.fxComposerAnchor]. Rows read it when they start flying.
 * Plain object, not State: reading it never recomposes anything.
 */
object FlightAnchors {
    @Volatile var composerBounds: Rect? = null

    // r76-21 (owner: "animation er somoy abaro sei nicher dike right side a
    // kata pore jai"): the chat list's own viewport, in window coordinates.
    // A flight must not start growing its row until the row sits fully
    // INSIDE this rect — anything below its bottom edge is clipped by the
    // list, which is exactly the cut the owner keeps seeing.
    @Volatile var listBounds: Rect? = null
    // r76-15 (owner: "attach panel close korle mic upore theke jay"): snapshot
    // STATE — the window overlay reads this during composition, so every
    // layout move (IME / inline panel glide) repositions the mic live. As a
    // plain var the overlay only saw it on unrelated recompositions and the
    // mic clung to a stale top spot until something else invalidated.
    var micBounds: Rect? by mutableStateOf(null)
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
        // r76-21 (owner: the cut is BACK — "animation er somoy abaro sei
        // nicher dike right side a kata pore jai"): r76-19 moved the growth
        // origin to the row's bottom corner so the ROW never clips itself —
        // but the flight still started while the list was mid-scroll, so the
        // VIEWPORT clipped the row's bottom corner (the very corner the sent
        // bubble grows from). The growth now waits until the seat is fully
        // inside the list viewport; the row is alpha-0 (invisible, no pop)
        // while it waits, and a 600 ms cap means a stuck scroll can never
        // hold the message invisible forever.
        withTimeoutOrNull(600L) {
            snapshotFlow {
                val s = seat
                val lb = FlightAnchors.listBounds
                s != null && (lb == null || s.bottom <= lb.bottom + 1f)
            }.first { it }
        }
        // r76-20 (owner: "animation ta smooth na" — jerky): the old spec
        // fought itself — FlightEase's slow start read as a hesitate-then-
        // rush, the 700 ms tail dragged, and the landing squash snapped the
        // bubble the moment the flight ended. One decelerate curve instead:
        // it rises right away and settles gently, 300-520 ms.
        progress.animateTo(1f, androidx.compose.animation.core.tween((durMs * scale).toInt().coerceIn(300, 520), easing = FastOutSlowInEasing))
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
            // r76-19 (owner: "emojis jokhon right side a nicher theke asche
            // tokhon emoji full body soho asche na ... nicher theke kichu
            // ongsho kata pore jacche"): the old +68dp/+84dp translation
            // started the row BELOW and BESIDE the list's edges, so the
            // viewport clipped the bubble's own bottom/right for the first
            // frames - a cut emoji gliding in. The flight now GROWS out of
            // the seat's bottom corner instead (transform origin pinned to
            // the corner it arrives from): every frame is drawn fully inside
            // the row's own bounds, so nothing can ever be cut, and it still
            // reads as rising from the bottom-right (sent) / bottom-left
            // (received) corner.
            transformOrigin = if (isSent) TransformOrigin(1f, 1f) else TransformOrigin(0f, 1f)
            val sc = if (active) 0.6f + 0.4f * v else 1f
            scaleX = sc
            scaleY = sc
            alpha = if (v < 0.35f) (v / 0.35f).coerceIn(0f, 1f) else 1f
        }
}
