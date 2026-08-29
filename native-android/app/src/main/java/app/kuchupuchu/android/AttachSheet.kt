package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.location.LocationManager
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ContactPage
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One device media item for the attach panel grid. */
private data class MediaItem(
    val uri: Uri,
    val isVideo: Boolean,
    val durationMs: Long,
    val bucket: String,
    val added: Long,
)

private data class AttachAction(
    val icon: ImageVector,
    val tint: Color,
    val label: String,
    val onClick: () -> Unit,
)

/**
 * Attach panel — WhatsApp-exact: sits UNDER the message bar (the bar stays
 * on top of it), normally NOT fullscreen; tapping the handle or swiping it
 * up is the ONLY way it goes fullscreen. Grid taps SELECT (multi-select
 * with numbered badges); a send button appears once something is picked.
 * The chevron next to "Recent" opens device FOLDERS (Camera, Screenshots…).
 */
@Composable
fun AttachPanel(
    onDismiss: () -> Unit,
    onImagePicked: (Uri) -> Unit,
    onDocumentPicked: (Uri) -> Unit,
    onContactPicked: (Uri) -> Unit,
    onLocationRequested: () -> Unit,
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()
    var canRead by remember { mutableStateOf(false) }
    var pool by remember { mutableStateOf(listOf<MediaItem>()) }
    var foldersOpen by remember { mutableStateOf(false) }
    var folder by remember { mutableStateOf<String?>(null) }
    var fullscreen by remember { mutableStateOf(false) }
    val sel = remember { mutableStateListOf<MediaItem>() }
    val dragTotal = remember { mutableStateOf(0f) }

    val screenH = LocalConfiguration.current.screenHeightDp.dp
    val targetH = if (fullscreen) screenH - 132.dp else screenH * 0.40f
    val panelH by animateDpAsState(targetH, tween(260), label = "attachPanelH")

    fun hasRead(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        canRead = hasRead()
    }

    LaunchedEffect(Unit) {
        canRead = hasRead()
        if (!canRead) {
            permission.launch(
                if (Build.VERSION.SDK_INT >= 33) {
                    arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
                } else {
                    arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                },
            )
        }
    }

    LaunchedEffect(canRead) {
        if (!canRead) return@LaunchedEffect
        pool = withContext(Dispatchers.IO) {
            runCatching { loadMediaPool(ctx) }.getOrDefault(emptyList())
        }
    }

    val gallery =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            onDismiss()
            if (uri != null) onImagePicked(uri)
        }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            onDismiss()
            if (ok) cameraUri?.let(onImagePicked)
        }
    val document =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            onDismiss()
            if (uri != null) onDocumentPicked(uri)
        }
    val contact =
        rememberLauncherForActivityResult(ActivityResultContracts.PickContact()) { uri ->
            onDismiss()
            if (uri != null) onContactPicked(uri)
        }
    val locationPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            onDismiss()
            if (granted) onLocationRequested()
        }
    fun comingSoon() {
        Toast.makeText(ctx, "Coming in a future update", Toast.LENGTH_SHORT).show()
    }

    fun sendSelected() {
        val batch = sel.toList()
        sel.clear()
        onDismiss()
        // fire sequentially so pending outbox keeps its order (photos first,
        // then videos — WhatsApp mixes, we keep the user's tap order)
        scope.launch {
            batch.forEach { item ->
                if (item.isVideo) onDocumentPicked(item.uri) else onImagePicked(item.uri)
            }
        }
    }

    val buckets =
        remember(pool) {
            pool.groupBy { it.bucket }
                .map { (name, items) -> Triple(name, items.size, items.maxOf { it.added }) }
                .sortedByDescending { it.third }
        }
    val shown =
        when {
            !foldersOpen -> pool.take(24)
            folder == null -> pool.take(80)
            else -> pool.filter { it.bucket == folder }.take(80)
        }

    Column(
        Modifier
            .fillMaxWidth()
            .height(panelH)
            .background(Cream),
    ) {
        /* drag handle — tap OR swipe up = fullscreen; swipe down = back.
           This is the ONLY fullscreen trigger, like WhatsApp. */
        Box(
            Modifier
                .fillMaxWidth()
                .clickable {
                    haptics.tap()
                    fullscreen = !fullscreen
                }
                .pointerInput("expandDrag") {
                    detectVerticalDragGestures(
                        onDragEnd = {
                            if (dragTotal.value < -70f) fullscreen = true
                            else if (dragTotal.value > 70f) fullscreen = false
                            dragTotal.value = 0f
                        },
                    ) { _, amount ->
                        dragTotal.value += amount
                    }
                }
                .padding(top = 4.dp, bottom = 3.dp),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(width = 40.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color(0x59FFFFFF)),
            )
        }

        /* action grid — 2 x 4; swiping the handle up HIDES it so the
           gallery grid takes the whole panel (WhatsApp behaviour) */
        val rows = listOf(
            listOf(
                AttachAction(Icons.Filled.Image, Color(0xFF60A5FA), "Gallery") {
                    gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                AttachAction(Icons.Filled.CameraAlt, Color(0xFFF472B6), "Camera") {
                    val f = java.io.File(ctx.cacheDir, "camera_${System.currentTimeMillis()}.jpg")
                    cameraUri = androidx.core.content.FileProvider.getUriForFile(
                        ctx,
                        "${ctx.packageName}.fileprovider",
                        f,
                    )
                    camera.launch(cameraUri!!)
                },
                AttachAction(Icons.Filled.LocationOn, Color(0xFF34D399), "Location") {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    ) {
                        onDismiss()
                        onLocationRequested()
                    } else {
                        locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                    }
                },
                AttachAction(Icons.Filled.ContactPage, Color(0xFF38BDF8), "Contact") {
                    contact.launch(null)
                },
            ),
            listOf(
                AttachAction(Icons.Filled.Description, Color(0xFFA78BFA), "Document") {
                    document.launch("*/*")
                },
                AttachAction(Icons.Filled.Poll, Color(0xFFFBBF24), "Poll") { comingSoon() },
                AttachAction(Icons.Filled.Event, Color(0xFFF87171), "Event") { comingSoon() },
                AttachAction(Icons.Filled.AutoAwesome, Color(0xFF818CF8), "AI images") { comingSoon() },
            ),
        )
        if (!fullscreen) {
            rows.forEach { row ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 1.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    row.forEach { a -> AttachTile(a.icon, a.tint, a.label, a.onClick) }
                }
            }
        }

        if (!canRead) {
            Text(
                "Gallery permission off — actions still kaj korbe; recent photos dekhte permission din.",
                color = Color(0x801C1917),
                fontSize = 12.sp,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            return@Column
        }

        /* header: Recent / folder name — selection count + SEND replaces the
           chevron while a selection is active (WhatsApp behavior) */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 14.dp, end = 10.dp, top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (foldersOpen && folder != null) folder!! else "Recent",
                color = Ink,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            if (sel.isNotEmpty()) {
                Text(
                    "${sel.size} selected",
                    color = Ink,
                    fontSize = 12.5.sp,
                )
                Spacer(Modifier.size(10.dp))
                Box(
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Gold)
                        .clickable {
                            haptics.confirm()
                            sendSelected()
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Filled.Send,
                        contentDescription = "Send selected",
                        tint = Color(0xFFFFFFFF),
                        modifier = Modifier
                            .size(20.dp)
                            .padding(start = 1.dp),
                    )
                }
            } else {
                Icon(
                    if (foldersOpen) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                    contentDescription = "Folders",
                    tint = Ink,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickable {
                            haptics.tap()
                            foldersOpen = !foldersOpen
                            if (!foldersOpen) folder = null
                        }
                        .padding(6.dp)
                        .size(20.dp),
                )
            }
        }

        /* folder chips (only when the chevron opened them) */
        if (foldersOpen) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val all = listOf("All" to buckets.sumOf { it.second })
                (all + buckets.map { it.first to it.second }).forEach { (name, count) ->
                    val selected = (folder == null && name == "All") || folder == name
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(if (selected) Color(0xFFFEF3C7) else Color(0x0F1C1917))
                            .clickable {
                                if (name == "All") folder = null else folder = name
                            }
                            .padding(horizontal = 12.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            name,
                            color = if (selected) GoldDeep else Color(0x991C1917),
                            fontSize = 12.5.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        )
                        Text("  $count", color = Color(0x661C1917), fontSize = 11.sp)
                    }
                }
            }
        }

        if (shown.isEmpty()) {
            Text(
                if (foldersOpen) "This folder khali — onno folder try koro" else "No recent media",
                color = Color(0x801C1917),
                fontSize = 13.sp,
                modifier = Modifier
                    .padding(vertical = 14.dp)
                    .align(Alignment.CenterHorizontally),
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(horizontal = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(shown, key = { it.uri.toString() }) { item ->
                    val pos = sel.indexOfFirst { it.uri == item.uri }
                    MediaCell(
                        item,
                        ctx,
                        selected = pos >= 0,
                        selectIndex = if (pos >= 0) pos + 1 else 0,
                        onToggle = {
                            haptics.tap()
                            if (pos >= 0) sel.removeAll { it.uri == item.uri } else sel.add(item)
                        },
                    )
                }
            }
        }
    }
}

