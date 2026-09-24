package app.kuchupuchu.android

import android.content.pm.ActivityInfo
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.navigation.NavController
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/*
 * Owner round 31 (items 14 + 15): KuchuPuchu's OWN photo viewer and video
 * player. Nothing here hands media to the system default — the player is a
 * TextureView + MediaPlayer with the app's controls (no stock widget controller),
 * and every photo in the app (chat, profile, group, media tab) opens in the
 * same viewer.
 */

/** Message JSON → URL-safe nav argument (and back). */
internal fun mediaArg(m: JSONObject): String =
    android.util.Base64.encodeToString(
        m.toString().toByteArray(),
        android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
    )

internal fun mediaArgDecode(b64: String): JSONObject? =
    runCatching {
        JSONObject(
            String(
                android.util.Base64.decode(b64, android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP),
                Charsets.UTF_8,
            ),
        )
    }.getOrNull()

/** The viewable URL of a photo message: inline/absolute mediaUrl, else the file key. */
internal fun messageMediaUrl(m: JSONObject): String =
    m.optText("kpLocalUrl").takeIf { it.isNotBlank() }
        ?: m.optText("mediaUrl").takeIf { it.isNotBlank() }
        ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { key ->
            if (key.startsWith("data:") || key.startsWith("http") || key.startsWith("/")) key else "/api/files/$key"
        } ?: ""

/** "Today, 3:45 PM" · "Yesterday, 9:02 AM" · "7 Sep 2026, 11:10 PM". */
internal fun viewerStamp(iso: String): String {
    if (iso.isBlank()) return ""
    val z = runCatching { atDhaka(java.time.Instant.parse(iso)) }.getOrNull() ?: return ""
    val today = dhakaNow().toLocalDate()
    val day =
        when (z.toLocalDate()) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> {
                val mon = z.month.toString().take(3).let { it[0] + it.substring(1).lowercase() }
                "${z.dayOfMonth} $mon ${z.year}"
            }
        }
    val h = (z.hour % 12).let { if (it == 0) 12 else it }
    return "$day, %d:%02d %s".format(h, z.minute, if (z.hour >= 12) "PM" else "AM")
}

private fun clock(ms: Int): String {
    val s = (ms.coerceAtLeast(0)) / 1000
    return "%d:%02d".format(s / 60, s % 60)
}

private fun playerAccent(): Color = if (KpThemeMode.darkBlue) ActionBlue else Gold

/* ------------------------------------------------------------------ */
/*                              PHOTOS                                */
/* ------------------------------------------------------------------ */

/**
 * Fullscreen photo viewer: pinch/double-tap zoom, pan when zoomed, swipe
 * down to close, tap to hide the chrome. Save always copies to
 * Pictures/KuchuPuchu; Forward shows only when the host wires it.
 */
