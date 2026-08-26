package app.kuchupuchu.android

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
    val items = session.inbox
    LaunchedEffect(Unit) {
        while (isActive) {
            val next =
                withContext(Dispatchers.IO) {
                    runCatching { Api.get("/api/conversations").arr("items").objects() }.getOrNull()
                }
            if (next != null) {
                replaceList(items, next)
                session.unread = next.sumOf { it.optInt("unread") }
            }
            delay(8000)
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        LazyColumn(Modifier.padding(top = 8.dp)) {
            itemsIndexed(items, key = { _, c -> c.optString("id") }) { _, c ->
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
    val notes = session.notes
    val reqs = session.requests
    val scope = rememberCoroutineScope()
    suspend fun load() {
        val nextNotes =
            withContext(Dispatchers.IO) {
                runCatching {
                    Api.get("/api/notifications").arr("items").objects().filter { n ->
                        val title = n.optString("title").lowercase()
                        val link = n.optString("link")
                        n.optString("kind") !in listOf("calls", "messaging") &&
                            !link.startsWith("/messages/") &&
                            title != "friend request" &&
                            !title.contains("incoming call") &&
                            !title.contains("incoming video")
                    }
                }.getOrNull()
            }
        val nextReqs =
            withContext(Dispatchers.IO) {
                runCatching { Api.get("/api/friend-requests").arr("items").objects() }.getOrNull()
            }
        if (nextNotes != null) replaceList(notes, nextNotes)
        if (nextReqs != null) replaceList(reqs, nextReqs)
        session.noteCount = notes.count { it.optString("readAt").isBlank() } + reqs.size
    }
    LaunchedEffect(Unit) {
        if (notes.isEmpty() && reqs.isEmpty()) load()
        while (isActive) {
            delay(12_000)
            load()
        }
    }
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
    val messages = session.chatOf(convoId)
    var other by remember(convoId) {
        mutableStateOf(session.inbox.find { it.optString("id") == convoId }?.optJSONObject("other") ?: JSONObject())
    }
    var text by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var muted by remember(convoId) {
        mutableStateOf(session.inbox.find { it.optString("id") == convoId }?.optBoolean("muted") == true)
    }
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
            scope.launch {
                val data =
                    withContext(Dispatchers.IO) {
                        runCatching { compressPhoto(ctx, uri) }.getOrNull()
                    } ?: return@launch
                photos.add(data)
            }
        }

    LaunchedEffect(convoId) {
        Cache.peek("/api/conversations/$convoId/messages")?.let { cached ->
            otherReadAt = cached.optString("otherReadAt")
            mergeChat(messages, cached.arr("items").objects())
        }
        while (isActive) {
            val data =
                withContext(Dispatchers.IO) {
                    runCatching { Api.get("/api/conversations/$convoId/messages") }.getOrNull()
                }
            if (data != null) {
                otherReadAt = data.optString("otherReadAt")
                mergeChat(messages, data.arr("items").objects())
            }
            if (other.userId().isBlank()) {
                val found = session.inbox.find { it.optString("id") == convoId }
                if (found != null) {
                    other = found.optJSONObject("other") ?: other
                    muted = found.optBoolean("muted")
                }
            }
            delay(2200)
        }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) list.scrollToItem(messages.lastIndex)
    }

    val lastMine = messages.lastOrNull { it.optString("senderId") == meId && it.optString("call").isBlank() }

    fun send(payload: JSONObject) {
        val tempId = "tmp-${System.currentTimeMillis()}"
        val temp =
            JSONObject()
                .put("id", tempId)
                .put("senderId", meId)
                .put("body", payload.optString("body"))
                .put("sticker", payload.optString("sticker"))
                .put("pending", true)
                .put("createdAt", java.time.Instant.now().toString())
        if (payload.has("imageData")) {
            val imgs = payload.optJSONArray("imageData")
            temp.put("imageUrls", imgs)
            temp.put("imageUrl", imgs?.optString(0).orEmpty())
        }
        messages.add(temp)
        text = ""
        photos.clear()
        stickers = false
        scope.launch {
            val saved =
                withContext(Dispatchers.IO) {
                    runCatching { Api.post("/api/conversations/$convoId/messages", payload) }.getOrNull()?.optJSONObject("message")
                }
            val idx = messages.indexOfFirst { it.optString("id") == tempId }
            if (idx < 0) return@launch
            if (saved != null) messages[idx] = saved
            else messages[idx] = JSONObject(temp.toString()).put("pending", false).put("failed", true)
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
            itemsIndexed(messages, key = { _, m -> m.optString("id") }) { _, m ->
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
                                        if (src.isNotBlank()) {
                                            MediaImage(
                                                src,
                                                modifier = Modifier.width(220.dp).clip(RoundedCornerShape(12.dp)).clickable { viewer = src },
                                                contentScale = ContentScale.Crop,
                                            )
                                        }
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
                            } else if (m.optBoolean("failed")) {
                                Text("Couldn't send", fontSize = 11.sp, color = Rose, modifier = Modifier.padding(end = 4.dp))
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
                        MediaImage(src, modifier = Modifier.size(36.dp).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
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
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        imeAction = androidx.compose.ui.text.input.ImeAction.Send,
                    ),
                    keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                        onSend = {
                            if (text.isBlank() && photos.isEmpty()) return@KeyboardActions
                            val payload = JSONObject()
                            if (text.isNotBlank()) payload.put("body", text)
                            if (photos.isNotEmpty()) {
                                val arr = JSONArray()
                                photos.forEach { arr.put(it) }
                                payload.put("imageData", arr)
                            }
                            send(payload)
                        },
                    ),
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
                MediaImage(src, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
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