/** Newest-first device media pool: 400 images + 80 videos, bucket-tagged. */
private fun loadMediaPool(ctx: android.content.Context): List<MediaItem> {
    val out = ArrayList<MediaItem>()
    runCatching {
        ctx.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                MediaStore.Images.Media.DATE_ADDED,
            ),
            null,
            null,
            "${MediaStore.Images.Media.DATE_ADDED} DESC",
        )?.use { c ->
            var n = 0
            while (c.moveToNext() && n < 400) {
                val id = c.getLong(0)
                val bucket = c.getString(1)?.ifBlank { null } ?: "Images"
                out.add(
                    MediaItem(
                        Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString()),
                        false,
                        0,
                        bucket,
                        c.getLong(2),
                    ),
                )
                n++
            }
        }
    }
    runCatching {
        ctx.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            arrayOf(
                MediaStore.Video.Media._ID,
                MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
                MediaStore.Video.Media.DATE_ADDED,
                MediaStore.Video.Media.DURATION,
            ),
            null,
            null,
            "${MediaStore.Video.Media.DATE_ADDED} DESC",
        )?.use { c ->
            var n = 0
            while (c.moveToNext() && n < 80) {
                val id = c.getLong(0)
                val bucket = c.getString(1)?.ifBlank { null } ?: "Videos"
                out.add(
                    MediaItem(
                        Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString()),
                        true,
                        c.getLong(3),
                        bucket,
                        c.getLong(2),
                    ),
                )
                n++
            }
        }
    }
    return out.sortedByDescending { it.added }
}

