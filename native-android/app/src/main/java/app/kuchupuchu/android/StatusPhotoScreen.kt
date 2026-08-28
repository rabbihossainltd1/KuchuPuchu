package app.kuchupuchu.android

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Photo status: pick a photo (downscaled like chat photos), preview,
 * optional caption, post as a 24h IMAGE status.
 */
@Composable
fun StatusPhotoScreen(nav: NavController) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var dataUrl by remember { mutableStateOf<String?>(null) }
    var videoUri by remember { mutableStateOf<android.net.Uri?>(null) }
    var videoSecs by remember { mutableStateOf(0) }
    var caption by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                scope.launch {
                    val mime = ctx.contentResolver.getType(uri) ?: ""
                    if (mime.startsWith("video")) {
                        val secs = withContext(Dispatchers.IO) {
                            val r = android.media.MediaMetadataRetriever()
                            runCatching {
                                r.setDataSource(ctx, uri)
                                (r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000
                            }.getOrDefault(0L).also { runCatching { r.release() } }.toInt()
                        }
                        if (secs > 60) {
                            error = "Video status can be at most 1 minute."
                            videoUri = null
                        } else {
                            error = ""
                            dataUrl = null
                            videoUri = uri
                            videoSecs = secs
                        }
                    } else {
                        videoUri = null
                        val d = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 1280, maxChars = 380_000) }
                        if (d == null) error = "Could not read that photo."
                        dataUrl = d
                    }
                }
            }
        }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.Filled.Close, "Close", tint = Ink)
            }
            Text("Photo or video status", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        // Flexible preview: takes whatever height is left after the caption
        // and the buttons, so "Post" always stays on-screen (the fixed 400dp
        // pushed it off small devices).
        Box(
            Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .weight(1f)
                .heightIn(min = 160.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Card),
            contentAlignment = Alignment.Center,
        ) {
            val bmp = rememberBitmap(dataUrl)
            if (bmp != null) {
                Image(bmp, contentDescription = "Status photo", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            } else if (videoUri != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        Icons.Filled.Videocam,
                        contentDescription = "Video status",
                        tint = GoldDeep,
                        modifier = Modifier.size(64.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("Video ready · ${videoSecs}s", color = Muted, fontSize = 14.sp)
                }
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        androidx.compose.material.icons.Icons.Filled.PhotoLibrary,
                        contentDescription = "Pick photo",
                        tint = GoldDeep,
                        modifier = Modifier.size(44.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("Tap below to pick a photo or a video (max 1 min)", color = Muted, fontSize = 14.sp)
                }
            }
        }
        if (videoUri != null) {
            Text("Video · ${videoSecs}s", color = Muted, modifier = Modifier.padding(horizontal = 16.dp))
        }
        if (dataUrl != null || videoUri != null) {
            OutlinedTextField(
                caption,
                { caption = it.take(200) },
                label = { Text("Caption (optional)") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
            )
        }
        if (error.isNotBlank()) {
            Text(error, color = Red, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp))
        }
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GoldBtn("Choose photo or video") {
                // ImageOnly meant the video branch below could never be reached,
                // even though the picker contract, the duration check and the
                // viewer all support video.
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            }
            if (dataUrl != null || videoUri != null) {
                GoldBtn("Post") {
                    // Snapshot everything, tell the user it's on its way, and
                    // leave the screen IMMEDIATELY — the upload continues in
                    // the background. Waiting on this screen felt frozen.
                    val vUri = videoUri
                    val img = dataUrl
                    val secs = videoSecs
                    val cap = caption.trim()
                    android.widget.Toast.makeText(ctx, "Sharing status…", android.widget.Toast.LENGTH_SHORT).show()
                    nav.popBackStack()
                    ScreenStore.appScope.launch {
                        try {
                            if (vUri != null) {
                                // Video goes to R2 as an object, not as a data
                                // URL - a minute of video is far past the inline
                                // budget the server allows.
                                val read = FilesUtil.readDocument(ctx, vUri)
                                    ?: throw Exception("Could not read that video.")
                                val (name, bytes) = read
                                if (bytes.size > 25 * 1024 * 1024) {
                                    throw Exception("That video is over 25 MB.")
                                }
                                val up = Api.upload(name.ifBlank { "status.mp4" }, "video/mp4", bytes)
                                Api.post(
                                    "/api/statuses",
                                    JSONObject()
                                        .put("kind", "VIDEO")
                                        .put("fileKey", up.optString("fileKey"))
                                        .put("seconds", secs)
                                        .put("text", cap),
                                )
                            } else {
                                Api.post(
                                    "/api/statuses",
                                    JSONObject()
                                        .put("kind", "IMAGE")
                                        .put("imageData", img)
                                        .put("text", cap),
                                )
                            }
                            runCatching {
                                val data = Api.get("/api/statuses", true)
                                ScreenStore.setStatuses(data.arr("items").objects())
                            }
                        } catch (e: Exception) {
                            android.os.Handler(android.os.Looper.getMainLooper()).post {
                                android.widget.Toast.makeText(
                                    ctx,
                                    e.message ?: "Status didn't post. Try again.",
                                    android.widget.Toast.LENGTH_LONG,
                                ).show()
                            }
                        }
                    }
                }
            }
        }
    }
}
