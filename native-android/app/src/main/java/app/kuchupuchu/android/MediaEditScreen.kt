package app.kuchupuchu.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owner round 32 (item 19): the light editor behind the attach panel's Edit
 * — one picked PHOTO gets a pen (colours, undo, clear), one picked VIDEO gets
 * the trim strip. Send hands the result back to the open chat through
 * [ScreenStore.pendingEdited]; the chat sends it like any picked media (the
 * panel's ① / schedule choices are the chat's, not this screen's).
 *
 * The photo path draws in the picture's own pixel space (strokes are stored
 * in normalised 0..1 units), so what the user drew is exactly what is baked
 * into the JPEG whatever the stage size. The video path re-encodes the window
 * with the same GPU pipeline the status share uses (VideoExport) and falls
 * back to a sample copy when a device's codec refuses.
 */
@Composable
fun MediaEditScreen(nav: NavController, pickedUri: Uri, pickedIsVideo: Boolean, convId: String, viewOnce: Boolean) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()

    val window = MainActivity.current?.window
    DisposableEffect(Unit) {
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
        val prev = controller?.isAppearanceLightStatusBars
        controller?.isAppearanceLightStatusBars = false
        onDispose { controller?.isAppearanceLightStatusBars = prev ?: true }
    }

    var photo by remember { mutableStateOf<ImageBitmap?>(null) }
    var source by remember { mutableStateOf<VideoExport.Source?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var start by remember { mutableStateOf(0L) }
    var end by remember { mutableStateOf(0L) }
    var scrub by remember { mutableStateOf<Long?>(null) }
    var busy by remember { mutableStateOf(false) }
    val thumbs = remember { mutableStateListOf<ImageBitmap?>() }
    // Pen: strokes in normalised picture units; the live one is drawn as it grows.
    val strokes = remember { mutableStateListOf<PenStroke>() }
    var live by remember { mutableStateOf<PenStroke?>(null) }
    var penColor by remember { mutableStateOf(PEN_COLOURS[0]) }
    var penWidth by remember { mutableStateOf(PEN_WIDTHS[1]) }

    LaunchedEffect(pickedUri) {
        if (pickedIsVideo) {
            val src = withContext(Dispatchers.IO) { VideoExport.probe(ctx, pickedUri) }
            if (src == null) {
                loadFailed = true
                return@LaunchedEffect
            }
            // A chat video keeps its whole length by default (the status
            // share's first-minute rule is a status rule); trim from any point.
            start = 0L
            end = src.durationMs
            source = src
            thumbs.clear()
            repeat(EDIT_STRIP_FRAMES) { thumbs.add(null) }
            withContext(Dispatchers.IO) {
                VideoExport.thumbnails(ctx, pickedUri, src.durationMs, EDIT_STRIP_FRAMES) { i, bmp ->
                    if (i < thumbs.size) thumbs[i] = bmp.asImageBitmap()
                }
            }
        } else {
            val bmp = withContext(Dispatchers.IO) {
                FilesUtil.imageToJpeg(pickedUri, ctx, maxSide = 1600, maxBytes = 2_000_000)?.let {
                    android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
                }
            }
            if (bmp == null) loadFailed = true else photo = bmp.asImageBitmap()
        }
    }

    val shot = photo
    val clip = source
    val ready = shot != null || clip != null
    val mediaAspect =
        when {
            shot != null -> shot.width.toFloat() / shot.height.coerceAtLeast(1)
            clip != null -> clip.displayW.toFloat() / clip.displayH.coerceAtLeast(1)
            else -> 9f / 16f
        }

    fun send() {
        if (busy) return
        busy = true
        val img = photo
        val vSource = source
        val s = start
        val e = end
        val drawn = strokes.toList()
        ScreenStore.appScope.launch {
            val result =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val out = java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4")
                        val whole = s <= 0L && e >= vSource.durationMs
                        if (!whole) {
                            try {
                                VideoExport.export(ctx, pickedUri, s, e, null, out)
                            } catch (_: Exception) {
                                out.delete()
                                VideoExport.passthrough(ctx, pickedUri, s, e, out)
                            }
                            EditedMedia.Video(out, "video/mp4")
                        } else {
                            EditedMedia.Untouched(pickedUri, true)
                        }
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        if (drawn.isEmpty()) {
                            EditedMedia.Untouched(pickedUri, false)
                        } else {
                            EditedMedia.Photo(bakePen(bmp, drawn) ?: throw Exception("Could not save the drawing."))
                        }
                    }
                }.getOrElse { EditedMedia.Failed(it.message ?: "Could not edit that file.") }
            ScreenStore.pendingEdited.value = EditedResult(convId, viewOnce, result)
        }
        nav.popBackStack()
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            /* top bar: Close · (video) clip length · (photo) undo / clear */
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Icons.Filled.Close, "Close", tint = Color.White)
                }
                Spacer(Modifier.weight(1f))
                if (clip != null) {
                    Text(editClipLabel(start, end), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(6.dp))
                }
                if (shot != null && strokes.isNotEmpty()) {
                    IconButton(onClick = {
                        haptics.tap()
                        strokes.removeAt(strokes.size - 1)
                    }) {
                        Icon(Icons.AutoMirrored.Filled.Undo, "Undo", tint = Color.White)
                    }
                    IconButton(onClick = {
                        haptics.tap()
                        strokes.clear()
                    }) {
                        Icon(Icons.Filled.Delete, "Clear", tint = Color.White)
                    }
                }
            }

            /* the stage: media at its own aspect; the pen layer over a photo */
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                when {
                    loadFailed -> Text("Could not open that file.", color = Color.White, fontSize = 14.sp)
                    !ready -> CircularProgressIndicator(color = ActionBlue)
                    else -> {
                        Box(Modifier.aspectRatio(mediaAspect.coerceIn(0.3f, 3.5f))) {
                            if (shot != null) {
                                Image(shot, contentDescription = "Photo", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                                Canvas(
                                    Modifier
                                        .fillMaxSize()
                                        .pointerInput(penColor, penWidth) {
                                            detectDragGestures(
                                                onDragStart = { pos ->
                                                    val w = size.width.coerceAtLeast(1).toFloat()
                                                    val h = size.height.coerceAtLeast(1).toFloat()
                                                    live = PenStroke(penColor, penWidth, mutableListOf(Offset(pos.x / w, pos.y / h)))
                                                },
                                                onDragEnd = {
                                                    live?.let { if (it.points.size > 1) strokes.add(it) }
                                                    live = null
                                                },
                                                onDragCancel = { live = null },
                                            ) { change, _ ->
                                                change.consume()
                                                val w = size.width.coerceAtLeast(1).toFloat()
                                                val h = size.height.coerceAtLeast(1).toFloat()
                                                val cur = live ?: return@detectDragGestures
                                                cur.points.add(Offset(change.position.x / w, change.position.y / h))
                                                // A fresh object so the canvas repaints the growing line.
                                                live = PenStroke(cur.color, cur.width, cur.points)
                                            }
                                        },
                                ) {
                                    (strokes + listOfNotNull(live)).forEach { st -> drawPen(st, size.width, size.height) }
                                }
                            } else {
                                StatusTrimPreview(pickedUri, start, end, paused = false, scrubAt = scrub)
                            }
                        }
                    }
                }
            }

            /* bottom: the pen's colours + widths (photo) or the trim strip (video), then Send */
            if (shot != null) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PEN_COLOURS.forEach { c ->
                        val on = penColor == c
                        Box(
                            Modifier
                                .size(if (on) 30.dp else 24.dp)
                                .clip(CircleShape)
                                .background(c)
                                .border(if (on) 2.5.dp else 1.dp, Color.White, CircleShape)
                                .clickable {
                                    haptics.tap()
                                    penColor = c
                                },
                        )
                    }
                    Spacer(Modifier.width(6.dp))
                    PEN_WIDTHS.forEach { w ->
                        val on = penWidth == w
                        Box(
                            Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .background(if (on) Color(0x55FFFFFF) else Color(0x22FFFFFF))
                                .clickable {
                                    haptics.tap()
                                    penWidth = w
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(Modifier.size((6 + w * 160).dp.coerceAtMost(20.dp)).clip(CircleShape).background(Color.White))
                        }
                    }
                }
            } else if (clip != null) {
                TrimStrip(
                    thumbs = thumbs,
                    durationMs = clip.durationMs,
                    start = start,
                    end = end,
                    maxMs = Long.MAX_VALUE,
                    onWindow = { s, e ->
                        start = s
                        end = e
                    },
                    onScrub = { scrub = it },
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
                            .clickable(enabled = !busy) {
                                haptics.confirm()
                                send()
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Send,
                            contentDescription = "Send",
                            tint = ActionBlueInk,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                }
            }
        }
    }
}

