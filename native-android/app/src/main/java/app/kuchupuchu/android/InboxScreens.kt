package app.kuchupuchu.android

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.SentimentSatisfied
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun InboxScreen(session: Session, onRoute: (String) -> Unit) {
    val items = remember { mutableStateListOf<JSONObject>() }
    LaunchedEffect(Unit) {
        while (isActive) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val data = Api.get("/api/conversations")
                    items.clear()
                    items.addAll(data.arr("items").objects())
                    session.unread = items.sumOf { it.optInt("unread") }
                }
            }
            delay(4000)
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        LazyColumn(Modifier.padding(top = 8.dp)) {
            itemsIndexed(items) { _, c ->
                val other = c.optJSONObject("other") ?: JSONObject()
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp))
                        .clickable { onRoute("chat/${c.optString("id")}") }.padding(12.dp, 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(other, 48.dp, online = other.optBoolean("online"))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(other.name(), fontWeight = FontWeight.SemiBold)
                                if (c.optBoolean("muted")) {
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Outlined.VolumeOff, null, tint = Muted, modifier = Modifier.size(14.dp))
                                }
                            }
                            Text(timeAgo(c.optString("lastMessageAt")), color = Muted, fontSize = 12.sp)
                        }
                        Text(c.optJSONObject("lastMessage")?.optString("body").orEmpty().ifBlank { "No messages yet" }, color = Muted, fontSize = 13.sp, maxLines = 1)
                    }
                    if (c.optInt("unread") > 0) {
                        Box(Modifier.size(22.dp).clip(CircleShape).background(Accent), contentAlignment = Alignment.Center) {
                            Text("${c.optInt("unread")}", color = AccentInk, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AlertsScreen(session: Session, onRoute: (String) -> Unit) {
    val notes = remember { mutableStateListOf<JSONObject>() }
    val reqs = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        withContext(Dispatchers.IO) {
            runCatching {
                notes.clear()
                notes.addAll(
                    Api.get("/api/notifications").arr("items").objects().filter { n ->
                        val title = n.optString("title").lowercase()
                        val link = n.optString("link")
                        n.optString("kind") !in listOf("calls", "messaging") &&
                            !link.startsWith("/messages/") &&
                            title != "friend request" &&
                            !title.contains("incoming call") &&
                            !title.contains("incoming video")
                    },
                )
                reqs.clear()
                reqs.addAll(Api.get("/api/friend-requests").arr("items").objects())
                session.noteCount = notes.count { it.optString("readAt").isBlank() } + reqs.size
            }
        }
    }
    LaunchedEffect(Unit) { load() }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Notifications", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
            GhostBtn("Mark all read") {
                scope.launch {
                    withContext(Dispatchers.IO) { runCatching { Api.post("/api/notifications/read") } }
                    load()
                }
            }
        }
        val preview = reqs.take(3)
        LazyColumn {
            itemsIndexed(preview) { _, r ->
                val from = r.optJSONObject("from") ?: r
                Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFFFFDF8)).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(14.dp)) {
                    Row {
                        Avatar(from, 42.dp, online = from.optBoolean("online")) { onRoute("player/${from.userId()}") }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("${from.name()} sent you a friend request", fontWeight = FontWeight.SemiBold)
                            Text("@${from.uid()} · ${timeAgo(r.optString("createdAt"))}", color = Muted, fontSize = 13.sp)
                            Row(Modifier.padding(top = 8.dp)) {
                                AccentBtn("Accept") {
                                    scope.launch {
                                        withContext(Dispatchers.IO) { runCatching { Api.post("/api/friend-requests/${r.optString("id")}/accept") } }
                                        reqs.remove(r)
                                    }
                                }
                                GhostBtn("Decline") {
                                    scope.launch {
                                        withContext(Dispatchers.IO) { runCatching { Api.post("/api/friend-requests/${r.optString("id")}/decline") } }
                                        reqs.remove(r)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (reqs.size > 3) {
                item {
                    Text("See all friend requests", color = Accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { onRoute("requests") }.padding(12.dp))
                }
            }
            itemsIndexed(notes) { _, n ->
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(14.dp))
                        .background(if (n.optString("readAt").isBlank()) Color(0xFFFFFDF8) else Surface)
                        .border(1.dp, Line, RoundedCornerShape(14.dp))
                        .clickable {
                            val link = n.optString("link")
                            when {
                                link.startsWith("/players/") -> onRoute("player/${link.removePrefix("/players/")}")
                                link.startsWith("/requests") -> onRoute("requests")
                            }
                        }.padding(14.dp),
                ) {
                    Text(n.optString("title"), fontWeight = FontWeight.SemiBold)
                    Text(n.optString("body"), color = Muted, fontSize = 13.sp)
                    Text(timeAgo(n.optString("createdAt")), color = Muted, fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
fun ChatScreen(convoId: String, session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    val ctx = LocalContext.current
    val messages = remember { mutableStateListOf<JSONObject>() }
    var other by remember { mutableStateOf(JSONObject()) }
    var text by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    var stickers by remember { mutableStateOf(false) }
    var reactFor by remember { mutableStateOf<String?>(null) }
    var otherReadAt by remember { mutableStateOf("") }
    var viewer by remember { mutableStateOf<String?>(null) }
    val photos = remember { mutableStateListOf<String>() }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val meId = session.me?.optString("id")

    val pick =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            scope.launch(Dispatchers.IO) {
                runCatching {
                    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@launch
                    val data = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                    photos.add(data)
                }
            }
        }

    LaunchedEffect(convoId) {
        while (isActive) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val inbox = Api.get("/api/conversations")
                    val found = inbox.arr("items").objects().find { it.optString("id") == convoId }
                    if (found != null) {
                        other = found.optJSONObject("other") ?: other
                        muted = found.optBoolean("muted")
                    }
                    val data = Api.get("/api/conversations/$convoId/messages")
                    otherReadAt = data.optString("otherReadAt")
                    val rows = data.arr("items").objects()
                    messages.clear()
                    messages.addAll(rows)
                }
            }
            delay(900)
        }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) list.scrollToItem(messages.lastIndex)
    }

    val lastMine = messages.lastOrNull { it.optString("senderId") == meId && it.optString("call").isBlank() }

    fun send(payload: JSONObject) {
        val temp =
            JSONObject()
                .put("id", "tmp-${System.currentTimeMillis()}")
                .put("senderId", meId)
                .put("body", payload.optString("body"))
                .put("sticker", payload.optString("sticker"))
                .put("pending", true)
        if (payload.has("imageData")) temp.put("imageUrls", payload.optJSONArray("imageData"))
        messages.add(temp)
        text = ""
        photos.clear()
        stickers = false
        scope.launch(Dispatchers.IO) {
            runCatching { Api.post("/api/conversations/$convoId/messages", payload) }
        }
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(Surface).padding(4.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconBtn(Icons.Outlined.ChevronLeft) { onRoute("tabs/inbox") }
            Row(Modifier.weight(1f).clickable { onRoute("player/${other.userId()}") }, verticalAlignment = Alignment.CenterVertically) {
                Avatar(other, 36.dp, online = other.optBoolean("online"))
                Spacer(Modifier.width(10.dp))
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(other.name(), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        if (muted) {
                            Spacer(Modifier.width(6.dp))
                            Icon(Icons.Outlined.VolumeOff, null, tint = Muted, modifier = Modifier.size(14.dp))
                        }
                    }
                    Text(lastSeen(other.optString("lastActiveAt"), other.optBoolean("online")), color = Muted, fontSize = 12.sp)
                }
            }
            IconBtn(Icons.Outlined.Call) { engine.startCall(other.userId(), "AUDIO", other.name()) }
            IconBtn(Icons.Outlined.Videocam) { engine.startCall(other.userId(), "VIDEO", other.name()) }
            IconBtn(Icons.Outlined.MoreVert) { menu = !menu }
        }
        LazyColumn(Modifier.weight(1f).padding(10.dp, 12.dp), state = list) {
            itemsIndexed(messages) { _, m ->
                val mine = m.optString("senderId") == meId
                val call = m.optString("call")
                if (call.isNotBlank()) {
                    val parts = call.split(":")
                    val kind = if (parts.getOrNull(1) == "VIDEO") "Video" else "Voice"
                    val status = parts.getOrNull(2).orEmpty()
                    val sec = parts.getOrNull(3)?.toIntOrNull() ?: 0
                    val clock = "${sec / 60}:${(sec % 60).toString().padStart(2, '0')}"
                    val label =
                        when (status) {
                            "ENDED" -> "$kind call · $clock"
                            "DECLINED" -> "Declined ${kind.lowercase()} call"
                            else -> "Missed ${kind.lowercase()} call"
                        }
                    Text(label, color = Muted, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.fillMaxWidth().padding(8.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                } else {
                    val sticker = m.optString("sticker")
                    val images = m.optJSONArray("imageUrls")?.let { a -> (0 until a.length()).map { a.optString(it) } }
                        ?: listOfNotNull(m.optString("imageUrl").takeIf { it.isNotBlank() })
                    val stickerOnly = sticker.isNotBlank()
                    val photoOnly = images.isNotEmpty() && (m.optString("body").isBlank() || m.optString("body") == "Photo")
                    Column(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                        Row(verticalAlignment = Alignment.Bottom) {
                            if (!mine) {
                                Avatar(other, 28.dp)
                                Spacer(Modifier.width(6.dp))
                            }
                            Box(
                                Modifier.widthIn(max = 280.dp)
                                    .then(
                                        if (stickerOnly || photoOnly) Modifier
                                        else Modifier.clip(RoundedCornerShape(if (mine) 18.dp else 18.dp, 18.dp, if (mine) 6.dp else 18.dp, if (mine) 18.dp else 6.dp))
                                            .background(if (mine) Accent else Surface)
                                            .then(if (mine) Modifier else Modifier.border(1.dp, Line, RoundedCornerShape(18.dp, 18.dp, 18.dp, 6.dp))),
                                    )
                                    .pointerInput(m.optString("id")) {
                                        detectTapGestures(onLongPress = { reactFor = m.optString("id") })
                                    }
                                    .padding(if (stickerOnly || photoOnly) 0.dp else 9.dp, if (stickerOnly || photoOnly) 0.dp else 8.dp),
                            ) {
                                Column {
                                    if (reactFor == m.optString("id")) {
                                        Row(Modifier.clip(RoundedCornerShape(99.dp)).background(Color(0xFF1C1917)).padding(4.dp, 2.dp)) {
                                            listOf("❤️", "😂", "😮", "😢", "👍").forEach { e ->
                                                Text(
                                                    e,
                                                    modifier = Modifier.clickable {
                                                        reactFor = null
                                                        scope.launch(Dispatchers.IO) {
                                                            runCatching {
                                                                Api.post("/api/conversations/$convoId/messages/${m.optString("id")}/react", JSONObject().put("emoji", e))
                                                            }
                                                        }
                                                    }.padding(6.dp),
                                                    fontSize = 20.sp,
                                                )
                                            }
                                        }
                                    }
                                    if (sticker.isNotBlank()) {
                                        AsyncImage("file:///android_asset/stickers/$sticker.png", null, modifier = Modifier.size(96.dp))
                                    }
                                    images.forEach { src ->
                                        AsyncImage(
                                            src,
                                            null,
                                            modifier = Modifier.width(220.dp).clip(RoundedCornerShape(12.dp)).clickable { viewer = src },
                                            contentScale = ContentScale.Crop,
                                        )
                                    }
                                    val body = m.optString("body")
                                    if (body.isNotBlank() && !stickerOnly && !photoOnly) {
                                        Text(body, color = if (mine) AccentInk else Ink)
                                    }
                                    val reaction = m.optString("reaction")
                                    if (reaction.isNotBlank()) Text(reaction, fontSize = 16.sp)
                                }
                            }
                        }
                        if (mine && lastMine?.optString("id") == m.optString("id")) {
                            val seen = otherReadAt.isNotBlank() && parseIso(otherReadAt) != null && parseIso(m.optString("createdAt")) != null &&
                                (parseIso(otherReadAt) ?: 0) >= (parseIso(m.optString("createdAt")) ?: 0)
                            if (m.optBoolean("pending")) {
                                Text("Sending", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(end = 4.dp))
                            } else if (seen) {
                                Avatar(other, 16.dp)
                            } else {
                                val day =
                                    parseIso(m.optString("createdAt"))?.let {
                                        java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(java.util.Date(it))
                                    }.orEmpty()
                                Text("Delivered $day", fontSize = 11.sp, color = Muted, modifier = Modifier.padding(end = 4.dp, bottom = 6.dp))
                            }
                        }
                    }
                }
            }
        }
        Column(Modifier.background(Surface)) {
            if (stickers) {
                androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                    columns = androidx.compose.foundation.lazy.grid.GridCells.Fixed(5),
                    modifier = Modifier.height(220.dp).padding(10.dp),
                ) {
                    items(STICKERS.size) { i ->
                        val (id, name) = STICKERS[i]
                        AsyncImage(
                            "file:///android_asset/stickers/$id.png",
                            name,
                            modifier = Modifier.size(64.dp).clickable {
                                send(JSONObject().put("sticker", id).put("body", name))
                            }.padding(4.dp),
                        )
                    }
                }
            }
            if (photos.isNotEmpty()) {
                Row(Modifier.padding(8.dp, 8.dp, 8.dp, 0.dp)) {
                    photos.forEach { src ->
                        AsyncImage(src, null, modifier = Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
                        Spacer(Modifier.width(8.dp))
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(8.dp, 8.dp, 10.dp, 10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconBtn(Icons.Outlined.Image) { pick.launch("image/*") }
                IconBtn(Icons.Outlined.SentimentSatisfied, tint = if (stickers) Accent else Ink) { stickers = !stickers }
                TextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Message") },
                    singleLine = true,
                    colors = TextFieldDefaults.colors(
                        unfocusedContainerColor = FeedBg,
                        focusedContainerColor = FeedBg,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                    ),
                    shape = RoundedCornerShape(99.dp),
                )
                Box(
                    Modifier.padding(start = 4.dp).size(42.dp).clip(CircleShape).background(if (text.isBlank() && photos.isEmpty()) Accent.copy(0.4f) else Accent)
                        .clickable {
                            if (text.isBlank() && photos.isEmpty()) return@clickable
                            val payload = JSONObject()
                            if (text.isNotBlank()) payload.put("body", text)
                            if (photos.isNotEmpty()) {
                                val arr = JSONArray()
                                photos.forEach { arr.put(it) }
                                payload.put("imageData", arr)
                            }
                            send(payload)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.Send, null, tint = AccentInk, modifier = Modifier.size(18.dp))
                }
            }
        }
        viewer?.let { src ->
            Box(Modifier.fillMaxSize().background(Color(0xFF0C0A09))) {
                AsyncImage(src, null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                CloseIcon { viewer = null }
            }
        }
    }
        if (menu) {
            Box(Modifier.fillMaxSize().clickable { menu = false })
            Column(
                Modifier.align(Alignment.TopEnd).padding(end = 8.dp, top = 52.dp).width(200.dp)
                    .clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)),
            ) {
                listOf(if (muted) "Unmute" else "Mute", "Clear chat history", "Delete", "Block").forEach { label ->
                    Text(
                        label,
                        modifier = Modifier.fillMaxWidth().clickable {
                            menu = false
                            scope.launch(Dispatchers.IO) {
                                when (label) {
                                    "Delete" -> Api.delete("/api/conversations/$convoId")
                                    "Clear chat history" -> Api.post("/api/conversations/$convoId/clear")
                                    "Block" -> {
                                        Api.post("/api/users/${other.userId()}/block")
                                        Api.delete("/api/conversations/$convoId")
                                    }
                                    else -> Api.post("/api/conversations/$convoId/mute", JSONObject().put("muted", !muted))
                                }
                            }
                            if (label == "Delete" || label == "Block") onRoute("tabs/inbox")
                        }.padding(14.dp, 12.dp),
                    )
                }
            }
        }
    }
}
