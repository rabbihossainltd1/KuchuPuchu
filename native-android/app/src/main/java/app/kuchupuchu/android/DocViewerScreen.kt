package app.kuchupuchu.android

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavController
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Owner round 32 (item 33): documents open INSIDE KuchuPuchu.
 *
 * Route `docviewer/{b64}` (the message JSON, like the video player). The file
 * is downloaded once into the app's document cache, then shown by the
 * renderer that fits it:
 *  - PDF          → the platform PdfRenderer, every page in a scrolling list,
 *                    pinch to zoom;
 *  - text / code  → selectable monospace text (first 400 KB);
 *  - JPEG / PNG / WebP / GIF / BMP / HEIC → a picture (BitmapFactory,
 *                    bounded), pinch to zoom;
 *  - SVG          → drawn by an offline WebView with scripts, network and
 *                    file access switched off;
 *  - TIFF         → TiffDecoder (baseline TIFF, no system codec exists);
 *  - ZIP / RAR    → the table of contents (folders and files with sizes,
 *                    a lock mark when the archive is password-protected);
 *  - anything else (DOC / DOCX / XLSX / PPTX …) → a card with the name,
 *                    type and size — no renderer for those lives on the
 *                    phone itself, so the ⋮ sheet's "Open with" is the
 *                    way through.
 * The ⋮ at the top opens a bottom sheet: Save (Downloads), Forward, Open with.
 */
