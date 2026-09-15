package app.kuchupuchu.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.RotateRight
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owner round 32 (item 19): the light editor behind the attach panel's Edit
 * — one picked PHOTO gets a pen (colours, undo, clear), one picked VIDEO gets
 * the trim strip. Send hands the result back to the open chat through
 * [ScreenStore.pendingEdited]; the chat sends it like any picked media.
 *
 * Owner round 34 (item 16b): the full WhatsApp-style editor, and a tap on a
 * lone attach-grid photo / video opens it straight here (AttachSheet). The
 * top bar is close · save · HD · rotate · sticker · text · pen; a swipe-up
 * strip carries the filters; the caption bar carries the + (stage this one
 * and pick more), the caption field and the view-once ① (the editor OWNS the
 * toggle now — the panel's switch only sets its starting side); the bottom
 * row is the recipient chip + the green send. A video keeps the trim strip +
 * clip download and shares the caption / view-once / chip / send half — pen,
 * text, stickers, filters and rotation are photo-only (they bake into the
 * JPEG; baking them into a clip needs a re-encode overlay pass).
 *
 * The photo path draws in the picture's own pixel space (strokes AND text /
 * sticker overlays are stored in normalised 0..1 units and rotate with the
 * picture), so what the user sees is exactly what is baked into the JPEG
 * whatever the stage size. HD bakes at up to 2560px / 1.2MB (standard stays
 * 1440px / ~285KB); an HD pick with no edits still bakes (that is the whole
 * point of the switch).
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
    // Owner round 33 (item 8): the preview's play position for the strip's playhead.
    var playAt by remember { mutableStateOf<Long?>(null) }
    var busy by remember { mutableStateOf(false) }
    val thumbs = remember { mutableStateListOf<ImageBitmap?>() }
    // Pen: strokes in normalised picture units; the live one is drawn as it grows.
    val strokes = remember { mutableStateListOf<PenStroke>() }
    var live by remember { mutableStateOf<PenStroke?>(null) }
    var penColor by remember { mutableStateOf(PEN_COLOURS[0]) }
    var penWidth by remember { mutableStateOf(PEN_WIDTHS[1]) }
    // Owner round 34 (item 16b): the full-editor state — the pen is a MODE now
    // (the stage is drag-to-move for overlays while it is off), the ① toggle
    // and the HD switch live here, overlays sit in normalised units.
    var penMode by remember { mutableStateOf(false) }
    var rotation by remember { mutableStateOf(0) }
    var filterIdx by remember { mutableStateOf(0) }
    val texts = remember { mutableStateListOf<EditText>() }
    val stickers = remember { mutableStateListOf<EditSticker>() }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var once by remember { mutableStateOf(viewOnce) }
    var hd by remember { mutableStateOf(false) }
    var caption by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf<String?>(null) }
    var showTextSheet by remember { mutableStateOf(false) }
    var showStickerSheet by remember { mutableStateOf(false) }
    var filtersOpen by remember { mutableStateOf(false) }
    var filterThumbs by remember { mutableStateOf<List<ImageBitmap?>>(emptyList()) }

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
            // HD-ready working copy (2560px): the bake caps decide the output
            // size, so one decode serves both the standard and the HD send.
            val bmp = withContext(Dispatchers.IO) {
                FilesUtil.imageToJpeg(pickedUri, ctx, maxSide = 2560, maxBytes = 2_000_000)?.let {
                    android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size)
                }
            }
            if (bmp == null) loadFailed = true else photo = bmp.asImageBitmap()
        }
    }

    val base = photo
    // The rotated working copy — overlays are stored against THIS orientation
    // (rotateTap transforms them), so the bake reads straight off it.
    val shot = remember(base, rotation) {
        if (base == null || rotation == 0) {
            base
        } else {
            runCatching { rotateEditBitmap(base.asAndroidBitmap(), rotation).asImageBitmap() }.getOrNull() ?: base
        }
    }
    val clip = source
    val ready = shot != null || clip != null
    val mediaAspect =
        when {
            shot != null -> shot.width.toFloat() / shot.height.coerceAtLeast(1)
            clip != null -> clip.displayW.toFloat() / clip.displayH.coerceAtLeast(1)
            else -> 9f / 16f
        }
    val filterMatrix = EDIT_FILTERS.getOrNull(filterIdx)?.matrix
    val previewFilter = remember(filterMatrix) {
        if (filterMatrix == null) null else ColorFilter.colorMatrix(ColorMatrix(filterMatrix.array))
    }
    // Filter thumbs follow the rotated copy (a 180° photo's strip matches it).
    LaunchedEffect(shot) {
        val bmp = shot?.asAndroidBitmap()
        if (bmp == null) {
            filterThumbs = emptyList()
            return@LaunchedEffect
        }
        filterThumbs = withContext(Dispatchers.IO) {
            EDIT_FILTERS.map { f ->
                runCatching {
                    val small =
                        Bitmap.createScaledBitmap(
                            bmp,
                            96,
                            (96f * bmp.height / bmp.width.coerceAtLeast(1)).toInt().coerceAtLeast(1),
                            true,
                        )
                    applyEditFilter(small, f.matrix).asImageBitmap()
                }.getOrNull()
            }
        }
    }
    // The transient notice ("Saved to gallery") clears itself.
    LaunchedEffect(notice) {
        if (notice != null) {
            delay(2500)
            notice = null
        }
    }

    /** The selected overlay's geometry for the ring, the delete mark and hit tests. */
    fun selectedOverlay(): EditSel? {
        val id = selectedId ?: return null
        texts.find { it.id == id }?.let { t ->
            val rx = (0.04f + 0.014f * t.text.length.coerceAtMost(16)) * t.scale
            return EditSel(id, t.center, rx, 0.05f * t.scale)
        }
        stickers.find { it.id == id }?.let { s -> return EditSel(id, s.center, 0.075f * s.scale, 0.075f * s.scale) }
        return null
    }

    /** Topmost overlay under the normalised point (stickers above texts). */
    fun hitOverlay(x: Float, y: Float): String? {
        for (i in stickers.indices.reversed()) {
            val s = stickers[i]
            val r = 0.075f * s.scale
            if (kotlin.math.abs(x - s.center.x) <= r && kotlin.math.abs(y - s.center.y) <= r) return s.id
        }
        for (i in texts.indices.reversed()) {
            val t = texts[i]
            val rx = (0.04f + 0.014f * t.text.length.coerceAtMost(16)) * t.scale
            val ry = 0.05f * t.scale
            if (kotlin.math.abs(x - t.center.x) <= rx && kotlin.math.abs(y - t.center.y) <= ry) return t.id
        }
        return null
    }

    fun moveOverlay(id: String, dx: Float, dy: Float) {
        val ti = texts.indexOfFirst { it.id == id }
        if (ti >= 0) {
            val t = texts[ti]
            val nx = (t.center.x + dx).coerceIn(0.02f, 0.98f)
            val ny = (t.center.y + dy).coerceIn(0.02f, 0.98f)
            texts[ti] = t.copy(center = Offset(nx, ny))
            return
        }
        val si = stickers.indexOfFirst { it.id == id }
        if (si >= 0) {
            val s = stickers[si]
            val nx = (s.center.x + dx).coerceIn(0.02f, 0.98f)
            val ny = (s.center.y + dy).coerceIn(0.02f, 0.98f)
            stickers[si] = s.copy(center = Offset(nx, ny))
        }
    }

    fun removeOverlay(id: String) {
        texts.removeAll { it.id == id }
        stickers.removeAll { it.id == id }
        if (selectedId == id) selectedId = null
    }

    /** Owner round 35 (item 8): pinch zoom — per-event clamped so one jumpy frame never flings the size. */
    fun scaleOverlay(id: String, factor: Float) {
        val f = factor.coerceIn(0.5f, 2f)
        val ti = texts.indexOfFirst { it.id == id }
        if (ti >= 0) {
            val t = texts[ti]
            texts[ti] = t.copy(scale = (t.scale * f).coerceIn(0.4f, 4f))
            return
        }
        val si = stickers.indexOfFirst { it.id == id }
        if (si >= 0) {
            val s = stickers[si]
            stickers[si] = s.copy(scale = (s.scale * f).coerceIn(0.4f, 4f))
        }
    }

    fun rotateTap() {
        haptics.tap()
        live = null
        rotation = (rotation + 1) % 4
        // Every overlay lives in normalised units, so a 90° clockwise turn
        // carries them all along: (x, y) -> (1 - y, x).
        for (i in strokes.indices) {
            val st = strokes[i]
            strokes[i] = PenStroke(st.color, st.width, st.points.map { rot90(it) }.toMutableList())
        }
        for (i in texts.indices) {
            val t = texts[i]
            texts[i] = t.copy(center = rot90(t.center))
        }
        for (i in stickers.indices) {
            val s = stickers[i]
            stickers[i] = s.copy(center = rot90(s.center))
        }
    }

    fun send() {
        if (busy) return
        busy = true
        val cap = caption.trim()
        val img = runCatching { shot?.asAndroidBitmap() }.getOrNull()
        val vSource = source
        val s = start
        val e = end
        val drawn = strokes.toList()
        val wrote = texts.toList()
        val placed = stickers.toList()
        val filt = filterMatrix
        val turn = rotation
        val hdShot = hd
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
                        // HD with no edits still bakes — the bigger file IS the edit.
                        val edited = drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() || filt != null || turn != 0 || hdShot
                        if (!edited) {
                            EditedMedia.Untouched(pickedUri, false)
                        } else {
                            EditedMedia.Photo(bakeFull(bmp, drawn, filt, wrote, placed, hdShot) ?: throw Exception("Could not save the drawing."))
                        }
                    }
                }.getOrElse { EditedMedia.Failed(it.message ?: "Could not edit that file.") }
            ScreenStore.pendingEdited.value = EditedResult(convId, once, result, cap)
        }
        nav.popBackStack()
    }

    /** The caption bar's + : stage this one (edits baked in) and pick more. */
    fun addMore() {
        if (busy) return
        busy = true
        haptics.tap()
        val cap = caption.trim()
        val img = runCatching { shot?.asAndroidBitmap() }.getOrNull()
        val vSource = source
        val s = start
        val e = end
        val drawn = strokes.toList()
        val wrote = texts.toList()
        val placed = stickers.toList()
        val filt = filterMatrix
        val turn = rotation
        val hdShot = hd
        val onceShot = once
        ScreenStore.appScope.launch {
            val item =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val whole = s <= 0L && e >= vSource.durationMs
                        if (whole) {
                            MediaItem(pickedUri, true, vSource.durationMs, "", System.currentTimeMillis() / 1000, cap)
                        } else {
                            val out = java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4")
                            try {
                                VideoExport.export(ctx, pickedUri, s, e, null, out)
                            } catch (_: Exception) {
                                out.delete()
                                VideoExport.passthrough(ctx, pickedUri, s, e, out)
                            }
                            val uri =
                                androidx.core.content.FileProvider.getUriForFile(
                                    ctx,
                                    "${ctx.packageName}.fileprovider",
                                    out,
                                )
                            MediaItem(uri, true, e - s, "Edits", System.currentTimeMillis() / 1000, cap)
                        }
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        val edited = drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() || filt != null || turn != 0 || hdShot
                        if (!edited) {
                            MediaItem(pickedUri, false, 0, "", System.currentTimeMillis() / 1000, cap)
                        } else {
                            val url = bakeFull(bmp, drawn, filt, wrote, placed, hdShot) ?: throw Exception("Could not save the drawing.")
                            val bytes = android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                            val f = java.io.File(ctx.cacheDir, "addmore_${System.currentTimeMillis()}.jpg")
                            f.writeBytes(bytes)
                            val uri =
                                androidx.core.content.FileProvider.getUriForFile(
                                    ctx,
                                    "${ctx.packageName}.fileprovider",
                                    f,
                                )
                            MediaItem(uri, false, 0, "Edits", System.currentTimeMillis() / 1000, cap, hdShot)
                        }
                    }
                }.getOrNull()
            withContext(Dispatchers.Main) {
                if (item == null) {
                    busy = false
                    haptics.reject()
                    notice = "Could not add that one."
                } else {
                    ScreenStore.pendingAddMore.value = AddMore(convId, item, onceShot)
                    nav.popBackStack()
                }
            }
        }
    }

    /** The top bar's download: the current state into the gallery. */
    fun saveCurrent() {
        if (busy) return
        busy = true
        haptics.tap()
        val img = runCatching { shot?.asAndroidBitmap() }.getOrNull()
        val vSource = source
        val s = start
        val e = end
        val drawn = strokes.toList()
        val wrote = texts.toList()
        val placed = stickers.toList()
        val filt = filterMatrix
        val hdShot = hd
        ScreenStore.appScope.launch {
            val ok =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val whole = s <= 0L && e >= vSource.durationMs
                        val f =
                            if (whole) {
                                FilesUtil.copyDocument(ctx, pickedUri, "video.mp4")?.second
                                    ?: throw Exception("Could not read that video.")
                            } else {
                                java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4").also { out ->
                                    try {
                                        VideoExport.export(ctx, pickedUri, s, e, null, out)
                                    } catch (_: Exception) {
                                        out.delete()
                                        VideoExport.passthrough(ctx, pickedUri, s, e, out)
                                    }
                                }
                            }
                        FilesUtil.saveVideo(ctx, f, "kuchupuchu_${System.currentTimeMillis()}.mp4") != null
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        val url = bakeFull(bmp, drawn, filt, wrote, placed, hdShot) ?: throw Exception("Could not save the drawing.")
                        val bytes = android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                        FilesUtil.saveImage(ctx, bytes, "kuchupuchu_${System.currentTimeMillis()}.jpg") != null
                    }
                }.getOrDefault(false)
            withContext(Dispatchers.Main) {
                busy = false
                if (ok) haptics.confirm() else haptics.reject()
                notice = if (ok) "Saved to gallery" else "Could not save that file."
            }
        }
    }

    /** One round top-bar tool (the pen lights up while its mode is armed). */
    @Composable
    fun ToolButton(active: Boolean = false, onClick: () -> Unit, glyph: @Composable () -> Unit) {
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(if (active) ActionBlue else Color.Transparent)
                .clickable {
                    haptics.tap()
                    onClick()
                },
            contentAlignment = Alignment.Center,
        ) {
            glyph()
        }
    }

    // Owner round 35 (item 8): soft scrims so the floating chrome reads over any photo.
    val topScrim = Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))
    val bottomScrim = Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000)))

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        // Owner round 35 (item 8): the photo owns the whole screen —
        // chrome floats OVER it on soft black scrims, nothing boxes it in.
        Box(Modifier.fillMaxSize()) {
            /* the stage, full-bleed: media max-fit at its own aspect; overlays + the pen layer over a photo */
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                when {
                    loadFailed -> Text("Could not open that file.", color = Color.White, fontSize = 14.sp)
                    !ready -> CircularProgressIndicator(color = ActionBlue)
                    else -> {
                        Box(Modifier.aspectRatio(mediaAspect.coerceIn(0.3f, 3.5f))) {
                            if (shot != null) {
                                Image(
                                    shot,
                                    contentDescription = "Photo",
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Fit,
                                    colorFilter = previewFilter,
                                )
                                Canvas(
                                    Modifier
                                        .fillMaxSize()
                                        .then(
                                            if (penMode) {
                                                Modifier.pointerInput(penColor, penWidth) {
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
                                                }
                                            } else {
                                                // Overlay mode, unified (owner round 35, item 8):
                                                // tap selects (the mark deletes), a one-finger
                                                // drag past the slop moves the grabbed overlay,
                                                // a two-finger pinch resizes it. One loop owns
                                                // the whole gesture, so select / move / pinch /
                                                // delete can never strand each other halfway.
                                                Modifier.pointerInput(texts.size, stickers.size) {
                                                    awaitEachGesture {
                                                        val w = size.width.coerceAtLeast(1).toFloat()
                                                        val h = size.height.coerceAtLeast(1).toFloat()
                                                        val d0 = awaitFirstDown()
                                                        val nx0 = d0.position.x / w
                                                        val ny0 = d0.position.y / h
                                                        selectedOverlay()?.let { sel ->
                                                            val dp = deletePos(sel)
                                                            if (kotlin.math.hypot(nx0 - dp.x, ny0 - dp.y) < DEL_MARK_HIT) {
                                                                haptics.tap()
                                                                removeOverlay(sel.id)
                                                                waitForUpOrCancellation()
                                                                return@awaitEachGesture
                                                            }
                                                        }
                                                        val hit = hitOverlay(nx0, ny0)
                                                        if (hit != null) {
                                                            haptics.tap()
                                                            selectedId = hit
                                                        }
                                                        // 0 undecided, 1 move, 2 pinch (pinch wins
                                                        // outright — lifting back to one finger
                                                        // ends the gesture instead of dragging).
                                                        var mode = 0
                                                        var moved = false
                                                        var prev = d0.position
                                                        var prevDist = 0f
                                                        var prevCent = Offset.Zero
                                                        val slopPx = viewConfiguration.touchSlop
                                                        while (true) {
                                                            val ev = awaitPointerEvent()
                                                            val pressed = ev.changes.filter { it.pressed }
                                                            if (pressed.isEmpty()) break
                                                            val target = hit ?: selectedId
                                                            if (pressed.size >= 2 && target != null) {
                                                                val a = pressed[0].position
                                                                val b = pressed[1].position
                                                                val dist = kotlin.math.hypot(a.x - b.x, a.y - b.y)
                                                                val cent = Offset((a.x + b.x) / 2f, (a.y + b.y) / 2f)
                                                                if (mode != 2) {
                                                                    mode = 2
                                                                    moved = true
                                                                    prevDist = dist
                                                                    prevCent = cent
                                                                } else {
                                                                    if (prevDist > 1f && dist > 1f) scaleOverlay(target, dist / prevDist)
                                                                    moveOverlay(target, (cent.x - prevCent.x) / w, (cent.y - prevCent.y) / h)
                                                                    prevDist = dist
                                                                    prevCent = cent
                                                                }
                                                                pressed.forEach { it.consume() }
                                                            } else if (pressed.size == 1 && mode != 2) {
                                                                val c = pressed[0]
                                                                if (mode == 0) {
                                                                    val ox = c.position.x - d0.position.x
                                                                    val oy = c.position.y - d0.position.y
                                                                    if (kotlin.math.hypot(ox, oy) > slopPx) {
                                                                        if (hit == null) break
                                                                        mode = 1
                                                                        moved = true
                                                                        prev = c.position
                                                                    }
                                                                }
                                                                if (mode == 1 && hit != null) {
                                                                    moveOverlay(hit, (c.position.x - prev.x) / w, (c.position.y - prev.y) / h)
                                                                    prev = c.position
                                                                }
                                                                c.consume()
                                                            }
                                                        }
                                                        if (!moved && hit == null) selectedId = null
                                                    }
                                                }
                                            },
                                        ),
                                ) {
                                    val ww = size.width
                                    val hh = size.height
                                    val native = drawContext.canvas.nativeCanvas
                                    stickers.forEach { st -> drawEditSticker(native, st, ww, hh) }
                                    texts.forEach { t -> drawEditText(native, t, ww, hh) }
                                    selectedOverlay()?.let { ov -> drawEditSelection(native, ov, ww, hh) }
                                    (strokes + listOfNotNull(live)).forEach { st -> drawPen(st, ww, hh) }
                                }
                            } else {
                                StatusTrimPreview(pickedUri, start, end, paused = false, scrubAt = scrub, onPosition = { playAt = it })
                            }
                        }
                    }
                }
                val note = notice
                if (note != null) {
                    Text(
                        note,
                        color = Color.White,
                        fontSize = 12.sp,
                        modifier = Modifier
                            .align(Alignment.Center)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color(0xCC000000))
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
            /* top bar: Close · (video) clip length · save / HD / rotate /
               sticker / text / pen (photo) · undo / clear while inked */
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(topScrim)
                    .statusBarsPadding()
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { nav.popBackStack() }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp))
                }
                if (clip != null) {
                    Text(editClipLabel(start, end), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(6.dp))
                }
                Spacer(Modifier.weight(1f))
                ToolButton(onClick = { saveCurrent() }) {
                    Icon(Icons.Filled.Download, "Save to gallery", tint = Color.White, modifier = Modifier.size(18.dp))
                }
                if (clip == null) {
                    // The HD pill: filled while the bigger send is armed.
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(if (hd) Color.White else Color.Transparent)
                            .border(1.5.dp, Color.White, RoundedCornerShape(7.dp))
                            .clickable {
                                haptics.toggle(!hd)
                                hd = !hd
                            }
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("HD", color = if (hd) Color.Black else Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.width(2.dp))
                    ToolButton(onClick = { rotateTap() }) {
                        Icon(Icons.Filled.RotateRight, "Rotate", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                    ToolButton(onClick = { showStickerSheet = true }) {
                        Icon(Icons.Filled.EmojiEmotions, "Stickers", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                    ToolButton(onClick = { showTextSheet = true }) {
                        Text("Aa", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    }
                    ToolButton(active = penMode, onClick = { penMode = !penMode }) {
                        Icon(Icons.Filled.Edit, "Draw", tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                }
                if (shot != null && strokes.isNotEmpty()) {
                    IconButton(
                        onClick = {
                            haptics.tap()
                            strokes.removeAt(strokes.size - 1)
                        },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Undo, "Undo", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    IconButton(
                        onClick = {
                            haptics.tap()
                            strokes.clear()
                        },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(Icons.Filled.Delete, "Clear", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                }
            }

            // Owner round 35 (item 8): filters + pen/trim + caption ride one
            // floating cluster over the photo, on a single soft scrim.
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .background(bottomScrim)
                    .fillMaxWidth(),
            ) {
                /* swipe-up filters (photo only): the hint row + the thumb strip */
                if (shot != null) {
                    var swipeTotal by remember { mutableStateOf(0f) }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { filtersOpen = !filtersOpen }
                            .pointerInput(Unit) {
                                detectVerticalDragGestures(
                                    onDragStart = { swipeTotal = 0f },
                                    onVerticalDrag = { _, amount -> swipeTotal += amount },
                                    onDragEnd = {
                                        if (swipeTotal < -30f) filtersOpen = true
                                        else if (swipeTotal > 30f) filtersOpen = false
                                    },
                                )
                            }
                            .padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (filtersOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                            if (filtersOpen) "Hide filters" else "Show filters",
                            tint = Color(0xFF9AA4B2),
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text("Swipe up for filters", color = Color(0xFF9AA4B2), fontSize = 12.sp)
                    }
                    if (filtersOpen) {
                        LazyRow(
                            Modifier.fillMaxWidth().padding(bottom = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            items(EDIT_FILTERS.size) { i ->
                                val on = filterIdx == i
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Box(
                                        Modifier
                                            .size(48.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(Color(0xFF232A33))
                                            .border(if (on) 2.5.dp else 0.dp, Color.White, RoundedCornerShape(10.dp))
                                            .clickable {
                                                haptics.tap()
                                                filterIdx = i
                                            },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        val thumb = filterThumbs.getOrNull(i)
                                        if (thumb != null) {
                                            Image(thumb, EDIT_FILTERS[i].name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                        }
                                    }
                                    Spacer(Modifier.height(2.dp))
                                    Text(
                                        EDIT_FILTERS[i].name,
                                        color = if (on) Color.White else Color(0xFF9AA4B2),
                                        fontSize = 11.sp,
                                        fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                                    )
                                }
                            }
                        }
                    }
                }

                /* bottom: the pen's colours + widths (photo, pen mode) or the trim strip (video) */
                if (shot != null && penMode) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PEN_COLOURS.forEach { c ->
                            val on = penColor == c
                            Box(
                                Modifier
                                    .size(if (on) 26.dp else 22.dp)
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
                                    .size(26.dp)
                                    .clip(CircleShape)
                                    .background(if (on) Color(0x55FFFFFF) else Color(0x22FFFFFF))
                                    .clickable {
                                        haptics.tap()
                                        penWidth = w
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(Modifier.size((6 + w * 160).dp.coerceAtMost(16.dp)).clip(CircleShape).background(Color.White))
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
                        positionMs = playAt,
                    )
                }
                /* the caption bar + recipient chip / send ride above the keyboard */
                Column(Modifier.imePadding()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(Color(0xFF232A33))
                            .padding(start = 2.dp, end = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { addMore() }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Filled.AddPhotoAlternate, "Add more", tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        BasicTextField(
                            value = caption,
                            onValueChange = { if (it.length <= 1000) caption = it },
                            singleLine = true,
                            textStyle = TextStyle(color = Color.White, fontSize = 14.sp),
                            cursorBrush = SolidColor(Color.White),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                Box {
                                    if (caption.isEmpty()) Text("Add a caption...", color = Color(0xFF9AA4B2), fontSize = 14.sp)
                                    inner()
                                }
                            },
                        )
                        // Owner round 35 (item 8): the ① sits in a real seat —
                        // a ring button that fills blue while once is armed.
                        // (Placement follows the owner's screenshot when it lands.)
                        Box(
                            Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .background(if (once) ActionBlue else Color.Transparent)
                                .border(1.dp, if (once) ActionBlue else Color(0x66FFFFFF), CircleShape)
                                .clickable {
                                    haptics.toggle(!once)
                                    once = !once
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            ViewOnceOneIcon(20.dp, tint = if (once) Color.White else Color(0xB3FFFFFF))
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(16.dp))
                                .background(Color(0xFF232A33))
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Filled.Person, "To", tint = Color.White, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                ScreenStore.editTitle.ifBlank { "Chat" },
                                color = Color.White,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        if (ready) {
                            // Owner round 35 (item 8): the send is a small BLUE dot.
                            Box(
                                Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(ActionBlue)
                                    .clickable(enabled = !busy) {
                                        haptics.confirm()
                                        send()
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (busy) {
                                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(20.dp))
                                } else {
                                    Icon(
                                        Icons.AutoMirrored.Filled.Send,
                                        contentDescription = "Send",
                                        tint = Color.White,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /* text overlay sheet: the words + their colour */
    if (showTextSheet) {
        KpSheet(onDismiss = { showTextSheet = false }, title = "Add text") {
            var draft by remember { mutableStateOf("") }
            var ink by remember { mutableStateOf(PEN_COLOURS[0]) }
            BasicTextField(
                value = draft,
                onValueChange = { if (it.length <= 120) draft = it },
                textStyle = TextStyle(color = Ink, fontSize = 17.sp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                decorationBox = { inner ->
                    Box {
                        if (draft.isEmpty()) Text("Type something", color = Muted, fontSize = 17.sp)
                        inner()
                    }
                },
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PEN_COLOURS.forEach { c ->
                    val on = ink == c
                    Box(
                        Modifier
                            .size(if (on) 30.dp else 24.dp)
                            .clip(CircleShape)
                            .background(c)
                            .border(if (on) 2.5.dp else 1.dp, if (on) ActionBlueDeep else Muted, CircleShape)
                            .clickable {
                                haptics.tap()
                                ink = c
                            },
                    )
                }
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.End) {
                Text(
                    "Add",
                    color = ActionBlueDeep,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            if (draft.isBlank()) return@clickable
                            haptics.confirm()
                            val t = EditText(newOverlayId(), Offset(0.5f, 0.38f), draft.trim(), ink)
                            texts.add(t)
                            selectedId = t.id
                            showTextSheet = false
                        }
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                )
            }
        }
    }

    /* sticker sheet: the app's packs + search, tap one to place it */
    if (showStickerSheet) {
        KpSheet(onDismiss = { showStickerSheet = false }, title = "Stickers") {
            var query by remember { mutableStateOf("") }
            var pack by remember { mutableStateOf(0) }
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(color = Ink, fontSize = 14.sp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) Text("Search stickers", color = Muted.copy(alpha = 0.7f), fontSize = 14.sp)
                        inner()
                    }
                },
            )
            LazyRow(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(Stickers.packs.size) { i ->
                    val on = pack == i && query.isBlank()
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (on) ChipSelected else ChipIdle)
                            .clickable {
                                haptics.tap()
                                pack = i
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    ) {
                        Text(
                            Stickers.packs[i].first,
                            color = if (on) ActionBlueDeep else Muted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
            val q = query.trim()
            val list =
                if (q.isBlank()) {
                    Stickers.packs[pack.coerceIn(0, Stickers.packs.size - 1)].second
                } else {
                    Stickers.packs.asSequence().flatMap { it.second }.filter { it.contains(q) }.distinct().take(60).toList()
                }
            LazyVerticalGrid(
                columns = GridCells.Fixed(6),
                modifier = Modifier.fillMaxWidth().height(300.dp).padding(horizontal = 8.dp),
            ) {
                items(list.size) { i ->
                    Box(
                        Modifier
                            .size(46.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable {
                                haptics.confirm()
                                val s = EditSticker(newOverlayId(), Offset(0.5f, 0.5f), list[i])
                                stickers.add(s)
                                selectedId = s.id
                                showStickerSheet = false
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(list[i], fontSize = 24.sp)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** What the editor hands back to the chat (ScreenStore.pendingEdited). */
data class EditedResult(val convId: String, val viewOnce: Boolean, val media: EditedMedia, val caption: String = "")

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

/** A placed text overlay: normalised centre, the words, their colour, pinch size. */
internal data class EditText(val id: String, val center: Offset, val text: String, val color: Color, val scale: Float = 1f)

/** A placed sticker: normalised centre + the pack glyph + pinch size. */
internal data class EditSticker(val id: String, val center: Offset, val glyph: String, val scale: Float = 1f)

/** The selected overlay's hit geometry (normalised units). */
private data class EditSel(val id: String, val center: Offset, val rx: Float, val ry: Float)

/** The delete mark floats just above the selection. */
private fun deletePos(sel: EditSel): Offset = Offset(sel.center.x, (sel.center.y - sel.ry - 0.045f).coerceAtLeast(0.03f))

/** Owner round 35 (item 8): the delete mark's normalised hit radius. */
private const val DEL_MARK_HIT = 0.04f

private fun newOverlayId(): String = java.util.UUID.randomUUID().toString().take(8)

/** One 90° clockwise turn in normalised units: (x, y) -> (1 - y, x). */
private fun rot90(p: Offset): Offset = Offset(1f - p.y, p.x)

private val PEN_COLOURS = listOf(Color(0xFFFFFFFF), Color(0xFFEF4444), Color(0xFFF59E0B), Color(0xFF22C55E), Color(0xFF3B82F6), Color(0xFF111111))

/** Stroke widths as a fraction of the picture's width (stage-independent). */
private val PEN_WIDTHS = listOf(0.006f, 0.012f, 0.024f)

private const val EDIT_STRIP_FRAMES = 10

/** HD JPEG budget (~1.2MB — the data URL runs ~1.6M chars). */
private const val HD_JPEG_BUDGET = 1_200_000

/** One swipe-up filter: the preview thumb + bake share the same matrix. */
private data class EditFilter(val name: String, val matrix: android.graphics.ColorMatrix?)

private val EDIT_FILTERS = listOf(
    EditFilter("Normal", null),
    EditFilter("Mono", android.graphics.ColorMatrix().apply { setSaturation(0f) }),
    EditFilter(
        "Sepia",
        android.graphics.ColorMatrix(
            floatArrayOf(
                0.393f, 0.769f, 0.189f, 0f, 0f,
                0.349f, 0.686f, 0.168f, 0f, 0f,
                0.272f, 0.534f, 0.131f, 0f, 0f,
                0f, 0f, 0f, 1f, 0f,
            ),
        ),
    ),
    EditFilter(
        "Warm",
        android.graphics.ColorMatrix(
            floatArrayOf(
                1.15f, 0f, 0f, 0f, 0f,
                0f, 1.0f, 0f, 0f, 0f,
                0f, 0f, 0.85f, 0f, 0f,
                0f, 0f, 0f, 1f, 0f,
            ),
        ),
    ),
    EditFilter(
        "Cool",
        android.graphics.ColorMatrix(
            floatArrayOf(
                0.9f, 0f, 0f, 0f, 0f,
                0f, 1.0f, 0f, 0f, 0f,
                0f, 0f, 1.15f, 0f, 0f,
                0f, 0f, 0f, 1f, 0f,
            ),
        ),
    ),
    EditFilter("Vivid", android.graphics.ColorMatrix().apply { setSaturation(1.6f) }),
)

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

/** The text overlay, drawn identically in the preview and the bake. */
private fun drawEditText(native: android.graphics.Canvas, t: EditText, w: Float, h: Float) {
    val size = w * 0.06f * t.scale
    val paint =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = t.color.toArgb()
            textSize = size
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            textAlign = android.graphics.Paint.Align.CENTER
            setShadowLayer(size * 0.08f, 0f, size * 0.04f, 0xCC000000.toInt())
        }
    native.drawText(t.text, t.center.x * w, t.center.y * h + size * 0.35f, paint)
}

/** The sticker glyph, drawn identically in the preview and the bake. */
private fun drawEditSticker(native: android.graphics.Canvas, s: EditSticker, w: Float, h: Float) {
    val size = w * 0.11f * s.scale
    val paint =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textSize = size
            textAlign = android.graphics.Paint.Align.CENTER
            setShadowLayer(size * 0.06f, 0f, size * 0.03f, 0x88000000.toInt())
        }
    native.drawText(s.glyph, s.center.x * w, s.center.y * h + size * 0.35f, paint)
}

/** Preview-only: the selection ring + the delete mark above it. */
private fun drawEditSelection(native: android.graphics.Canvas, sel: EditSel, w: Float, h: Float) {
    val ring =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = android.graphics.Paint.Style.STROKE
            strokeWidth = 3f
        }
    val reach = (sel.rx * w).coerceAtLeast(sel.ry * h) * 0.62f + 10f
    native.drawCircle(sel.center.x * w, sel.center.y * h, reach, ring)
    val dp = deletePos(sel)
    val dx = dp.x * w
    val dy = dp.y * h
    val fill =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = android.graphics.Paint.Style.FILL
        }
    native.drawCircle(dx, dy, 32f, fill)
    val cross =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.BLACK
            style = android.graphics.Paint.Style.STROKE
            strokeWidth = 5f
            strokeCap = android.graphics.Paint.Cap.ROUND
        }
    native.drawLine(dx - 11f, dy - 11f, dx + 11f, dy + 11f, cross)
    native.drawLine(dx - 11f, dy + 11f, dx + 11f, dy - 11f, cross)
}

/** Runs the working copy through the filter (a no-op for Normal). */
private fun applyEditFilter(src: Bitmap, matrix: android.graphics.ColorMatrix?): Bitmap {
    if (matrix == null) return src
    val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(out)
    val paint =
        android.graphics.Paint().apply {
            colorFilter = android.graphics.ColorMatrixColorFilter(matrix)
        }
    canvas.drawBitmap(src, 0f, 0f, paint)
    return out
}

private fun rotateEditBitmap(src: Bitmap, rotation: Int): Bitmap {
    val matrix = android.graphics.Matrix().apply { postRotate(90f * (rotation % 4)) }
    return Bitmap.createBitmap(src, 0, 0, src.width, src.height, matrix, true)
}

/**
 * Bakes filter + stickers + texts + pen into the picture at its own
 * resolution → JPEG data URL (standard ≤380K chars, HD ≤1.6M).
 */
internal fun bakeFull(
    base: Bitmap,
    strokes: List<PenStroke>,
    filter: android.graphics.ColorMatrix?,
    texts: List<EditText>,
    stickers: List<EditSticker>,
    hd: Boolean,
): String? =
    runCatching {
        val picture = applyEditFilter(base, filter).copy(Bitmap.Config.ARGB_8888, true)
        val canvas = android.graphics.Canvas(picture)
        val w = picture.width.toFloat()
        val h = picture.height.toFloat()
        stickers.forEach { st -> drawEditSticker(canvas, st, w, h) }
        texts.forEach { t -> drawEditText(canvas, t, w, h) }
        val paint =
            android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                style = android.graphics.Paint.Style.STROKE
                strokeCap = android.graphics.Paint.Cap.ROUND
                strokeJoin = android.graphics.Paint.Join.ROUND
            }
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
        val maxSide = if (hd) 2560 else 1440
        while (out.width / scale > maxSide || out.height / scale > maxSide) scale *= 2
        if (scale > 1) out = Bitmap.createScaledBitmap(out, out.width / scale, out.height / scale, true)
        var quality = 90
        var bytes = ByteArray(0)
        val budget = if (hd) HD_JPEG_BUDGET else 380_000 * 3 / 4
        val minQuality = if (hd) 60 else 45
        while (true) {
            val buf = java.io.ByteArrayOutputStream()
            if (!out.compress(Bitmap.CompressFormat.JPEG, quality, buf)) break
            bytes = buf.toByteArray()
            if (bytes.size <= budget || quality <= minQuality) break
            quality -= 5
        }
        if (bytes.isEmpty()) null else "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
    }.getOrNull()

/** The plain-pen bake (round 32 shape): no filter, no overlays, standard budget. */
internal fun bakePen(bmp: ImageBitmap, strokes: List<PenStroke>): String? =
    bakeFull(bmp.asAndroidBitmap(), strokes, null, emptyList(), emptyList(), false)