@Composable
fun KpPhotoViewer(
    url: String,
    title: String,
    subtitle: String = "",
    onClose: () -> Unit,
    onForward: (() -> Unit)? = null,
    canSave: Boolean = true,
    secure: Boolean = false,
    // Owner round 39 (item 1): the host wires this to open the current page
    // in the media editor (download → mediaedit route → Done sends it back
    // to the chat like any picked media). Null = no Edit row, as before.
    onEdit: (() -> Unit)? = null,
    // v166 (owner: "photo video … kothaw 3 dot nei … Save, Forward, Delete"):
    // Delete joins the same ⋮. The viewer never touches the list — it hands
    // the one request to its host, which runs the chat's own delete (the
    // vanishing show, the dust latch, the server call, the local hide).
    // Both null = the sheet keeps its old shape.
    onDeleteForMe: (() -> Unit)? = null,
    onDeleteForEveryone: (() -> Unit)? = null,
    // r68-8: the checkbox line for this chat ("Also delete for <peer>"). The
    // viewer is generic — only its host knows who the other person is — and a
    // null label simply means this delete has no other side to speak of.
    deleteAlsoLabel: String? = null,
    // Owner round 32 (item 17): fired once the picture is on screen (a failed
    // load never fires it) — the chat uses it to spend a view-once opening.
    onShown: (() -> Unit)? = null,
    // Owner round 34 (item 6): album paging — the chat passes every photo +
    // the tapped index; single-photo callers keep the old params, one page.
    urls: List<String> = emptyList(),
    subtitles: List<String> = emptyList(),
    startIndex: Int = 0,
    onPageChanged: ((Int) -> Unit)? = null,
    // H3 (audit 2026-09-21): a view-once page is never cached anywhere —
    // Coil memory + disk caching is disabled for the whole viewer instance.
    once: Boolean = false,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var scale by remember { mutableFloatStateOf(1f) }
    // v165: the running double-tap zoom (a second double-tap takes it over).
    var zoomJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var offX by remember { mutableFloatStateOf(0f) }
    var offY by remember { mutableFloatStateOf(0f) }
    val drag = remember { Animatable(0f) }
    var chrome by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    // Owner round 32 (item 46): the viewer's ⋮ opens a sheet with Save /
    // Forward (nothing else); the old always-visible bottom strip is gone.
    var menuOpen by remember { mutableStateOf(false) }
    // v166: Delete asks one question first (for everyone / for me), the same
    // words the chat's long-press sheet uses.
    var confirmDelete by remember { mutableStateOf(false) }
    // Owner round 34 (item 6): one page per photo; zoom resets on each flip.
    val pages = urls.ifEmpty { listOf(url) }
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(pages.indices)) { pages.size }
    LaunchedEffect(pager.currentPage) {
        scale = 1f
        offX = 0f
        offY = 0f
        onPageChanged?.invoke(pager.currentPage)
    }
    fun savePhoto() {
        if (saving) return
        val pageUrl = pages[pager.currentPage]
        scope.launch {
            saving = true
            val bytes =
                withContext(Dispatchers.IO) {
                    runCatching {
                        if (pageUrl.startsWith("data:")) {
                            android.util.Base64.decode(pageUrl.substringAfter(","), android.util.Base64.DEFAULT)
                        } else {
                            Api.download(pageUrl)
                        }
                    }.getOrNull()
                }
            saving = false
            if (bytes == null) {
                android.widget.Toast.makeText(ctx, "Could not download the photo", android.widget.Toast.LENGTH_SHORT).show()
            } else {
                val saved = FilesUtil.saveImage(ctx, bytes, "kuchupuchu_${System.currentTimeMillis()}.jpg")
                android.widget.Toast.makeText(
                    ctx,
                    if (saved != null) "Saved to Pictures/KuchuPuchu" else "Could not save",
                    android.widget.Toast.LENGTH_SHORT,
                ).show()
            }
        }
    }
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // Owner round 31 item 21: a private person's picture — the viewer's
        // own window is the one a screenshot would capture, so guard THAT
        // (Save / Forward are already withheld by the caller).
        KpSecure.Guard(secure || !canSave)
        // White status icons over the black viewer, whatever the app theme.
        val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            dialogWindow?.let { w ->
                WindowCompat.getInsetsController(w, w.decorView).isAppearanceLightStatusBars = false
            }
        }
        val dim = (1f - abs(drag.value) / 900f).coerceIn(0.35f, 1f)
        val chromeAlpha by animateFloatAsState(if (chrome) 1f else 0f, tween(160), label = "photochrome")
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = dim))) {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            var twoFinger = false
                            var travelled = 0f
                            var dismissing = false
                            var dragLocal = 0f
                            while (true) {
                                val event = awaitPointerEvent()
                                if (event.changes.none { it.pressed }) break
                                if (event.changes.count { it.pressed } > 1) twoFinger = true
                                val zoom = event.calculateZoom()
                                val pan = event.calculatePan()
                                if (twoFinger || scale > 1.01f) {
                                    if (zoom != 1f) {
                                        val newScale = (scale * zoom).coerceIn(1f, 6f)
                                        val c = event.calculateCentroid()
                                        val factor = newScale / scale
                                        val cx = c.x - size.width / 2f
                                        val cy = c.y - size.height / 2f
                                        offX = (offX - cx) * factor + cx
                                        offY = (offY - cy) * factor + cy
                                        scale = newScale
                                    }
                                    offX += pan.x
                                    offY += pan.y
                                    if (scale <= 1.01f) {
                                        scale = 1f
                                        offX = 0f
                                        offY = 0f
                                    } else {
                                        val maxX = size.width * (scale - 1f) / 2f
                                        val maxY = size.height * (scale - 1f) / 2f
                                        offX = offX.coerceIn(-maxX, maxX)
                                        offY = offY.coerceIn(-maxY, maxY)
                                    }
                                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                                } else {
                                    travelled += abs(pan.y)
                                    if (travelled > viewConfiguration.touchSlop) {
                                        dismissing = true
                                        dragLocal += pan.y
                                        val v = dragLocal
                                        scope.launch { drag.snapTo(v) }
                                        event.changes.forEach { if (it.positionChanged()) it.consume() }
                                    }
                                }
                            }
                            if (dismissing) {
                                if (abs(dragLocal) > size.height * 0.16f) {
                                    onClose()
                                } else {
                                    scope.launch { drag.animateTo(0f) }
                                }
                            }
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { chrome = !chrome },
                            onDoubleTap = { p ->
                                // v165 (owner: "double tap korle rudely zoom
                                // hocche eita animation er sathe kore daw"):
                                // the tap used to TELEPORT the picture to 2.5x
                                // (and back). The target is the same; it is
                                // walked there now — a short spring that reads
                                // as a zoom instead of a jump. Pinch is
                                // untouched and cancels the animation by
                                // writing the same state the animation drives.
                                val target = if (scale > 1f) 1f else 2.5f
                                val tx =
                                    if (target > 1f) {
                                        val maxX = size.width * (target - 1f) / 2f
                                        ((size.width / 2f - p.x) * (target - 1f)).coerceIn(-maxX, maxX)
                                    } else {
                                        0f
                                    }
                                val ty =
                                    if (target > 1f) {
                                        val maxY = size.height * (target - 1f) / 2f
                                        ((size.height / 2f - p.y) * (target - 1f)).coerceIn(-maxY, maxY)
                                    } else {
                                        0f
                                    }
                                val s0 = scale
                                val x0 = offX
                                val y0 = offY
                                zoomJob?.cancel()
                                zoomJob =
                                    scope.launch {
                                        androidx.compose.animation.core.animate(
                                            0f,
                                            1f,
                                            animationSpec = spring(
                                                dampingRatio = 0.86f,
                                                stiffness = Spring.StiffnessMediumLow,
                                            ),
                                        ) { k, _ ->
                                            scale = s0 + (target - s0) * k
                                            offX = x0 + (tx - x0) * k
                                            offY = y0 + (ty - y0) * k
                                        }
                                        scale = target
                                        offX = tx
                                        offY = ty
                                    }
                            },
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                // Owner round 34 (item 6): swipe between the album's photos;
                // a zoomed photo holds the gesture (no accidental page flip).
                HorizontalPager(
                    state = pager,
                    modifier = Modifier.fillMaxSize(),
                    userScrollEnabled = scale <= 1.01f,
                ) { page ->
                    KpNetImage(
                        pages[page],
                        title,
                        Modifier
                            .fillMaxSize()
                            .graphicsLayer(
                                scaleX = scale,
                                scaleY = scale,
                                translationX = offX,
                                translationY = offY + drag.value,
                            ),
                        ContentScale.Fit,
                        onLoaded = onShown,
                        noCache = once,
                    )
                }
            }
            if (chromeAlpha > 0.01f) {
                val pageSubtitle = subtitles.getOrElse(pager.currentPage) { subtitle }
                Row(
                    Modifier
                        .align(Alignment.TopCenter)
                        .fillMaxWidth()
                        .graphicsLayer { alpha = chromeAlpha }
                        .background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent)))
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}
                        .statusBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Color.White, modifier = Modifier.size(28.dp))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            title,
                            color = Color.White,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (pageSubtitle.isNotBlank()) {
                            Text(pageSubtitle, color = Color(0xB3FFFFFF), fontSize = 11.5.sp, maxLines = 1)
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    if (saving) {
                        CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.padding(end = 14.dp).size(18.dp))
                    } else if (canSave || onForward != null || onEdit != null || onDeleteForMe != null || onDeleteForEveryone != null) {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(24.dp))
                        }
                    }
                }
                // Owner round 34 (item 6): album position, riding the chrome.
                if (pages.size > 1) {
                    Box(
                        Modifier
                            .align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .padding(bottom = 18.dp)
                            .background(Color(0x99000000), RoundedCornerShape(12.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            "${pager.currentPage + 1} / ${pages.size}",
                            color = Color.White,
                            fontSize = 12.sp,
                        )
                    }
                }
            }
        }
    }
    // The sheet is its own window, composed beside the viewer dialog (a later
    // window stacks above it) — not nested inside the dialog's composition.
    if (menuOpen) {
        MediaMenuSheet(
            onDismiss = { menuOpen = false },
            onSave = if (canSave) ({ menuOpen = false; savePhoto() }) else null,
            onForward = onForward?.let { f -> { menuOpen = false; f() } },
            onEdit = onEdit?.let { e -> { menuOpen = false; e() } },
            onDelete =
                if (onDeleteForMe != null || onDeleteForEveryone != null) {
                    { menuOpen = false; confirmDelete = true }
                } else {
                    null
                },
        )
    }
    if (confirmDelete) {
        // r68-8: the viewer's delete is the SAME popup the chat uses — one
        // option, and the checkbox decides whether the other side is affected.
        KpDeleteDialog(
            title = "Delete message",
            question = "Are you sure you want to delete this message?",
            alsoLabel = if (onDeleteForEveryone != null) deleteAlsoLabel else null,
            confirmLabel = "Delete",
            onDismiss = { confirmDelete = false },
            onConfirm = { also ->
                confirmDelete = false
                if (also) onDeleteForEveryone?.invoke() else onDeleteForMe?.invoke()
            },
        )
    }
}

