package app.kuchupuchu.android

import android.Manifest
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ContactPage
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.Icon
import android.content.Context
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Attach sheet — locked design #1: classic 3x2 grid.
 * Gallery / Camera / Document / Audio / Location / Contact.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachSheet(
    onDismiss: () -> Unit,
    onSendText: (String) -> Unit,
    onSendImage: (dataUrl: String) -> Unit,
    onSendFile: (name: String, mime: String, bytes: ByteArray) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    val gallery =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            onDismiss()
            if (uri != null) {
                scope.launch {
                    val dataUrl = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx) }
                    if (dataUrl != null) onSendImage(dataUrl)
                }
            }
        }
    val camera =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            onDismiss()
            if (ok && cameraUri != null) {
                val uri = cameraUri!!
                scope.launch {
                    val dataUrl = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx) }
                    if (dataUrl != null) onSendImage(dataUrl)
                }
            }
        }
    val document =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            onDismiss()
            if (uri != null) {
                scope.launch {
                    val pair = withContext(Dispatchers.IO) { FilesUtil.readDocument(ctx, uri) }
                    if (pair != null) {
                        val (mime, bytes) = pair
                        val name = queryName(ctx, uri)
                        onSendFile(name, mime, bytes)
                    }
                }
            }
        }
    val audio =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            onDismiss()
            if (uri != null) {
                scope.launch {
                    val pair = withContext(Dispatchers.IO) { FilesUtil.readDocument(ctx, uri) }
                    if (pair != null) {
                        val (mime, bytes) = pair
                        onSendFile(queryName(ctx, uri), if (mime.startsWith("audio")) mime else "audio/mpeg", bytes)
                    }
                }
            }
        }
    val contact =
        rememberLauncherForActivityResult(ActivityResultContracts.PickContact()) { uri ->
            onDismiss()
            if (uri != null) {
                scope.launch {
                    val text = withContext(Dispatchers.IO) { readContact(ctx, uri) }
                    if (text.isNotBlank()) onSendText(text)
                }
            }
        }
    val locationPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            onDismiss()
            if (granted) {
                scope.launch {
                    val text = withContext(Dispatchers.IO) { readLocation(ctx) }
                    if (text.isNotBlank()) onSendText(text)
                }
            }
        }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp)) {
            Text(
                "Attach",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
                modifier = Modifier.padding(bottom = 14.dp),
            )
            for (row in 0 until 2) {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 14.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    for (col in 0 until 3) {
                        val idx = row * 3 + col
                        when (idx) {
                            0 -> AttachTile(Icons.Filled.Image, Gold, "Gallery") {
                                gallery.launch(
                                    PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                                )
                            }
                            1 -> AttachTile(Icons.Filled.CameraAlt, Color(0xFF0EA5E9), "Camera") {
                                val f = java.io.File(ctx.cacheDir, "camera_${System.currentTimeMillis()}.jpg")
                                cameraUri = androidx.core.content.FileProvider.getUriForFile(
                                    ctx,
                                    "${ctx.packageName}.fileprovider",
                                    f,
                                )
                                camera.launch(cameraUri!!)
                            }
                            2 -> AttachTile(Icons.Filled.Description, Color(0xFF7C3AED), "Document") {
                                document.launch("*/*")
                            }
                            3 -> AttachTile(Icons.Filled.Audiotrack, Color(0xFFEA580C), "Audio") {
                                audio.launch("audio/*")
                            }
                            4 -> AttachTile(Icons.Filled.LocationOn, Color(0xFF16A34A), "Location") {
                                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                                    == PackageManager.PERMISSION_GRANTED ||
                                    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                                    == PackageManager.PERMISSION_GRANTED
                                ) {
                                    onDismiss()
                                    scope.launch {
                                        val text = withContext(Dispatchers.IO) { readLocation(ctx) }
                                        if (text.isNotBlank()) onSendText(text)
                                    }
                                } else {
                                    locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                                }
                            }
                            5 -> AttachTile(Icons.Filled.ContactPage, Color(0xFF0891B2), "Contact") {
                                contact.launch(null)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
        }
    }
}

@Composable
private fun AttachTile(icon: ImageVector, bg: Color, label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(16.dp))
            .clickable { onClick() }
            .padding(8.dp),
    ) {
        Box(
            Modifier
                .size(58.dp)
                .clip(CircleShape)
                .background(bg.copy(alpha = 0.14f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = label, tint = bg, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(6.dp))
        Text(label, fontSize = 12.5.sp, color = Muted, fontWeight = FontWeight.Medium)
    }
}

private var cameraUri: Uri? = null

private fun queryName(ctx: android.content.Context, uri: Uri): String {
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
private fun readLocation(ctx: android.content.Context): String {
    val mgr = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
    for (p in providers) {
        runCatching { mgr.getLastKnownLocation(p) }?.getOrNull()?.let { loc ->
            return "📍 My location: https://maps.google.com/?q=${"%.5f".format(loc.latitude)},${"%.5f".format(loc.longitude)}"
        }
    }
    return ""
}

private fun readContact(ctx: android.content.Context, uri: Uri): String {
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
