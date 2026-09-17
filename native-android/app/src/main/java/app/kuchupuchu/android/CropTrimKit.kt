package app.kuchupuchu.android

import android.net.Uri
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Owner round 31 (item 30): the dedicated status SHARE screen. The media
 * fills a dark stage, Close sits at the top, one Send button at the bottom —
 * the caption bar is gone. A video longer than a minute opens with its FIRST
 * minute selected; the strip below lets the user slide that window anywhere
 * or drag either end (never past a minute), and the Crop tool (9:16 / 1:1 /
 * free) applies to photos and videos alike. The clip is cut on the phone:
 * only the trimmed, cropped result is uploaded.
 *
 * Item 31: the item comes from the app's OWN gallery (StatusPickScreen) via
 * the route argument — the system picker and the old "Choose photo or video"
 * / "Post" buttons are gone.
 */
/** The clip loops inside the selected window; tap pauses/resumes. While a
 *  trim handle is being dragged ([scrubAt]) the picture holds the frame under
 *  that handle — the release restarts playback from the start handle. */
@Composable
internal fun StatusTrimPreview(
    uri: Uri,
    start: Long,
    end: Long,
    paused: Boolean,
    scrubAt: Long? = null,
    // Owner round 33 (item 8): the play position (ms in the clip) on
    // every tick — the trim strip draws its playhead from it.
    onPosition: (Long) -> Unit = {},
) {
    var player by remember(uri) { mutableStateOf<TrimClipPlayer?>(null) }
    var userPaused by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    LaunchedEffect(player, start, end, scrubAt) { player?.setWindow(start, end, scrubAt ?: -1L) }
    LaunchedEffect(player, paused, userPaused, scrubAt) { player?.setPaused(paused || userPaused || scrubAt != null) }
    val positionCb = rememberUpdatedState(onPosition)
    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        while (true) {
            p.tick()
            positionCb.value(p.positionMs())
            delay(120)
        }
    }
    // Polish 2026-09-18: video was still playing after the app went to
    // background — pause on ON_PAUSE/ON_STOP, resume on ON_RESUME if the
    // strip still wants to play. The AndroidView onRelease already handles
    // the screen-close case; this handles the background case.
    val ctxLifecycle = androidx.compose.ui.platform.LocalContext.current as? androidx.lifecycle.LifecycleOwner
    DisposableEffect(ctxLifecycle, player, paused, userPaused, scrubAt) {
        val obs = androidx.lifecycle.LifecycleEventObserver { _, ev ->
            when (ev) {
                androidx.lifecycle.Lifecycle.Event.ON_PAUSE,
                androidx.lifecycle.Lifecycle.Event.ON_STOP -> player?.setPaused(true)
                androidx.lifecycle.Lifecycle.Event.ON_RESUME -> {
                    if (!paused && !userPaused && scrubAt == null) player?.setPaused(false)
                }
                else -> {}
            }
        }
        ctxLifecycle?.lifecycle?.addObserver(obs)
        onDispose { ctxLifecycle?.lifecycle?.removeObserver(obs) }
    }
    DisposableEffect(uri) {
        onDispose {
            runCatching { player?.release() }
        }
    }
    Box(
        Modifier
            .fillMaxSize()
            .clickable {
                haptics.tap()
                userPaused = !userPaused
            },
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.ui.viewinterop.AndroidView(
            factory = { c ->
                android.view.TextureView(c).apply {
                    isOpaque = false
                    player = TrimClipPlayer(this, c, uri).also { it.attach() }
                }
            },
            onRelease = {
                runCatching { player?.release() }
                player = null
            },
            modifier = Modifier.fillMaxSize(),
        )
        if (userPaused) {
            Box(Modifier.size(56.dp).clip(CircleShape).background(Color(0x66000000)), contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(32.dp))
            }
        }
    }
}

