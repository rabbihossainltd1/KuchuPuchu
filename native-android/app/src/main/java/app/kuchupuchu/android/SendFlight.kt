package app.kuchupuchu.android

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
    // r76-28 (owner: "send korar por first time animates hoi na ... successfully
    // send hobar por 0.5 seconds por auto animate hobe"): `sent` is the SERVER
    // ack. A mine row is born fully visible (it appears instantly while
    // pending) and its flight starts HALF A SECOND after the ack lands;
    // received rows are born sent and start as before.
    sent: Boolean = true,
    key: String = "",
    onDone: () -> Unit = {},
): Modifier {
    val scale = fxAnimatorScale()
    val density = LocalDensity.current.density
    val dur = ((durMs * scale).toInt().coerceIn(300, 520)).coerceAtLeast(1)
    // r76-25 (owner: "send hole off hoye jai instant" / "eto slow keno"):
    // the flight is TIME-BASED and GLOBAL per message key. The pending echo
    // starts it at birth (message appears INSTANTLY, animated — no waiting
    // for the server), and when the echo swaps to the server row the item
    // recomposes — a composition-held Animatable died there and froze the
    // flight mid-air. Now every frame is computed from (now - goAt), so ANY
    // composition that picks the row up continues the SAME flight, and the
    // flight itself can never be killed by a swap.
    val st =
        remember(key) {
            if (active && key.isNotBlank() && scale > 0f) FlightAnims.birth(key)
            else if (key.isNotBlank()) FlightAnims.of(key)
            else null
        }
    var v by remember(key) {
        mutableStateOf(
            when {
                st == null -> 1f
                st.goAt >= 0L -> FlightAnims.valueAt(st, dur)
                // r76-28: a mine row waiting for its ack shows FULL SIZE -
                // the message is there; the flight is a post-send celebration.
                active && !sent -> 1f
                else -> 0f
            },
        )
    }
    var seat by remember { mutableStateOf<Rect?>(null) }
    var done by remember { mutableStateOf(false) }

    val measure = Modifier.onGloballyPositioned { c ->
        if (!done) seat = c.boundsInWindow()
    }

    val sentNow = androidx.compose.runtime.rememberUpdatedState(sent)
    LaunchedEffect(key) {
        val f = st ?: return@LaunchedEffect
        if (f.goAt < 0L) {
            // r76-21 gate: the growth waits until the seat is fully inside
            // the list viewport (600 ms cap) — the send scroll is a snap
            // (r76-22), so this releases within a frame or two.
            withTimeoutOrNull(600L) {
                snapshotFlow {
                    val s = seat
                    val lb = FlightAnchors.listBounds
                    s != null && (lb == null || s.bottom <= lb.bottom + 1f)
                }.first { it }
            }
            // r76-28: the ack wait - a mine row's flight starts 500 ms AFTER
            // the pending echo becomes the server row. The key is stable
            // across the swap (both rows carry the clientId), so this same
            // coroutine sees the flip and no flight is ever restarted or lost.
            if (!sentNow.value) {
                snapshotFlow { sentNow.value }.first { it }
                kotlinx.coroutines.delay(500L)
            }
            if (f.goAt < 0L) f.goAt = android.os.SystemClock.uptimeMillis()
        }
        // Tick to the end from wherever the global clock says we are.
        while (true) {
            val nv = FlightAnims.valueAt(f, dur)
            v = nv
            if (nv >= 1f) break
            androidx.compose.runtime.withFrameNanos { }
        }
        done = true
        if (FlightAnims.markDone(key)) onDone()
    }

    return this
        .then(measure)
        .graphicsLayer {
            val v0 = v
            if (false) {
                val lift = sin(v0 * PI.toFloat()) * 8f * density
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
            val sc = 0.6f + 0.4f * v0
            scaleX = sc
            scaleY = sc
            alpha = if (v0 < 0.35f) (v0 / 0.35f).coerceIn(0f, 1f) else 1f
        }
}

/**
 * r76-25: per-message flight state that outlives any composition. [birth] is
 * claimed once (the pending echo), [of] lets the server row that REPLACES the
 * echo find the same flight, and [valueAt] is the eased 0..1 progress derived
 * from the wall clock — recomposition, recycling or a swap can never restart
 * or freeze it.
 */
object FlightAnims {
    class Flight(val bornAt: Long) {
        @Volatile var goAt: Long = -1L
    }

    private val map =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, Flight>(64, 0.75f, false) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Flight>?): Boolean = size > 500
            },
        )
    private val doneKeys =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, Boolean>(64, 0.75f, false) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?): Boolean = size > 500
            },
        )

    fun birth(key: String): Flight = synchronized(map) { map.getOrPut(key) { Flight(android.os.SystemClock.uptimeMillis()) } }

    fun of(key: String): Flight? = synchronized(map) { map[key] }

    fun markDone(key: String): Boolean =
        synchronized(doneKeys) {
            if (doneKeys.containsKey(key)) return false
            doneKeys[key] = true
            return true
        }

    fun valueAt(f: Flight, durMs: Int): Float {
        val go = f.goAt
        if (go < 0L) return 0f
        val t = ((android.os.SystemClock.uptimeMillis() - go).toFloat() / durMs).coerceIn(0f, 1f)
        return FastOutSlowInEasing.transform(t)
    }
}
