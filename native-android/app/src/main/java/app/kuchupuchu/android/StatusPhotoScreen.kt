package app.kuchupuchu.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

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
@Composable
fun StatusPhotoScreen(nav: NavController, pickedUri: Uri, pickedIsVideo: Boolean) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()

    // Dark stage → light status-bar icons while this screen is up.
    val window = MainActivity.current?.window
    DisposableEffect(Unit) {
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
        val prev = controller?.isAppearanceLightStatusBars
        controller?.isAppearanceLightStatusBars = false
        onDispose { controller?.isAppearanceLightStatusBars = prev ?: true }
    }

    val picked: Uri = pickedUri
    val isVideo = pickedIsVideo
    var photo by remember { mutableStateOf<ImageBitmap?>(null) }
    var source by remember { mutableStateOf<VideoExport.Source?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var start by remember { mutableStateOf(0L) }
    var end by remember { mutableStateOf(0L) }
    var cropping by remember { mutableStateOf(false) }
    var crop by remember { mutableStateOf<CropBox?>(null) }
    var preset by remember { mutableStateOf("Original") }
    val thumbs = remember { mutableStateListOf<ImageBitmap?>() }

    LaunchedEffect(picked) {
        val uri = picked
        if (isVideo) {
            val src = withContext(Dispatchers.IO) { VideoExport.probe(ctx, uri) }
            if (src == null) {
                loadFailed = true
                return@LaunchedEffect
            }
            // Over a minute: the first minute is selected up front.
            val (s, e) = VideoPlan.defaultWindow(src.durationMs)
            start = s
            end = e
            source = src
            thumbs.clear()
            repeat(STRIP_FRAMES) { thumbs.add(null) }
            withContext(Dispatchers.IO) {
                VideoExport.thumbnails(ctx, uri, src.durationMs, STRIP_FRAMES) { i, bmp ->
                    if (i < thumbs.size) thumbs[i] = bmp.asImageBitmap()
                }
            }
        } else {
            val bmp = withContext(Dispatchers.IO) {
                FilesUtil.imageToJpeg(uri, ctx, maxSide = 1600, maxBytes = 2_000_000)?.let {
                    android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
                }
            }
            if (bmp == null) loadFailed = true else photo = bmp.asImageBitmap()
        }
    }

    val shot = photo
    val clip = source
    val ready = shot != null || clip != null
    // The stage has the media's own aspect, so the crop box maths (normalised
    // units) and the on-screen pixels agree without any extra measuring.
    val mediaAspect =
        when {
            shot != null -> shot.width.toFloat() / shot.height.coerceAtLeast(1)
            clip != null -> clip.displayW.toFloat() / clip.displayH.coerceAtLeast(1)
            else -> 9f / 16f
        }

    fun applyPreset(name: String) {
        preset = name
        crop =
            when (name) {
                "9:16" -> CropBox.centered(9f / 16f, mediaAspect)
                "1:1" -> CropBox.centered(1f, mediaAspect)
                "Free" -> crop ?: CropBox(0.08f, 0.08f, 0.84f, 0.84f)
                else -> null
            }
    }

    BackHandler(enabled = cropping) { cropping = false }

    fun send() {
        val uri = picked
        val vSource = source
        val img = photo
        val video = isVideo
        val box = crop?.takeIf { !it.isFull() }
        val s = start
        val e = end
        android.widget.Toast.makeText(ctx, "Sharing status…", android.widget.Toast.LENGTH_SHORT).show()
        nav.popBackStack()
        ScreenStore.appScope.launch {
            try {
                if (video && vSource != null) {
                    val cut = java.io.File(ctx.cacheDir, "status_out_${System.currentTimeMillis()}.mp4")
                    val bytes = readVideo(ctx, uri, s, e, vSource, box, cut)
                    if (bytes.size > VideoPlan.UPLOAD_LIMIT) throw Exception("That video is over 25 MB.")
                    val up = Api.upload("status.mp4", "video/mp4", bytes)
                    Api.post(
                        "/api/statuses",
                        JSONObject()
                            .put("kind", "VIDEO")
                            .put("fileKey", up.optString("fileKey"))
                            .put("seconds", ((e - s + 500L) / 1000L).toInt().coerceAtLeast(1))
                            .put("text", ""),
                    )
                } else {
                    val bmp = img ?: throw Exception("Could not read that photo.")
                    val data = photoDataUrl(bmp, box) ?: throw Exception("Could not read that photo.")
                    Api.post(
                        "/api/statuses",
                        JSONObject().put("kind", "IMAGE").put("imageData", data).put("text", ""),
                    )
                }
                runCatching {
                    val data = Api.get("/api/statuses", true)
                    ScreenStore.setStatuses(data.arr("items").objects())
                }
            } catch (e: Exception) {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(
                        ctx,
                        e.message ?: "Status didn't post. Try again.",
                        android.widget.Toast.LENGTH_LONG,
                    ).show()
                }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            /* top bar: Close · clip length · Crop */
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { if (cropping) cropping = false else nav.popBackStack() }) {
                    Icon(Icons.Filled.Close, "Close", tint = Color.White)
                }
                Spacer(Modifier.weight(1f))
                if (clip != null) {
                    Text(clipLabel(start, end), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(6.dp))
                }
                if (ready) {
                    IconButton(onClick = {
                        haptics.tap()
                        cropping = !cropping
                        if (cropping && crop == null) applyPreset("Free")
                    }) {
                        Icon(Icons.Filled.Crop, "Crop", tint = if (cropping) ActionBlueDeep else Color.White)
                    }
                }
            }

            /* the stage: media at its own aspect, crop overlay on top */
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                when {
                    loadFailed -> Text("Could not open that file.", color = Color.White, fontSize = 14.sp)
                    !ready -> CircularProgressIndicator(color = ActionBlue)
                    else -> {
                        Box(Modifier.aspectRatio(mediaAspect.coerceIn(0.3f, 3.5f))) {
                            if (shot != null) {
                                Image(shot, contentDescription = "Status photo", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                            } else {
                                StatusTrimPreview(pickedUri, start, end, paused = cropping)
                            }
                            if (cropping) {
                                CropOverlay(
                                    box = crop ?: CropBox.FULL,
                                    lock =
                                        when (preset) {
                                            "9:16" -> 9f / 16f
                                            "1:1" -> 1f
                                            else -> null
                                        },
                                    boxAspect = mediaAspect,
                                    onChange = {
                                        crop = it
                                        if (preset == "Original") preset = "Free"
                                    },
                                )
                            }
                        }
                    }
                }
            }

            /* bottom: crop presets, or the trim strip, then Send */
            if (cropping) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    listOf("Original", "9:16", "1:1", "Free").forEach { name ->
                        val on = preset == name
                        Text(
                            name,
                            color = if (on) ActionBlueInk else Color.White,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (on) ActionBlue else Color(0x33FFFFFF))
                                .clickable {
                                    haptics.tap()
                                    applyPreset(name)
                                }
                                .padding(horizontal = 14.dp, vertical = 7.dp),
                        )
                    }
                }
            } else if (clip != null) {
                TrimStrip(
                    thumbs = thumbs,
                    durationMs = clip.durationMs,
                    start = start,
                    end = end,
                    onWindow = { s, e ->
                        start = s
                        end = e
                    },
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.weight(1f))
                if (ready) {
                    Box(
                        Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(ActionBlue)
                            .clickable {
                                haptics.tap()
                                if (cropping) cropping = false else send()
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (cropping) Icons.Filled.Check else Icons.AutoMirrored.Filled.Send,
                            contentDescription = if (cropping) "Done" else "Send",
                            tint = ActionBlueInk,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}

private const val STRIP_FRAMES = 10

private fun clipLabel(start: Long, end: Long): String {
    val secs = ((end - start + 500L) / 1000L).coerceAtLeast(1L)
    return "%d:%02d".format(secs / 60, secs % 60)
}

/** Photo path: crop in bitmap space, then a JPEG data URL inside the inline budget. */
private fun photoDataUrl(bmp: ImageBitmap, box: CropBox?): String? =
    runCatching {
        val src = bmp.asAndroidBitmap()
        var picture =
            if (box == null) {
                src
            } else {
                val x = (box.x * src.width).toInt().coerceIn(0, src.width - 1)
                val y = (box.y * src.height).toInt().coerceIn(0, src.height - 1)
                val w = (box.w * src.width).toInt().coerceIn(1, src.width - x)
                val h = (box.h * src.height).toInt().coerceIn(1, src.height - y)
                Bitmap.createBitmap(src, x, y, w, h)
            }
        var scale = 1
        while (picture.width / scale > 1280 || picture.height / scale > 1280) scale *= 2
        if (scale > 1) picture = Bitmap.createScaledBitmap(picture, picture.width / scale, picture.height / scale, true)
        var quality = 90
        var out = ByteArray(0)
        while (true) {
            val buf = java.io.ByteArrayOutputStream()
            if (!picture.compress(Bitmap.CompressFormat.JPEG, quality, buf)) break
            out = buf.toByteArray()
            if (out.size <= 380_000 * 3 / 4 || quality <= 45) break
            quality -= 5
        }
        if (out.isEmpty()) null else "data:image/jpeg;base64," + android.util.Base64.encodeToString(out, android.util.Base64.NO_WRAP)
    }.getOrNull()

/**
 * Video path: the clip is cut on the phone. Untouched small mp4s go up as they
 * are; anything trimmed, cropped or big is re-encoded on the GPU, and if a
 * device's codec refuses, the window is copied sample-for-sample instead
 * (still trimmed, still under a minute — only the crop is lost).
 */
private fun readVideo(
    ctx: android.content.Context,
    uri: Uri,
    start: Long,
    end: Long,
    src: VideoExport.Source,
    crop: CropBox?,
    out: java.io.File,
): ByteArray {
    val mime = (ctx.contentResolver.getType(uri) ?: "").ifBlank { "video/mp4" }
    val size = runCatching { ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L }.getOrDefault(-1L)
    if (!VideoPlan.needsTranscode(crop, start, end, src.durationMs, size, mime)) {
        return ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw Exception("Could not read that video.")
    }
    try {
        VideoExport.export(ctx, uri, start, end, crop, out)
    } catch (e: Exception) {
        out.delete()
        VideoExport.passthrough(ctx, uri, start, end, out)
    }
    val bytes = out.readBytes()
    out.delete()
    return bytes
}

/** The clip loops inside the selected window; tap pauses/resumes. */
@Composable
private fun StatusTrimPreview(uri: Uri, start: Long, end: Long, paused: Boolean) {
    var player by remember(uri) { mutableStateOf<TrimClipPlayer?>(null) }
    var userPaused by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    LaunchedEffect(player, start, end) { player?.setWindow(start, end) }
    LaunchedEffect(player, paused, userPaused) { player?.setPaused(paused || userPaused) }
    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        while (true) {
            p.tick()
            delay(120)
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

/** MediaPlayer on a TextureView that loops [start, end] of the source clip. */
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
                        runCatching { p.seekTo(startMs.toInt()) }
                        if (!wantPaused) runCatching { p.start() }
                    }
                    setOnCompletionListener { p ->
                        runCatching {
                            p.seekTo(startMs.toInt())
                            if (!wantPaused) p.start()
                        }
                    }
                    setOnErrorListener { _, _, _ -> true }
                    prepareAsync()
                }
            }
        runCatching { mp?.setSurface(android.view.Surface(st)) }
    }

    fun setWindow(s: Long, e: Long) {
        if (s != startMs) pendingSeek = s
        startMs = s
        endMs = e
    }

    fun setPaused(p: Boolean) {
        wantPaused = p
        val m = mp ?: return
        if (!prepared) return
        runCatching { if (p) m.pause() else m.start() }
    }

    /** ~8×/s: applies a pending seek (at most one per tick) and loops at the end handle. */
    fun tick() {
        val m = mp ?: return
        if (!prepared) return
        runCatching {
            if (pendingSeek >= 0L) {
                m.seekTo(pendingSeek.toInt())
                pendingSeek = -1L
            } else if (m.currentPosition >= endMs || m.currentPosition < startMs - 1500L) {
                m.seekTo(startMs.toInt())
            }
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
 */
@Composable
private fun TrimStrip(
    thumbs: List<ImageBitmap?>,
    durationMs: Long,
    start: Long,
    end: Long,
    onWindow: (Long, Long) -> Unit,
) {
    var widthPx by remember { mutableStateOf(1f) }
    var mode by remember { mutableStateOf(0) } // 0 idle · 1 start · 2 end · 3 slide
    var s by remember { mutableStateOf(start) }
    var e by remember { mutableStateOf(end) }
    LaunchedEffect(start, end) {
        s = start
        e = end
    }
    val total = durationMs.coerceAtLeast(1L).toFloat()
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
                        val grab = 40f
                        mode =
                            when {
                                kotlin.math.abs(pos.x - sx) <= grab -> 1
                                kotlin.math.abs(pos.x - ex) <= grab -> 2
                                pos.x in sx..ex -> 3
                                else -> 0
                            }
                    },
                    onDragEnd = { mode = 0 },
                    onDragCancel = { mode = 0 },
                ) { change, drag ->
                    change.consume()
                    val deltaMs = (drag.x / widthPx * total).toLong()
                    val next =
                        when (mode) {
                            1 -> VideoPlan.moveStart(s, e, durationMs, s + deltaMs)
                            2 -> VideoPlan.moveEnd(s, e, durationMs, e + deltaMs)
                            3 -> VideoPlan.slide(s, e, durationMs, deltaMs)
                            else -> null
                        }
                    if (next != null) {
                        s = next.first
                        e = next.second
                        onWindow(s, e)
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
            drawRect(accent, Offset(sx, 0f), Size(ex - sx, size.height), style = Stroke(6f))
            val hw = 22f
            drawRoundRect(accent, Offset(sx - hw / 2f, 0f), Size(hw, size.height), CornerRadius(6f))
            drawRoundRect(accent, Offset(ex - hw / 2f, 0f), Size(hw, size.height), CornerRadius(6f))
            listOf(sx, ex).forEach { x ->
                drawLine(Color.White, Offset(x, size.height * 0.35f), Offset(x, size.height * 0.65f), strokeWidth = 4f)
            }
        }
    }
}

/**
 * The crop box over the stage: drag inside to move, drag a corner to resize
 * (a locked preset keeps its ratio); everything outside the box dims.
 */
@Composable
private fun CropOverlay(box: CropBox, lock: Float?, boxAspect: Float, onChange: (CropBox) -> Unit) {
    var corner by remember { mutableStateOf(0) } // 0 none · 1 inside · 2..5 corners
    Canvas(
        Modifier
            .fillMaxSize()
            .pointerInput(lock, boxAspect) {
                detectDragGestures(
                    onDragStart = { pos ->
                        val w = size.width.toFloat()
                        val h = size.height.toFloat()
                        val r = Rect(box.x * w, box.y * h, (box.x + box.w) * w, (box.y + box.h) * h)
                        val grab = 64f
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
                    when (corner) {
                        1 -> onChange(box.moved(dx, dy))
                        in 2..5 -> onChange(box.resized(corner, dx, dy, lock, boxAspect))
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
