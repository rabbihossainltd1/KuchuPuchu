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
import androidx.compose.runtime.mutableStateListOf
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
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
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
/**
 * r76-28 (owner: "chat er jei position a media ache otay click korle oi
 * position theke middle a eshe Fullscreen hobe smoothly"): the tapped photo
 * tile's seat, keyed by message id. The viewer opens FROM it - a hero, not a
 * hard pop. One-shot: [take] clears, so a recompose never replays the hero.
 */
object PhotoHero {
    private val map =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, androidx.compose.ui.geometry.Rect>(32, 0.75f, false) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, androidx.compose.ui.geometry.Rect>?): Boolean = size > 64
            },
        )
    var lastId: String? = null

    // r77-3 (owner: "fake doublicate na"): the tile the hero stands in for is
    // HIDDEN for the whole trip - the hero is the only copy on screen, from
    // the tap's frame to the landing's.
    var outId: String? by androidx.compose.runtime.mutableStateOf(null)

    // r79-3 (owner: "closing a photo age thekei thakche chat a, otar upore
    // overlap korche, taw sothik position a na"): the old handoff snapped the
    // tile from hidden to shown only at the very end - if the two windows
    // (activity tile vs dialog hero) disagreed by even a frame or a pixel the
    // owner saw the photo TWICE, offset. The flight's progress is public now
    // while closing: the tile cross-fades IN over the flight's last 45% as
    // the hero fades OUT over the same span, so a one-pixel seat mismatch
    // reads as a soft blend instead of a duplicate.
    var heroCloseT by androidx.compose.runtime.mutableStateOf(0f) // 0 = not closing
    // r80-3 (owner: "late kore open hoi, kono smooth animation nai"): the
    // tile's OWN decoded pixels ride beside its seat. Coil's memory cache
    // evicts 1200px decodes fast in a heavy chat, so the viewer used to fly
    // a BLANK window while the network re-answered (that blank IS the
    // "late open"). The viewer now paints these exact pixels as its first
    // frame - the flight always starts on the real picture. View-once tiles
    // never deposit (H3: no caching).
    private val bitmaps =
        java.util.Collections.synchronizedMap(
            object : java.util.LinkedHashMap<String, android.graphics.Bitmap>(24, 0.75f, true) {
                override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, android.graphics.Bitmap>?): Boolean = size > 24
            },
        )

    fun setBitmap(id: String, bmp: android.graphics.Bitmap) {
        if (id.isBlank()) return
        synchronized(bitmaps) { bitmaps[id] = bmp }
    }

    fun bitmapOf(id: String?): android.graphics.Bitmap? =
        if (id.isNullOrBlank()) null else synchronized(bitmaps) { bitmaps[id] }

    fun tileAlphaFor(id: String?): Float {
        val out = outId
        if (id.isNullOrBlank() || out.isNullOrBlank() || out != id) return 1f
        val t = heroCloseT
        if (t <= 0f) return 0f // viewer open, not closing: fully hidden
        return if (t >= 0.45f) 0f else ((0.45f - t) / 0.45f).coerceIn(0f, 1f)
    }

    // r77-3: the tile reports its seat on every layout, so the map always
    // knows where it sits NOW (rows move while the viewer is open - the old
    // snapshot is what landed the exit hero mid-air, "zero gap na").
    fun seatOf(id: String?): androidx.compose.ui.geometry.Rect? =
        if (id.isNullOrBlank()) null else map[id]

    fun set(id: String, r: androidx.compose.ui.geometry.Rect) {
        if (id.isNotBlank()) map[id] = r
    }

    fun take(): androidx.compose.ui.geometry.Rect? {
        val id = lastId ?: return null
        lastId = null
        return map[id]
    }
}

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
    // r76-28: the tapped tile's seat - the photo grows from it to fullscreen.
    heroFrom: androidx.compose.ui.geometry.Rect? = null,
    // r77-3: page index -> that page's chat-tile id (albums; a single page is
    // the tapped tile). The exit hero lands on the LIVE seat of whatever page
    // is showing, and each such tile hides until the landing releases it.
    heroPageId: ((Int) -> String)? = null,
) {
    // Snapshotted once - a later recompose (page flip, chrome) must never
    // restart or cancel the opening.
    val heroSeat = remember { heroFrom }
    val hero = remember { Animatable(if (heroSeat == null) 1f else 0f) }
    // r80-3 (owner: "oi photo er position theke aste aste fullscreen hobe";
    // retest: "kono smooth animation nai, click korle late kore open hoi,
    // onek rudely hoi"): the flight used to clock from LaunchedEffect(Unit) -
    // it STARTED while the new dialog window was still warming and while the
    // pager had no size yet, so the first drawn frames were either warmed-up
    // wall time (the grow half over before a pixel showed) or one fullscreen
    // POP (the size-guard skipped the transform until layout, then the photo
    // snapped down to the tile). The sprint now starts on the viewer's FIRST
    // REAL LAYOUT, and every frame before that is invisible (alpha 0 on the
    // outer box below): the first thing the eye sees is the photo AT the
    // tile, and the whole 320 ms plays in front of it. Zero-lag, no pop.
    var openLaidOut by remember { mutableStateOf(false) }
    LaunchedEffect(openLaidOut) {
        if (openLaidOut && heroSeat != null) {
            // r81-3 (owner: "animation ta smooth hobe"): the Material
            // emphasized curve - a longer, gentler glide instead of the
            // fast-out punch. Decelerate-emphasized open.
            hero.animateTo(
                1f,
                tween(280, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)),
            )
        }
    }
    // r76-29 (owner: "photo theke ber hole animation ta reverse hoi na"):
    // leaving plays the hero BACKWARDS - the picture shrinks into the tile it
    // came from and only then does the window go.
    var closing by remember { mutableStateOf(false) }
    val heroScope = rememberCoroutineScope()
    // r79-3: publish the flight progress while closing - the chat tile and
    // this window cross-fade through the same span (see tileAlphaFor and the
    // hero alpha in the pager's graphicsLayer).
    LaunchedEffect(closing, heroSeat != null) {
        androidx.compose.runtime.snapshotFlow { hero.value }.collect { v ->
            PhotoHero.heroCloseT = if (closing) v else 0f
        }
    }
    val dismiss: () -> Unit = {
        if (closing) {
            // already on its way out
        } else if (heroSeat != null) {
            closing = true
            heroScope.launch {
                // r81-3: emphasized-accelerate reverse, matching the open.
                hero.animateTo(
                    0f,
                    tween(220, easing = androidx.compose.animation.core.CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)),
                )
                // r77-3: the landed hero sits exactly on the live seat, fully
                // opaque. Bring the tile back and commit ONE frame while that
                // still covers it, THEN detach the window - zero gap, no
                // blank frame, no duplicate at the handoff.
                PhotoHero.outId = null
                androidx.compose.runtime.withFrameNanos { }
                PhotoHero.heroCloseT = 0f
                onClose()
            }
        } else {
            onClose()
        }
    }
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
    // r76-27 (audit #14): the save success pill that slides up inside the
    // viewer - a system Toast has no app styling to carry.
    var savedPill by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()
    LaunchedEffect(savedPill) {
        if (savedPill) {
            kotlinx.coroutines.delay(1_800)
            savedPill = false
        }
    }
    // Owner round 32 (item 46): the viewer's ⋮ opens a sheet with Save /
    // Forward (nothing else); the old always-visible bottom strip is gone.
    var menuOpen by remember { mutableStateOf(false) }
    // v166: Delete asks one question first (for everyone / for me), the same
    // words the chat's long-press sheet uses.
    var confirmDelete by remember { mutableStateOf(false) }
    // Owner round 34 (item 6): one page per photo; zoom resets on each flip.
    val pages = urls.ifEmpty { listOf(url) }
    // r76-26 (owner: "ami owner, ami view once media save korte gele error
    // dekhay"): a once page's bytes are a one-shot fetch - the on-screen
    // fetch SPENDS the opening, so Save's second download always came back
    // 410 ("already opened") and toasted an error. The viewer now performs
    // that single fetch itself and keeps the bytes in memory: the page
    // renders from them (as a data URI) and Save writes those same bytes.
    // The server-side spend still happens exactly once, at this fetch.
    val oncePages = remember(pages, once) { mutableStateListOf<String>().also { it.addAll(pages) } }
    if (once) {
        LaunchedEffect(pages) {
            pages.forEachIndexed { i, u ->
                if (u.startsWith("data:")) return@forEachIndexed
                val bytes = withContext(Dispatchers.IO) { runCatching { Api.download(u) }.getOrNull() } ?: return@forEachIndexed
                oncePages[i] = "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            }
        }
    }
    val pager = rememberPagerState(initialPage = startIndex.coerceIn(pages.indices)) { pages.size }
    // r77-3: hide whichever chat tile the hero stands in for. The landing
    // releases it (see dismiss) exactly when the hero is back on it.
    if (heroPageId != null) {
        LaunchedEffect(pager.currentPage) { PhotoHero.outId = heroPageId.invoke(pager.currentPage) }
    }
    LaunchedEffect(pager.currentPage) {
        scale = 1f
        offX = 0f
        offY = 0f
        onPageChanged?.invoke(pager.currentPage)
    }
    fun savePhoto() {
        if (saving) return
        // r76-26: a once page saves from the bytes the viewer already holds -
        // its single fetch was spent the moment the picture came on screen.
        val pageUrl = oncePages.getOrElse(pager.currentPage) { pages.getOrElse(pager.currentPage) { return } }
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
                if (saved != null) {
                    // r76-27 (audit H1): success is FELT (confirm tick) and
                    // shown as the viewer's own pill, not a system Toast.
                    haptics.confirm()
                    savedPill = true
                } else {
                    android.widget.Toast.makeText(ctx, "Could not save", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
    Dialog(
        onDismissRequest = dismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        // Owner round 31 item 21: a private person's picture — the viewer's
        // own window is the one a screenshot would capture, so guard THAT
        // (Save / Forward are already withheld by the caller).
        // r78-4 (owner retest: "allow screenshot on thaklei view once capture
        // hoy — that cannot stand"): a view-once page ignores the chat's Allow
        // switches PERMANENTLY, and its flag is planted on BOTH windows from
        // here — the dialog's own and the activity's — so no window resolution
        // quirk on any device can leave the picture on a capturable surface.
        KpSecure.Guard(secure || !canSave || once)
        if (secure || !canSave || once) {
            val secureWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
            DisposableEffect(secureWindow) {
                secureWindow?.setFlags(
                    android.view.WindowManager.LayoutParams.FLAG_SECURE,
                    android.view.WindowManager.LayoutParams.FLAG_SECURE,
                )
                onDispose { secureWindow?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE) }
            }
            val activityWindow = MainActivity.current?.window
            DisposableEffect(activityWindow) {
                if (activityWindow != null) KpSecure.acquire(activityWindow)
                onDispose { if (activityWindow != null) KpSecure.release(activityWindow) }
            }
        }
        // White status icons over the black viewer, whatever the app theme.
        val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            dialogWindow?.let { w ->
                WindowCompat.getInsetsController(w, w.decorView).isAppearanceLightStatusBars = false
                // r76-29 (owner: "photo te click korle agei Fullscreen hoye
                // tarpo ... animate hoye ashe"): the PLATFORM dim is what
                // slammed a dark fullscreen up before the picture moved. Off -
                // the viewer's own background fades in with the hero instead.
                w.setDimAmount(0f)
            }
        }
        val dim = (1f - abs(drag.value) / 900f).coerceIn(0.35f, 1f)
        val chromeAlpha by animateFloatAsState(if (chrome) 1f else 0f, tween(160), label = "photochrome")
        // r76-27 (audit #1) / r76-28 (owner: "oi position theke middle a eshe
        // Fullscreen hobe smoothly"): with a hero seat the picture itself
        // grows from the tile to fullscreen (the dim rides along); without
        // one the window falls back to the small fade+zoom.
        Box(
            Modifier
                .fillMaxSize()
                .onGloballyPositioned { openLaidOut = true }
                .then(if (heroSeat == null) Modifier.kpPopIn() else Modifier)
                .graphicsLayer {
                    // r80-3: nothing renders until the first layout starts
                    // the sprint - no warmed-up clock, no fullscreen pop.
                    alpha = if (heroSeat != null && !openLaidOut) 0f else 1f
                }
                .background(Color.Black.copy(alpha = dim * hero.value)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            var twoFinger = false
                            var travelled = 0f
                            var dismissBuzz = false
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
                                        // r76-27 (audit H2): the moment the drag crosses
                                        // the close threshold the finger hears it - once.
                                        if (!dismissBuzz && abs(dragLocal) > size.height * 0.16f) {
                                            dismissBuzz = true
                                            haptics.tap()
                                        }
                                        event.changes.forEach { if (it.positionChanged()) it.consume() }
                                    }
                                }
                            }
                            if (dismissing) {
                                if (abs(dragLocal) > size.height * 0.16f) {
                                    dismiss()
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
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            // r77-3: on the way OUT the target is the tile's
                            // seat RIGHT NOW (it may have scrolled while the
                            // viewer was open); on the way IN the snapshot.
                            val h =
                                if (closing) {
                                    heroPageId?.let { PhotoHero.seatOf(it.invoke(pager.currentPage)) } ?: heroSeat
                                } else {
                                    heroSeat
                                }
                            val t = hero.value
                            // r79-3: during the close's last 45% the hero
                            // fades OUT in the exact span the chat tile fades
                            // IN - a seat that disagrees by a hair no longer
                            // flashes a second copy below the landing photo.
                            alpha = if (closing && t < 0.45f) (t / 0.45f).coerceIn(0f, 1f) else 1f
                            if (h != null && t < 1f && size.width > 0f && size.height > 0f) {
                                val sw = size.width
                                val sh = size.height
                                // r76-30 (owner: "photo closing ta ratio te
                                // problem"): scaleX / scaleY lerped to
                                // DIFFERENT factors, so the picture squashed
                                // into the tile's shape on the way out. One
                                // UNIFORM factor (cover) - the ratio holds
                                // for the whole hero, both directions.
                                val s0 = maxOf(h.width / sw, h.height / sh)
                                scaleX = androidx.compose.ui.util.lerp(s0, 1f, t)
                                scaleY = androidx.compose.ui.util.lerp(s0, 1f, t)
                                translationX = androidx.compose.ui.util.lerp(h.center.x - sw / 2f, 0f, t)
                                translationY = androidx.compose.ui.util.lerp(h.center.y - sh / 2f, 0f, t)
                            }
                        },
                    userScrollEnabled = scale <= 1.01f,
                ) { page ->
                    // r80-3: base layer = the chat tile's own decoded pixels,
                    // so the opening flight's first frame is ALWAYS the real
                    // picture (never a black box on a cache miss); the full
                    // image lands over it the moment it decodes. View-once
                    // tiles deposit nothing (H3) - those pages behave as
                    // before.
                    KpNetImage(
                        oncePages.getOrElse(page) { pages[page] },
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
                        placeholderBitmap = if (once) null else PhotoHero.bitmapOf(heroPageId?.invoke(page)),
                    )
                }
            }
            androidx.compose.animation.AnimatedVisibility(
                visible = savedPill,
                enter = androidx.compose.animation.slideInVertically(tween(180)) { it } + androidx.compose.animation.fadeIn(tween(140)),
                exit = androidx.compose.animation.fadeOut(tween(300)),
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 30.dp),
            ) {
                Text(
                    "Saved to Pictures/KuchuPuchu",
                    color = Color.White,
                    fontSize = 12.5.sp,
                    modifier = Modifier.clip(RoundedCornerShape(18.dp)).background(Color(0xE620242B)).padding(horizontal = 14.dp, vertical = 8.dp),
                )
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
                    IconButton(onClick = dismiss) {
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
/**
 * r84-2 (owner r84 #2: "video opening thik ache but closing a jokhon ber
 * hocche video theke jokhon background black thakche chat dekha jai na photo
 * er moto"): the player used to open from the chat as a nav ROUTE, and while
 * a route is on top the chat destination underneath is not composed - the
 * close flight played against the nav host's plain black container. From the
 * chat the player now rides this in-compose Dialog exactly like the photo
 * viewer: the chat STAYS ALIVE behind it, so closing shrinks into the tile
 * over the live chat. Open is faster too - no route push, no destination
 * composition, the overlay mounts in the same window as the chat. (The
 * gallery keeps the route: its "behind" is the gallery grid, not a chat.)
 */
@Composable
fun KpVideoOverlay(nav: NavController, arg: String, onClose: () -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        VideoPlayerScreen(nav, arg, overlayClose = onClose)
    }
}

@Composable
fun VideoPlayerScreen(nav: NavController, b64: String, overlayClose: (() -> Unit)? = null) {
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    val m = remember(b64) { mediaArgDecode(b64) }
    // r81-3 (owner: "video chat er all media same vabe open hobe, ounce view
    // o"): the player flies out of the tapped tile with the SAME hero the
    // photo viewer uses - invisible until the first real layout, then the
    // clip grows from the tile's seat on the same emphasized curve, and the
    // tile's own poster pixels are the base layer from frame one (never a
    // black window). Close plays the flight backwards, tile cross-fading in.
    val vidHeroId = remember { m?.optString("id")?.ifBlank { m.optString("clientId") } ?: "" }
    val vidHeroSeat = remember { PhotoHero.take() }
    val vidHero = remember { Animatable(if (vidHeroSeat == null) 1f else 0f) }
    var vidHeroLaidOut by remember { mutableStateOf(false) }
    var vidClosing by remember { mutableStateOf(false) }
    val vidPoster = remember(vidHeroId) { PhotoHero.bitmapOf(vidHeroId) }
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
    // Owner round 32 (item 17): a view-once clip — the opening is spent the
    // moment the clip is on screen; kpPrivate already withholds Save / Forward.
    val onceClip = m?.optBoolean("kpOnce") == true
    // r78-4: a once clip is guarded by itself too — never left to whatever
    // the nav argument carried in.
    KpSecure.Guard(privateClip || onceClip)
    // r71-18: the chat's "Media Save permission" — this clip was sent by
    // someone who withheld saving, so the Save row goes and the capture guard
    // stays off (they may look, they may not keep a copy).
    val noSaveClip = m?.optBoolean("kpNoSave") == true
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
    LaunchedEffect(vidHeroLaidOut) {
        if (vidHeroLaidOut && vidHeroSeat != null) {
            vidHero.animateTo(
                1f,
                tween(280, easing = androidx.compose.animation.core.CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)),
            )
        }
    }
    LaunchedEffect(Unit) { if (vidHeroId.isNotBlank()) PhotoHero.outId = vidHeroId }
    // r81-3: publish the close progress - the chat tile cross-fades in over
    // the flight's last 45% exactly like the photo viewer (tileAlphaFor).
    LaunchedEffect(vidClosing) {
        androidx.compose.runtime.snapshotFlow { vidHero.value }.collect { v ->
            PhotoHero.heroCloseT = if (vidClosing) v else 0f
        }
    }
    DisposableEffect(vidHeroId) {
        onDispose {
            if (PhotoHero.outId == vidHeroId) {
                PhotoHero.outId = null
                PhotoHero.heroCloseT = 0f
            }
        }
    }
    // r84-2: from the chat the player rides the in-compose overlay (see
    // KpVideoOverlay) - closing pops the overlay, not the nav stack.
    val closePlayer: () -> Unit = { if (overlayClose != null) overlayClose() else nav.popBackStack() }
    val dismissVid: () -> Unit = dismissVid@{
        if (vidClosing) return@dismissVid
        if (vidHeroSeat == null) {
            closePlayer()
            return@dismissVid
        }
        vidClosing = true
        scope.launch {
            vidHero.animateTo(
                0f,
                tween(220, easing = androidx.compose.animation.core.CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)),
            )
            PhotoHero.outId = null
            androidx.compose.runtime.withFrameNanos { }
            PhotoHero.heroCloseT = 0f
            closePlayer()
        }
    }
    BackHandler(enabled = vidHeroSeat != null && !vidClosing) { dismissVid() }
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
        closePlayer()
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
            // r76-27 (audit H1): the clip's save success ticks like the photo's.
            if (ok) haptics.confirm()
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
            .onGloballyPositioned { vidHeroLaidOut = true }
            .graphicsLayer {
                val t = vidHero.value
                alpha =
                    when {
                        vidHeroSeat != null && !vidHeroLaidOut -> 0f
                        vidClosing && t < 0.45f -> (t / 0.45f).coerceIn(0f, 1f)
                        else -> 1f
                    }
                if (vidHeroSeat != null && t < 1f && size.width > 0f && size.height > 0f) {
                    val h = vidHeroSeat
                    val s0 = maxOf(h.width / size.width, h.height / size.height)
                    scaleX = androidx.compose.ui.util.lerp(s0, 1f, t)
                    scaleY = androidx.compose.ui.util.lerp(s0, 1f, t)
                    translationX = androidx.compose.ui.util.lerp(h.center.x - size.width / 2f, 0f, t)
                    translationY = androidx.compose.ui.util.lerp(h.center.y - size.height / 2f, 0f, t)
                }
            }
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
        // r81-3: the tile's own poster pixels are the first thing on screen -
        // the open flight starts on the real frame even while the decoder /
        // network has nothing yet; the live surface draws over it.
        if (vidPoster != null) {
            Image(
                bitmap = vidPoster.asImageBitmap(),
                contentDescription = title,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit,
            )
        }
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
                IconButton(onClick = dismissVid) {
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