@Composable
fun DocViewerScreen(nav: NavController, b64: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val m = remember(b64) { mediaArgDecode(b64) }
    val name = m?.optText("fileName")?.ifBlank { null } ?: "Document"
    val declaredType = m?.optText("fileType").orEmpty()
    val mime = FilesUtil.mimeFor(name, declaredType)
    val size = m?.optInt("fileSize") ?: 0
    val key =
        m?.optText("fileKey")?.takeIf { it.isNotBlank() }
            ?: m?.optText("mediaUrl")?.takeIf { it.startsWith("/") || it.startsWith("http") } ?: ""
    val privateDoc = m?.optBoolean("kpPrivate") == true
    KpSecure.Guard(privateDoc)
    val sub = m?.let { viewerStamp(it.optText("createdAt")) } ?: ""

    val dest = remember(b64) { m?.let { docCacheFile(ctx, it) } }
    // 0 loading · 1 ready · -1 failed
    var state by remember(b64) { mutableIntStateOf(if (dest != null && dest.exists() && dest.length() > 0L) 1 else 0) }
    var menuOpen by remember { mutableStateOf(false) }
    var forwarding by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    val canForward = m != null && !privateDoc && m.optText("fileKey").isNotBlank()

    LaunchedEffect(b64) {
        if (m == null || dest == null || key.isBlank()) {
            state = -1
            return@LaunchedEffect
        }
        if (state == 1) return@LaunchedEffect
        val ok =
            withContext(Dispatchers.IO) {
                runCatching {
                    val tmp = File(dest.absolutePath + ".part")
                    val done = Api.downloadToFile(key, tmp) && tmp.length() > 0L
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

    fun saveDoc() {
        if (dest == null || saving || saved || state != 1) return
        scope.launch {
            saving = true
            val ok = withContext(Dispatchers.IO) { saveVideoToDownloads(ctx, dest, name, mime) }
            saving = false
            saved = ok
            android.widget.Toast.makeText(ctx, if (ok) "Saved to Downloads" else "Could not save", android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    fun openWith() {
        if (dest == null || state != 1) return
        FilesUtil.openFile(ctx, name, dest, mime)
    }

    if (menuOpen) {
        KpSheet(onDismiss = { menuOpen = false }) {
            if (!privateDoc && !saved) KpSheetRow(Icons.Filled.Download, "Save") { menuOpen = false; saveDoc() }
            if (canForward) KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward") { menuOpen = false; forwarding = true }
            if (!privateDoc) KpSheetRow(Icons.AutoMirrored.Filled.OpenInNew, "Open with") { menuOpen = false; openWith() }
        }
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

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Column(Modifier.weight(1f)) {
                Text(name, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val line = listOf(FilesUtil.displaySize(size).takeIf { size > 0 }, sub.takeIf { it.isNotBlank() }).filterNotNull().joinToString(" · ")
                if (line.isNotBlank()) Text(line, color = Muted, fontSize = 11.5.sp, maxLines = 1)
            }
            if (saving) {
                CircularProgressIndicator(color = Ink, strokeWidth = 2.dp, modifier = Modifier.padding(end = 14.dp).size(18.dp))
            } else if (state == 1 && m != null) {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, "More", tint = Ink)
                }
            }
        }
        Box(Modifier.fillMaxSize()) {
            when {
                m == null || dest == null || state == -1 ->
                    EmptyState(Icons.Filled.InsertDriveFile, "Could not load", "This file is not available right now")
                state == 0 ->
                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = if (KpThemeMode.darkBlue) ActionBlue else Gold)
                        Spacer(Modifier.height(10.dp))
                        Text("Loading…", color = Muted, fontSize = 13.sp)
                    }
                else -> DocBody(dest, name, mime, size)
            }
        }
    }
}

/** Per-message cache file for documents (files need the auth header). */
internal fun docCacheFile(ctx: android.content.Context, m: org.json.JSONObject): File {
    val key = m.optText("fileKey").ifBlank { m.optText("mediaUrl") }.ifBlank { "d" }
    val safe = key.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(80)
    val ext = m.optText("fileName").substringAfterLast('.', "").lowercase().take(6).replace(Regex("[^a-z0-9]"), "")
    return File(File(ctx.filesDir, "kp-doc-cache").apply { mkdirs() }, if (ext.isBlank()) safe else "$safe.$ext")
}

private enum class DocKind { PDF, TEXT, IMAGE, SVG, TIFF, ARCHIVE, OTHER }

private fun docKind(f: File, name: String, mime: String): DocKind {
    val n = name.lowercase()
    val ext = n.substringAfterLast('.', "")
    return when {
        mime == "application/pdf" || ext == "pdf" -> DocKind.PDF
        ext == "svg" || mime == "image/svg+xml" -> DocKind.SVG
        ext == "tif" || ext == "tiff" || mime == "image/tiff" || TiffDecoder.looksTiff(f) -> DocKind.TIFF
        mime.startsWith("image/") || ext in setOf("jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif") -> DocKind.IMAGE
        ArchiveList.looksZip(f) && ext !in setOf("docx", "xlsx", "pptx", "apk", "jar", "odt", "ods", "odp", "epub") -> DocKind.ARCHIVE
        ext in setOf("zip", "rar") || ArchiveList.looksRar(f) -> DocKind.ARCHIVE
        mime.startsWith("text/") || mime == "application/json" || mime == "application/xml" ||
            ext in setOf("txt", "md", "json", "csv", "log", "kt", "js", "ts", "py", "html", "css", "xml", "yml", "yaml", "ini", "sh", "java", "c", "cpp", "h", "sql", "srt", "vtt") -> DocKind.TEXT
        else -> DocKind.OTHER
    }
}

@Composable
private fun DocBody(file: File, name: String, mime: String, size: Int) {
    val kind = remember(file.path) { docKind(file, name, mime) }
    when (kind) {
        DocKind.PDF -> PdfPages(file)
        DocKind.TEXT -> TextDoc(file)
        DocKind.IMAGE -> ImageDoc(file)
        DocKind.SVG -> SvgDoc(file)
        DocKind.TIFF -> TiffDoc(file)
        DocKind.ARCHIVE -> ArchiveDoc(file)
        DocKind.OTHER -> OtherDoc(name, mime, size)
    }
}

/* ------------------------------ PDF ------------------------------ */

@Composable
private fun PdfPages(file: File) {
    val density = LocalDensity.current
    var pageCount by remember(file.path) { mutableIntStateOf(0) }
    var failed by remember(file.path) { mutableStateOf(false) }
    var locked by remember(file.path) { mutableStateOf(false) }
    val renderer = remember(file.path) { mutableStateOf<PdfRenderer?>(null) }
    val lock = remember(file.path) { Any() }
    DisposableEffect(file.path) {
        runCatching {
            val pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            val r = PdfRenderer(pfd)
            renderer.value = r
            pageCount = r.pageCount
        }.onFailure { e ->
            // A password-protected PDF fails with SecurityException.
            locked = e is SecurityException
            failed = true
        }
        onDispose {
            synchronized(lock) {
                runCatching { renderer.value?.close() }
                renderer.value = null
            }
        }
    }
    val r = renderer.value
    when {
        failed && locked -> EmptyState(Icons.Filled.Lock, "Locked PDF", "This file needs a password")
        failed || r == null -> if (failed) EmptyState(Icons.Filled.InsertDriveFile, "Could not open", "This PDF could not be read")
        pageCount == 0 -> EmptyState(Icons.Filled.InsertDriveFile, "Empty PDF", "This file has no pages")
        else -> {
            // Pages render at the screen width (bounded 1600 px) — sharp on a
            // phone, small enough to keep a 100-page file scrolling.
            val screenDp = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp
            val widthPx = remember(screenDp) { with(density) { (screenDp.dp.toPx()).toInt().coerceIn(360, 1600) } }
            ZoomBox {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(pageCount) { index ->
                        PdfPage(r, lock, index, widthPx)
                    }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
private fun PdfPage(r: PdfRenderer, lock: Any, index: Int, widthPx: Int) {
    var bmp by remember(index) { mutableStateOf<Bitmap?>(null) }
    var ratio by remember(index) { mutableFloatStateOf(1f / 1.414f) }
    LaunchedEffect(index) {
        withContext(Dispatchers.IO) {
            runCatching {
                synchronized(lock) {
                    r.openPage(index).use { page ->
                        val w = widthPx
                        val h = (w * page.height.toFloat() / page.width).toInt().coerceIn(1, 6000)
                        ratio = w.toFloat() / h
                        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        b.eraseColor(android.graphics.Color.WHITE)
                        page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp = b
                    }
                }
            }
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(ratio)
            .clip(RoundedCornerShape(4.dp))
            .background(Color.White),
    ) {
        val b = bmp
        if (b != null) {
            Image(b.asImageBitmap(), "Page ${index + 1}", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        } else {
            CircularProgressIndicator(color = Color(0xFF9CA3AF), strokeWidth = 2.dp, modifier = Modifier.align(Alignment.Center).size(22.dp))
        }
    }
}

/**
 * Pinch zoom (1×–4×) + pan over any content. Events are consumed only with
 * two fingers down or while zoomed in, so a one-finger drag still scrolls
 * the page list underneath (the photo viewer's gesture, minus the dismiss).
 */
@Composable
private fun ZoomBox(content: @Composable () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offX by remember { mutableFloatStateOf(0f) }
    var offY by remember { mutableFloatStateOf(0f) }
    Box(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var twoFinger = false
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.changes.none { it.pressed }) break
                        if (event.changes.count { it.pressed } > 1) twoFinger = true
                        if (!twoFinger && scale <= 1.01f) continue
                        val zoom = event.calculateZoom()
                        val pan = event.calculatePan()
                        if (zoom != 1f) {
                            val newScale = (scale * zoom).coerceIn(1f, 4f)
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
                    }
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offX
                translationY = offY
            },
    ) { content() }
}

/* ------------------------------ TEXT ------------------------------ */

@Composable
private fun TextDoc(file: File) {
    var body by remember(file.path) { mutableStateOf<String?>(null) }
    LaunchedEffect(file.path) {
        body =
            withContext(Dispatchers.IO) {
                runCatching {
                    file.inputStream().use { input ->
                        val bytes = ByteArray(400_000)
                        var n = 0
                        while (n < bytes.size) {
                            val got = input.read(bytes, n, bytes.size - n)
                            if (got < 0) break
                            n += got
                        }
                        String(bytes, 0, n, Charsets.UTF_8) + if (file.length() > n) "\n\n… (${FilesUtil.displaySize(file.length().toInt())} in total)" else ""
                    }
                }.getOrDefault("")
            }
    }
    val text = body
    if (text == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = if (KpThemeMode.darkBlue) ActionBlue else Gold) }
        return
    }
    SelectionContainer {
        Text(
            text.ifBlank { "(empty file)" },
            fontFamily = FontFamily.Monospace,
            fontSize = 12.5.sp,
            lineHeight = 17.sp,
            color = Ink,
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        )
    }
}

/* ------------------------------ IMAGES ------------------------------ */

@Composable
private fun ImageDoc(file: File) {
    var bmp by remember(file.path) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(file.path) { mutableStateOf(false) }
    LaunchedEffect(file.path) {
        val b = withContext(Dispatchers.IO) { runCatching { Bitmaps.decodeFileBounded(file, 2048) }.getOrNull() }
        if (b == null) failed = true else bmp = b
    }
    PictureBody(bmp, failed)
}

@Composable
private fun TiffDoc(file: File) {
    var bmp by remember(file.path) { mutableStateOf<Bitmap?>(null) }
    var failed by remember(file.path) { mutableStateOf(false) }
    LaunchedEffect(file.path) {
        val img = withContext(Dispatchers.IO) { TiffDecoder.decode(file, 2048) }
        if (img == null) failed = true
        else bmp = Bitmap.createBitmap(img.argb, img.width, img.height, Bitmap.Config.ARGB_8888)
    }
    PictureBody(bmp, failed)
}

@Composable
private fun PictureBody(bmp: Bitmap?, failed: Boolean) {
    when {
        failed -> EmptyState(Icons.Filled.InsertDriveFile, "Could not open", "This picture could not be decoded")
        bmp == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = if (KpThemeMode.darkBlue) ActionBlue else Gold) }
        else ->
            ZoomBox {
                Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                    Image(bmp.asImageBitmap(), null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                }
            }
    }
}

/**
 * SVG through a WebView that can reach nothing: JavaScript off, no network
 * (blocked by the client), no file / content access. The markup is loaded
 * as a data document with an about:blank base, so an `<image href>` or a
 * script in the file draws nothing and calls nobody.
 */
@Composable
private fun SvgDoc(file: File) {
    var markup by remember(file.path) { mutableStateOf<String?>(null) }
    LaunchedEffect(file.path) {
        markup = withContext(Dispatchers.IO) { runCatching { if (file.length() > 3_000_000L) "" else file.readText() }.getOrDefault("") }
    }
    val svg = markup
    when {
        svg == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = if (KpThemeMode.darkBlue) ActionBlue else Gold) }
        svg.isBlank() || !svg.contains("<svg", ignoreCase = true) -> EmptyState(Icons.Filled.InsertDriveFile, "Could not open", "This SVG could not be read")
        else ->
            AndroidView(
                factory = { c ->
                    android.webkit.WebView(c).apply {
                        settings.javaScriptEnabled = false
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.blockNetworkLoads = true
                        settings.blockNetworkImage = true
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        setBackgroundColor(android.graphics.Color.WHITE)
                        webViewClient =
                            object : android.webkit.WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): Boolean = true

                                override fun shouldInterceptRequest(view: android.webkit.WebView?, request: android.webkit.WebResourceRequest?): android.webkit.WebResourceResponse? =
                                    android.webkit.WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
                            }
                        val cleaned = svg.replace(Regex("<script[\\s\\S]*?</script>", RegexOption.IGNORE_CASE), "")
                        val page =
                            "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
                                "<style>html,body{margin:0;background:#fff;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100vw;max-height:100vh;width:100vw;height:auto}</style>" +
                                "</head><body>" + cleaned + "</body></html>"
                        loadDataWithBaseURL("about:blank", page, "text/html", "utf-8", null)
                    }
                },
                onRelease = { it.destroy() },
                modifier = Modifier.fillMaxSize(),
            )
    }
}

