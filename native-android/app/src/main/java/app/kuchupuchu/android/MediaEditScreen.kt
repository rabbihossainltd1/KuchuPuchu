package app.kuchupuchu.android

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.BackHandler
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Crop
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
import androidx.compose.runtime.key
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
import androidx.compose.ui.input.pointer.PointerEventPass
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
import org.json.JSONObject

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
 * row is the recipient chip + the blue send. A video keeps the trim strip +
 * clip download and shares the caption / view-once / chip / send half; pen,
 * text, stickers, filters, rotation AND crop ride video too (the overlay
 * bakes at the export's own output size, the filter rides the GL shader,
 * turns + crop ride the frame map).
 *
 * Owner round 37 (item 2): status lands straight here (convId "status") —
 * no caption / once / add-more / HD, Done posts the status from this one
 * screen. The crop tool (photo + video) opens the box over the FULL frame;
 * photo overlays commit into cropped coords on exit, video overlays remap
 * at bake time — the stage always shows what the bake keeps.
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
    // Owner round 45 (item 7): an attach pencil trip stages the panel's
    // pool (ScreenStore.editPool) — swiping left/right browses the other
    // photos right here instead of backing out. Single opens (viewer,
    // status, camera) skip the pool untouched. The stage dies with the
    // screen, so a stale pool can never leak into a later open.
    val pool = ScreenStore.editPool
    DisposableEffect(Unit) { onDispose { ScreenStore.editPool = emptyList() } }
    if (pool.size < 2) {
        MediaEditItemScreen(nav, pickedUri, pickedIsVideo, convId, viewOnce, null, null, null)
        return
    }
    var idx by remember {
        mutableStateOf(pool.indexOfFirst { it.uri == pickedUri }.takeIf { it >= 0 } ?: 0)
    }
    // Every photo visited keeps its edits — the item screen snapshots its
    // EditBits on leave (kilobytes; bitmaps are re-decoded on return).
    val works = remember { HashMap<String, EditBits>() }
    val item = pool[idx]
    val uriKey = item.uri.toString()
    key(uriKey) {
        MediaEditItemScreen(
            nav,
            item.uri,
            item.isVideo,
            convId,
            viewOnce,
            works[uriKey],
            { bits -> works[uriKey] = bits },
            { d -> idx = (idx + d).coerceIn(0, pool.lastIndex) },
        )
    }
}

/** Snapshotted per-photo edit state while browsing (owner round 45, item 7). */
private class EditBits(
    val rotation: Int,
    val filterIdx: Int,
    val cropBox: CropBox?,
    val cropDraft: CropBox,
    val cropTouched: Boolean,
    val cropPreset: String,
    val caption: String,
    val once: Boolean,
    val hd: Boolean,
    val startMs: Long,
    val endMs: Long,
    val strokes: List<PenStroke>,
    val texts: List<EditText>,
    val stickers: List<EditSticker>,
)

