package app.kuchupuchu.android

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin

/**
 * N3r: the WHOLE emoji animates — the real system glyph, never a redrawn
 * face. Every glyph gets a deterministic 3D move from the palette below
 * (hash-assigned, so each of the 300+ keyboard emojis dances its own way
 * and siblings never move in lockstep).
 *
 * A glyph plays for 3 seconds, then rests: on a live arrival, on tap, or
 * when the other side taps (the server's emoji_fx frame lands in
 * emojiFxReplays and the row consumes its own id exactly once). Reduced
 * motion (animator scale 0) never plays.
 */
internal val emojiFxReplays = SnapshotStateList<String>()

private const val FX_PLAY_MS = 3000L

private const val TAU = 2f * PI.toFloat()

private fun frac(x: Float): Float = x - floor(x)

/** 0 at the loop ends, 1 mid-loop. */
private fun tri(p: Float): Float = 1f - abs(2f * frac(p) - 1f)

/** Lub-dub: a strong thump plus its smaller echo. */
private fun dub(p: Float): Float {
    val q = frac(p)
    val a = max(0f, sin(q * TAU))
    val b = max(0f, sin((q - 0.16f) * TAU))
    return (a * a * 0.75f + b * b * 0.45f).coerceIn(0f, 1f)
}

private data class FxPattern(
    /** How many move cycles fit one 1600 ms loop. */
    val cycles: Float,
    val move: GraphicsLayerScope.(ph: Float, density: Float) -> Unit,
)

/** The 3D palette: spins, nods, hops, floats — every move loops seamlessly. */
private val FX_PATTERNS =
    listOf(
        // Coin spin: a full Y turn per loop.
        FxPattern(1f) { ph, _ -> rotationY = ph * 360f },
        // Nod: forward-back on X.
        FxPattern(2f) { ph, _ -> rotationX = sin(TAU * ph) * 22f },
        // Swing: side-to-side on Y.
        FxPattern(2f) { ph, _ -> rotationY = sin(TAU * ph) * 38f },
        // Hop: a little jump with a forward lean.
        FxPattern(3f) { ph, density ->
            val h = abs(sin(TAU * ph))
            translationY = -h * 14f * density
            rotationX = -h * 10f
        },
        // Wobble: X plus a double-speed Y.
        FxPattern(2f) { ph, _ ->
            rotationX = sin(TAU * ph) * 18f
            rotationY = sin(TAU * ph * 2f) * 18f
        },
        // Drift: a gentle sideways sway with a nod (replaces Thump scale).
        FxPattern(2f) { ph, density ->
            translationX = sin(TAU * ph) * 8f * density
            rotationX = sin(TAU * ph) * 10f
            rotationY = sin(TAU * ph * 2f) * 14f
        },
        // Tilt-spin: leaning back while turning around.
        FxPattern(1f) { ph, _ ->
            rotationX = 22f
            rotationY = ph * 360f
        },
        // Rocker: a slow deep nod.
        FxPattern(1f) { ph, _ -> rotationX = sin(TAU * ph) * 30f },
        // Peek: turns away and comes back.
        FxPattern(1f) { ph, _ -> rotationY = tri(ph) * 75f },
        // Float: hovers up and down, tilting with the drift.
        FxPattern(1f) { ph, density ->
            translationY = sin(TAU * ph) * 10f * density
            rotationX = sin(TAU * ph) * 10f
            rotationY = cos(TAU * ph) * 10f
        },
        // Lean: a tipsy sideways tilt.
        FxPattern(2f) { ph, _ ->
            rotationZ = sin(TAU * ph) * 10f
            rotationY = sin(TAU * ph) * 24f
        },
        // Sway: a lateral drift with a lean (replaces Pulse-3D scale).
        FxPattern(2f) { ph, density ->
            translationX = sin(TAU * ph) * 6f * density
            rotationZ = sin(TAU * ph) * 8f
            rotationY = sin(TAU * ph) * 16f
        },
        // Roll: a full forward flip per loop.
        FxPattern(1f) { ph, _ -> rotationX = ph * 360f },
        // Shimmy: a Z twist with a bob (replaces Heartbeat-side scale).
        FxPattern(2f) { ph, density ->
            rotationZ = sin(TAU * ph) * 12f
            rotationY = sin(TAU * ph) * 10f
            translationY = abs(sin(TAU * ph * 2f)) * -4f * density
        },
    )