/** v166: a row that is still on its way out of this phone (its echo id is the
 *  client id) — the viewer withholds "Delete for everyone" for it, exactly as
 *  the chat's sheet does. */
internal fun isEchoMsg(m: JSONObject): Boolean = m.optString("id").startsWith("c_")

/** Owner round 32 (item 46): the viewer / player ⋮ sheet — Save, Forward.
 *  Owner round 39 (item 1): + Edit (owner order Save / Forward / Edit) —
 *  the photo viewer wires it, the video player leaves it null. */
@Composable
internal fun MediaMenuSheet(
    onDismiss: () -> Unit,
    onSave: (() -> Unit)?,
    onForward: (() -> Unit)?,
    onEdit: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null,
) {
    KpSheet(onDismiss = onDismiss) {
        if (onSave != null) KpSheetRow(Icons.Filled.Download, "Save", onClick = onSave)
        if (onForward != null) KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward", onClick = onForward)
        if (onEdit != null) KpSheetRow(Icons.Filled.Brush, "Edit", onClick = onEdit)
        if (onDelete != null) KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red, onClick = onDelete)
        // v167: the photo viewer is a full-screen DIALOG with no back chrome
        // and no outside-dismiss — a sheet the user could not close. Every
        // sheet gets its own way out.
        KpSheetRow(Icons.Filled.Close, "Dismiss") { onDismiss() }
    }
}