/**
 * MediaPlayer on a TextureView that loops [start, end] of the source clip.
 *
 * Owner round 32 (item 43, "preview glitches and loops back after ~1 s"):
 * the old loop used seekTo(int), which lands on the PREVIOUS keyframe — with
 * a 2-3 s GOP that is seconds before the start handle — and then judged the
 * position against `start - 1.5 s` on the very next tick, seeking again,
 * landing on the same keyframe again… an endless stutter. Seeks are now
 * frame-exact (SEEK_CLOSEST, API 26+), a seek in flight is never second-
 * guessed, and where a seek actually landed is accepted as the loop floor.
 */
private class TrimClipPlayer(
    private val view: android.view.TextureView,
    private val ctx: android.content.Context,
    private val uri: Uri,
) : android.view.TextureView.SurfaceTextureListener {
    private var mp: android.media.MediaPlayer? = null
    private var prepared = false
    private var wantPaused = false
    private var startMs = 0L
    private var endMs = Long.MAX_VALUE
    private var pendingSeek = -1L
    private var seeking = false
    private var seekSince = 0L
    private var landedAt = 0L
    private var scrubbing = false

    fun attach() {
        view.surfaceTextureListener = this
        if (view.surfaceTexture != null) bind()
    }

    private fun bind() {
        val st = view.surfaceTexture ?: return
        val existing = mp
        if (existing != null) {
            runCatching { existing.setSurface(android.view.Surface(st)) }
            if (!wantPaused && prepared) runCatching { existing.start() }
            return
        }
        mp =
            android.media.MediaPlayer().apply {
                runCatching {
                    setDataSource(ctx, uri)
                    setOnPreparedListener { p ->
                        prepared = true
                        seek(p, startMs)
                        if (!wantPaused) runCatching { p.start() }
                    }
                    setOnSeekCompleteListener { p ->
                        seeking = false
                        landedAt = runCatching { p.currentPosition.toLong() }.getOrDefault(startMs)
                    }
                    setOnCompletionListener { p ->
                        runCatching {
                            seek(p, startMs)
                            if (!wantPaused) p.start()
                        }
                    }
                    setOnErrorListener { _, _, _ -> true }
                    prepareAsync()
                }
            }
        runCatching { mp?.setSurface(android.view.Surface(st)) }
    }

    /** Frame-exact where the platform can (26+); the legacy call lands on a keyframe. */
    private fun seek(p: android.media.MediaPlayer, ms: Long) {
        seeking = true
        seekSince = android.os.SystemClock.uptimeMillis()
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                p.seekTo(ms, android.media.MediaPlayer.SEEK_CLOSEST)
            } else {
                p.seekTo(ms.toInt())
            }
        }.onFailure { seeking = false }
    }

    /**
     * The window, plus the handle under the finger ([scrubTo], -1 when none):
     * a dragged handle shows its exact frame; letting go restarts from the
     * start handle.
     */
    fun setWindow(s: Long, e: Long, scrubTo: Long = -1L) {
        val startMoved = s != startMs
        startMs = s
        endMs = e
        val nowScrubbing = scrubTo >= 0L
        when {
            nowScrubbing -> pendingSeek = scrubTo
            scrubbing || startMoved -> pendingSeek = s
        }
        scrubbing = nowScrubbing
    }

    fun setPaused(p: Boolean) {
        wantPaused = p
        val m = mp ?: return
        if (!prepared) return
        runCatching {
            if (p) {
                m.pause()
            } else {
                // Resume from the handle, not from wherever the scrub left the head.
                if (pendingSeek >= 0L) {
                    seek(m, pendingSeek)
                    pendingSeek = -1L
                }
                m.start()
            }
        }
    }

    /** Owner round 33 (item 8): where the picture is right now (ms in the
     *  clip) — the target of a seek still in flight, the start handle
     *  before the player is ready; never throws. */
    fun positionMs(): Long {
        val m = mp ?: return startMs
        if (!prepared) return startMs
        if (pendingSeek >= 0L) return pendingSeek
        return runCatching { m.currentPosition.toLong() }.getOrDefault(startMs)
    }

    /** ~8×/s: applies a pending seek (never while one is in flight) and loops at the end handle. */
    fun tick() {
        val m = mp ?: return
        if (!prepared) return
        // A seek-complete that never arrives (some OEM players skip it for a
        // no-op seek) must not freeze the loop for good.
        if (seeking && android.os.SystemClock.uptimeMillis() - seekSince > 1_500L) seeking = false
        if (seeking) return
        runCatching {
            if (pendingSeek >= 0L) {
                val target = pendingSeek
                pendingSeek = -1L
                seek(m, target)
                return
            }
            // A paused picture never loops (a scrub holds its frame).
            if (wantPaused) return
            val pos = m.currentPosition.toLong()
            // Past the end handle → back to the start. Behind the start is
            // only a restart when it is also behind where the last seek
            // LANDED (a legacy keyframe seek lands early — that is fine).
            if (pos >= endMs || pos < minOf(startMs, landedAt) - 1_000L) seek(m, startMs)
        }
    }

    override fun onSurfaceTextureAvailable(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {
        bind()
    }

    override fun onSurfaceTextureSizeChanged(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {}

    override fun onSurfaceTextureDestroyed(surface: android.graphics.SurfaceTexture): Boolean {
        runCatching { mp?.pause() }
        runCatching { mp?.setSurface(null) }
        return true
    }

    override fun onSurfaceTextureUpdated(surface: android.graphics.SurfaceTexture) {}

    fun release() {
        prepared = false
        runCatching { mp?.stop() }
        runCatching { mp?.release() }
        mp = null
        runCatching { view.surfaceTextureListener = null }
    }
}

/**
 * The trim strip: frames of the whole clip with a bright window over the
 * chosen part. Drag inside the window to slide it (length kept), drag either
 * edge to move that handle; VideoPlan keeps the window inside a minute.
 *
 * Owner round 32 (item 43, "handles imprecise"): the handle hit zone was 40 px
 * (~13 dp — a fingertip missed it and slid the whole window instead); it is
 * 24 dp each side now, the nearer handle wins, and the drag is computed in
 * absolute terms (window at touch-down + total finger travel) instead of
 * summing per-event deltas rounded to whole milliseconds. [onScrub] reports the
 * handle's clip position while the finger is down (null on release) so the
 * preview can show that exact frame.
 */
@Composable
internal fun TrimStrip(
    thumbs: List<ImageBitmap?>,
    durationMs: Long,
    start: Long,
    end: Long,
    onWindow: (Long, Long) -> Unit,
    onScrub: (Long?) -> Unit = {},
    // Owner round 32 (item 19): the window cap — a minute for a status, none
    // for a chat video (MediaEditScreen).
    maxMs: Long = VideoPlan.MAX_STATUS_MS,
    // Owner round 33 (item 8): the preview's play position (ms in the clip,
    // null = unknown) — drawn as a thin white playhead inside the window.
    positionMs: Long? = null,
) {
    var widthPx by remember { mutableStateOf(1f) }
    var mode by remember { mutableStateOf(0) } // 0 idle · 1 start · 2 end · 3 slide
    var s by remember { mutableStateOf(start) }
    var e by remember { mutableStateOf(end) }
    var grabS by remember { mutableStateOf(start) }
    var grabE by remember { mutableStateOf(end) }
    var travel by remember { mutableStateOf(0f) }
    LaunchedEffect(start, end) {
        s = start
        e = end
    }
    val total = durationMs.coerceAtLeast(1L).toFloat()
    val grabPx = with(LocalDensity.current) { 24.dp.toPx() }
    val scrubCb = rememberUpdatedState(onScrub)
    val windowCb = rememberUpdatedState(onWindow)
    // Owner round 34 (item 18): the position ticks land every 120 ms — glide
    // the playhead between them (linear, about one tick) instead of jumping
    // tick to tick. Hoisted into composition: the value is drawn by the
    // strip's Canvas, and composables cannot run inside a draw scope.
    val headSmooth by animateFloatAsState(
        targetValue = (positionMs ?: s).toFloat(),
        animationSpec = tween(durationMillis = 130, easing = LinearEasing),
        label = "trimhead",
    )
    Box(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .height(56.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF1B1B1B))
            .onSizeChanged { widthPx = it.width.toFloat().coerceAtLeast(1f) }
            .pointerInput(durationMs) {
                detectDragGestures(
                    onDragStart = { pos ->
                        val sx = s / total * widthPx
                        val ex = e / total * widthPx
                        val ds = kotlin.math.abs(pos.x - sx)
                        val de = kotlin.math.abs(pos.x - ex)
                        mode =
                            when {
                                ds <= grabPx && ds <= de -> 1
                                de <= grabPx -> 2
                                pos.x in sx..ex -> 3
                                else -> 0
                            }
                        grabS = s
                        grabE = e
                        travel = 0f
                        if (mode != 0) scrubCb.value(if (mode == 2) e else s)
                    },
                    onDragEnd = {
                        mode = 0
                        scrubCb.value(null)
                    },
                    onDragCancel = {
                        mode = 0
                        scrubCb.value(null)
                    },
                ) { change, drag ->
                    change.consume()
                    travel += drag.x
                    val deltaMs = (travel / widthPx * total).toLong()
                    val next =
                        when (mode) {
                            1 -> VideoPlan.moveStart(grabS, grabE, durationMs, grabS + deltaMs, maxMs)
                            2 -> VideoPlan.moveEnd(grabS, grabE, durationMs, grabE + deltaMs, maxMs)
                            3 -> VideoPlan.slide(grabS, grabE, durationMs, deltaMs)
                            else -> null
                        }
                    if (next != null) {
                        s = next.first
                        e = next.second
                        windowCb.value(s, e)
                        scrubCb.value(if (mode == 2) e else s)
                    }
                }
            },
    ) {
        Row(Modifier.fillMaxSize()) {
            thumbs.forEach { t ->
                Box(Modifier.weight(1f).fillMaxSize().background(Color(0xFF2A2A2A))) {
                    if (t != null) Image(t, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                }
            }
        }
        Canvas(Modifier.fillMaxSize()) {
            val sx = s / total * size.width
            val ex = e / total * size.width
            val shade = Color(0x99000000)
            drawRect(shade, Offset.Zero, Size(sx.coerceAtLeast(0f), size.height))
            drawRect(shade, Offset(ex, 0f), Size((size.width - ex).coerceAtLeast(0f), size.height))
            val accent = ActionBlue // blue in dark-blue, the classic gold in light-cream
            val edge = 2.dp.toPx()
            drawRect(accent, Offset(sx, 0f), Size(ex - sx, size.height), style = Stroke(edge * 2f))
            // Handles: 10 dp pills a thumb can find, brighter while held.
            val hw = 10.dp.toPx()
            val r = CornerRadius(3.dp.toPx())
            drawRoundRect(if (mode == 1) Color.White else accent, Offset(sx - hw / 2f, 0f), Size(hw, size.height), r)
            drawRoundRect(if (mode == 2) Color.White else accent, Offset(ex - hw / 2f, 0f), Size(hw, size.height), r)
            listOf(sx to (mode == 1), ex to (mode == 2)).forEach { (x, held) ->
                drawLine(
                    if (held) accent else Color.White,
                    Offset(x, size.height * 0.32f),
                    Offset(x, size.height * 0.68f),
                    strokeWidth = edge,
                )
            }
            // Owner round 33 (item 8): the playhead — a white line with a
            // dark outline (visible over any frame), inside the window only,
            // hidden while a handle is held (the handle IS the position then).
            val head = positionMs
            if (head != null && mode == 0) {
                val px = (headSmooth.toLong().coerceIn(s, e) / total * size.width).coerceIn(sx + hw / 2f, ex - hw / 2f)
                drawLine(Color(0x99000000), Offset(px, 0f), Offset(px, size.height), strokeWidth = edge * 2f)
                drawLine(Color.White, Offset(px, 0f), Offset(px, size.height), strokeWidth = edge)
                drawCircle(Color.White, radius = 3.dp.toPx(), center = Offset(px, 3.dp.toPx()))
            }
        }
    }
}

/**
 * The crop box over the stage: drag inside to move, drag a corner to resize
 * (a locked preset keeps its ratio); everything outside the box dims.
 */
@Composable
internal fun CropOverlay(box: CropBox, lock: Float?, boxAspect: Float, onChange: (CropBox) -> Unit) {
    var corner by remember { mutableStateOf(0) } // 0 none · 1 inside · 2..5 corners
    // Owner round 32 (item 43, "the Free crop box can't be moved"): the gesture
    // block is launched once per (lock, boxAspect) and kept the `box` it was
    // created with — every drag event moved that stale copy by (dx, dy), so the
    // box only ever jittered around its first position. The block now reads the
    // box (and the callback) as they are NOW.
    val current = rememberUpdatedState(box)
    val changeCb = rememberUpdatedState(onChange)
    val grabPx = with(LocalDensity.current) { 28.dp.toPx() }
    Canvas(
        Modifier
            .fillMaxSize()
            .pointerInput(lock, boxAspect) {
                detectDragGestures(
                    onDragStart = { pos ->
                        val w = size.width.toFloat()
                        val h = size.height.toFloat()
                        val b = current.value
                        val r = Rect(b.x * w, b.y * h, (b.x + b.w) * w, (b.y + b.h) * h)
                        val grab = grabPx
                        corner =
                            when {
                                (pos - r.topLeft).getDistance() <= grab -> 2
                                (pos - r.topRight).getDistance() <= grab -> 3
                                (pos - r.bottomLeft).getDistance() <= grab -> 4
                                (pos - r.bottomRight).getDistance() <= grab -> 5
                                r.contains(pos) -> 1
                                else -> 0
                            }
                    },
                    onDragEnd = { corner = 0 },
                    onDragCancel = { corner = 0 },
                ) { change, drag ->
                    change.consume()
                    val dx = drag.x / size.width.toFloat().coerceAtLeast(1f)
                    val dy = drag.y / size.height.toFloat().coerceAtLeast(1f)
                    val b = current.value
                    when (corner) {
                        1 -> changeCb.value(b.moved(dx, dy))
                        in 2..5 -> changeCb.value(b.resized(corner, dx, dy, lock, boxAspect))
                    }
                }
            },
    ) {
        val r = Rect(box.x * size.width, box.y * size.height, (box.x + box.w) * size.width, (box.y + box.h) * size.height)
        val dim = Color(0x8C000000)
        drawRect(dim, Offset.Zero, Size(size.width, r.top))
        drawRect(dim, Offset(0f, r.bottom), Size(size.width, (size.height - r.bottom).coerceAtLeast(0f)))
        drawRect(dim, Offset(0f, r.top), Size(r.left, r.height))
        drawRect(dim, Offset(r.right, r.top), Size((size.width - r.right).coerceAtLeast(0f), r.height))
        drawRect(Color.White, r.topLeft, r.size, style = Stroke(3f))
        val third = Color(0x66FFFFFF)
        for (i in 1..2) {
            drawLine(third, Offset(r.left + r.width * i / 3f, r.top), Offset(r.left + r.width * i / 3f, r.bottom), 1.5f)
            drawLine(third, Offset(r.left, r.top + r.height * i / 3f), Offset(r.right, r.top + r.height * i / 3f), 1.5f)
        }
        val arm = 34f
        val bold = 8f
        listOf(
            Triple(r.topLeft, 1f, 1f),
            Triple(r.topRight, -1f, 1f),
            Triple(r.bottomLeft, 1f, -1f),
            Triple(r.bottomRight, -1f, -1f),
        ).forEach { (c, sx, sy) ->
            drawLine(Color.White, c, Offset(c.x + arm * sx, c.y), bold)
            drawLine(Color.White, c, Offset(c.x, c.y + arm * sy), bold)
        }
    }
}