/* ------------------------------ ARCHIVES ------------------------------ */

@Composable
private fun ArchiveDoc(file: File) {
    var listing by remember(file.path) { mutableStateOf<ArchiveList.Listing?>(null) }
    var failed by remember(file.path) { mutableStateOf(false) }
    LaunchedEffect(file.path) {
        val l = withContext(Dispatchers.IO) { ArchiveList.list(file) }
        if (l == null) failed = true else listing = l
    }
    val l = listing
    when {
        failed -> EmptyState(Icons.Filled.InsertDriveFile, "Could not open", "This archive could not be read")
        l == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = if (KpThemeMode.darkBlue) ActionBlue else Gold) }
        l.entries.isEmpty() && l.locked -> EmptyState(Icons.Filled.Lock, "Locked archive", "The file names are encrypted")
        l.entries.isEmpty() -> EmptyState(Icons.Filled.Folder, "Empty archive", "There is nothing inside")
        else -> {
            val sorted = remember(l) { l.entries.sortedWith(compareBy({ !it.dir }, { it.path.lowercase() })) }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 6.dp)) {
                if (l.locked) {
                    item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Lock, null, tint = Muted, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Password protected", color = Muted, fontSize = 12.5.sp)
                        }
                    }
                }
                itemsIndexed(sorted, key = { i, e -> "$i:${e.path}" }) { _, e ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            if (e.dir) Icons.Filled.Folder else Icons.Filled.InsertDriveFile,
                            null,
                            tint = if (KpThemeMode.darkBlue) ActionBlue else GoldDeep,
                            modifier = Modifier.size(22.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            val slash = e.path.lastIndexOf('/')
                            val leaf = if (slash >= 0) e.path.substring(slash + 1) else e.path
                            val folder = if (slash >= 0) e.path.substring(0, slash) else ""
                            Text(leaf, color = Ink, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (folder.isNotBlank()) Text(folder, color = Muted, fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (!e.dir) {
                            Spacer(Modifier.width(8.dp))
                            Text(FilesUtil.displaySize(e.size.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()), color = Muted, fontSize = 12.sp)
                        }
                    }
                }
                if (l.truncated) {
                    item { Text("… and more", color = Muted, fontSize = 12.5.sp, modifier = Modifier.padding(16.dp)) }
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

/* ------------------------------ OTHER ------------------------------ */

@Composable
private fun OtherDoc(name: String, mime: String, size: Int) {
    val ext = name.substringAfterLast('.', "").uppercase()
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier
                .size(88.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.18f) else GoldSoft),
            contentAlignment = Alignment.Center,
        ) {
            if (ext.isNotBlank() && ext.length <= 5) {
                Text(ext, color = if (KpThemeMode.darkBlue) ActionBlue else GoldDeep, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            } else {
                Icon(Icons.Filled.InsertDriveFile, null, tint = if (KpThemeMode.darkBlue) ActionBlue else GoldDeep, modifier = Modifier.size(40.dp))
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(name, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        Text(listOf(mime.takeIf { it.isNotBlank() && it != "application/octet-stream" }, FilesUtil.displaySize(size).takeIf { size > 0 }).filterNotNull().joinToString(" · "), color = Muted, fontSize = 12.5.sp)
    }
}