/* ------------------------------------------------------------------ */
/*                              VIDEOS                                */
/* ------------------------------------------------------------------ */

/**
 * The in-app video player screen (route `videoplayer/{b64}`): the clip is
 * downloaded once into the app's cache (files need the auth header), then
 * played on a TextureView with KuchuPuchu's own controls — play/pause/replay,
 * a scrubbable seek bar, mute, and ⋮ (Save / Forward / Delete) in the top bar,
 * where the rotate button used to sit (v167 removed it). Tap anywhere toggles
 * the controls; they hide themselves after three seconds of playback.
 */
@Composable
fun VideoPlayerScreen(nav: NavController, b64: String) {
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    val m = remember(b64) { mediaArgDecode(b64) }
    val accent = playerAccent()
    val window = MainActivity.current?.window
    DisposableEffect(Unit) {
        val controller = window?.let { WindowCompat.getInsetsController(it, it.decorView) }
        controller?.isAppearanceLightStatusBars = false
        onDispose {
            controller?.isAppearanceLightStatusBars = !KpThemeMode.darkBlue
            controller?.show(WindowInsetsCompat.Type.systemBars())
            MainActivity.current?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
    val dest = remember(b64) { m?.let { videoCacheFile(ctx, it) } }
    val src = remember(b64) { m?.let { videoSource(it) } ?: "" }
    val title = m?.optText("kpTitle")?.ifBlank { null } ?: "Video"
    // Owner round 31 item 21: a video from / with a private profile — no
    // capture, no Save (the chat passes `kpPrivate` along in the argument).
    val privateClip = m?.optBoolean("kpPrivate") == true
    KpSecure.Guard(privateClip)
    // r71-18: the chat's "Media Save permission" — this clip was sent by
    // someone who withheld saving, so the Save row goes and the capture guard
    // stays off (they may look, they may not keep a copy).
    val noSaveClip = m?.optBoolean("kpNoSave") == true
    // Owner round 32 (item 17): a view-once clip — the opening is spent the
    // moment the clip is on screen; kpPrivate already withholds Save / Forward.
    val onceClip = m?.optBoolean("kpOnce") == true
    val sub = m?.let { viewerStamp(it.optText("createdAt")) } ?: ""
    // 0 loading · 1 ready · -1 failed
    var state by remember(b64) { mutableIntStateOf(if (dest != null && dest.exists() && dest.length() > 0L) 1 else 0) }
    var aspect by remember(b64) {
        mutableFloatStateOf(
            dest?.let { VideoThumbs.readMeta(it.absolutePath)?.ratio }
                // v163: the message carries the clip's own box from the sender's
                // measurement, so a clip that was never downloaded still opens
                // in its own shape instead of the hardcoded 16:9.
                ?: m?.let { MediaBox.payloadRatio(it) }?.takeIf { it > 0f }
                ?: (16f / 9f),
        )
    }
    var player by remember { mutableStateOf<KpClipPlayer?>(null) }
    var posMs by remember { mutableIntStateOf(0) }
    var durMs by remember { mutableIntStateOf(0) }
    var playing by remember { mutableStateOf(false) }
    var ended by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    var playError by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    var scrubbing by remember { mutableStateOf(false) }
    var scrubFrac by remember { mutableFloatStateOf(0f) }
    var saved by remember { mutableStateOf(false) }
    var savingClip by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    // v165 (owner: "photo va video zoom korar jonno double tap korle rudely
    // zoom hocche … smoothly zoom hoi"): the clip zooms under a double tap the
    // way the photo does — same 2.5x, same spring, same walk there instead of
    // a jump. The gesture sits on the same detector that toggles the chrome;
    // pinch is not claimed (the player keeps its own controls).
    var vScale by remember { mutableFloatStateOf(1f) }
    var vOffX by remember { mutableFloatStateOf(0f) }
    var vOffY by remember { mutableFloatStateOf(0f) }
    var vZoomJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    // Owner round 32 (item 46): ⋮ → Save / Forward sheet (Forward = the
    // chat picker, then the clip is re-posted by its file key).
    var menuOpen by remember { mutableStateOf(false) }
    var forwarding by remember { mutableStateOf(false) }
    // v166 (owner: "video photo te je send korche je receive korche kothaw 3 dot
    // nei"): the player's ⋮ carries Delete too. This screen is a ROUTE — it has
    // no list — so the request goes to the chat through ScreenStore and the
    // player closes; the chat runs its own delete exactly as if the user had
    // long-pressed the bubble.
    var confirmDelete by remember { mutableStateOf(false) }
    // r68-8: the gate is the chat's own predicate — in a personal chat the
    // OTHER person's message can be deleted for everyone too. This screen is a
    // ROUTE (it has no conversation of its own), so it reads the chat that
    // opened it from the store; no chat, no checkbox.
    val canUnsend = canDeleteForEveryone(ScreenStore.activeConvId, m)
    fun raiseDelete(everyone: Boolean) {
        val id = m?.optString("id").orEmpty()
        if (id.isNotBlank()) ScreenStore.viewerDelete.value = ScreenStore.ViewerDelete(id, everyone)
        nav.popBackStack()
    }
    val canForward = m != null && !privateClip && m.optText("fileKey").isNotBlank()
    fun saveClip() {
        if (m == null || dest == null || savingClip || saved) return
        scope.launch {
            savingClip = true
            // v167: the clip is fetched first when Save is tapped before the
            // player's own download finished (Save was already offered — it
            // must never answer with "Could not save").
            val have =
                withContext(Dispatchers.IO) {
                    if (dest.exists() && dest.length() > 0L) {
                        true
                    } else {
                        runCatching {
                            val tmp = java.io.File(dest.absolutePath + ".part")
                            val done = Api.downloadToFile(src, tmp) && tmp.length() > 0L
                            if (done) {
                                if (!tmp.renameTo(dest)) {
                                    tmp.copyTo(dest, overwrite = true)
                                    tmp.delete()
                                }
                            } else {
                                tmp.delete()
                            }
                            done
                        }.getOrDefault(false)
                    }
                }
            if (have) state = 1
            val name = m.optText("fileName").ifBlank { "KuchuPuchu_${System.currentTimeMillis()}.mp4" }
            val ok =
                have &&
                withContext(Dispatchers.IO) {
                    saveVideoToDownloads(ctx, dest, name, FilesUtil.mimeFor(name, m.optText("fileType")))
                }
            savingClip = false
            saved = ok
            android.widget.Toast.makeText(
                ctx,
                if (ok) "Saved to Downloads" else "Could not save",
                android.widget.Toast.LENGTH_SHORT,
            ).show()
        }
    }
    if (menuOpen) {
        MediaMenuSheet(
            onDismiss = { menuOpen = false },
            // v167 (owner: "ager bar o same question korcho but add koroni" —
            // the last round ANSWERED "Save + Forward + Delete" and the ⋮ was
            // still unreachable: the seat was a floating twin that the
            // auto-hiding chrome could leave behind). Save is attempted
            // FIRST now — if the clip is not on this phone yet, [saveClip]
            // fetches it and then saves, instead of the old gate silently
            // leaving the row out.
            onSave =
                if (m != null && !saved && (KpSecure.amOwner() || (!privateClip && !noSaveClip))) {
                    ({ menuOpen = false; saveClip() })
                } else {
                    null
                },
            onForward = if (canForward) ({ menuOpen = false; forwarding = true }) else null,
            onDelete = if (m != null) ({ menuOpen = false; confirmDelete = true }) else null,
        )
    }
    if (confirmDelete) {
        KpDeleteDialog(
            title = "Delete message",
            question = "Are you sure you want to delete this message?",
            alsoLabel = if (canUnsend) deleteAlsoLabelForActiveChat() else null,
            confirmLabel = "Delete",
            onDismiss = { confirmDelete = false },
            onConfirm = { also ->
                confirmDelete = false
                raiseDelete(everyone = also)
            },
        )
    }
    if (forwarding && m != null) {
        ForwardDialog(
            onClose = { forwarding = false },
            onSend = { targets ->
                forwarding = false
                scope.launch {
                    val ok = targets.all { runCatching { forwardMessageTo(it, m) }.isSuccess }
                    android.widget.Toast.makeText(ctx, if (ok) "Forwarded" else "Could not forward", android.widget.Toast.LENGTH_SHORT).show()
                }
            },
        )
    }

    LaunchedEffect(b64) {
        if (m == null || dest == null) {
            state = -1
            return@LaunchedEffect
        }
        if (state == 1) return@LaunchedEffect
        val ok =
            withContext(Dispatchers.IO) {
                runCatching {
                    // Stream to a .part file first: a download that dies halfway
                    // must not leave a truncated clip that later plays as "cached".
                    val tmp = java.io.File(dest.absolutePath + ".part")
                    val done = Api.downloadToFile(src, tmp) && tmp.length() > 0L
                    if (done) {
                        if (!tmp.renameTo(dest)) {
                            tmp.copyTo(dest, overwrite = true)
                            tmp.delete()
                        }
                    } else {
                        tmp.delete()
                    }
                    done
                }.getOrDefault(false)
            }
        state = if (ok) 1 else -1
    }
    // H3 (audit 2026-09-21): a view-once clip's downloaded bytes + thumb
    // sidecars die with the viewing — the cache must not keep a copy of a
    // message the server has already vanished.
    DisposableEffect(b64, onceClip) {
        onDispose {
            if (onceClip) {
                runCatching { dest?.delete() }
                dest?.absolutePath?.let { VideoThumbs.evict(it) }
            }
        }
    }
    LaunchedEffect(state) {
        if (onceClip && state == 1) ViewOnce.spend(m?.optString("id").orEmpty())
    }
    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        while (true) {
            // Background = pause (the clip must not keep talking under another app).
            if (!Store.foreground && p.playing) p.pause()
            p.snapshot()?.let { (cur, dur, isPlaying) ->
                if (!scrubbing) posMs = cur
                if (dur > 0) durMs = dur
                playing = isPlaying
            }
            delay(200)
        }
    }
    LaunchedEffect(chrome, playing, scrubbing) {
        if (chrome && playing && !scrubbing) {
            delay(3000)
            chrome = false
        }
    }
    val chromeAlpha by animateFloatAsState(if (chrome) 1f else 0f, tween(180), label = "videochrome")
    val swallow = remember { MutableInteractionSource() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { chrome = !chrome },
                    onDoubleTap = { p ->
                        val target = if (vScale > 1f) 1f else 2.5f
                        val tx =
                            if (target > 1f) {
                                val maxX = size.width * (target - 1f) / 2f
                                ((size.width / 2f - p.x) * (target - 1f)).coerceIn(-maxX, maxX)
                            } else {
                                0f
                            }
                        val ty =
                            if (target > 1f) {
                                val maxY = size.height * (target - 1f) / 2f
                                ((size.height / 2f - p.y) * (target - 1f)).coerceIn(-maxY, maxY)
                            } else {
                                0f
                            }
                        val s0 = vScale
                        val x0 = vOffX
                        val y0 = vOffY
                        vZoomJob?.cancel()
                        vZoomJob =
                            scope.launch {
                                androidx.compose.animation.core.animate(
                                    0f,
                                    1f,
                                    animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
                                ) { k, _ ->
                                    vScale = s0 + (target - s0) * k
                                    vOffX = x0 + (tx - x0) * k
                                    vOffY = y0 + (ty - y0) * k
                                }
                                vScale = target
                                vOffX = tx
                                vOffY = ty
                            }
                    },
                )
            },
    ) {
        when {
            m == null || dest == null || state == -1 -> {
                Text(
                    "Could not load this video.",
                    color = Color.White,
                    fontSize = 14.sp,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            state == 0 -> {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = accent)
                    Spacer(Modifier.height(10.dp))
                    Text("Loading…", color = Color.White, fontSize = 13.sp)
                }
            }
            else -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = vScale
                            scaleY = vScale
                            translationX = vOffX
                            translationY = vOffY
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    AndroidView(
                        factory = { c ->
                            android.view.TextureView(c).apply {
                                isOpaque = false
                                keepScreenOn = true
                                player =
                                    KpClipPlayer(
                                        view = this,
                                        path = dest.absolutePath,
                                        onSize = { w, h -> aspect = (w.toFloat() / h).coerceIn(0.3f, 3.5f) },
                                        onEnd = {
                                            ended = true
                                            playing = false
                                            chrome = true
                                        },
                                        onError = { playError = true },
                                    ).also { it.attach() }
                            }
                        },
                        onRelease = {
                            runCatching { player?.release() }
                            player = null
                        },
                        modifier = Modifier.fillMaxSize().aspectRatio(aspect),
                    )
                    if (playError) {
                        Text(
                            "Could not play this video.",
                            color = Color.White,
                            fontSize = 14.sp,
                            modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Color(0x99000000)).padding(12.dp),
                        )
                    }
                }
            }
        }

        // v166 (owner: "video photo te je send korche je receive korche kothaw 3
        // dot nei"): a private clip's ⋮ used to be withheld along with Save /
        // Forward — so there was NO dots anywhere in that viewer, and Delete
        // (which a private clip does allow) had no way in. The sheet is what
        // gates Save / Forward.
        // v167 (owner: "video 3 dot ta upore rotate button ta remove kore
        // okhane thakbe"): the dots take the rotate button's own seat in the
        // top bar — there is exactly ONE ⋮ on this screen, where rotate used
        // to be, on screen whenever the bar is (a tap brings the bar back).
        if (chromeAlpha > 0.01f) {
            // ---- top bar: back · title/date · rotate · save ----
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .graphicsLayer { alpha = chromeAlpha }
                    .background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent)))
                    .clickable(interactionSource = swallow, indication = null) {}
                    .statusBarsPadding()
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { nav.popBackStack() }) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Color.White, modifier = Modifier.size(28.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(title, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (sub.isNotBlank()) Text(sub, color = Color(0xB3FFFFFF), fontSize = 11.5.sp, maxLines = 1)
                }
                // v167 (owner: "video 3 dot ta upore rotate button ta remove
                // kore okhane thakbe"): the rotate button is gone from the bar
                // — the dots sit in its place.
                if (m != null) {
                    IconButton(onClick = { haptics.tap(); menuOpen = true }) {
                        Icon(Icons.Filled.MoreVert, "More", tint = Color.White, modifier = Modifier.size(22.dp))
                    }
                }
                // v165 (owner: "video receive korle 3 dot option nai save
                // forward photo te jemon ache"): this ⋮ lived inside the
                // auto-hiding bar AND was replaced by the saving spinner /
                // the saved tick — so a received clip that had been played
                // (chrome hidden after 3 s) or saved once had NO way to reach
                // Save / Forward again, while the photo viewer's ⋮ is always
                // there. The spinner and the tick have always ridden BESIDE
                // the seat instead of taking its place; that stays.
                if (savingClip) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.padding(end = 6.dp).size(18.dp))
                } else if (saved) {
                    Icon(Icons.Filled.Check, "Saved", tint = Color.White, modifier = Modifier.padding(end = 6.dp).size(20.dp))
                }
            }
            // ---- centre: play / pause / replay ----
            if (state == 1 && !playError) {
                Box(
                    Modifier
                        .align(Alignment.Center)
                        .graphicsLayer { alpha = chromeAlpha }
                        .size(64.dp)
                        .clip(CircleShape)
                        .background(Color(0x66000000))
                        .clickable {
                            val p = player ?: return@clickable
                            haptics.tap()
                            when {
                                ended -> {
                                    ended = false
                                    p.restart()
                                }
                                p.playing -> p.pause()
                                else -> p.play()
                            }
                            chrome = true
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        when {
                            ended -> Icons.Filled.Replay
                            playing -> Icons.Filled.Pause
                            else -> Icons.Filled.PlayArrow
                        },
                        contentDescription = if (playing) "Pause" else "Play",
                        tint = Color.White,
                        modifier = Modifier.size(36.dp),
                    )
                }
            }
            // ---- bottom: time · seek bar · duration · mute ----
            if (state == 1) {
                val frac =
                    if (scrubbing) scrubFrac
                    else if (durMs > 0) (posMs.toFloat() / durMs).coerceIn(0f, 1f)
                    else 0f
                Row(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .graphicsLayer { alpha = chromeAlpha }
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xB3000000))))
                        .clickable(interactionSource = swallow, indication = null) {}
                        .navigationBarsPadding()
                        .padding(start = 14.dp, end = 4.dp, top = 18.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(clock(if (scrubbing) (scrubFrac * durMs).toInt() else posMs), color = Color.White, fontSize = 12.sp)
                    Spacer(Modifier.width(10.dp))
                    SeekBar(
                        frac = frac,
                        accent = accent,
                        modifier = Modifier.weight(1f),
                        onScrub = { f ->
                            scrubbing = true
                            scrubFrac = f
                            chrome = true
                        },
                        onScrubEnd = { f ->
                            scrubbing = false
                            if (durMs > 0) {
                                val target = (f * durMs).toInt()
                                posMs = target
                                player?.seekTo(target)
                                ended = false
                            }
                        },
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(clock(durMs), color = Color.White, fontSize = 12.sp)
                    IconButton(onClick = {
                        muted = !muted
                        player?.setMuted(muted)
                    }) {
                        Icon(
                            if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
                            contentDescription = if (muted) "Unmute" else "Mute",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp),
                        )
                    }
                }
            }
        }
    }
}