/** Grid cell: SELECT toggles (never sends), thumbnail decodes off-thread. */
@Composable
private fun MediaCell(
    item: MediaItem,
    ctx: android.content.Context,
    selected: Boolean,
    selectIndex: Int,
    onToggle: () -> Unit,
) {
    val thumb by produceState<ImageBitmap?>(initialValue = null, key1 = item.uri) {
        value = withContext(Dispatchers.IO) {
            runCatching { decodeThumb(item.uri, ctx, item.isVideo) }.getOrNull()
        }
    }
    Box(
        Modifier
            .aspectRatio(1f)
            .background(Color(0xFFEAE6DF))
            .clickable { onToggle() },
    ) {
        val bmp = thumb
        if (bmp != null) {
            Image(
                bmp,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
        if (item.isVideo) {
            Icon(
                Icons.Filled.Videocam,
                contentDescription = "Video",
                tint = Color.White,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(5.dp)
                    .size(15.dp),
            )
            Text(
                formatDuration(item.durationMs),
                color = Color.White,
                fontSize = 10.5.sp,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(5.dp),
            )
        }
        /* selection badge — appears ONLY once the item is tapped;
           unselected cells stay clean (no checkbox clutter) */
        if (selected) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(5.dp)
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(Gold),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "$selectIndex",
                    color = Color(0xFFFFFFFF),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

private fun decodeThumb(uri: Uri, ctx: android.content.Context, isVideo: Boolean): ImageBitmap? =
    runCatching {
        if (isVideo) {
            // ImageDecoder can't touch video URIs — pull a frame instead.
            val mmr = MediaMetadataRetriever()
            try {
                mmr.setDataSource(ctx, uri)
                val scaled = mmr.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 480, 480)
                    ?: mmr.frameAtTime
                scaled?.asImageBitmap()
            } finally {
                mmr.release()
            }
        } else if (Build.VERSION.SDK_INT >= 28) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { d, _, _ ->
                d.setTargetSampleSize(4)
            }.asImageBitmap()
        } else {
            val raw = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
            val opts = BitmapFactory.Options().apply { inSampleSize = 4 }
            BitmapFactory.decodeByteArray(raw, 0, raw.size, opts)?.asImageBitmap()
        }
    }.getOrNull()

private fun formatDuration(ms: Long): String {
    if (ms <= 0) return "0:00"
    return "%d:%02d".format(ms / 60_000, (ms % 60_000) / 1000)
}

@Composable
private fun AttachTile(icon: ImageVector, tint: Color, label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(horizontal = 4.dp, vertical = 2.dp),
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .border(1.dp, Color(0x1F1C1917), CircleShape)
                .background(Color(0xFFFFFFFF)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 10.sp, color = Ink, fontWeight = FontWeight.Medium)
    }
}

private var cameraUri: Uri? = null

internal fun queryName(ctx: android.content.Context, uri: Uri): String {
    var name = uri.lastPathSegment ?: "file"
    runCatching {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) c.getString(idx)?.let { name = it }
            }
        }
    }
    return name.substringAfterLast('/')
}

