package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ProfileScreen(nav: NavController, userId: String) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // Paint INSTANTLY from the cached conversation data (name/avatar/username/
    // about all ride along with the chat list) — the network call only
    // refreshes. First open used to sit on "Loading…" like a web page.
    var user by remember { mutableStateOf(profileSnapshot(userId)) }
    var error by remember { mutableStateOf("") }
    // The API answers `blocked` on the profile now (it has to, so the profile can
    // be shown at all to someone who blocked this user). Starting from `false`
    // meant an already-blocked contact showed "Block"; tapping it POSTed a second
    // block and the UI said "blocked" while the server said nothing changed.
    var blocked by remember { mutableStateOf(user?.optBoolean("blocked") == true) }

    LaunchedEffect(userId) {
        runCatching {
            val cached = withContext(Dispatchers.IO) { Api.get("/api/users/$userId") }
            user = cached.optJSONObject("user") ?: user
            error = ""
            val fresh = withContext(Dispatchers.IO) { Api.get("/api/users/$userId", true) }
            user = fresh.optJSONObject("user") ?: user
        }.onSuccess {
            // Re-read from the row we actually ended up showing, so a stale cache
            // can never disagree with the button.
            user?.takeIf { it.has("blocked") }?.let { blocked = it.optBoolean("blocked") }
        }.onFailure {
            if (user == null) error = it.message ?: "Could not load profile."
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
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("Contact", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        val u = user
        if (u == null) {
            Text(error.ifBlank { "Loading…" }, color = Muted, modifier = Modifier.padding(24.dp))
            return
        }
        // Compact header: avatar, name, @username, online, about — no big
        // empty blocks in between (optText keeps JSON-null fields from
        // rendering as the literal string "null").
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            var viewerUrl by remember { mutableStateOf<String?>(null) }
            // THE REFERENCE, NOT THE PAYLOAD FIELD. `/api/users/:id` light rows (the
            // chat-list snapshot this screen paints from) carry `avatarUrl: null` and
            // only an `avatarRef`; the bytes live in the per-version avatar cache.
            // Reading `u.optText("avatarUrl")` here meant: nothing to show until the
            // network answered, then a fresh 80KB data-URI decode — so an already
            // downloaded photo reloaded on every app start, while offline it "stayed
            // loaded" because the cached payload still had the old bytes.
            val avatarRef = u.optIso("avatarRef")
            val shownAvatar = rememberAvatarUrl(u.optText("avatarUrl").ifBlank { null }, avatarRef)
            Box {
                KpAvatar(
                    u.optText("displayName").ifBlank { "?" },
                    shownAvatar,
                    88.dp,
                    avatarRef = avatarRef,
                )
                // Tapping the photo opens it full-screen (zoom + save) — the resolved
                // value, so the viewer works from the cache too.
                Box(
                    Modifier
                        .matchParentSize()
                        .clickable { shownAvatar?.takeIf { it.isNotBlank() }?.let { viewerUrl = it } },
                )
            }
            viewerUrl?.let { url ->
                ProfilePhotoDialog(
                    url = url,
                    name = u.optText("displayName"),
                    onClose = { viewerUrl = null },
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(u.optText("displayName").ifBlank { "—" }, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
            val uname = u.optText("username")
            if (uname.isNotBlank()) Text("@$uname", fontSize = 13.5.sp, color = Muted)
            val about = u.optText("about")
            if (about.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(about, fontSize = 13.5.sp, color = Ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    CallEngine.instance?.startCall(userId, "AUDIO", u.optText("displayName"), u.optText("avatarUrl"))
                }) {
                    Icon(Icons.Filled.Call, "Voice call", tint = GoldDeep, modifier = Modifier.size(25.dp))
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    CallEngine.instance?.startCall(userId, "VIDEO", u.optText("displayName"), u.optText("avatarUrl"))
                }) {
                    Icon(Icons.Filled.Videocam, "Video call", tint = GoldDeep, modifier = Modifier.size(27.dp))
                }
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                ProfileHeaderCallBtn(onClick = {
                    haptics.tap()
                    scope.launch {
                        runCatching {
                            val data = withContext(Dispatchers.IO) {
                                Api.post("/api/conversations", JSONObject().put("userId", userId))
                            }
                            val cid = data.optJSONObject("conversation")?.optString("id").orEmpty()
                            if (cid.isNotBlank()) {
                                ScreenStore.pendingChatSearch = cid
                                nav.navigate("chat/$cid")
                            }
                        }
                    }
                }) {
                    Icon(Icons.Filled.Search, "Search", tint = GoldDeep, modifier = Modifier.size(25.dp))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Column(Modifier.padding(horizontal = 16.dp)) {
            // Real shared-media strip: recent photos from this user's chat.
            // (The card here used to be a dead placeholder.)
            val convId0 = ScreenStore.convs
                .firstOrNull { !it.optBoolean("isGroup") && it.optJSONObject("other")?.optString("id") == userId }
                ?.optString("id")
            val photos = remember(convId0, ScreenStore.msgsVersion.value) {
                if (convId0 == null) emptyList()
                else ScreenStore.msgsOf(convId0).filter { m ->
                    val k = m.optString("kind")
                    (k == "IMAGE" && m.optText("mediaUrl").isNotBlank()) ||
                        (k == "FILE" && (m.optText("fileType").startsWith("image") ||
                            listOf(".jpg", ".jpeg", ".png", ".webp").any { m.optText("fileName").lowercase().endsWith(it) }))
                }.takeLast(9).reversed()
            }
            if (convId0 != null) {
                if (photos.isNotEmpty()) {
                    LazyRow(
                        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
                    ) {
                        items(photos.size) { i ->
                            val m = photos[i]
                            val url =
                                m.optText("mediaUrl").takeIf { it.isNotBlank() }
                                    ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { k ->
                                        if (k.startsWith("data:") || k.startsWith("http") || k.startsWith("/")) k else "/api/files/$k"
                                    } ?: ""
                            Box(
                                Modifier
                                    .size(86.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { nav.navigate("chatmedia/$convId0") },
                            ) {
                                KpNetImage(url, "Shared photo", Modifier.fillMaxSize())
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Shared media — tap to see all",
                        color = Muted,
                        fontSize = 12.sp,
                        modifier = Modifier.clickable { nav.navigate("chatmedia/$convId0") },
                    )
                } else {
                    Text("No shared media yet — photos you send will appear here.", color = Muted, fontSize = 13.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
            androidx.compose.foundation.layout.Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card)
                    .padding(4.dp),
            ) {
                androidx.compose.material3.TextButton(
                    onClick = {
                        scope.launch {
                            runCatching {
                                val res = withContext(Dispatchers.IO) {
                                    if (blocked) Api.delete("/api/blocks/$userId")
                                    else Api.post("/api/blocks", JSONObject().put("userId", userId))
                                }
                                // Flip on the server's answer only: these calls
                                // return an error body (403/429) instead of
                                // throwing, and the old code marked the user blocked
                                // even when the write was refused.
                                if (!res.has("error")) blocked = !blocked
                            }
                        }
                    },
                ) {
                    Icon(Icons.Filled.Block, null, tint = Red, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (blocked) "Unblock" else "Block", color = Red)
                }
            }
        }
    }
}

@Composable
private fun ProfileHeaderCallBtn(onClick: () -> Unit, icon: @Composable () -> Unit) {
    val haptics = rememberHaptics()
    Box(
        Modifier
            .padding(horizontal = 3.dp)
            .size(50.dp)
            .shadow(5.dp, CircleShape)
            .clip(CircleShape)
            .background(Brush.verticalGradient(listOf(Color(0xFFFFFFFF), Color(0xFFF3E4C6))))
            .border(1.dp, Color(0x24000000), CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

private fun profileSnapshot(userId: String): JSONObject? {
    ScreenStore.convs.forEach { c ->
        val o = c.optJSONObject("other")
        if (o != null && o.optString("id") == userId) return o
    }
    return Cache.peek("/api/users/$userId")?.optJSONObject("user")
}

/** Full-screen profile photo with zoom + save-to-gallery. */
@Composable
private fun ProfilePhotoDialog(url: String, name: String, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var scale by remember { mutableStateOf(1f) }
    var offX by remember { mutableStateOf(0f) }
    var offY by remember { mutableStateOf(0f) }
    androidx.compose.ui.window.Dialog(
        onDismissRequest = onClose,
        properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Box(
                Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 6f)
                            offX = if (scale > 1f) offX + pan.x else 0f
                            offY = if (scale > 1f) offY + pan.y else 0f
                        }
                    },
            ) {
                KpNetImage(
                    url,
                    name,
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offX, translationY = offY),
                    androidx.compose.ui.layout.ContentScale.Fit,
                )
            }
            IconButton(onClick = onClose, Modifier.align(Alignment.TopStart).padding(6.dp)) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White)
            }
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                IconButton(onClick = {
                    scope.launch {
                        val bytes = withContext(Dispatchers.IO) {
                            runCatching {
                                if (url.startsWith("data:")) {
                                    android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                                } else Api.download(url)
                            }.getOrNull()
                        }
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
                }) {
                    Icon(Icons.Filled.Download, "Save to gallery", tint = Color.White, modifier = Modifier.size(26.dp))
                }
                Text("Save", color = Color.White, fontSize = 12.sp)
            }
        }
    }
}