/** Thin themed track with a round thumb; tap to jump, drag to scrub. */
@Composable
private fun SeekBar(
    frac: Float,
    accent: Color,
    modifier: Modifier = Modifier,
    onScrub: (Float) -> Unit,
    onScrubEnd: (Float) -> Unit,
) {
    var widthPx by remember { mutableIntStateOf(1) }
    val f = frac.coerceIn(0f, 1f)
    Box(
        modifier
            .height(28.dp)
            .onSizeChanged { widthPx = it.width.coerceAtLeast(1) }
            .pointerInput(Unit) {
                detectTapGestures { p -> onScrubEnd((p.x / widthPx).coerceIn(0f, 1f)) }
            }
            .pointerInput(Unit) {
                var last = 0f
                detectHorizontalDragGestures(
                    onDragStart = { p ->
                        last = (p.x / widthPx).coerceIn(0f, 1f)
                        onScrub(last)
                    },
                    onDragEnd = { onScrubEnd(last) },
                    onDragCancel = { onScrubEnd(last) },
                ) { change, _ ->
                    last = (change.position.x / widthPx).coerceIn(0f, 1f)
                    onScrub(last)
                    change.consume()
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x4DFFFFFF)))
        Box(Modifier.fillMaxWidth(f).height(3.dp).clip(RoundedCornerShape(2.dp)).background(accent))
        Box(
            Modifier
                .offset { IntOffset((f * widthPx - 6.dp.toPx()).roundToInt(), 0) }
                .size(12.dp)
                .clip(CircleShape)
                .background(accent),
        )
    }
}

