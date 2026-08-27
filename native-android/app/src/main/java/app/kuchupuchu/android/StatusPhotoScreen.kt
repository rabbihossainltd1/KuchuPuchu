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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
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
    var caption by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                scope.launch {
                    val d = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx) }
                    if (d == null) error = "Could not read that photo."
                    dataUrl = d
                }
            }
        }

    Column(Modifier.fillMaxSize().background(Cream)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.Filled.Close, "Close", tint = Ink)
            }
            Text("Photo status", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        Box(
            Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .height(400.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Card),
            contentAlignment = Alignment.Center,
        ) {
            val bmp = rememberBitmap(dataUrl)
            if (bmp != null) {
                Image(bmp, contentDescription = "Status photo", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🖼", fontSize = 44.sp)
                    Spacer(Modifier.height(8.dp))
                    Text("Tap below to pick a photo", color = Muted, fontSize = 14.sp)
                    Spacer(Modifier.height(14.dp))
                    Box(
                        Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(Gold)
                            .padding(12.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("＋", color = AmberInk, fontSize = 20.sp) }
                }
            }
        }
        if (dataUrl != null) {
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
        Spacer(Modifier.weight(1f))
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = androidx.compose.foundation.layout.Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GoldBtn("Choose photo") {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            if (dataUrl != null) {
                GoldBtn(if (busy) "…" else "Post", enabled = !busy) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    "/api/statuses",
                                    JSONObject()
                                        .put("kind", "IMAGE")
                                        .put("imageData", dataUrl)
                                        .put("text", caption.trim()),
                                )
                            }
                            nav.popBackStack()
                        } catch (e: Exception) {
                            error = e.message ?: "Could not post."
                        } finally {
                            busy = false
                        }
                    }
                }
            }
        }
    }
}
