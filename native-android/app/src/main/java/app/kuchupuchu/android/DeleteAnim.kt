package app.kuchupuchu.android

import android.graphics.Bitmap
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.core.view.drawToBitmap
import kotlin.math.exp
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import org.json.JSONObject

/* Owner round 34 (delete animation): a deleted message explodes into dust.
   A band sweeps left → right across a capture of the real bubble; swept
   pixel-columns burst into particles (upward launch + gravity); unswept
   columns bulge upward just ahead of the band; then the row collapses.
   Ports the owner's demo pixel-for-pixel (same constants, same order). */

/** Geometry snapshots: bubble + row rects in window pixels, keyed by rowKey. */
internal object DeleteGeoms {
    val bubbles = mutableMapOf<String, Rect>()
    val rows = mutableMapOf<String, Rect>()

    fun put(m: JSONObject, rect: Rect) {
        bubbles[m.optString("clientId").ifBlank { m.optString("id") }] = rect
    }

    /** Consume-once: later layouts (collapse) must not move a running show. */
    fun snapshot(rowKey: String): DeleteFlip? {
        val row = rows.remove(rowKey) ?: return null
        return DeleteFlip(row, bubbles.remove(rowKey))
    }
}

internal data class DeleteFlip(val row: Rect, val bubble: Rect?)

internal data class DeleteShot(val bmp: Bitmap, val row: Rect, val bubble: Rect)

internal object DeleteAnim {
    const val SWEEP_MS = 1200
    const val SAFETY_MS = 2100L
    const val COLLAPSE_MS = 220
    const val PRE_MS = 120L
    const val GRACE_MS = 2600L
    const val MAX_W = 360
    const val BLOCK = 2
    const val EXTRA = 14f
    const val CURVE_H = 6f
    const val CURVE_W = 6f
    const val BAND_LEAD = 20f
    const val MAX_ALIVE = 6000

    private var sharedFull: Bitmap? = null
    private var sharedAt = 0L

    /** Screen capture cropped to the bubble, downscaled to the sim budget.
     *  The full-screen shot is shared across rows deleted in one burst;
     *  every crop is an independent copy (subset bitmaps share pixels). */
    fun capture(bubble: Rect): Bitmap? {
        return try {
            if (bubble.width < 4f || bubble.height < 4f) return null
            val decor = MainActivity.current?.window?.decorView ?: return null
            val now = android.os.SystemClock.uptimeMillis()
            var full = sharedFull
            if (full == null || full.isRecycled || now - sharedAt > 300) {
                full = decor.drawToBitmap()
                sharedFull = full
                sharedAt = now
            }
            val l = bubble.left.roundToInt().coerceIn(0, full.width - 1)
            val t = bubble.top.roundToInt().coerceIn(0, full.height - 1)
            val r = bubble.right.roundToInt().coerceIn(l + 1, full.width)
            val b = bubble.bottom.roundToInt().coerceIn(t + 1, full.height)
            val crop = Bitmap.createBitmap(full, l, t, r - l, b - t)
            if (crop.width > MAX_W) {
                val s = MAX_W.toFloat() / crop.width
                Bitmap.createScaledBitmap(crop, MAX_W, (crop.height * s).roundToInt().coerceAtLeast(1), true)
            } else {
                crop.copy(Bitmap.Config.ARGB_8888, false) ?: crop
            }
        } catch (e: Exception) {
            null
        }
    }
}

private data class DeleteParticle(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    var life: Float,
    val decay: Float,
    val size: Float,
    val color: Int,
)

/** The sweep simulation: plain mutable state, stepped once per frame. */
private class DeleteSim(val w: Int, val h: Int, val px: IntArray) {
    val cols = (w + DeleteAnim.BLOCK - 1) / DeleteAnim.BLOCK
    val colDone = BooleanArray(cols)
    val parts = ArrayList<DeleteParticle>(2048)
    val rnd = java.util.Random()
    var bandX = -DeleteAnim.BAND_LEAD

    /** Advance one frame. Returns true when the show is over. */
    fun step(elapsedMs: Long): Boolean {
        val t = (elapsedMs / DeleteAnim.SWEEP_MS.toFloat()).coerceIn(0f, 1f)
        bandX = -DeleteAnim.BAND_LEAD + t * (w + 2 * DeleteAnim.BAND_LEAD)
        val bandCol = (bandX / DeleteAnim.BLOCK).toInt()
        for (c in 0..bandCol.coerceAtMost(cols - 1)) {
            if (colDone[c]) continue
            colDone[c] = true
            if (parts.size >= DeleteAnim.MAX_ALIVE) continue
            val x0 = c * DeleteAnim.BLOCK
            var y = 0
            while (y < h) {
                val col = px[y * w + minOf(x0, w - 1)]
                if ((col ushr 24) >= 10 && rnd.nextFloat() < 0.7f) {
                    parts.add(
                        DeleteParticle(
                            x = x0 + DeleteAnim.BLOCK / 2f,
                            y = y + DeleteAnim.BLOCK / 2f,
                            vx = (rnd.nextFloat() - 0.3f) * 1.1f,
                            vy = -rnd.nextFloat() * 4.2f - 1.8f,
                            life = 1f,
                            decay = 0.02f + rnd.nextFloat() * 0.02f,
                            size = DeleteAnim.BLOCK * (0.5f + rnd.nextFloat() * 0.4f),
                            color = col,
                        ),
                    )
                }
                y += DeleteAnim.BLOCK
            }
        }
        for (i in parts.size - 1 downTo 0) {
            val p = parts[i]
            p.x += p.vx
            p.y += p.vy
            p.vy += 0.05f
            p.life -= p.decay
            if (p.life <= 0f) parts.removeAt(i)
        }
        return (t >= 1f && parts.isEmpty()) || elapsedMs >= DeleteAnim.SAFETY_MS
    }

