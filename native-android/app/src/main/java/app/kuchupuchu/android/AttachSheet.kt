package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.ImageDecoder
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ContactPage
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Poll
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One recent gallery item shown in the attach sheet. */
private data class RecentMedia(
    val uri: Uri,
    val isVideo: Boolean,
    val durationMs: Long,
    val thumb: ImageBitmap?,
)

private data class AttachAction(
    val icon: ImageVector,
    val tint: Color,
    val label: String,
    val onClick: () -> Unit,
)

/**
 * Attach sheet — WhatsApp-style dark panel that opens right above the chat
 * bar: two rows of round actions, and a RECENT photos+videos grid under it,
 * so media goes out without ever opening a gallery app. Videos ride the
 * document (FILE) upload path, photos the inline image path.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachSheet(
    onDismiss: () -> Unit,
    onImagePicked: (Uri) -> Unit,
    onDocumentPicked: (Uri) -> Unit,
    onContactPicked: (Uri) -> Unit,
    onLocationRequested: () -> Unit,
) {
    val ctx = LocalContext.current
    var recent by remember { mutableStateOf(listOf<RecentMedia>()) }
    var canRead by remember { mutableStateOf(false) }

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
        recent = withContext(Dispatchers.IO) {
            runCatching { loadRecentMedia(ctx) }.getOrDefault(emptyList())
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
    val audio =
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

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF201E1B),
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            /* drag handle */
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = 2.dp, bottom = 12.dp)
                    .size(width = 44.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Color(0x40FFFFFF)),
            )

            /* action grid — 2 x 4 like the WhatsApp reference */
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
            rows.forEach { row ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 5.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    row.forEach { a -> AttachTile(a.icon, a.tint, a.label, a.onClick) }
                }
            }

            /* recent media — straight from MediaStore, tap = send */
            if (canRead) {
                if (recent.isNotEmpty()) {
                    Text(
                        "Recent",
                        color = Color(0xB3FFFFFF),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 6.dp),
                    )
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(4),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 340.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        items(recent, key = { it.uri.toString() }) { item ->
                            Box(
                                Modifier
                                    .aspectRatio(1f)
                                    .background(Color(0xFF2B2823))
                                    .clickable {
                                        onDismiss()
                                        // Videos ride the FILE path (raw upload),
                                        // photos the inline image path.
                                        if (item.isVideo) onDocumentPicked(item.uri) else onImagePicked(item.uri)
                                    },
                            ) {
                                val bmp = item.thumb
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
                            }
                        }
                    }
                } else {
                    Text(
                        "No recent media",
                        color = Color(0x80FFFFFF),
                        fontSize = 13.sp,
                        modifier = Modifier
                            .padding(vertical = 14.dp)
                            .align(Alignment.CenterHorizontally),
                    )
                }
            } else {
                Text(
                    "Gallery permission deny korechen — actions still work, recent photos dekhte permission din.",
                    color = Color(0x80FFFFFF),
                    fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

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
            .padding(horizontal = 8.dp, vertical = 5.dp),
    ) {
        Box(
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .border(1.dp, Color(0x33FFFFFF), CircleShape)
                .background(Color(0x14FFFFFF)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(26.dp))
        }
        Spacer(Modifier.height(5.dp))
        Text(label, fontSize = 12.sp, color = Color(0xCCFFFFFF), fontWeight = FontWeight.Medium)
    }
}

/** Newest photos first, then newest videos — capped for a fast sheet. */
private fun loadRecentMedia(ctx: android.content.Context): List<RecentMedia> {
    val out = ArrayList<RecentMedia>()

    fun decode(uri: Uri): ImageBitmap? =
        runCatching {
            if (Build.VERSION.SDK_INT >= 28) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { d, _ ->
                    d.setTargetSampleSize(2)
                }.asImageBitmap()
            } else {
                val raw = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
                android.graphics.BitmapFactory.decodeByteArray(raw, 0, raw.size)?.asImageBitmap()
            }
        }.getOrNull()

    runCatching {
        ctx.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Images.Media._ID),
            null,
            null,
            "${MediaStore.Images.Media.DATE_ADDED} DESC",
        )?.use { c ->
            var n = 0
            while (c.moveToNext() && n < 9) {
                val id = c.getLong(0)
                val uri = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString())
                out.add(RecentMedia(uri, false, 0, decode(uri)))
                n++
            }
        }
    }
    runCatching {
        ctx.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Video.Media._ID, MediaStore.Video.Media.DURATION),
            null,
            null,
            "${MediaStore.Video.Media.DATE_ADDED} DESC",
        )?.use { c ->
            var n = 0
            while (c.moveToNext() && n < 5) {
                val id = c.getLong(0)
                val dur = c.getLong(1)
                val uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString())
                out.add(RecentMedia(uri, true, dur, decode(uri)))
                n++
            }
        }
    }
    return out.take(14)
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