@Suppress("MissingPermission")
internal fun readLocation(ctx: android.content.Context): String {
    val mgr = ctx.getSystemService(android.content.Context.LOCATION_SERVICE) as LocationManager
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
    for (p in providers) {
        runCatching { mgr.getLastKnownLocation(p) }?.getOrNull()?.let { loc ->
            return "📍 My location: https://maps.google.com/?q=${"%.5f".format(loc.latitude)},${"%.5f".format(loc.longitude)}"
        }
    }
    return ""
}

internal fun readContact(ctx: android.content.Context, uri: Uri): String {
    return runCatching {
        var name = ""
        var number = ""
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val ni = c.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME)
                if (ni >= 0) name = c.getString(ni) ?: ""
                val hasPhone =
                    c.getColumnIndex(ContactsContract.Contacts.HAS_PHONE_NUMBER)
                if (hasPhone < 0 || c.getInt(hasPhone) > 0) {
                    val idIdx = c.getColumnIndex(ContactsContract.Contacts._ID)
                    val id = if (idIdx >= 0) c.getString(idIdx) else null
                    if (id != null) {
                        ctx.contentResolver.query(
                            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                            null,
                            "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
                            arrayOf(id),
                            null,
                        )?.use { p ->
                            if (p.moveToFirst()) {
                                val pi = p.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
                                if (pi >= 0) number = p.getString(pi) ?: ""
                            }
                        }
                    }
                }
            }
        }
        buildString {
            append("👤 Contact")
            if (name.isNotBlank()) append(": $name")
            if (number.isNotBlank()) append("\n📱 $number")
        }
    }.getOrDefault("")
}