    fun draw(s: androidx.compose.ui.graphics.drawscope.DrawScope, img: ImageBitmap) {
        for (c in 0 until cols) {
            if (colDone[c]) continue
            val x = c * DeleteAnim.BLOCK
            val dist = x - bandX
            val offY =
                if (dist >= 0 && dist < DeleteAnim.CURVE_W * 3) {
                    -DeleteAnim.CURVE_H * exp(-dist / DeleteAnim.CURVE_W)
                } else {
                    0f
                }
            val sw = minOf(DeleteAnim.BLOCK, w - x)
            s.drawImage(
                img,
                srcOffset = IntOffset(x, 0),
                srcSize = IntSize(sw, h),
                dstOffset = IntOffset(x, offY.roundToInt()),
                dstSize = IntSize(sw, h),
            )
        }
        for (p in parts) {
            s.drawRect(
                Color(p.color).copy(alpha = p.life.coerceIn(0f, 1f)),
                topLeft = Offset(p.x - p.size / 2f, p.y - p.size / 2f),
                size = Size(p.size, p.size),
            )
        }
    }
}

/** Plays the sweep + dust over the captured bubble, then collapses the row. */
@Composable
internal fun DestroyCanvas(shot: DeleteShot, onDone: () -> Unit) {
    val density = LocalDensity.current
    val img = remember(shot) { shot.bmp.asImageBitmap() }
    val px = remember(shot) {
        IntArray(shot.bmp.width * shot.bmp.height).also {
            shot.bmp.getPixels(it, 0, shot.bmp.width, 0, 0, shot.bmp.width, shot.bmp.height)
        }
    }
    val sim = remember(shot) { DeleteSim(shot.bmp.width, shot.bmp.height, px) }
    var tick by remember(shot) { mutableStateOf(0) }
    var collapse by remember(shot) { mutableStateOf(false) }
    val collapseT = remember(shot) { Animatable(1f) }
    LaunchedEffect(shot) {
        val start = withFrameNanos { it }
        var done = false
        while (!done) {
            val now = withFrameNanos { it }
            done = sim.step((now - start) / 1_000_000L)
            tick++
        }
        collapse = true
        collapseT.animateTo(0f, tween(DeleteAnim.COLLAPSE_MS))
        onDone()
    }
    val sc = shot.bubble.width / shot.bmp.width.toFloat()
    val frac = if (collapse) collapseT.value else 1f
    Box(
        Modifier
            .fillMaxWidth()
            .height(with(density) { (shot.row.height * frac).toDp() })
            .clipToBounds(),
    ) {
        if (!collapse) {
            Canvas(
                Modifier
                    .size(
                        with(density) { shot.bubble.width.toDp() },
                        with(density) { (shot.bubble.height + DeleteAnim.EXTRA * sc).toDp() },
                    )
                    .offset {
                        IntOffset(
                            (shot.bubble.left - shot.row.left).roundToInt(),
                            (shot.bubble.top - shot.row.top - DeleteAnim.EXTRA * sc).roundToInt(),
                        )
                    },
            ) {
                // Frame trigger (never true): draw-phase state reads redraw
                // without recomposing.
                if (tick == -1) return@Canvas
                scale(sc, sc, pivot = Offset.Zero) {
                    translate(top = DeleteAnim.EXTRA) {
                        sim.draw(this, img)
                    }
                }
            }
        }
    }
}

/** One chat-list row with the delete show: capture → dust → collapse.
 *  Rows without a capture (system rows, capture failure) shrink instead. */
@Composable
internal fun DeleteRowShell(
    m: JSONObject,
    rowKey: String,
    born: Boolean,
    rowSelected: Boolean,
    vanishing: Boolean,
    onGone: () -> Unit,
    bubble: @Composable () -> Unit,
) {
    var dead by remember(rowKey, m.optString("kind")) { mutableStateOf(false) }
    if (dead) return
    var shot by remember(rowKey) { mutableStateOf<DeleteShot?>(null) }
    var capFailed by remember(rowKey) { mutableStateOf(false) }
    // Snapshot at the flip: later layouts (collapse) must not move the show.
    val flip = remember(rowKey, vanishing) { if (vanishing) DeleteGeoms.snapshot(rowKey) else null }
    fun finishDead() {
        if (dead) return
        dead = true
        onGone()
    }
    val fallback = vanishing && shot == null && flip != null && (flip.bubble == null || capFailed)
    Box(
        Modifier
            .fillMaxWidth()
            .riseIn(born)
            .background(if (rowSelected) ActionBlue.copy(alpha = 0.16f) else Color.Transparent)
            .onGloballyPositioned { DeleteGeoms.rows[rowKey] = it.boundsInWindow() },
    ) {
        // The bubble keeps its slot from normal → capture-wait (no reload
        // flash); the canvas takes over in the same frame it retires.
        if (!fallback && shot == null) bubble()
        if (fallback) Box(Modifier.vanishOut(true) { finishDead() }) { bubble() }
        if (shot != null) DestroyCanvas(shot!!, onDone = { finishDead() })
        if (vanishing && shot == null && !fallback) {
            if (flip == null) {
                // Composed but never laid out: nothing to play — drop now.
                LaunchedEffect(rowKey) { finishDead() }
            } else {
                LaunchedEffect(rowKey) {
                    // The action sheet needs a beat to finish exiting, or the
                    // capture frames it sliding over the bubble.
                    delay(DeleteAnim.PRE_MS)
                    val bmp = DeleteAnim.capture(flip.bubble!!)
                    if (bmp == null) capFailed = true else shot = DeleteShot(bmp, flip.row, flip.bubble)
                }
            }
        }
    }
}