/** MediaPlayer on a TextureView surface; survives the surface going away
 *  (screen off) by remembering the position and re-showing that frame. */
private class KpClipPlayer(
    private val view: android.view.TextureView,
    private val path: String,
    private val onSize: (Int, Int) -> Unit,
    private val onEnd: () -> Unit,
    private val onError: () -> Unit,
) : android.view.TextureView.SurfaceTextureListener {
    private var mp: android.media.MediaPlayer? = null
    private var prepared = false
    private var wantPlaying = true
    private var resumeAt = 0
    private var muted = false

    val playing: Boolean
        get() = prepared && runCatching { mp?.isPlaying == true }.getOrDefault(false)

    fun attach() {
        view.surfaceTextureListener = this
        if (view.surfaceTexture != null) bind()
    }

    private fun bind() {
        val st = view.surfaceTexture ?: return
        val existing = mp
        if (existing != null) {
            runCatching { existing.setSurface(android.view.Surface(st)) }
            // Back from a dead surface: show the remembered frame, stay paused.
            if (prepared && resumeAt > 0) runCatching { existing.seekTo(resumeAt) }
            return
        }
        mp =
            android.media.MediaPlayer().apply {
                runCatching {
                    setDataSource(path)
                    setOnVideoSizeChangedListener { _, w, h -> if (w > 0 && h > 0) onSize(w, h) }
                    setOnPreparedListener { p ->
                        prepared = true
                        applyVolume(p)
                        if (resumeAt > 0) runCatching { p.seekTo(resumeAt) }
                        if (wantPlaying) runCatching { p.start() }
                    }
                    setOnCompletionListener {
                        wantPlaying = false
                        onEnd()
                    }
                    setOnErrorListener { _, _, _ ->
                        onError()
                        true
                    }
                    prepareAsync()
                }.onFailure { onError() }
            }
        runCatching { mp?.setSurface(android.view.Surface(st)) }
    }

    private fun applyVolume(p: android.media.MediaPlayer) {
        runCatching { if (muted) p.setVolume(0f, 0f) else p.setVolume(1f, 1f) }
    }

    fun play() {
        wantPlaying = true
        if (prepared) runCatching { mp?.start() }
    }

    fun pause() {
        wantPlaying = false
        if (prepared) runCatching { mp?.pause() }
    }

    fun seekTo(ms: Int) {
        if (prepared) runCatching { mp?.seekTo(ms) } else resumeAt = ms
    }

    fun restart() {
        seekTo(0)
        play()
    }

    fun setMuted(on: Boolean) {
        muted = on
        mp?.let { applyVolume(it) }
    }

    /** (positionMs, durationMs, isPlaying), or null until prepared. */
    fun snapshot(): Triple<Int, Int, Boolean>? {
        val p = mp ?: return null
        if (!prepared) return null
        return runCatching { Triple(p.currentPosition, p.duration, p.isPlaying) }.getOrNull()
    }

    override fun onSurfaceTextureAvailable(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {
        bind()
    }

    override fun onSurfaceTextureSizeChanged(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {}

    override fun onSurfaceTextureDestroyed(surface: android.graphics.SurfaceTexture): Boolean {
        resumeAt = runCatching { mp?.currentPosition ?: resumeAt }.getOrDefault(resumeAt)
        wantPlaying = false
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

/** Copies a cached clip into the system Downloads (API 29+ MediaStore; the
 *  app's external Downloads folder below that). */
internal fun saveVideoToDownloads(ctx: android.content.Context, file: java.io.File, name0: String, mime: String): Boolean {
    val name = name0.ifBlank { "KuchuPuchu_${System.currentTimeMillis()}.mp4" }
    return runCatching {
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            val values =
                android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, mime.ifBlank { "video/mp4" })
                }
            val uri =
                ctx.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return@runCatching false
            ctx.contentResolver.openOutputStream(uri)?.use { out ->
                file.inputStream().use { it.copyTo(out, 128 * 1024) }
            } ?: return@runCatching false
            true
        } else {
            val dir = java.io.File(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "KuchuPuchu")
            if (!dir.exists()) dir.mkdirs()
            file.copyTo(java.io.File(dir, name), overwrite = true)
            true
        }
    }.getOrDefault(false)
}