private fun fxPatternOf(ch: String): FxPattern = FX_PATTERNS[abs(ch.hashCode()) % FX_PATTERNS.size]

/** Splits a body into emoji clusters (bases keep their joiners / modifiers). */
internal fun splitEmojiClusters(body: String): List<String> {
    val t = body.trim()
    if (t.isEmpty()) return emptyList()
    val out = ArrayList<String>()
    var cur = StringBuilder()
    var lastCp = -1
    var i = 0
    fun flush() {
        if (cur.isNotEmpty()) {
            out.add(cur.toString())
            cur = StringBuilder()
        }
    }
    while (i < t.length) {
        val cp = t.codePointAt(i)
        val chunk = t.substring(i, i + Character.charCount(cp))
        if (cp == ' '.code) {
            flush()
        } else if (lastCp == 0x200D || cp == 0x200D || cp == 0xFE0F || cp in 0x1F3FB..0x1F3FF) {
            cur.append(chunk)
        } else {
            flush()
            cur.append(chunk)
        }
        lastCp = cp
        i += Character.charCount(cp)
    }
    flush()
    return out
}

/**
 * One emoji-only row: every glyph dances its own 3D move for 3 seconds —
 * on a live arrival ([active]), on tap, or when the other side taps (the
 * row's [mid] lands in [emojiFxReplays]). History rows rest until tapped.
 */
@Composable
internal fun EmojiGlyphRow(
    body: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
) {
    Row(
        Modifier.fxPopIn(active).padding(start = 2.dp, end = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        splitEmojiClusters(body).forEachIndexed { i, ch ->
            EmojiFxGlyph(ch, sizeSp, active, mid, i)
        }
    }
}

@Composable
private fun EmojiFxGlyph(
    ch: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
    idx: Int,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val anim = fxAnimatorScale() > 0f
    var playing by remember(mid, ch) { mutableStateOf(active && anim) }
    var playId by remember(mid, ch) { mutableStateOf(0) }
    fun replay(local: Boolean) {
        if (!anim) return
        playing = true
        playId++
        // A local tap replays on the OTHER side too: the server fans the
        // frame out and it lands in emojiFxReplays on every watcher.
        if (local && mid.isNotBlank() && !mid.startsWith("c_")) {
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) { Api.post("/api/messages/$mid/fx") }
                }
            }
        }
    }
    // The other side tapped this very row: play it here too. Consumed, so
    // the replay fires exactly once per frame.
    if (mid.isNotBlank() && emojiFxReplays.remove(mid)) replay(local = false)
    // Three seconds of dance, then the rest pose — never frozen mid-move.
    LaunchedEffect(playId) {
        if (playing) {
            delay(FX_PLAY_MS)
            playing = false
        }
    }
    val tap = Modifier.clickable { haptics.tap(); replay(local = true) }
    if (playing) FxMovingGlyph(ch, sizeSp, idx, tap)
    else Text(ch, fontSize = sizeSp.sp, modifier = tap)
}

@Composable
private fun FxMovingGlyph(
    ch: String,
    sizeSp: Float,
    idx: Int,
    tap: Modifier,
) {
    val density = LocalDensity.current.density
    val trans = rememberInfiniteTransition(label = "fx")
    val loop by trans.animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = LinearEasing)), label = "loop")
    val pattern = fxPatternOf(ch)
    // Siblings run phase-shifted: a row of laughers never laughs in lockstep.
    val ph = frac(loop * pattern.cycles + idx * 0.31f)
    // Real 3D: the glyph extrudes — a darker offset copy behind the main one.
    // The offset itself animates with the same 3D phase, so inner highlights
    // (eyes, tears, hearts) appear to have depth and parallax, not just the
    // whole glyph rotating. Original colors stay, only depth is added.
    Box(
        modifier = tap,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            ch,
            fontSize = sizeSp.sp,
            color = Color.Black.copy(alpha = 0.22f),
            modifier =
                Modifier.graphicsLayer {
                    cameraDistance = 8f * density
                    pattern.move(this, ph, density)
                    translationX += 1.8f * density
                    translationY += 1.8f * density
                    // Slight scale down for the extrusion so the front glyph overhangs.
                    scaleX = 0.98f
                    scaleY = 0.98f
                },
        )
        Text(
            ch,
            fontSize = sizeSp.sp,
            modifier =
                Modifier.graphicsLayer {
                    cameraDistance = 8f * density
                    pattern.move(this, ph, density)
                },
        )
    }
}
