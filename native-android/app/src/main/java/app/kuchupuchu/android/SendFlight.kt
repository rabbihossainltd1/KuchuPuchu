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
    // r93-4 (owner r93 #4: "fast asbe slow na"): the flight is QUICK - the
    // caller's duration is halved and clamped tight (a text bubble lands in
    // ~340 ms instead of ~680).
    val dur = ((durMs * 0.5f * scale).toInt().coerceIn(240, 360)).coerceAtLeast(1)
    // r76-25 (owner: "send hole off hoye jai instant" / "eto slow keno"):
    // the flight is TIME-BASED and GLOBAL per message key. The pending echo
    // starts it at birth (message appears INSTANTLY, animated — no waiting
    // for the server), and when the echo swaps to the server row the item
    // recomposes — a composition-held Animatable died there and froze the
    // flight mid-air. Now every frame is computed from (now - goAt), so ANY
    // composition that picks the row up continues the SAME flight, and the
    // flight itself can never be killed by a swap.
    // r97-4 (owner r96 #4 "not fixed": "notun kore chat a gele ager chat a
    // thaka emojis 1 second er jonno nice ar right side a kata pore
    // jacche"): a PASSIVE pick-up (this composition was not born live) may
    // only ADOPT a flight that is already armed (goAt >= 0) - that is the
    // pending->server swap handoff. An entry birthed but never armed (its
    // owning row left composition inside the 600 ms viewport gate, or a send
    // that never acked) used to be adopted anyway: the row rendered pinned
    // at the bottom-right corner (v = 0) and the effect below SELF-ARMED
    // it, so a re-entered chat flew its old emojis in from the corner for
    // ~1 s no matter what fxBorn said. Unarmed entries are ignored now -
    // the row renders settled (v = 1), the global entry stays untouched for
    // whoever truly owns it.
    val st =
        remember(key) {
            if (active && key.isNotBlank() && scale > 0f) FlightAnims.birth(key)
            else if (key.isNotBlank()) FlightAnims.of(key)?.takeIf { it.goAt >= 0L }
            else null
        }
    // r98-4 diagnostics: which flight this composition picked up
    // (adb logcat -s kpfx) - the any-chat clip hunt.
    android.util.Log.d("kpfx", "flight key=$key active=$active goAt=${st?.goAt}")
    var v by remember(key) {
        mutableStateOf(
            when {
                st == null -> 1f
                st.goAt >= 0L -> FlightAnims.valueAt(st, dur)
                // r76-30 (owner: "regression - animation er agei chat a
                // message emoji chole jacche"): the flight IS the entrance -
                // a mine row stays invisible in its seat until the ack-armed
                // moment, then flies up from the composer into the chat.
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
            // r76-29: a mine row's flight is ARMED by the send-ack
            // (FlightAnims.armIn sets goAt = ack + 500 ms) - this coroutine
            // only waits for the arm, so it survives however the row swaps.
            if (!sentNow.value && f.goAt < 0L) {
                withTimeoutOrNull(60_000L) { snapshotFlow { f.goAt >= 0L }.first { it } }
            }
            if (f.goAt < 0L) f.goAt = android.os.SystemClock.uptimeMillis()
        }
        // Tick to the end from wherever the global clock says we are. A
        // future goAt (the armed 0.5 s wait) holds the row INVISIBLE - the
        // message must NOT sit in the chat before its animation; the flight
        // itself carries it in, on the dot.
        while (true) {
            if (f.goAt > android.os.SystemClock.uptimeMillis()) {
                if (v != 0f) v = 0f
                androidx.compose.runtime.withFrameNanos { }
                continue
            }
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
            // r93-4 (owner r93 #4: "massage ekhon halka right theke zoom
            // hoye asche but ami chai full right side theke asbe massage ta
            // right side er ektu niche mane corner theke. fast asbe slow na
            // ar eshe bonus Hobe"): the SENT bubble no longer zooms in place
            // - it FLIES IN from the bottom-right corner: off the right edge
            // of the list, a little below its seat, at full size (no zoom),
            // fast, and it settles with a small overshoot bounce as it
            // lands (the bonus). r101: received rows fly the same way,
            // mirrored from the bottom-left corner.
            // r102 (owner r101 feedback: "bonus effect nei massage send
            // receive a"): the r93 bounce was 5dp over the last 28% of a
            // ~300 ms flight - invisible in practice. The landing bounce is
            // now a clearly VISIBLE 18dp overshoot past the seat over the
            // last 38% of the flight: the bubble lands, pops past its seat
            // and glides back. One hump, shared by both directions
            // (subtracted for sent, added for received).
            val bounce =
                if (v0 > 0.62f) {
                    sin((v0 - 0.62f) / 0.38f * PI.toFloat()) * 18f * density
                } else {
                    0f
                }
            if (isSent) {
                val s = seat
                val lb = FlightAnchors.listBounds
                val x0 = if (s != null && lb != null) (lb.right - s.left + 14f * density) else 120f * density
                // r94-4 (owner r94 #4: "right theke asche ok but ektu nicher
                // thekeo asbe ekdom corner theke right side er nicher theke"):
                // the take-off sits well BELOW the seat - the bubble flies in
                // from the true bottom-right corner, not merely from the right.
                val y0 = 110f * density
                val inv = 1f - v0
                translationX = x0 * inv - bounce
                translationY = y0 * inv
                scaleX = 1f
                scaleY = 1f
                alpha = if (v0 < 0.3f) (v0 / 0.3f).coerceIn(0f, 1f) else 1f
            } else {
                // r101 (owner r100: "ekhon jemon massage send korle right
                // side a nicher theke asche Receiver er screen o same sevabe
                // asbe tobe left er ektu niche theke"): the RECEIVED bubble
                // flies in the same way as the sent one, mirrored - off the
                // LEFT edge of the list, a little below its seat, at full
                // size, fast, with the same overshoot bounce as it lands.
                // The old corner-GROW (0.6 -> 1 zoom) is gone.
                val s = seat
                val lb = FlightAnchors.listBounds
                val x0 = if (s != null && lb != null) -(s.right - lb.left + 14f * density) else -120f * density
                val y0 = 110f * density
                val inv = 1f - v0
                translationX = x0 * inv + bounce
                translationY = y0 * inv
                scaleX = 1f
                scaleY = 1f
                alpha = if (v0 < 0.3f) (v0 / 0.3f).coerceIn(0f, 1f) else 1f
            }
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

    /**
     * r76-29 (owner: "not fixed"): the send-ack arms a mine row's flight -
     * goAt lands delayMs in the FUTURE, and valueAt() holds 0 until the clock
     * reaches it. Arming here (not inside the composition) makes the 0.5 s
     * post-send animation deterministic: the echo and the server row live in
     * DIFFERENT LazyColumn items blocks, so the waiting coroutine could die at
     * the swap and the flight never started. Idempotent - the first arm wins.
     */
    fun armIn(key: String, delayMs: Long): Boolean {
        if (key.isBlank()) return false
        synchronized(map) {
            val f = map.getOrPut(key) { Flight(android.os.SystemClock.uptimeMillis()) }
            if (f.goAt >= 0L) return false
            f.goAt = android.os.SystemClock.uptimeMillis() + delayMs
            return true
        }
    }

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