/** What the editor hands back to the chat (ScreenStore.pendingEdited). */
data class EditedResult(val convId: String, val viewOnce: Boolean, val media: EditedMedia)

sealed class EditedMedia {
    /** A drawn-on photo, as the same JPEG data URL the picker path produces. */
    data class Photo(val dataUrl: String) : EditedMedia()

    /** A trimmed clip in the cache — sent as a FILE like a picked video. */
    data class Video(val file: java.io.File, val mime: String) : EditedMedia()

    /** Nothing changed: the chat sends the original pick as it would have. */
    data class Untouched(val uri: Uri, val isVideo: Boolean) : EditedMedia()

    data class Failed(val message: String) : EditedMedia()
}

internal class PenStroke(val color: Color, val width: Float, val points: MutableList<Offset>)

private val PEN_COLOURS = listOf(Color(0xFFFFFFFF), Color(0xFFEF4444), Color(0xFFF59E0B), Color(0xFF22C55E), Color(0xFF3B82F6), Color(0xFF111111))

/** Stroke widths as a fraction of the picture's width (stage-independent). */
private val PEN_WIDTHS = listOf(0.006f, 0.012f, 0.024f)

private const val EDIT_STRIP_FRAMES = 10

private fun editClipLabel(start: Long, end: Long): String {
    val secs = ((end - start + 500L) / 1000L).coerceAtLeast(1L)
    return "%d:%02d".format(secs / 60, secs % 60)
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawPen(st: PenStroke, w: Float, h: Float) {
    if (st.points.size < 2) return
    val path = Path()
    st.points.forEachIndexed { i, p ->
        if (i == 0) path.moveTo(p.x * w, p.y * h) else path.lineTo(p.x * w, p.y * h)
    }
    drawPath(path, st.color, style = Stroke(width = st.width * w, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

/** Bakes the strokes into the picture at its own resolution → JPEG data URL
 *  inside the inline budget (the same shape FilesUtil.imageToDataUrl makes). */
internal fun bakePen(bmp: ImageBitmap, strokes: List<PenStroke>): String? =
    runCatching {
        val src = bmp.asAndroidBitmap()
        val picture = src.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = android.graphics.Canvas(picture)
        val paint =
            android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.STROKE
                strokeCap = android.graphics.Paint.Cap.ROUND
                strokeJoin = android.graphics.Paint.Join.ROUND
            }
        val w = picture.width.toFloat()
        val h = picture.height.toFloat()
        strokes.forEach { st ->
            if (st.points.size < 2) return@forEach
            paint.color = st.color.toArgb()
            paint.strokeWidth = st.width * w
            val path = android.graphics.Path()
            st.points.forEachIndexed { i, p ->
                if (i == 0) path.moveTo(p.x * w, p.y * h) else path.lineTo(p.x * w, p.y * h)
            }
            canvas.drawPath(path, paint)
        }
        var out = picture
        var scale = 1
        while (out.width / scale > 1440 || out.height / scale > 1440) scale *= 2
        if (scale > 1) out = Bitmap.createScaledBitmap(out, out.width / scale, out.height / scale, true)
        var quality = 90
        var bytes = ByteArray(0)
        while (true) {
            val buf = java.io.ByteArrayOutputStream()
            if (!out.compress(Bitmap.CompressFormat.JPEG, quality, buf)) break
            bytes = buf.toByteArray()
            if (bytes.size <= 380_000 * 3 / 4 || quality <= 45) break
            quality -= 5
        }
        if (bytes.isEmpty()) null else "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }.getOrNull()
