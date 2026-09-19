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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Crop
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
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
import androidx.compose.ui.draw.alpha
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
        MediaEditItemScreen(nav, pickedUri, pickedIsVideo, convId, viewOnce, null, null, null, null, null, 0)
        return
    }
    var idx by remember {
        mutableStateOf(pool.indexOfFirst { it.uri == pickedUri }.takeIf { it >= 0 } ?: 0)
    }
    var browseDir by remember { mutableStateOf(1) }
    // Polish 2026-09-18c: pool browse starts with ONLY the picked item
    // selected — owner: 17 always fake, should show real selected count.
    // Tapping the box toggles current uri; badge shows true count.
    val selectedUris = remember { mutableStateListOf<String>().apply { add(pool[idx].uri.toString()) } }
    // Every photo visited keeps its edits — the item screen snapshots its
    // EditBits on leave (kilobytes; bitmaps are re-decoded on return).
    val works = remember { HashMap<String, EditBits>() }
    // Fix: only inner media slides, outer chrome stays. Keep per-photo
    // isolation via works map and remember(pickedUri) inside the item.
    val item = pool[idx]
    val uriKey = item.uri.toString()
    // v162: the ticked set in TICK ORDER (selectedUris keeps it) — the send
    // circle now sends all of them, not just the item on screen.
    val ticked = selectedUris.mapNotNull { u -> pool.firstOrNull { it.uri.toString() == u } }
    MediaEditItemScreen(
        nav,
        item.uri,
        item.isVideo,
        convId,
        viewOnce,
        works[uriKey],
        { bits -> works[uriKey] = bits },
        { d ->
            browseDir = d
            idx = (idx + d).coerceIn(0, pool.lastIndex)
        },
        isSelected = selectedUris.contains(uriKey),
        onToggleSelect = {
            if (selectedUris.contains(uriKey)) selectedUris.remove(uriKey) else selectedUris.add(uriKey)
        },
        selectedCount = selectedUris.size,
        ticked = ticked,
        works = works,
    )
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
    // v164 (owner: "done dile just edit ta apply hobe"): the file the edit was
    // baked into, when the user pressed Done on this item. Browsing away and
    // back must show the APPLIED picture, not the raw pick again.
    val workUri: String? = null,
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
    isSelected: Boolean? = null,
    onToggleSelect: (() -> Unit)? = null,
    selectedCount: Int = 0,
    // v162: every ticked item of the pool, in tick order (empty = no pool
    // browse, e.g. the attach pencil's single-item trip).
    ticked: List<MediaItem> = emptyList(),
    // v164: each item's snapshot, so a batch send hands back the file an item
    // was APPLIED into instead of its raw pick.
    works: Map<String, EditBits> = emptyMap(),
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

    var photo by remember(pickedUri) { mutableStateOf<ImageBitmap?>(null) }
    var source by remember(pickedUri) { mutableStateOf<VideoExport.Source?>(null) }
    var loadFailed by remember(pickedUri) { mutableStateOf(false) }
    var start by remember(pickedUri) { mutableStateOf(0L) }
    var end by remember(pickedUri) { mutableStateOf(0L) }
    var scrub by remember(pickedUri) { mutableStateOf<Long?>(null) }
    // Owner round 33 (item 8): the preview's play position for the strip's playhead.
    var playAt by remember(pickedUri) { mutableStateOf<Long?>(null) }
    var seekTo by remember(pickedUri) { mutableStateOf<Long?>(null) }
    var busy by remember { mutableStateOf(false) }
    // v168 (owner: "video edit er somoy ply pause kora jai na eita add kore
    // daw"): the stage's own play/pause state. StatusTrimPreview's built-in
    // tap-to-pause never fires here - the overlay canvas above it claims
    // every tap - so the clip gets a real seat (and r42-3's apply parks the
    // fresh clip on it).
    var vidPaused by remember { mutableStateOf(false) }
    // v166 (owner: "video edit kore done dile lag kore ar done o hoi na"):
    // a clip bake is a real transcode — without a number on screen it read as
    // a freeze and as "Done didn't work". -1f = no bake running, else 0..1.
    var applyPct by remember { mutableStateOf(-1f) }
    // v164 (owner: "done dile just edit ta apply hobe, save ba send hobe na,
    // editor kholai thakbe"): Done bakes what has been drawn / written / stuck /
    // cropped / trimmed into a NEW working file and makes it the media this
    // screen reads. Nothing leaves the screen — the layers are simply spent
    // (they live inside the picture now) and the editor stays open for the
    // next edit or for the send circle. Everything the stage loads is keyed on
    // this uri, so an apply reloads the stage off the baked file.
    var mediaUri by remember(pickedUri, bits) {
        mutableStateOf(bits?.workUri?.let { android.net.Uri.parse(it) } ?: pickedUri)
    }
    val thumbs = remember(mediaUri) { mutableStateListOf<ImageBitmap?>() }
    // Pen: strokes in normalised picture units; the live one is drawn as it grows.
    val strokes = remember(pickedUri, bits) { mutableStateListOf<PenStroke>().also { l -> bits?.let { l.addAll(it.strokes) } } }
    var live by remember { mutableStateOf<PenStroke?>(null) }
    var penColor by remember { mutableStateOf(PEN_COLOURS[0]) }
    var penWidth by remember { mutableStateOf(PEN_WIDTHS[1]) }
    // Owner round 34 (item 16b): the full-editor state — the pen is a MODE now
    // (the stage is drag-to-move for overlays while it is off), the ① toggle
    // and the HD switch live here, overlays sit in normalised units.
    var penMode by remember { mutableStateOf(false) }
    var rotation by remember(pickedUri, bits) { mutableStateOf(bits?.rotation ?: 0) }
    var filterIdx by remember(pickedUri, bits) { mutableStateOf(bits?.filterIdx ?: 0) }
    val texts = remember(pickedUri, bits) { mutableStateListOf<EditText>().also { l -> bits?.let { l.addAll(it.texts) } } }
    val stickers = remember(pickedUri, bits) { mutableStateListOf<EditSticker>().also { l -> bits?.let { l.addAll(it.stickers) } } }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var once by remember(pickedUri, bits) { mutableStateOf(bits?.once ?: viewOnce) }
    var hd by remember(pickedUri, bits) { mutableStateOf(bits?.hd ?: false) }
    var caption by remember(pickedUri, bits) { mutableStateOf(bits?.caption ?: "") }
    var notice by remember { mutableStateOf<String?>(null) }
    var showTextSheet by remember { mutableStateOf(false) }
    var showStickerSheet by remember { mutableStateOf(false) }
    var filtersOpen by remember { mutableStateOf(false) }
    // v160 (item 2): keyed to the picked item — a swipe must never leave
    // the previous photo's filter strip or freeze-frame behind.
    var filterThumbs by remember(mediaUri) { mutableStateOf<List<ImageBitmap?>>(emptyList()) }
    // Owner round 36 (item 6): the video still-mode frame (exact export
    // pixels for the playhead — turns + filter baked in, see below).
    // Owner round 37 (item 2): the status share screen is GONE — the
    // picker lands straight here, and Done posts the status. No caption
    // (status posts carry none), no once, no add-more, no HD.
    val statusMode = convId == "status"
    // Owner round 37 (item 2): the crop tool (photo + video, chat + status).
    // cropBox commits into normalised full-frame coords; while the box is
    // open the stage shows the FULL frame and the draft rides above it.
    var cropping by remember(pickedUri) { mutableStateOf(false) }
    var cropBox by remember(pickedUri, bits) { mutableStateOf<CropBox?>(bits?.cropBox) }
    var cropDraft by remember(pickedUri, bits) { mutableStateOf(bits?.cropDraft ?: CropBox.FULL) }
    var cropTouched by remember(pickedUri, bits) { mutableStateOf(bits?.cropTouched ?: false) }
    var cropPreset by remember(pickedUri, bits) { mutableStateOf(bits?.cropPreset ?: "Original") }
    // Owner round 45 (item 7): snapshot this photo's work for the browse back.
    // v161 (item 2): keyed on pickedUri — the chrome no longer re-composes per
    // item (the media alone changes), so this snapshot has to fire on the SWIPE
    // itself, otherwise edits were dropped when moving between photos.
    DisposableEffect(pickedUri) {
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
                    workUri = mediaUri.takeIf { it.toString() != pickedUri.toString() }?.toString(),
                ),
            )
        }
    }

    LaunchedEffect(mediaUri) {
        if (pickedIsVideo) {
            val src = withContext(Dispatchers.IO) { VideoExport.probe(ctx, mediaUri) }
            if (src == null) {
                loadFailed = true
                return@LaunchedEffect
            }
            // v164: an APPLIED clip is already trimmed / edited — its window
            // is the whole baked file. Restoring the old selection on top of it
            // would cut the clip a second time.
            val applied = mediaUri.toString() != pickedUri.toString()
            if (applied) {
                start = 0L
                end = src.durationMs
            } else if (bits != null) {
            // Owner round 45 (item 7): a browsed-back clip keeps its trim.
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
                VideoExport.thumbnails(ctx, mediaUri, src.durationMs, EDIT_STRIP_FRAMES) { i, bmp ->
                    if (i < thumbs.size) thumbs[i] = bmp.asImageBitmap()
                }
            }
        } else {
            // HD-ready working copy (2560px): the bake caps decide the output
            // size, so one decode serves both the standard and the HD send.
            val bmp = withContext(Dispatchers.IO) {
                FilesUtil.imageToJpeg(mediaUri, ctx, maxSide = 2560, maxBytes = 2_000_000)?.let {
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
    // v164 (owner: "profile picture upload korar somoy image select korle edit
    // option gula thakbe"): a profile photo opens this same editor — the route
    // carries convId "avatar". No caption, no recipient chip, no ① view-once;
    // the circle means "use this photo" and the profile takes the baked file.
    val avatarMode = convId == "avatar"
    // v164 (owner: "kono edit na korle done button thakbe na"): is there an edit
    // for Done to apply? The same idea as the bakes' own "edited" test, so the
    // button can never be there for nothing.
    val hasEdits =
        strokes.isNotEmpty() || texts.isNotEmpty() || stickers.isNotEmpty() ||
            rotation != 0 || filterIdx != 0 || cropBox != null || hd ||
            (clip != null && (start > 0L || end < clip.durationMs))
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
                    val turned = if (rotation % 2 == 1) h / w.coerceAtLeast(1f) else w / h.coerceAtLeast(1f)
                    // v170: a committed crop narrows the stage to its box.
                    val box = cropBox?.takeIf { !it.isFull() }
                    if (box == null) turned else turned * (box.w / box.h.coerceAtLeast(0.01f))
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
                grabVideoFrame(ctx, mediaUri, (clip?.durationMs ?: 0L) / 2)
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
    // v170 (owner r44 item 3): the WYSIWYG still is GONE - turns, filter
    // and crop ride the live player (TextureView transform + a hardware
    // layer ColorFilter), WhatsApp/Telegram style: the clip never freezes
    // while editing and nothing re-encodes until the send.
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
    // v165 (owner: "all edit a undo redo button rakho tobe compact kore dio"):
    // REDO beside undo, in every editor flow (chat send, status post, profile
    // photo). Every undo hands back the action it took, so redo is its exact
    // inverse; a NEW edit clears the redo branch (nothing ahead of a fresh
    // stroke to walk back to).
    val redoStack = remember { mutableStateListOf<() -> Unit>() }

    fun pushOverlayPast() {
        overlayPast.add(texts.toList() to stickers.toList())
        if (overlayPast.size > 50) overlayPast.removeAt(0)
        redoStack.clear()
    }
    fun undoOverlay() {
        val last = overlayPast.removeLastOrNull() ?: return
        val nowTexts = texts.toList()
        val nowStickers = stickers.toList()
        redoStack.add {
            texts.clear()
            texts.addAll(nowTexts)
            stickers.clear()
            stickers.addAll(nowStickers)
        }
        texts.clear()
        texts.addAll(last.first)
        stickers.clear()
        stickers.addAll(last.second)
        if (selectedId != null && texts.none { it.id == selectedId } && stickers.none { it.id == selectedId }) selectedId = null
    }

    // v165: the two ends of the undo lane sit HERE, after the state they touch
    // (redoStack above, undoOverlay above) — a local function only sees what is
    // declared before it.
    /** One undo: the last pen stroke, else the last overlay snapshot. */
    fun undoEdit() {
        if (strokes.isNotEmpty()) {
            val st = strokes.removeAt(strokes.size - 1)
            live = null
            redoStack.add { strokes.add(st) }
            return
        }
        undoOverlay()
    }

    /** The inverse of [undoEdit] — replays the last undone action. */
    fun redoEdit() {
        redoStack.removeLastOrNull()?.invoke()
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
                    val mime = (ctx.contentResolver.getType(mediaUri) ?: "").ifBlank { "video/mp4" }
                    val size = runCatching { ctx.contentResolver.openAssetFileDescriptor(mediaUri, "r")?.use { it.length } ?: -1L }.getOrDefault(-1L)
                    val cut = java.io.File(ctx.cacheDir, "status_out_${System.currentTimeMillis()}.mp4")
                    val bytes =
                        if (!VideoPlan.needsTranscode(box, s, e, vSource.durationMs, size, mime) && !hasEdits) {
                            ctx.contentResolver.openInputStream(mediaUri)?.use { it.readBytes() }
                                ?: throw Exception("Could not read that video.")
                        } else {
                            try {
                                VideoExport.export(ctx, mediaUri, s, e, box, cut, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                // Edits must never silently vanish: only a
                                // bare trim may go through degraded.
                                if (hasEdits) throw err
                                cut.delete()
                                VideoExport.passthrough(ctx, mediaUri, s, e, cut)
                            }
                            val b = cut.readBytes()
                            cut.delete()
                            b
                        }
                    // v163: the video ceiling is 2 GB now (chunked upload).
                    if (bytes.size > Api.VIDEO_MAX) throw Exception("That video is over ${Api.humanLimit(Api.VIDEO_MAX)}.")
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
                            MediaItem(mediaUri, true, vSource.durationMs, "", System.currentTimeMillis() / 1000, cap, once = onceShot)
                        } else {
                            val out = java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4")
                            try {
                                VideoExport.export(ctx, mediaUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                if (hasEdits) throw err
                                out.delete()
                                VideoExport.passthrough(ctx, mediaUri, s, e, out)
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
                            MediaItem(mediaUri, false, 0, "", System.currentTimeMillis() / 1000, cap, once = onceShot)
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
                                VideoExport.export(ctx, mediaUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                            } catch (err: Exception) {
                                // Edits must never silently vanish: only a
                                // bare trim may go through degraded.
                                if (hasEdits) throw err
                                out.delete()
                                VideoExport.passthrough(ctx, mediaUri, s, e, out)
                            }
                            // v166: the baked clip's own facts (the export may
                            // have cropped or turned it — exactly why the source
                            // numbers would be the wrong ones).
                            val baked = VideoExport.probe(ctx, android.net.Uri.fromFile(out))
                            EditedMedia.Video(
                                out,
                                "video/mp4",
                                baked?.displayW ?: 0,
                                baked?.displayH ?: 0,
                                baked?.durationMs ?: 0L,
                            )
                        } else {
                            EditedMedia.Untouched(mediaUri, true)
                        }
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        // HD with no edits still bakes — the bigger file IS the edit.
                        val edited = drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() || filt != null || turn != 0 || hdShot || box != null
                        if (!edited) {
                            EditedMedia.Untouched(mediaUri, false)
                        } else {
                            val url = bakeFull(bmp, drawn, filt, wrote, placed, hdShot) ?: throw Exception("Could not save the drawing.")
                            val box = jpegBox(url)
                            EditedMedia.Photo(url, box.first, box.second)
                        }
                    }
                }.getOrElse { EditedMedia.Failed(it.message ?: "Could not edit that file.") }
            // v162: the ticks are the batch. Several ticked -> every one of
            // them goes back to the chat in a single batch (the on-screen item
            // carries its edits when it is ticked, the rest ride exactly as
            // picked); one ticked / no pool -> the old single hand-back.
            val currentTicked = ticked.any { it.uri.toString() == pickedUri.toString() }
            if (ticked.size > 1 || (ticked.size == 1 && !currentTicked)) {
                ScreenStore.pendingEditedBatch.value =
                    ticked.map { t ->
                        if (t.uri.toString() == pickedUri.toString()) {
                            EditedResult(convId, once, result, cap)
                        } else {
                            // v164: an item that was applied while browsing sends
                            // its baked file, not the raw pick again.
                            val applied = works[t.uri.toString()]?.workUri?.let { android.net.Uri.parse(it) }
                            EditedResult(convId, t.once, EditedMedia.Untouched(applied ?: t.uri, t.isVideo), t.caption)
                        }
                    }
            } else {
                ScreenStore.pendingEdited.value = EditedResult(convId, once, result, cap)
            }
        }
        nav.popBackStack()
    }
    /**
     * v164 (owner: "done dile just edit ta apply hobe, save ba send hobe na,
     * edit kholai thakbe"): bake what has been drawn / written / stuck /
     * cropped / trimmed into the WORKING file and forget the layers — they are
     * part of the picture now. Nothing is sent, nothing is written to the
     * gallery, the screen stays open for the next edit (or for the send
     * circle). This is the one action behind the top bar's Done.
     */
    fun applyEdits() {
        if (busy) return
        // A crop that is still open is an edit too: commit it first.
        if (cropping) exitCrop()
        val anything =
            strokes.isNotEmpty() || texts.isNotEmpty() || stickers.isNotEmpty() ||
                rotation != 0 || filterIdx != 0 || cropBox != null || hd ||
                (clip != null && (start > 0L || end < clip.durationMs))
        if (!anything) return
        // v170 (owner r44 item 3: "prottekta edit a applying a onek time
        // jacche instant na. whatsapp telegram ora kivabe instant edit
        // apply kore sevabe koro"): for a CLIP, Done no longer re-encodes -
        // the turns / filter / crop / ink already ride the live player, so
        // "applied" is just the committed look. The one and only bake
        // happens at send / save, exactly like WhatsApp and Telegram.
        if (pickedIsVideo) {
            haptics.confirm()
            return
        }
        busy = true
        // A photo bake is instant; a clip bake walks 0..1 (see the chip).
        applyPct = -1f
        haptics.confirm()
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
        val srcUri = mediaUri
        ScreenStore.appScope.launch {
            val out =
                runCatching {
                    if (pickedIsVideo && vSource != null) {
                        val file = java.io.File(ctx.cacheDir, "applied_${System.currentTimeMillis()}.mp4")
                        // Owner round 36 (item 6): the clip carries the layers
                        // — overlay baked at the export's own size, filter on
                        // the shader, turns in the map. Same bake as the send.
                        val effRot = (vSource.rotation + (turn % 4) * 90) % 360
                        val (ovW, ovH) = VideoPlan.outputSize(vSource.codedW, vSource.codedH, effRot, box)
                        val overlay = bakeVideoOverlay(drawn, wrote, placed, ovW, ovH, box)
                        val layers = overlay != null || filt != null || turn != 0 || box != null
                        try {
                            // v168 (owner: "done a click korle applying a onek
                            // somoy nei ... eita fast koro ws tg er moto
                            // instant"): a bare trim has nothing to re-encode -
                            // the samples ride straight into the new box (a
                            // remux, not a transcode), which is as close to
                            // instant as a bake gets. Only real layers walk
                            // the encoder, and it walks at realtime priority.
                            if (!layers) {
                                VideoExport.passthrough(ctx, srcUri, s, e, file)
                            } else {
                                VideoExport.export(
                                    ctx,
                                    srcUri,
                                    s,
                                    e,
                                    box,
                                    file,
                                    // v166: the number the chip shows comes from the
                                    // encoder itself — one frame in, one step on.
                                    onProgress = { f -> applyPct = f.coerceIn(0f, 1f) },
                                    overlay = overlay,
                                    colorMat = filt?.array,
                                    userTurns = turn,
                                )
                            }
                        } catch (err: Exception) {
                            // A bare trim may ride the degraded passthrough; a
                            // real layer must never silently vanish.
                            if (layers) throw err
                            file.delete()
                            VideoExport.passthrough(ctx, srcUri, s, e, file)
                        } finally {
                            // The full-frame overlay is a screen-sized ARGB
                            // bitmap (33 MB at 4K) — it has been consumed by
                            // the encoder, so it goes back right here instead of
                            // waiting for the GC while the editor keeps running.
                            runCatching { overlay?.recycle() }
                        }
                        // v166: never hand the stage a file that cannot be
                        // played. An encoder that "succeeded" into a 0-byte or
                        // duration-less mp4 used to become mediaUri anyway — the
                        // editor then had nothing to show (and re-probing it is
                        // what made the whole thing feel stuck).
                        val ok = file.length() > 0L && VideoExport.probe(ctx, android.net.Uri.fromFile(file))?.durationMs?.let { it > 0L } == true
                        if (!ok) {
                            file.delete()
                            throw Exception("The clip could not be saved.")
                        }
                        androidx.core.content.FileProvider.getUriForFile(
                            ctx,
                            "${ctx.packageName}.fileprovider",
                            file,
                        )
                    } else {
                        val bmp = img ?: throw Exception("Could not read that photo.")
                        val url = bakeFull(bmp, drawn, filt, wrote, placed, hdShot)
                            ?: throw Exception("Could not apply that edit.")
                        val bytes = android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                        val f = java.io.File(ctx.cacheDir, "applied_${System.currentTimeMillis()}.jpg")
                        f.writeBytes(bytes)
                        androidx.core.content.FileProvider.getUriForFile(
                            ctx,
                            "${ctx.packageName}.fileprovider",
                            f,
                        )
                    }
                }.getOrNull()
            withContext(Dispatchers.Main) {
                busy = false
                applyPct = -1f
                if (out == null) {
                    // v166: the layers are still here — nothing was baked away,
                    // so the user can try again or Send as-is. The notice names
                    // the clip when it is a clip (a photo bake cannot fail this
                    // way).
                    haptics.reject()
                    notice =
                        if (pickedIsVideo) "Could not apply that clip edit — try again."
                        else "Could not apply that edit."
                } else {
                    // The stage now shows the baked file: mediaUri drives every
                    // load, so this is what re-reads the picture / clip and
                    // re-fills the trim strip off the applied clip.
                    mediaUri = out
                    strokes.clear()
                    texts.clear()
                    stickers.clear()
                    // The undo history belongs to the layers that were just
                    // baked — undo must never draw them a second time.
                    overlayPast.clear()
                    selectedId = null
                    live = null
                    rotation = 0
                    filterIdx = 0
                    cropBox = null
                    cropDraft = CropBox.FULL
                    cropTouched = false
                    cropPreset = "Original"
                    hd = false
                    // v168 (owner: "edit done dile apply hobar por auto puse
                    // hoye jai"): the fresh clip parks on its first frame -
                    // the r42-2 play seat is the tap that starts it.
                    if (pickedIsVideo) vidPaused = true
                    haptics.confirm()
                }
            }
        }
    }

    /**
     * v164 (owner): in the profile flow the circle means "use this photo" — the
     * bake rides back to ProfileScreen (ScreenStore.pendingAvatarUri) and the
     * profile uploads it as the avatar. Same layers, same bake as a photo send.
     */
    fun useAsAvatar() {
        if (busy) return
        if (cropping) exitCrop()
        busy = true
        haptics.confirm()
        val img = runCatching { shot?.asAndroidBitmap() }.getOrNull()
        val drawn = strokes.toList()
        val wrote = texts.toList()
        val placed = stickers.toList()
        val filt = filterMatrix
        val turn = rotation
        val hdShot = hd
        val box = cropBox?.takeIf { !it.isFull() }
        val srcUri = mediaUri
        ScreenStore.appScope.launch {
            val out =
                runCatching {
                    if (pickedIsVideo) throw Exception("A profile photo has to be a picture.")
                    val bmp = img ?: throw Exception("Could not read that photo.")
                    val edited =
                        drawn.isNotEmpty() || wrote.isNotEmpty() || placed.isNotEmpty() ||
                            filt != null || turn != 0 || hdShot || box != null
                    if (!edited) {
                        srcUri
                    } else {
                        val url = bakeFull(bmp, drawn, filt, wrote, placed, hdShot)
                            ?: throw Exception("Could not save the drawing.")
                        val bytes = android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                        val f = java.io.File(ctx.cacheDir, "avatar_${System.currentTimeMillis()}.jpg")
                        f.writeBytes(bytes)
                        androidx.core.content.FileProvider.getUriForFile(
                            ctx,
                            "${ctx.packageName}.fileprovider",
                            f,
                        )
                    }
                }.getOrNull()
            withContext(Dispatchers.Main) {
                busy = false
                if (out == null) {
                    haptics.reject()
                    notice = "Could not use that photo."
                } else {
                    ScreenStore.pendingAvatarUri.value = out.toString()
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
                                FilesUtil.copyDocument(ctx, mediaUri, "video.mp4")?.second
                                    ?: throw Exception("Could not read that video.")
                            } else {
                                java.io.File(ctx.cacheDir, "edit_${System.currentTimeMillis()}.mp4").also { out ->
                                    try {
                                        VideoExport.export(ctx, mediaUri, s, e, box, out, overlay = overlay, colorMat = filt?.array, userTurns = turn)
                                    } catch (err: Exception) {
                                        if (hasEdits) throw err
                                        out.delete()
                                        VideoExport.passthrough(ctx, mediaUri, s, e, out)
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

    /** v167 (owner: "undo redo amar screenshot a dekhano jaigay ami pain"):
     *  the floating history pair — a 40 dp dark seat so the glyph reads over a
     *  bright photo, one hairline, dimmed (never hidden) while it has nothing
     *  to act on. [glyph] keeps the seat's shape identical on every row. */
    @Composable
    fun StageHistory(can: Boolean, onClick: () -> Unit, glyph: @Composable () -> Unit) {
        // v170 (owner: "edit options gular border background remove hobe
        // just icon tahkbe"): bare glyphs - no circle, no border; a seat
        // that cannot fire just dims.
        Box(
            Modifier
                .size(40.dp)
                .alpha(if (can) 1f else 0.35f)
                .clickable(enabled = can) { onClick() },
            contentAlignment = Alignment.Center,
        ) {
            glyph()
        }
    }

    /** Owner round 36 (item 6): the pen + overlay layer — one canvas shared
     *  by the photo and the video stage (gestures + draw, normalised units). */
    @Composable
    fun StageCanvas(onStageTap: () -> Unit = {}) {
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
                                    live?.let {
                                        if (it.points.size > 1) {
                                            strokes.add(it)
                                            redoStack.clear()
                                        }
                                    }
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
                                if (!moved && hit == null) {
                                    selectedId = null
                                    onStageTap()
                                }
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

    // v168 (owner: "undo redo button 2ta upore left right ei thakuk" + the
    // tools "right side a upor niche"): the chrome reads its abilities here -
    // the top bar takes undo (left) and redo (right), the right rail takes
    // the tools, clear included.
    val canUndo = strokes.isNotEmpty() || overlayPast.isNotEmpty()
    val canRedo = redoStack.isNotEmpty()

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
                        // Polish 2026-09-18: trim strip + caption + send +
                        // top bar buttons are exempt — only the middle photo
                        // area browses, so handles/scrub/buttons win.
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                            val h = size.height.toFloat()
                            if (down.position.y < 180f || down.position.y > h - 520f) {
                                while (true) {
                                    val ev = awaitPointerEvent(PointerEventPass.Initial)
                                    val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!ch.pressed) break
                                }
                            } else {
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
                    }
                },
            ),
    ) {
        // Owner round 35 (item 8): the photo owns the whole screen —
        // chrome floats OVER it on soft black scrims, nothing boxes it in.
        Box(Modifier.fillMaxSize()) {
            /* the stage, full-bleed: media max-fit at its own aspect; overlays + the pen layer over a photo */
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                // Owner v160 (item 2): chrome stays put, ONLY the media swaps
                // on swipe. Everything read here is keyed to pickedUri, so the
                // inner media always belongs to the selected item.
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
                                StatusTrimPreview(
                                    mediaUri,
                                    start,
                                    end,
                                    paused = vidPaused,
                                    turn = rotation,
                                    colorMat = filterMatrix?.array,
                                    crop = if (cropping) null else cropBox,
                                    scrubAt = scrub,
                                    seekTo = seekTo,
                                    onSeekDone = { seekTo = null },
                                    onPosition = { playAt = it },
                                )
                                // v169 (owner: "video te tap korlei puse
                                // hobe ... only puse korle icon dekhabe resume
                                // korle hide hoye jabe"): a plain tap on the
                                // stage toggles the clip; the glyph rides
                                // ONLY the paused state (the player's own
                                // 56 dp play seat), never the playing one.
                                StageCanvas(onStageTap = {
                                    if (!cropping && !penMode && !busy) {
                                        haptics.tap()
                                        vidPaused = !vidPaused
                                    }
                                })
                                if (vidPaused && !cropping && !penMode && !busy) {
                                    Box(
                                        Modifier
                                            .align(Alignment.Center)
                                            .size(56.dp)
                                            .clip(CircleShape)
                                            .background(Color(0x66000000))
                                            .clickable {
                                                haptics.tap()
                                                vidPaused = false
                                            },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(32.dp))
                                    }
                                }
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
                // v170 (owner: "done button left side a thakbe"): Done rides
                // on the LEFT now, next to the ✕.
                if (hasEdits || busy) {
                    // v166: the same chip carries the bake's number — "Applying
                    // 42%" replaces "Done" while the clip is being written, so
                    // a long trim can never look like a frozen button.
                    val pct = applyPct
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(13.dp))
                            .background(Color(0x2EFFFFFF))
                            .border(0.5.dp, Color(0x4DFFFFFF), RoundedCornerShape(13.dp))
                            .clickable(enabled = !busy) {
                                haptics.tap()
                                applyEdits()
                            }
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (busy && pct >= 0f) "Applying ${(pct * 100).toInt()}%" else "Done",
                            color = Color.White.copy(alpha = if (busy) 0.7f else 0.94f),
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.Medium,
                        )
                    }
                    Spacer(Modifier.width(5.dp))
                }
                // v169 (owner: "undo redo button gula eto boro ar background
                // border rakhcho keno ar eto dure dure thakbe na middle a
                // thakbe pasha pashi"): the pair rides the TOP BAR CENTRE,
                // side by side, plain glyphs - no circle, no border.
                Spacer(Modifier.weight(1f))
                if (shot != null || clip != null) {
                    IconButton(onClick = { haptics.tap(); undoEdit() }, enabled = canUndo, modifier = Modifier.size(32.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.Undo,
                            "Undo",
                            tint = Color.White.copy(alpha = if (canUndo) 1f else 0.35f),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    IconButton(onClick = { haptics.tap(); redoEdit() }, enabled = canRedo, modifier = Modifier.size(32.dp)) {
                        Icon(
                            Icons.AutoMirrored.Filled.Redo,
                            "Redo",
                            tint = Color.White.copy(alpha = if (canRedo) 1f else 0.35f),
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                // v164 (owner): the clip length used to sit here. Done takes
                // its place — it APPLIES what the user has made so far (bake
                // the layers into the working file) and leaves the editor open.
                // Nothing is sent and nothing goes to the gallery. No edit, no
                // button: there would be nothing to apply.
                // v165 (owner): smaller, and its fill is a near-transparent
                // grey with a hairline — the solid blue chip shouted.
                Spacer(Modifier.weight(1f))
                // v165 (owner): a profile photo and a status post carry no HD
                // switch - the pill is the chat send's alone.
                if (clip == null && !statusMode && !avatarMode) {
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
                // Polish 2026-09-18: rounded check box - drives the pool
                // multi-select (attachSel); tick = selected for send.
                if (onToggleSelect != null) {
                    Spacer(Modifier.width(6.dp))
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(if (isSelected == true) ActionBlue else Color.Transparent)
                            .border(1.5.dp, Color.White, CircleShape)
                            .clickable { onToggleSelect.invoke() },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isSelected == true) {
                            Icon(Icons.Filled.Check, contentDescription = "Selected", tint = Color.White, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }

            // v168 (owner: "edit options gula ... right side a upor niche
            // vabe sajay daw"): every edit tool is one 40 dp seat on a
            // right-side vertical rail - rotate / crop / sticker / text /
            // pen / clear / save, top to bottom, one size, evenly spaced.
            if (shot != null || clip != null) {
                Column(
                    Modifier
                        .align(Alignment.TopEnd)
                        .statusBarsPadding()
                        .padding(top = 52.dp, end = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    // v169 (owner: "otar theke ektu niche thakbe edit pencil
                    // icon otar niche thakbe emoji icon otar niche thakbe crop
                    // otar niche Aa ... rotate ... effect ... save; ekhane
                    // delete icon remove hobe"): the rail's NEW order, and
                    // every seat is LIVE (a first tap always works - v168
                    // armed the pen / crop seats with their own state and a
                    // cold tap did nothing). The effects seat replaces the
                    // old swipe-up hint; undo covers the trash.
                    StageHistory(true, {
                        haptics.tap()
                        exitCrop()
                        penMode = !penMode
                    }) {
                        Icon(Icons.Filled.Edit, "Draw", tint = if (penMode) ActionBlue else Color.White, modifier = Modifier.size(20.dp))
                    }
                    StageHistory(true, {
                        haptics.tap()
                        exitCrop()
                        showStickerSheet = true
                    }) {
                        Icon(Icons.Filled.EmojiEmotions, "Stickers", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    StageHistory(true, { haptics.tap(); if (cropping) exitCrop() else enterCrop() }) {
                        Icon(Icons.Filled.Crop, "Crop", tint = if (cropping) ActionBlue else Color.White, modifier = Modifier.size(20.dp))
                    }
                    StageHistory(true, {
                        haptics.tap()
                        exitCrop()
                        showTextSheet = true
                    }) {
                        Text("Aa", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                    }
                    StageHistory(true, { haptics.tap(); rotateTap() }) {
                        Icon(Icons.Filled.RotateRight, "Rotate", tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    StageHistory(true, {
                        haptics.tap()
                        filtersOpen = !filtersOpen
                    }) {
                        Icon(Icons.Filled.AutoAwesome, "Effects", tint = if (filtersOpen) ActionBlue else Color.White, modifier = Modifier.size(20.dp))
                    }
                    // v165 (owner: "profile picture a edit a save button
                    // remove koro"): the profile flow has no save-to-gallery.
                    if (!avatarMode) {
                        StageHistory(true, { haptics.tap(); saveCurrent() }) {
                            Icon(Icons.Filled.Download, "Save to gallery", tint = Color.White, modifier = Modifier.size(20.dp))
                        }
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
                    // v169 (owner: "effect icon ekhon ota niche swipe up a
                    // ache okhan theke remove hobe"): the hint row is gone -
                    // the rail's Effects seat owns the strip now.
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
                        onSeek = {
                            seekTo = it
                            playAt = it
                        },
                    )
                }
                /* the caption bar + recipient chip / send ride above the keyboard */
                Column(Modifier.imePadding()) {
                    // v164: a profile photo has no caption and no ① view-once.
                    if (!statusMode && !avatarMode) {
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
                                if (avatarMode) "Profile photo" else ScreenStore.editTitle.ifBlank { "Chat" },
                                color = Color.White,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        if (ready) {
                            // Owner round 35 (item 8): the send is a small BLUE dot.
                            // Polish 2026-09-18: when pool multi-select is active the FAB
                            // shows the count badge (2/3…) at its top-end.
                            Box(contentAlignment = Alignment.Center) {
                                Box(
                                    Modifier
                                        .size(40.dp)
                                        .clip(CircleShape)
                                        .background(ActionBlue)
                                        .clickable(enabled = !busy) {
                                            haptics.confirm()
                                            if (cropping) {
                                                exitCrop()
                                            } else if (avatarMode) {
                                                useAsAvatar()
                                            } else {
                                                send()
                                            }
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (busy) {
                                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.5.dp, modifier = Modifier.size(20.dp))
                                    } else {
                                        Icon(
                                            if (statusMode || avatarMode) Icons.Filled.Check else Icons.AutoMirrored.Filled.Send,
                                            contentDescription =
                                                when {
                                                    avatarMode -> "Use photo"
                                                    statusMode -> "Done"
                                                    else -> "Send"
                                                },
                                            tint = Color.White,
                                            modifier = Modifier.size(20.dp),
                                        )
                                    }
                                }
                                if (selectedCount > 1) {
                                    Box(
                                        Modifier
                                            .align(Alignment.TopEnd)
                                            .offset(x = 4.dp, y = (-4).dp)
                                            .size(18.dp)
                                            .clip(CircleShape)
                                            .background(Color(0xFFE53935))
                                            .border(1.dp, Color.White, CircleShape),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            "$selectedCount",
                                            color = Color.White,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                            style = androidx.compose.ui.text.TextStyle(
                                                platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false),
                                                lineHeightStyle = androidx.compose.ui.text.style.LineHeightStyle(
                                                    alignment = androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center,
                                                    trim = androidx.compose.ui.text.style.LineHeightStyle.Trim.Both,
                                                ),
                                            ),
                                            modifier = Modifier.align(Alignment.Center),
                                        )
                                    }
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
    /**
     * A drawn-on photo, as the same JPEG data URL the picker path produces.
     * v166: [w] / [h] are the BAKED file's own pixels (an HD bake is bigger
     * than the working copy), so the chat can lay its bubble and its flying
     * clone out at the real ratio from the first frame.
     */
    data class Photo(val dataUrl: String, val w: Int = 0, val h: Int = 0) : EditedMedia()

    /** A trimmed clip in the cache — sent as a FILE like a picked video. */
    data class Video(
        val file: java.io.File,
        val mime: String,
        val w: Int = 0,
        val h: Int = 0,
        val durMs: Long = 0L,
    ) : EditedMedia()

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
/** v166: the pixels inside a JPEG data URL — header only, no decode. */
internal fun jpegBox(dataUrl: String): Pair<Int, Int> =
    runCatching {
        val bytes = android.util.Base64.decode(dataUrl.substringAfter(",", ""), android.util.Base64.DEFAULT)
        val opts = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        if (opts.outWidth > 0 && opts.outHeight > 0) opts.outWidth to opts.outHeight else 0 to 0
    }.getOrDefault(0 to 0)

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