@Composable
private fun MediaEditItemScreen(
    nav: NavController,
    pickedUri: Uri,
    pickedIsVideo: Boolean,
    convId: String,
    viewOnce: Boolean,
    bits: EditBits?,
    onBits: ((EditBits) -> Unit)?,
    onBrowse: ((Int) -> Unit)?,
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()

    val window = MainActivity.current?.window
    DisposableEffect(Unit) {
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
        val prev = controller?.isAppearanceLightStatusBars
        controller?.isAppearanceLightStatusBars = false
        // Owner round 39 (item 6): backing out of a pencil trip must not
        // poison the next edit — the stage flag dies with the screen.
        onDispose {
            controller?.isAppearanceLightStatusBars = prev ?: true
            ScreenStore.editStageUri = null
        }
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
    val strokes = remember { mutableStateListOf<PenStroke>().also { l -> bits?.let { l.addAll(it.strokes) } } }
    var live by remember { mutableStateOf<PenStroke?>(null) }
    var penColor by remember { mutableStateOf(PEN_COLOURS[0]) }
    var penWidth by remember { mutableStateOf(PEN_WIDTHS[1]) }
    // Owner round 34 (item 16b): the full-editor state — the pen is a MODE now
    // (the stage is drag-to-move for overlays while it is off), the ① toggle
    // and the HD switch live here, overlays sit in normalised units.
    var penMode by remember { mutableStateOf(false) }
    var rotation by remember { mutableStateOf(bits?.rotation ?: 0) }
    var filterIdx by remember { mutableStateOf(bits?.filterIdx ?: 0) }
    val texts = remember { mutableStateListOf<EditText>().also { l -> bits?.let { l.addAll(it.texts) } } }
    val stickers = remember { mutableStateListOf<EditSticker>().also { l -> bits?.let { l.addAll(it.stickers) } } }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var once by remember { mutableStateOf(bits?.once ?: viewOnce) }
    var hd by remember { mutableStateOf(bits?.hd ?: false) }
    var caption by remember { mutableStateOf(bits?.caption ?: "") }
    var notice by remember { mutableStateOf<String?>(null) }
    var showTextSheet by remember { mutableStateOf(false) }
    var showStickerSheet by remember { mutableStateOf(false) }
    var filtersOpen by remember { mutableStateOf(false) }
    var filterThumbs by remember { mutableStateOf<List<ImageBitmap?>>(emptyList()) }
    // Owner round 36 (item 6): the video still-mode frame (exact export
    // pixels for the playhead — turns + filter baked in, see below).
    var videoStill by remember { mutableStateOf<ImageBitmap?>(null) }
    // Owner round 37 (item 2): the status share screen is GONE — the
    // picker lands straight here, and Done posts the status. No caption
    // (status posts carry none), no once, no add-more, no HD.
    val statusMode = convId == "status"
    // Owner round 37 (item 2): the crop tool (photo + video, chat + status).
    // cropBox commits into normalised full-frame coords; while the box is
    // open the stage shows the FULL frame and the draft rides above it.
    var cropping by remember { mutableStateOf(false) }
    var cropBox by remember { mutableStateOf<CropBox?>(bits?.cropBox) }
    var cropDraft by remember { mutableStateOf(bits?.cropDraft ?: CropBox.FULL) }
    var cropTouched by remember { mutableStateOf(bits?.cropTouched ?: false) }
    var cropPreset by remember { mutableStateOf(bits?.cropPreset ?: "Original") }
    // Owner round 45 (item 7): snapshot this photo's work for the browse back.
    DisposableEffect(Unit) {
        onDispose {
            onBits?.invoke(
                EditBits(
                    rotation = rotation,
                    filterIdx = filterIdx,
                    cropBox = cropBox,
                    cropDraft = cropDraft,
                    cropTouched = cropTouched,
                    cropPreset = cropPreset,
                    caption = caption,
                    once = once,
                    hd = hd,
                    startMs = start,
                    endMs = end,
                    strokes = strokes.toList(),
                    texts = texts.toList(),
                    stickers = stickers.toList(),
                ),
            )
        }
    }

    LaunchedEffect(pickedUri) {
        if (pickedIsVideo) {
            val src = withContext(Dispatchers.IO) { VideoExport.probe(ctx, pickedUri) }
            if (src == null) {
                loadFailed = true
                return@LaunchedEffect
            }
            // Owner round 45 (item 7): a browsed-back clip keeps its trim.
            if (bits != null) {
                start = bits.startMs
                end = bits.endMs
            } else if (statusMode) {
            // A chat video keeps its whole length; a status clip preselects
            // the first minute (the status rule, inherited from the share screen).
                val (s, e) = VideoPlan.defaultWindow(src.durationMs)
                start = s
                end = e
            } else {
                start = 0L
                end = src.durationMs
            }
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
    // The full rotated working copy — the crop box is drawn over THIS, and
    // photo overlays hop back into these coords while the box is open.
    val shotFull = remember(base, rotation) {
        if (base == null || rotation == 0) {
            base
        } else {
            runCatching { rotateEditBitmap(base.asAndroidBitmap(), rotation).asImageBitmap() }.getOrNull() ?: base
        }
    }
    // The cropped working copy — photo overlays commit into these coords
    // when the box closes, so the stage + the bake read straight off it.
    val shot = remember(shotFull, cropBox) {
        val full = shotFull
        val box = cropBox?.takeIf { !it.isFull() }
        if (full == null || box == null) {
            full
        } else {
            runCatching {
                val src = full.asAndroidBitmap()
                val x = (box.x * src.width).toInt().coerceIn(0, src.width - 1)
                val y = (box.y * src.height).toInt().coerceIn(0, src.height - 1)
                val w = (box.w * src.width).toInt().coerceIn(1, src.width - x)
                val h = (box.h * src.height).toInt().coerceIn(1, src.height - y)
                Bitmap.createBitmap(src, x, y, w, h).asImageBitmap()
            }.getOrNull() ?: full
        }
    }
    val clip = source
    val ready = shot != null || clip != null
    val aspectShot = if (cropping) shotFull else shot
    // Full-frame aspect while the box is open, so the box maths (normalised
    // units) and the on-screen pixels agree without any extra measuring.
    val cropFullAspect =
        when {
            shotFull != null -> shotFull.width.toFloat() / shotFull.height.coerceAtLeast(1)
            clip != null -> clip.displayW.toFloat() / clip.displayH.coerceAtLeast(1)
            else -> 9f / 16f
        }
    val mediaAspect =
        when {
            aspectShot != null -> aspectShot.width.toFloat() / aspectShot.height.coerceAtLeast(1)
            clip != null ->
                run {
                    // Owner round 36 (item 6): user turns swap the frame.
                    val w = clip.displayW.toFloat()
                    val h = clip.displayH.toFloat()
                    if (rotation % 2 == 1) h / w.coerceAtLeast(1f) else w / h.coerceAtLeast(1f)
                }
            else -> 9f / 16f
        }
    val filterMatrix = EDIT_FILTERS.getOrNull(filterIdx)?.matrix
    val previewFilter = remember(filterMatrix) {
        if (filterMatrix == null) null else ColorFilter.colorMatrix(ColorMatrix(filterMatrix.array))
    }
    // Filter thumbs follow the rotated copy (a 180° photo's strip matches it).
    // Owner round 36 (item 6): video thumbs come from the mid-frame.
    LaunchedEffect(shot, clip) {
        if (shot == null && clip == null) {
            filterThumbs = emptyList()
            return@LaunchedEffect
        }
        val bmp =
            shot?.asAndroidBitmap() ?: withContext(Dispatchers.IO) {
                grabVideoFrame(ctx, pickedUri, (clip?.durationMs ?: 0L) / 2)
            }
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
    // Owner round 36 (item 6): turns / filters freeze the clip into a
    // WYSIWYG still — the playhead (or scrub target) rotated + filtered
    // exactly like the export. The player hides underneath, so no
    // tick-churn: this only re-grabs when the frame, turns or filter change.
    val stillMode = clip != null && (rotation != 0 || filterMatrix != null)
    LaunchedEffect(pickedUri, rotation, filterIdx, scrub, stillMode, cropBox) {
        if (!stillMode || clip == null) {
            videoStill = null
            return@LaunchedEffect
        }
        // A scrub lands the playhead first; grab where it settles.
        if (scrub != null) delay(150)
        val atMs = (scrub ?: playAt ?: start).coerceAtLeast(0L)
        val turn = rotation
        val filt = filterMatrix
        videoStill =
            withContext(Dispatchers.IO) {
                val frame = grabVideoFrame(ctx, pickedUri, atMs) ?: return@withContext null
                val turned = if (turn != 0) rotateEditBitmap(frame, turn) else frame
                val box = cropBox?.takeIf { !it.isFull() }
                val cropped =
                    if (box == null) turned
                    else {
                        val x = (box.x * turned.width).toInt().coerceIn(0, turned.width - 1)
                        val y = (box.y * turned.height).toInt().coerceIn(0, turned.height - 1)
                        val w = (box.w * turned.width).toInt().coerceIn(1, turned.width - x)
                        val h = (box.h * turned.height).toInt().coerceIn(1, turned.height - y)
                        Bitmap.createBitmap(turned, x, y, w, h)
                    }
                applyEditFilter(cropped, filt).asImageBitmap()
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
            return EditSel(id, t.center, rx, 0.05f * t.scale, t.rotation)
        }
        stickers.find { it.id == id }?.let { s -> return EditSel(id, s.center, 0.075f * s.scale, 0.075f * s.scale, s.rotation) }
        return null
    }

    /** Topmost overlay under the point (stickers above texts) — the touch
     *  is un-turned into each overlay's own frame, so turned overlays tap right. */
    fun hitOverlay(x: Float, y: Float, w: Float, h: Float): String? {
        for (i in stickers.indices.reversed()) {
            val s = stickers[i]
            val r = 0.075f * s.scale
            if (inOverlay(x, y, s.center, r, r, s.rotation, w, h)) return s.id
        }
        for (i in texts.indices.reversed()) {
            val t = texts[i]
            val rx = (0.04f + 0.014f * t.text.length.coerceAtMost(16)) * t.scale
            if (inOverlay(x, y, t.center, rx, 0.05f * t.scale, t.rotation, w, h)) return t.id
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

    // Owner round 36 (item 3): overlay undo — one snapshot per finished
    // gesture / add / remove, never per move event (a drag would flood it).
    val overlayPast = remember { mutableStateListOf<Pair<List<EditText>, List<EditSticker>>>() }
    fun pushOverlayPast() {
        overlayPast.add(texts.toList() to stickers.toList())
        if (overlayPast.size > 50) overlayPast.removeAt(0)
    }
    fun undoOverlay() {
        val last = overlayPast.removeLastOrNull() ?: return
        texts.clear()
        texts.addAll(last.first)
        stickers.clear()
        stickers.addAll(last.second)
        if (selectedId != null && texts.none { it.id == selectedId } && stickers.none { it.id == selectedId }) selectedId = null
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

    /** Reference-style rotate handle: drag around the centre, live degrees. */
    fun rotateOverlay(id: String, delta: Float) {
        val ti = texts.indexOfFirst { it.id == id }
        if (ti >= 0) {
            val t = texts[ti]
            texts[ti] = t.copy(rotation = (t.rotation + delta) % 360f)
            return
        }
        val si = stickers.indexOfFirst { it.id == id }
        if (si >= 0) {
            val s = stickers[si]
            stickers[si] = s.copy(rotation = (s.rotation + delta) % 360f)
        }
    }

    /** One normalised point between box coords and full-frame coords. */
    fun cropMap(p: Offset, from: CropBox?, to: CropBox?): Offset {
        val f = from?.takeIf { !it.isFull() }
        val t = to?.takeIf { !it.isFull() }
        val fx = if (f == null) p.x else f.x + p.x * f.w
        val fy = if (f == null) p.y else f.y + p.y * f.h
        if (t == null) return Offset(fx, fy)
        return Offset((fx - t.x) / t.w.coerceAtLeast(1e-6f), (fy - t.y) / t.h.coerceAtLeast(1e-6f))
    }

    /** Photo overlays hop boxes (strokes + texts + stickers, same carry as rotate). */
    fun remapOverlaysForCrop(from: CropBox?, to: CropBox?) {
        for (i in strokes.indices) {
            val st = strokes[i]
            strokes[i] = PenStroke(st.color, st.width, st.points.map { cropMap(it, from, to) }.toMutableList())
        }
        for (i in texts.indices) {
            val t = texts[i]
            texts[i] = t.copy(center = cropMap(t.center, from, to))
        }
        for (i in stickers.indices) {
            val s = stickers[i]
            stickers[i] = s.copy(center = cropMap(s.center, from, to))
        }
    }

    fun applyCropPreset(name: String) {
        haptics.tap()
        cropPreset = name
        cropDraft =
            when (name) {
                "9:16" -> CropBox.centered(9f / 16f, cropFullAspect)
                "1:1" -> CropBox.centered(1f, cropFullAspect)
                "Free" -> cropDraft
                else -> CropBox.FULL
            }
        cropTouched = true
    }

    fun enterCrop() {
        if (cropping || !ready) return
        penMode = false
        live = null
        selectedId = null
        filtersOpen = false
        val box = cropBox?.takeIf { !it.isFull() }
        if (box == null) {
            cropPreset = "Free"
            cropDraft = CropBox(0.08f, 0.08f, 0.84f, 0.84f)
        } else {
            cropDraft = box
        }
        cropTouched = false
        // Photo overlays commit into cropped coords — hop them back to full
        // so they sit right on the full frame while the box is open. (Video
        // overlays always live full-frame; the bake remaps them instead.)
        if (shotFull != null) remapOverlaysForCrop(cropBox, null)
        cropping = true
    }

    fun exitCrop() {
        if (!cropping) return
        if (cropTouched) {
            val draft = cropDraft.takeIf { !it.isFull() }
            if (shotFull != null) remapOverlaysForCrop(null, draft)
            cropBox = draft
            if (draft == null) cropPreset = "Original"
        } else {
            if (shotFull != null) remapOverlaysForCrop(null, cropBox)
        }
        cropping = false
    }
    BackHandler(enabled = cropping) { exitCrop() }

    fun rotateTap() {
        exitCrop()
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
            texts[i] = t.copy(center = rot90(t.center), rotation = (t.rotation + 90f) % 360f)
        }
        for (i in stickers.indices) {
            val s = stickers[i]
            stickers[i] = s.copy(center = rot90(s.center), rotation = (s.rotation + 90f) % 360f)
        }
    }


    /** Status mode's Done: the bake + the upload happen here — no second screen. */
    fun sendStatus() {
        if (busy) return
        busy = true
        val img = runCatching { shot?.asAndroidBitmap() }.getOrNull()
        val vSource = source
        val s = start
        val e = end
        val drawn = strokes.toList()
        val wrote = texts.toList()
        val placed = stickers.toList()
        val filt = filterMatrix
        val turn = rotation
        val box = cropBox?.takeIf { !it.isFull() }
        android.widget.Toast.makeText(ctx, "Sharing status…", android.widget.Toast.LENGTH_SHORT).show()
        nav.popBackStack()
        ScreenStore.appScope.launch {
            try {
                if (pickedIsVideo && vSource != null) {
                    val effRot = (vSource.rotation + (turn % 4) * 90) % 360
                    val (ovW, ovH) = VideoPlan.outputSize(vSource.codedW, vSource.codedH, effRot, box)
                    val overlay = bakeVideoOverlay(drawn, wrote, placed, ovW, ovH, box)
                    val hasEdits = overlay != null || filt != null || turn != 0 || box != null
                    val mime = (ctx.contentResolver.getType(pickedUri) ?: "").ifBlank { "video/mp4" }
                    val size = runCatching { ctx.contentResolver.openAssetFileDescriptor(pickedUri, "r")?.use { it.length } ?: -1L }.getOrDefault(-1L)
                    val cut = java.io.File(ctx.cacheDir, "status_out_${System.currentTimeMillis()}.mp4")
                    val bytes =
                        if (!VideoPlan.needsTranscode(box, s, e, vSource.durationMs, size, mime) && !hasEdits) {
                            ctx.contentResolver.openInputStream(pickedUri)?.use { it.readBytes() }
                                ?: throw Exception("Could not read that video.")
                        } else {
                            try {
                                VideoExport.export(ctx, pickedUri, s, e, box, cut, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                // Edits must never silently vanish: only a
                                // bare trim may go through degraded.
                                if (hasEdits) throw err
                                cut.delete()
                                VideoExport.passthrough(ctx, pickedUri, s, e, cut)
                            }
                            val b = cut.readBytes()
                            cut.delete()
                            b
                        }
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
                    val data = bakeFull(bmp, drawn, filt, wrote, placed, false)
                        ?: throw Exception("Could not read that photo.")
                    Api.post(
                        "/api/statuses",
                        JSONObject().put("kind", "IMAGE").put("imageData", data).put("text", ""),
                    )
                }
                runCatching {
                    val data = Api.get("/api/statuses", true)
                    ScreenStore.setStatuses(data.arr("items").objects())
                }
            } catch (err: Exception) {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    android.widget.Toast.makeText(ctx, err.message ?: "Status didn't post. Try again.", android.widget.Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** The caption bar's + : stage this one (edits baked in) and pick more.
     *  Owner round 39 (item 6): replaceUri carries the panel pencil's trip —
     *  the staged item replaces that uri in the batch instead of prepending. */
    fun addMore(replaceUri: String = "") {
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
        val box = cropBox?.takeIf { !it.isFull() }
        val hdShot = hd
        val onceShot = once
        ScreenStore.appScope.launch {
            val item =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val whole = s <= 0L && e >= vSource.durationMs && box == null
                        // Owner round 36 (item 6): staged with the layers.
                        val effRot = (vSource.rotation + (turn % 4) * 90) % 360
                        val (ovW, ovH) = VideoPlan.outputSize(vSource.codedW, vSource.codedH, effRot, box)
                        val overlay = bakeVideoOverlay(drawn, wrote, placed, ovW, ovH, box)
                        val hasEdits = overlay != null || filt != null || turn != 0 || box != null
                        if (whole && !hasEdits) {
                            MediaItem(pickedUri, true, vSource.durationMs, "", System.currentTimeMillis() / 1000, cap, once = onceShot)
                        } else {
                            val out = java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4")
                            try {
                                VideoExport.export(ctx, pickedUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                if (hasEdits) throw err
                                out.delete()
                                VideoExport.passthrough(ctx, pickedUri, s, e, out)
                            }
                            val uri =
                                androidx.core.content.FileProvider.getUriForFile(
                                    ctx,
                                    "${ctx.packageName}.fileprovider",
                                    out,
                                )
                            MediaItem(uri, true, e - s, "Edits", System.currentTimeMillis() / 1000, cap, once = onceShot)
                        }
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        val edited = drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() || filt != null || turn != 0 || hdShot || box != null
                        if (!edited) {
                            MediaItem(pickedUri, false, 0, "", System.currentTimeMillis() / 1000, cap, once = onceShot)
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
                            MediaItem(uri, false, 0, "Edits", System.currentTimeMillis() / 1000, cap, hdShot, once = onceShot)
                        }
                    }
                }.getOrNull()
            withContext(Dispatchers.Main) {
                if (item == null) {
                    busy = false
                    haptics.reject()
                    notice = "Could not add that one."
                } else {
                    ScreenStore.pendingAddMore.value = AddMore(convId, item, onceShot, replaceUri)
                    nav.popBackStack()
                }
            }
        }
    }

    fun send() {
        // Owner round 37 (item 2): status posts straight from here.
        if (statusMode) {
            sendStatus()
            return
        }
        // Owner round 39 (item 6): the panel pencil's trip — Done stages
        // the edited photo back into the batch (replacing the original)
        // instead of sending it. Same bake as the + button.
        ScreenStore.editStageUri?.let { stageUri ->
            ScreenStore.editStageUri = null
            addMore(stageUri)
            return
        }
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
        val box = cropBox?.takeIf { !it.isFull() }
        val hdShot = hd
        ScreenStore.appScope.launch {
            val result =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val out = java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4")
                        val whole = s <= 0L && e >= vSource.durationMs && box == null
                        // Owner round 36 (item 6): the clip carries the
                        // editor's layers — overlay baked at the export's own
                        // output size, filter on the shader, turns in the map.
                        val effRot = (vSource.rotation + (turn % 4) * 90) % 360
                        val (ovW, ovH) = VideoPlan.outputSize(vSource.codedW, vSource.codedH, effRot, box)
                        val overlay = bakeVideoOverlay(drawn, wrote, placed, ovW, ovH, box)
                        val hasEdits = overlay != null || filt != null || turn != 0 || box != null
                        if (!whole || hasEdits) {
                            try {
                                VideoExport.export(ctx, pickedUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                // Edits must never silently vanish: only a
                                // bare trim may go through degraded.
                                if (hasEdits) throw err
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
                        val edited = drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() || filt != null || turn != 0 || hdShot || box != null
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
        val turn = rotation
        val box = cropBox?.takeIf { !it.isFull() }
        val hdShot = hd
        ScreenStore.appScope.launch {
            val ok =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val whole = s <= 0L && e >= vSource.durationMs && box == null
                        // Owner round 36 (item 6): the gallery gets the layers too.
                        val effRot = (vSource.rotation + (turn % 4) * 90) % 360
                        val (ovW, ovH) = VideoPlan.outputSize(vSource.codedW, vSource.codedH, effRot, box)
                        val overlay = bakeVideoOverlay(drawn, wrote, placed, ovW, ovH, box)
                        val hasEdits = overlay != null || filt != null || turn != 0 || box != null
                        val f =
                            if (whole && !hasEdits) {
                                FilesUtil.copyDocument(ctx, pickedUri, "video.mp4")?.second
                                    ?: throw Exception("Could not read that video.")
                            } else {
                                java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4").also { out ->
                                    try {
                                        VideoExport.export(ctx, pickedUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                                    } catch (err: Exception) {
                                        if (hasEdits) throw err
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

    /** Owner round 36 (item 6): the pen + overlay layer — one canvas shared
     *  by the photo and the video stage (gestures + draw, normalised units). */
    @Composable
    fun StageCanvas() {
        Canvas(
            Modifier
                .fillMaxSize()
                .then(
                    if (cropping) Modifier
                    else if (penMode) {
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
                                // 0 none, 3 rotate handle, 4 resize handle.
                                var grabHandle = 0
                                selectedOverlay()?.let { sel ->
                                    val dp = deletePos(sel, w, h)
                                    if (kotlin.math.hypot(nx0 - dp.x, ny0 - dp.y) < DEL_MARK_HIT) {
                                        haptics.tap()
                                        pushOverlayPast()
                                        removeOverlay(sel.id)
                                        waitForUpOrCancellation()
                                        return@awaitEachGesture
                                    }
                                    // Reference-style handles: top-right turns,
                                    // bottom-right resizes — one snapshot each.
                                    val rp = rotatePos(sel, w, h)
                                    val zp = resizePos(sel, w, h)
                                    grabHandle =
                                        if (kotlin.math.hypot(nx0 - rp.x, ny0 - rp.y) < DEL_MARK_HIT) 3
                                        else if (kotlin.math.hypot(nx0 - zp.x, ny0 - zp.y) < DEL_MARK_HIT) 4
                                        else 0
                                    if (grabHandle != 0) {
                                        haptics.tap()
                                        pushOverlayPast()
                                    }
                                }
                                val hit = if (grabHandle != 0) selectedId else hitOverlay(nx0, ny0, w, h)
                                if (hit != null) {
                                    haptics.tap()
                                    selectedId = hit
                                }
                                // 0 undecided, 1 move, 2 pinch (pinch wins
                                // outright — lifting back to one finger
                                // ends the gesture instead of dragging),
                                // 3 rotate handle, 4 resize handle.
                                var mode = grabHandle
                                var moved = grabHandle != 0
                                var prev = d0.position
                                var prevDist = 0f
                                var prevCent = Offset.Zero
                                var grabAngle = 0f
                                var grabDist = 0f
                                if (mode == 3 || mode == 4) {
                                    val sel = selectedOverlay()
                                    if (sel != null) {
                                        val ccx = sel.center.x * w
                                        val ccy = sel.center.y * h
                                        grabAngle = kotlin.math.atan2(d0.position.y - ccy, d0.position.x - ccx)
                                        grabDist = kotlin.math.hypot(d0.position.x - ccx, d0.position.y - ccy)
                                    }
                                }
                                val slopPx = viewConfiguration.touchSlop
                                while (true) {
                                    val ev = awaitPointerEvent()
                                    val pressed = ev.changes.filter { it.pressed }
                                    if (pressed.isEmpty()) break
                                    val target = hit ?: selectedId
                                    if (mode == 3 || mode == 4) {
                                        val c = pressed[0]
                                        val sel = selectedOverlay()
                                        if (sel != null) {
                                            val ccx = sel.center.x * w
                                            val ccy = sel.center.y * h
                                            if (mode == 3) {
                                                val g = kotlin.math.atan2(c.position.y - ccy, c.position.x - ccx)
                                                // Around the branch cut without a 360° jump.
                                                var dd = g - grabAngle
                                                while (dd > Math.PI) dd -= 2f * Math.PI.toFloat()
                                                while (dd < -Math.PI) dd += 2f * Math.PI.toFloat()
                                                rotateOverlay(sel.id, Math.toDegrees(dd.toDouble()).toFloat())
                                                grabAngle = g
                                            } else {
                                                val d = kotlin.math.hypot(c.position.x - ccx, c.position.y - ccy)
                                                if (grabDist > 1f && d > 1f) scaleOverlay(sel.id, d / grabDist)
                                                grabDist = d
                                            }
                                        }
                                        pressed.forEach { it.consume() }
                                    } else if (pressed.size >= 2 && target != null) {
                                        val a = pressed[0].position
                                        val b = pressed[1].position
                                        val dist = kotlin.math.hypot(a.x - b.x, a.y - b.y)
                                        val cent = Offset((a.x + b.x) / 2f, (a.y + b.y) / 2f)
                                        if (mode != 2) {
                                            mode = 2
                                            pushOverlayPast()
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
                                                pushOverlayPast()
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
    }

    // Owner round 35 (item 8): soft scrims so the floating chrome reads over any photo.
    val topScrim = Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))
    val bottomScrim = Brush.verticalGradient(listOf(Color.Transparent, Color(0x99000000)))

    // Owner round 45 (item 7): a horizontal swipe browses the pool — gated
    // off while drawing, cropping or nudging an overlay, so those drags
    // always win. Left = next photo, right = previous.
    val browseTick = onBrowse != null && !penMode && !cropping && selectedId == null && !busy
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .then(
                if (!browseTick) {
                    Modifier
                } else {
                    Modifier.pointerInput("editbrowse") {
                        // Owner round 47 (item 5): the Main-pass detector
                        // lost the touch-slop race to the stage whenever
                        // the swipe started ON the photo — only the empty
                        // border margins browsed. Claim in the INITIAL pass
                        // (the parent sees events BEFORE the stage); only a
                        // firmly-horizontal drag is taken, so taps and
                        // vertical drags still belong to the stage, and
                        // browseTick keeps pen/crop/overlay drags winning.
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                            var travel = 0f
                            var vert = 0f
                            var mode = 0
                            while (true) {
                                val ev = awaitPointerEvent(PointerEventPass.Initial)
                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                if (!ch.pressed) break
                                val dx = ch.position.x - ch.previousPosition.x
                                val dy = ch.position.y - ch.previousPosition.y
                                if (mode == 0) {
                                    travel += dx
                                    vert += dy
                                    if (kotlin.math.abs(travel) > 24f && kotlin.math.abs(travel) > kotlin.math.abs(vert) * 1.5f) {
                                        mode = 1
                                        ch.consume()
                                    } else if (kotlin.math.abs(vert) > 24f) {
                                        mode = -1
                                    }
                                } else if (mode == 1) {
                                    travel += dx
                                    ch.consume()
                                    if (travel < -140f) {
                                        onBrowse?.invoke(1)
                                        break
                                    }
                                    if (travel > 140f) {
                                        onBrowse?.invoke(-1)
                                        break
                                    }
                                } else {
                                    break
                                }
                            }
                        }
                    }
                },
            ),
    ) {
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
                            // While the box is open the stage shows the FULL
                            // frame (photo) — the crop commits on exit.
                            val stageShot = if (cropping) shotFull else shot
                            if (stageShot != null) {
                                Image(
                                    stageShot,
                                    contentDescription = "Photo",
                                    modifier = Modifier.fillMaxSize(),
                                    contentScale = ContentScale.Fit,
                                    colorFilter = previewFilter,
                                )
                                StageCanvas()
                            } else {
                                // Owner round 36 (item 6): turns / filters freeze
                                // the clip into a WYSIWYG still (the export's
                                // exact pixels for this frame); the live player
                                // rests underneath, paused. Ink rides either way.
                                StatusTrimPreview(pickedUri, start, end, paused = stillMode, scrubAt = scrub, onPosition = { playAt = it })
                                val still = videoStill
                                if (stillMode && still != null) {
                                    Image(still, "Edited frame", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                                }
                                StageCanvas()
                            }
                            if (cropping) {
                                CropOverlay(
                                    box = cropDraft,
                                    lock =
                                        when (cropPreset) {
                                            "9:16" -> 9f / 16f
                                            "1:1" -> 1f
                                            else -> null
                                        },
                                    boxAspect = cropFullAspect,
                                    onChange = {
                                        cropDraft = it
                                        cropTouched = true
                                        if (cropPreset == "Original") cropPreset = "Free"
                                    },
                                )
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
            /* top bar: Close · (video) clip length · save / HD (photo) /
               rotate / sticker / text / pen (photo + video) · undo / clear */
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(topScrim)
                    .statusBarsPadding()
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { if (cropping) exitCrop() else nav.popBackStack() }, modifier = Modifier.size(36.dp)) {
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
                if (clip == null && !statusMode) {
                    // The HD pill: filled while the bigger send is armed.
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(7.dp))
                            .background(if (hd) Color.White else Color.Transparent)
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
                }
                // Owner round 36 (item 6): rotate / sticker / text / pen ride video too.
                ToolButton(onClick = { rotateTap() }) {
                    Icon(Icons.Filled.RotateRight, "Rotate", tint = Color.White, modifier = Modifier.size(18.dp))
                }
                // Owner round 37 (item 2): the crop tool (photo + video) —
                // the share screen's box + presets, on this one screen.
                ToolButton(active = cropping, onClick = { if (cropping) exitCrop() else enterCrop() }) {
                    Icon(Icons.Filled.Crop, "Crop", tint = Color.White, modifier = Modifier.size(18.dp))
                }
                ToolButton(onClick = {
                    exitCrop()
                    showStickerSheet = true
                }) {
                    Icon(Icons.Filled.EmojiEmotions, "Stickers", tint = Color.White, modifier = Modifier.size(18.dp))
                }
                ToolButton(onClick = {
                    exitCrop()
                    showTextSheet = true
                }) {
                    Text("Aa", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                }
                ToolButton(active = penMode, onClick = {
                    exitCrop()
                    penMode = !penMode
                }) {
                    Icon(Icons.Filled.Edit, "Draw", tint = Color.White, modifier = Modifier.size(18.dp))
                }
                if ((shot != null || clip != null) && (strokes.isNotEmpty() || overlayPast.isNotEmpty())) {
                    IconButton(
                        onClick = {
                            haptics.tap()
                            if (strokes.isNotEmpty()) strokes.removeAt(strokes.size - 1) else undoOverlay()
                        },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Undo, "Undo", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    IconButton(
                        onClick = {
                            haptics.tap()
                            if (strokes.isNotEmpty()) strokes.clear()
                            if (texts.isNotEmpty() || stickers.isNotEmpty()) {
                                pushOverlayPast()
                                texts.clear()
                                stickers.clear()
                                selectedId = null
                            }
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
                // Owner round 36 (item 6): filters ride video too (the still
                // below previews them — a TextureView takes no ColorFilter).
                if ((shot != null || clip != null) && !cropping) {
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

                /* bottom: the pen's colours + widths (photo + video, pen mode) and the trim strip (video) */
                if ((shot != null || clip != null) && penMode) {
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
                }
                if (cropping) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    ) {
                        listOf("Original", "9:16", "1:1", "Free").forEach { name ->
                            val on = cropPreset == name
                            Text(
                                name,
                                color = if (on) ActionBlueInk else Color.White,
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(if (on) ActionBlue else Color(0x33FFFFFF))
                                    .clickable { applyCropPreset(name) }
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
                    if (!statusMode) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp)
                                .clip(RoundedCornerShape(20.dp))
                                .background(Color(0xFF232A33))
                                .padding(start = 12.dp, end = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
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
                            // Owner round 38 (item 2): the ① sits borderless in
                            // its seat — no ring — and fills it (28.dp), the
                            // size the ringed button used to read. Still fills
                            // blue while once is armed.
                            Box(
                                Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(if (once) ActionBlue else Color.Transparent)
                                    .clickable {
                                        haptics.toggle(!once)
                                        once = !once
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                CenteredOnceIcon(28.dp, tint = if (once) Color.White else Color(0xB3FFFFFF))
                            }
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
                                        if (cropping) exitCrop() else send()
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (busy) {
                                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(20.dp))
                                } else {
                                    Icon(
                                        if (statusMode) Icons.Filled.Check else Icons.AutoMirrored.Filled.Send,
                                        contentDescription = if (statusMode) "Done" else "Send",
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
                            pushOverlayPast()
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
                                pushOverlayPast()
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

/** A placed text overlay: normalised centre, the words, their colour, pinch size, turn. */
internal data class EditText(val id: String, val center: Offset, val text: String, val color: Color, val scale: Float = 1f, val rotation: Float = 0f)

/** A placed sticker: normalised centre + the pack glyph + pinch size + turn. */
internal data class EditSticker(val id: String, val center: Offset, val glyph: String, val scale: Float = 1f, val rotation: Float = 0f)

/** The selected overlay's hit geometry (normalised units + its turn). */
private data class EditSel(val id: String, val center: Offset, val rx: Float, val ry: Float, val rot: Float)

/** Owner round 37 (item 3): a selection-box corner in normalised units —
 *  the reference puts × top-left, rotate top-right, resize bottom-right.
 *  The turn is a TRUE pixel-space rotation (normalised space is stretched). */
private fun handlePos(sel: EditSel, sx: Float, sy: Float, w: Float, h: Float): Offset {
    val dx = sx * sel.rx * w
    val dy = sy * sel.ry * h
    val r = Math.toRadians(sel.rot.toDouble())
    val cos = kotlin.math.cos(r).toFloat()
    val sin = kotlin.math.sin(r).toFloat()
    return Offset(sel.center.x + (dx * cos - dy * sin) / w, sel.center.y + (dx * sin + dy * cos) / h)
}

private fun deletePos(sel: EditSel, w: Float, h: Float): Offset = handlePos(sel, -1f, -1f, w, h)

private fun rotatePos(sel: EditSel, w: Float, h: Float): Offset = handlePos(sel, 1f, -1f, w, h)

private fun resizePos(sel: EditSel, w: Float, h: Float): Offset = handlePos(sel, 1f, 1f, w, h)

/** The touch un-turned into the overlay's own frame (pixel space, true angle). */
private fun inOverlay(x: Float, y: Float, c: Offset, rx: Float, ry: Float, rot: Float, w: Float, h: Float): Boolean {
    val dx = (x - c.x) * w
    val dy = (y - c.y) * h
    val r = Math.toRadians(-rot.toDouble())
    val cos = kotlin.math.cos(r).toFloat()
    val sin = kotlin.math.sin(r).toFloat()
    return kotlin.math.abs(dx * cos - dy * sin) <= rx * w && kotlin.math.abs(dx * sin + dy * cos) <= ry * h
}

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
    native.save()
    native.rotate(t.rotation, t.center.x * w, t.center.y * h)
    native.drawText(t.text, t.center.x * w, t.center.y * h + size * 0.35f, paint)
    native.restore()
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
    native.save()
    native.rotate(s.rotation, s.center.x * w, s.center.y * h)
    native.drawText(s.glyph, s.center.x * w, s.center.y * h + size * 0.35f, paint)
    native.restore()
}

/** Preview-only: the selection rect turns with the overlay, and the handles
 *  sit ON its corners like the reference — × top-left, rotate top-right,
 *  resize bottom-right (white buttons, dark glyphs, same hit feel). */
private fun drawEditSelection(native: android.graphics.Canvas, sel: EditSel, w: Float, h: Float) {
    val ring =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = android.graphics.Paint.Style.STROKE
            strokeWidth = 3f
        }
    val fill =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            style = android.graphics.Paint.Style.FILL
        }
    val glyph =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.BLACK
            style = android.graphics.Paint.Style.STROKE
            strokeWidth = 5f
            strokeCap = android.graphics.Paint.Cap.ROUND
        }
    // Owner round 36 (item 3): the selection is a SHARP rectangle hugging
    // the overlay — the old circle looked "rounded" and sat loose on text.
    val cx = sel.center.x * w
    val cy = sel.center.y * h
    native.save()
    native.rotate(sel.rot, cx, cy)
    native.drawRect(cx - sel.rx * w, cy - sel.ry * h, cx + sel.rx * w, cy + sel.ry * h, ring)
    val lx = cx - sel.rx * w
    val ty = cy - sel.ry * h
    val rx = cx + sel.rx * w
    val by = cy + sel.ry * h
    // × top-left.
    native.drawCircle(lx, ty, 32f, fill)
    native.drawLine(lx - 11f, ty - 11f, lx + 11f, ty + 11f, glyph)
    native.drawLine(lx - 11f, ty + 11f, lx + 11f, ty - 11f, glyph)
    // Rotate top-right: a near-full arc (gap at the top) + a filled head
    // sitting exactly on the arc's start, pointing along the travel.
    native.drawCircle(rx, ty, 32f, fill)
    native.drawArc(rx - 13f, ty - 13f, rx + 13f, ty + 13f, 300f, 300f, false, glyph)
    val head = android.graphics.Path()
    head.moveTo(rx + 6.5f, ty - 11.3f)
    head.lineTo(rx - 4.4f, ty - 12.4f)
    head.lineTo(rx + 0.1f, ty - 20.2f)
    head.close()
    val glyphFill =
        android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.BLACK
            style = android.graphics.Paint.Style.FILL
        }
    native.drawPath(head, glyphFill)
    // Resize bottom-right: a diagonal double arrow.
    native.drawCircle(rx, by, 32f, fill)
    native.drawLine(rx - 10f, by - 10f, rx + 10f, by + 10f, glyph)
    native.drawLine(rx + 10f, by + 10f, rx + 10f, by + 1f, glyph)
    native.drawLine(rx + 10f, by + 10f, rx + 1f, by + 10f, glyph)
    native.drawLine(rx - 10f, by - 10f, rx - 10f, by - 1f, glyph)
    native.drawLine(rx - 10f, by - 10f, rx - 1f, by - 10f, glyph)
    native.restore()
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
        paintPenStrokes(canvas, strokes, w, h)
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

/** Owner round 36 (item 6): pen strokes onto any native canvas — the photo
 *  bake and the video overlay share it, so ink looks identical in both. */
internal fun paintPenStrokes(canvas: android.graphics.Canvas, strokes: List<PenStroke>, w: Float, h: Float) {
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
}

/** Owner round 36 (item 6): the video export's overlay — pen + text +
 *  sticker baked transparent at the export's output size (null when empty). */
internal fun bakeVideoOverlay(strokes: List<PenStroke>, texts: List<EditText>, stickers: List<EditSticker>, w: Int, h: Int, box: CropBox? = null): Bitmap? {
    if (strokes.isEmpty() && texts.isEmpty() && stickers.isEmpty()) return null
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bmp)
    val fw = w.toFloat()
    val fh = h.toFloat()
    // Owner round 37 (item 2): the export frame IS the cropped region —
    // remap the full-frame overlay coords into it (scale, then shift). The
    // canvas clips the rest, exactly like the stage does.
    box?.takeIf { !it.isFull() }?.let { b ->
        canvas.scale(1f / b.w, 1f / b.h)
        canvas.translate(-b.x * fw, -b.y * fh)
    }
    stickers.forEach { st -> drawEditSticker(canvas, st, fw, fh) }
    texts.forEach { t -> drawEditText(canvas, t, fw, fh) }
    paintPenStrokes(canvas, strokes, fw, fh)
    return bmp
}

/** Owner round 36 (item 6): one video frame off the IO thread for the still
 *  preview + filter thumbs (closest sync frame — null on any refusal). */
internal fun grabVideoFrame(ctx: android.content.Context, uri: Uri, atMs: Long): Bitmap? =
    runCatching {
        val r = android.media.MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, uri)
            r.getFrameAtTime(atMs.coerceAtLeast(0L) * 1000L, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        } finally {
            runCatching { r.release() }
        }
    }.getOrNull()
