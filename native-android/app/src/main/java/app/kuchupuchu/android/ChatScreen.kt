package app.kuchupuchu.android

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.CallMissed

import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt

/**
 * Chat screen — locked design #7 "Chat Box": coin wallpaper, gradient
 * outgoing bubbles, voice notes, stickers, read ticks. Instant paint from
 * ScreenStore, silent background refresh, optimistic text/sticker sends.
 */
@Composable
fun ChatScreen(nav: NavController, convId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // Paint the header instantly from the last-known detail (or the chat
    // list row) — no "…" flash while the fetch round-trips.
    val conv = remember { mutableStateOf<JSONObject?>(ScreenStore.convDetailOf(convId) ?: convRowSnapshot(convId)) }
    val msgs = remember { mutableStateListOf<JSONObject>() }
    val pending = remember { mutableStateListOf<JSONObject>() }
    var input by remember { mutableStateOf("") }
    var showAttach by remember { mutableStateOf(false) }
    var showStickers by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recMs by remember { mutableStateOf(0) }
    var uploading by remember { mutableStateOf(0) } // >0 = photo/file uploads in flight
    var error by remember { mutableStateOf("") }
    var otherReadAt by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val player = remember { VoicePlayer() }
    var lastTopId by remember { mutableStateOf("") }
    var menuOpen by remember { mutableStateOf(false) }
    var showChatSearch by remember { mutableStateOf(false) }
    var showDisappear by remember { mutableStateOf(false) }
    var showTheme by remember { mutableStateOf(false) }
    var muteInFlight by remember { mutableStateOf(false) }
    var searchQ by remember { mutableStateOf("") }
    var searchHits by remember { mutableStateOf(listOf<JSONObject>()) }

    fun paintFromStore() {
        val next = ScreenStore.msgsOf(convId)
        if (msgs.isEmpty()) {
            msgs.addAll(next)
            return
        }
        val oldIds = msgs.map { it.optString("id") }
        val newIds = next.map { it.optString("id") }
        if (oldIds == newIds) {
            next.forEachIndexed { i, o -> msgs[i] = o }
            return
        }
        if (newIds.size > oldIds.size && newIds.take(oldIds.size) == oldIds) {
            msgs.addAll(next.drop(oldIds.size))
            return
        }
        msgs.clear()
        msgs.addAll(next)
    }

    fun refreshMeta() {
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId") }
                val c = data.optJSONObject("conversation")
                if (c != null) {
                    if (muteInFlight) {
                        val localMuted = conv.value?.optBoolean("muted") == true
                        c.put("muted", localMuted)
                    }
                    conv.value = c
                    ScreenStore.setConvDetail(convId, c)
                    c.arr("members").objects().forEach { m ->
                        val u = m.optJSONObject("user")
                        if (u != null && u.optString("id") != Store.myId()) {
                            otherReadAt = m.optIso("lastReadAt")
                        }
                    }
                }
            }
        }
    }

    fun refreshMessages(forceScroll: Boolean = false, markRead: Boolean = false) {
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId/messages") }
                val fresh = data.arr("items").objects()
                // Live read receipts: the sender's ticks turn blue without
                // reopening the chat.
                data.optString("readAt").takeIf { it.isNotBlank() }?.let { otherReadAt = it }
                val prevTop = lastTopId
                val newTop = fresh.lastOrNull()?.optString("id") ?: ""
                ScreenStore.setMsgs(convId, fresh)
                paintFromStore()
                if (pending.isNotEmpty()) {
                    pending.removeAll { p ->
                        val cid = p.optString("clientId").ifBlank { "" }
                        cid.isNotBlank() && fresh.any { it.optString("clientId") == cid }
                    }
                }
                val total = msgs.size + pending.size
                // Only scroll when it matters: initial load, explicit send,
                // or a NEW message landed while we're already near the bottom.
                val nearBottom = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let {
                    it >= total - 2
                } ?: true
                val newMessage = newTop.isNotBlank() && newTop != prevTop
                if (total > 0 && (forceScroll || (newMessage && nearBottom))) {
                    listState.animateScrollToItem(total - 1)
                }
                lastTopId = newTop
                if (markRead || (newMessage && prevTop.isNotBlank())) {
                    runCatching { withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/read") } }
                }
            } catch (_: Exception) {
            }
        }
    }

    /* instant paint + first refresh */
    LaunchedEffect(convId) {
        Store.route = "chat/$convId"
        paintFromStore()
        if (ScreenStore.pendingChatSearch == convId) {
            ScreenStore.pendingChatSearch = null
            showChatSearch = true
        }
        refreshMeta()
        refreshMessages(forceScroll = true, markRead = true)
        runCatching { Outbox.flush() }
    }

    /* single stable background refresh loop while this chat is open */
    LaunchedEffect(convId) {
        var gap = 4_000L
        while (true) {
            if (Store.foreground && Store.route == "chat/$convId") {
                val before = ScreenStore.msgsVersion.value
                refreshMessages()
                delay(gap)
                gap = if (ScreenStore.msgsVersion.value == before) {
                    (gap + 2_000L).coerceAtMost(12_000L)
                } else {
                    4_000L
                }
            } else {
                delay(1_500)
            }
        }
    }

    fun sendText(body: String, kind: String = "TEXT") {
        if (body.isBlank()) return
        val clientId = "c_${java.util.UUID.randomUUID()}"
        val payload = JSONObject().put("kind", kind).put("body", body).put("clientId", clientId)
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", kind)
                .put("body", body)
                .put("createdAt", java.time.Instant.now().toString()),
        )
        scope.launch {
            val total = msgs.size + pending.size
            if (total > 0) listState.animateScrollToItem(total - 1)
            KpSounds.send(ctx)
            try {
                withContext(Dispatchers.IO) {
                    Api.post("/api/conversations/$convId/messages", payload)
                }
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                Outbox.add(convId, clientId, payload)
            }
        }
    }

    fun sendImage(dataUrl: String) {
        val clientId = "c_${java.util.UUID.randomUUID()}"
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "FILE")
                .put("body", "")
                .put("hasImage", true)
                .put("fileName", "photo.jpg")
                .put("fileType", "image/jpeg")
                .put("mediaUrl", dataUrl)
                .put("createdAt", java.time.Instant.now().toString()),
        )
        scope.launch {
            listState.animateScrollToItem(msgs.size + pending.size - 1)
            try {
                val jpeg = withContext(Dispatchers.IO) {
                    val b64 = dataUrl.substringAfter(",", "")
                    android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
                }
                val up = withContext(Dispatchers.IO) { Api.upload("photo.jpg", "image/jpeg", jpeg) }
                val payload =
                    JSONObject()
                        .put("kind", "FILE")
                        .put("fileKey", up.optString("fileKey"))
                        .put("fileName", "photo.jpg")
                        .put("fileType", "image/jpeg")
                        .put("fileSize", jpeg.size)
                        .put("clientId", clientId)
                withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                KpSounds.send(ctx)
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                try {
                    val payload = JSONObject().put("kind", "IMAGE").put("imageData", dataUrl).put("clientId", clientId)
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                    KpSounds.send(ctx)
                    refreshMessages(forceScroll = true)
                } catch (e2: Exception) {
                    error = (e2.message ?: "Could not send photo.") + "  Tap the banner to retry."
                    pending.find { it.optString("clientId") == clientId }?.put("failed", true)
                }
            }
        }
    }

    fun sendFile(name: String, mime: String, bytes: ByteArray) {
        val clientId = "c_${java.util.UUID.randomUUID()}"
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "FILE")
                .put("fileName", name)
                .put("fileType", mime)
                .put("fileSize", bytes.size)
                .put("createdAt", java.time.Instant.now().toString()),
        )
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) { Api.upload(name, mime, bytes) }
                withContext(Dispatchers.IO) {
                    Api.post(
                        "/api/conversations/$convId/messages",
                        JSONObject()
                            .put("kind", "FILE")
                            .put("fileKey", data.optString("fileKey"))
                            .put("fileName", name)
                            .put("fileType", mime)
                            .put("fileSize", bytes.size)
                            .put("clientId", clientId),
                    )
                }
                KpSounds.send(ctx)
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                error = e.message ?: "Could not send file."
            }
        }
    }

    fun sendVoice(file: File, seconds: Int, name: String) {
        val clientId = "c_${java.util.UUID.randomUUID()}"
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "FILE")
                .put("body", "")
                .put("fileName", name)
                .put("fileType", "audio/mp4")
                .put("fileSize", file.length().toInt())
                .put("meta", JSONObject().put("voice", true).put("seconds", seconds).put("clientId", clientId))
                .put("createdAt", java.time.Instant.now().toString()),
        )
        scope.launch {
            listState.animateScrollToItem(msgs.size + pending.size - 1)
            try {
                val bytes = withContext(Dispatchers.IO) { file.readBytes() }
                val data = withContext(Dispatchers.IO) { Api.upload(name, "audio/mp4", bytes) }
                val payload =
                    JSONObject()
                        .put("kind", "FILE")
                        .put("fileKey", data.optString("fileKey"))
                        .put("fileName", name)
                        .put("fileType", "audio/mp4")
                        .put("fileSize", bytes.size)
                        .put("clientId", clientId)
                        .put("meta", JSONObject().put("voice", true).put("seconds", seconds).put("clientId", clientId))
                withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                KpSounds.send(ctx)
                file.delete()
                refreshMessages(forceScroll = false)
            } catch (e: Exception) {
                Outbox.add(convId, clientId, JSONObject().put("kind", "FILE").put("fileName", name).put("clientId", clientId))
            }
        }
    }

    /* ---- hold-to-record voice: press = record, release = send (≥1s),
       slide left while holding = cancel ---- */
    fun startRecording() {
        if (VoiceNote.isRecording) return
        if (VoiceNote.start(ctx)) {
            recMs = 0
            recording = true
        } else {
            error = "Mic is not available. Check the mic permission."
        }
    }

    fun finishRecording(cancelled: Boolean) {
        if (!recording) return
        recording = false
        if (cancelled) {
            VoiceNote.cancel()
            return
        }
        if (VoiceNote.elapsedMs() < 1000) {
            VoiceNote.cancel()
            error = "Hold the mic for at least 1 second to record."
            return
        }
        val result = VoiceNote.stop()
        if (result != null) {
            val name = "voice_${System.currentTimeMillis()}.m4a"
            sendVoice(result.first, result.second, name)
        }
    }

    LaunchedEffect(recording) {
        while (recording) {
            recMs = VoiceNote.elapsedMs().toInt()
            delay(100)
        }
    }

    val chatTheme = cTheme(conv.value)
    Column(Modifier.fillMaxSize().background(chatWallpaper(chatTheme))) {
        /* ---------------- top bar ---------------- */
        val c = conv.value
        val isGroup = c?.optBoolean("isGroup") == true
        val title =
            if (isGroup) c?.optString("title")?.ifBlank { "Group" } ?: "…"
            else c?.optJSONObject("other")?.optString("displayName")?.takeIf { it.isNotBlank() } ?: "…"
        val avatarUrl = if (isGroup) null else c?.optJSONObject("other")?.optString("avatarUrl")
        val online = !isGroup && c?.optJSONObject("other")?.optBoolean("online") == true
        Row(
            Modifier
                .fillMaxWidth()
                .background(Cream)
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = {
                Store.route = ""
                player.stop()
                nav.popBackStack()
            }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            val otherId = c?.optJSONObject("other")?.optString("id") ?: ""
            Row(
                Modifier.weight(1f).clickable {
                    if (!isGroup && otherId.isNotBlank()) nav.navigate("profile/$otherId")
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
            KpAvatar(title, avatarUrl, 40.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text(
                    when {
                        isGroup -> "${c?.arr("members")?.length() ?: 0} members"
                        online -> "online"
                        else -> " "
                    },
                    fontSize = 11.5.sp,
                    color = if (online) Green else Muted,
                )
            }
            }
            if (!isGroup && c != null) {
                if (otherId.isNotBlank()) {
                    IconButton(onClick = {
                        haptics.tap()
                        CallEngine.instance?.startCall(otherId, "AUDIO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Call, "Voice call", tint = GoldDeep, modifier = Modifier.size(23.dp))
                    }
                    IconButton(onClick = {
                        haptics.tap()
                        CallEngine.instance?.startCall(otherId, "VIDEO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Videocam, "Video call", tint = GoldDeep, modifier = Modifier.size(25.dp))
                    }
                }
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, "More", tint = Ink, modifier = Modifier.size(24.dp))
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DropdownMenuItem(
                        text = { Text("New group") },
                        leadingIcon = { Icon(Icons.Filled.GroupAdd, null, tint = Ink) },
                        onClick = { menuOpen = false; nav.navigate("newchat") },
                    )
                    DropdownMenuItem(
                        text = { Text("View contact") },
                        leadingIcon = { Icon(Icons.Filled.Person, null, tint = Ink) },
                        onClick = { menuOpen = false },
                    )
                    DropdownMenuItem(
                        text = { Text("Search") },
                        leadingIcon = { Icon(Icons.Filled.Search, null, tint = Ink) },
                        onClick = { menuOpen = false; nav.navigate("search") },
                    )
                    DropdownMenuItem(
                        text = { Text("Media, links, and docs") },
                        leadingIcon = { Icon(Icons.Filled.PermMedia, null, tint = Ink) },
                        onClick = { menuOpen = false },
                    )
                    DropdownMenuItem(
                        text = { Text(if (c?.optBoolean("muted") == true) "Unmute notifications" else "Mute notifications") },
                        leadingIcon = { Icon(Icons.Filled.NotificationsOff, null, tint = Ink) },
                        onClick = {
                            menuOpen = false
                            val snap = conv.value ?: c
                            val next = snap?.optBoolean("muted") != true
                            val copy = JSONObject((snap ?: JSONObject()).toString()).put("muted", next)
                            conv.value = copy
                            ScreenStore.setMuted(convId, next)
                            muteInFlight = true
                            scope.launch {
                                val ok = runCatching {
                                    withContext(Dispatchers.IO) {
                                        Api.post("/api/conversations/$convId/mute", JSONObject().put("muted", next))
                                    }
                                }.isSuccess
                                if (!ok) {
                                    conv.value = JSONObject(copy.toString()).put("muted", !next)
                                    ScreenStore.setMuted(convId, !next)
                                }
                                muteInFlight = false
                            }
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Disappearing messages") },
                        leadingIcon = { Icon(Icons.Filled.Timer, null, tint = Ink) },
                        onClick = { menuOpen = false; showDisappear = true },
                    )
                    DropdownMenuItem(
                        text = { Text("Chat theme") },
                        leadingIcon = { Icon(Icons.Filled.Palette, null, tint = Ink) },
                        onClick = { menuOpen = false; showTheme = true },
                    )
                }
            }
        }

        /* ---------------- message list on coin wallpaper ---------------- */
        Box(Modifier.weight(1f).fillMaxWidth()) {
            CoinWallpaper()
            if (msgs.isEmpty() && pending.isEmpty()) {
                Box(Modifier.align(Alignment.Center)) {
                    EmptyState(
                        icon = Icons.Filled.Mood,
                        title = "No messages yet",
                        note = "Say hi, send a sticker or a photo",
                    )
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 10.dp),
            ) {
                items(msgs, key = { it.optString("clientId").ifBlank { it.optString("id") } }) { m ->
                    Box {
                        MessageRow(m, isGroup, Store.myId(), otherReadAt, player) { id ->
                            scope.launch {
                                runCatching { withContext(Dispatchers.IO) { Api.delete("/api/messages/$id") } }
                                refreshMessages()
                            }
                        }
                    }
                }
                items(
                    pending.filter { p ->
                        val cid = p.optString("clientId").ifBlank { p.optString("id") }
                        msgs.none { it.optString("clientId") == cid || it.optString("id") == cid }
                    },
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                ) { m ->
                    MessageRow(m, isGroup, Store.myId(), otherReadAt, player, pendingEcho = true) {}
                }
                if (uploading > 0) {
                    item {
                        Row(
                            Modifier.fillMaxWidth().padding(8.dp),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(Card)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CircularProgressIndicator(
                                    color = Gold,
                                    strokeWidth = 2.dp,
                                    modifier = Modifier.size(14.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text("Sending…", fontSize = 12.5.sp, color = Muted)
                            }
                        }
                    }
                }
            }
        }

        /* ---------------- error ---------------- */
        if (error.isNotBlank()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFFEE2E2))
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    error,
                    color = Red,
                    fontSize = 13.sp,
                    modifier = Modifier.weight(1f).clickable {
                        val failed = pending.filter { it.optBoolean("failed") }
                        if (failed.isNotEmpty()) {
                            error = ""
                            failed.forEach { p ->
                                p.put("failed", false)
                                val url = p.optString("mediaUrl")
                                if (url.isNotBlank()) sendImage(url)
                            }
                        }
                    },
                )
                IconButton(onClick = { error = "" }, Modifier.size(26.dp)) {
                    Icon(Icons.Filled.Close, "Dismiss", tint = Red, modifier = Modifier.size(16.dp))
                }
            }
        }

        /* ---------------- sheets ---------------- */
        if (showAttach) {
            AttachSheet(
                onDismiss = { showAttach = false },
                onSendText = { sendText(it) },
                onSendImage = { sendImage(it) },
                onSendFile = { n, m, b -> sendFile(n, m, b) },
                onError = { error = it },
            )
        }
        if (showStickers) {
            StickerSheet(
                onDismiss = { showStickers = false },
                onSend = {
                    showStickers = false
                    sendText(it, "STICKER")
                },
            )
        }

        /* ---------------- composer (doubles as the recording bar) ---------------- */
        Composer(
            input = input,
            onInput = { input = it },
            onAttach = { haptics.tap(); showAttach = true },
            onSticker = { haptics.tap(); showStickers = true },
            onSend = {
                haptics.confirm()
                sendText(input)
                input = ""
            },
            recording = recording,
            recMs = recMs,
            onStartRecord = { haptics.tap(); startRecording() },
            onFinishRecord = { cancelled -> finishRecording(cancelled) },
        )
        if (showChatSearch) ChatSearchSheet(
            convId = convId,
            query = searchQ,
            onQuery = { searchQ = it },
            hits = searchHits,
            onHits = { searchHits = it },
            onClose = { showChatSearch = false; searchQ = ""; searchHits = emptyList() },
            onPick = { id ->
                showChatSearch = false
                val i = msgs.indexOfFirst { it.optString("id") == id }
                if (i >= 0) scope.launch { listState.animateScrollToItem(i) }
            },
        )
        if (showDisappear) DisappearDialog(
            current = conv.value?.optInt("disappearSeconds", 0) ?: 0,
            onClose = { showDisappear = false },
            onPick = { sec ->
                conv.value = conv.value?.put("disappearSeconds", sec)
                showDisappear = false
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            Api.patch("/api/conversations/$convId", JSONObject().put("disappearSeconds", sec))
                        }
                    }
                }
            },
        )
        if (showTheme) ThemeDialog(
            current = chatTheme,
            onClose = { showTheme = false },
            onPick = { theme ->
                conv.value = conv.value?.put("theme", theme)
                showTheme = false
                scope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            Api.patch("/api/conversations/$convId", JSONObject().put("theme", theme))
                        }
                    }
                }
            },
        )
    }
}

/* ------------------------------------------------------------------ */

/** Subtle scattered coins behind the conversation (locked design #7). */
@Composable
private fun CoinWallpaper() {
    Canvas(Modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        val step = 120.dp.toPx()
        var i = 0
        var y = 20f
        while (y < h) {
            var x = ((i % 3) * 47f) % step
            while (x < w) {
                val r = 7.dp.toPx() + (kotlin.math.abs((x * 31 + y * 17) % 5f)) * 1.2f
                drawCircle(
                    color = Color(0x14B45309),
                    radius = r,
                    center = Offset(x, y),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.6.dp.toPx()),
                )
                i++
                x += step
            }
            y += step * 0.62f
        }
    }
}

@Composable
private fun Composer(
    input: String,
    onInput: (String) -> Unit,
    onAttach: () -> Unit,
    onSticker: () -> Unit,
    onSend: () -> Unit,
    recording: Boolean,
    recMs: Int,
    onStartRecord: () -> Unit,
    onFinishRecord: (cancelled: Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Cream)
            .imePadding()
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!recording) {
            Column(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Card)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onAttach, Modifier.size(40.dp)) {
                        Icon(Icons.Filled.AttachFile, "Attach", tint = GoldDeep, modifier = Modifier.size(24.dp))
                    }
                    Box(Modifier.weight(1f)) {
                        if (input.isEmpty()) {
                            Text("Message", color = Muted, fontSize = 15.sp)
                        }
                        BasicTextField(
                            value = input,
                            onValueChange = onInput,
                            textStyle = TextStyle(color = Ink, fontSize = 15.sp),
                            maxLines = 4,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        )
                    }
                    IconButton(onClick = onSticker, Modifier.size(40.dp)) {
                        Icon(Icons.Filled.Mood, "Stickers", tint = GoldDeep, modifier = Modifier.size(24.dp))
                    }
                }
                if (input.length > 800) {
                    LinearProgressIndicator(
                        progress = { (input.length / 4000f).coerceIn(0f, 1f) },
                        color = Gold,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }
        } else {
            /* live recording panel: timer + slide-to-cancel hint */
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Color(0xFFFEE2E2))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PulsingDot()
                Spacer(Modifier.width(10.dp))
                Text(
                    "%d:%02d".format(recMs / 1000 / 60, recMs / 1000 % 60),
                    color = Ink,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.width(10.dp))
                Text("‹ Slide to cancel", color = Red, fontSize = 13.sp, modifier = Modifier.weight(1f))
            }
        }
        Spacer(Modifier.width(8.dp))

        /* mic/send circle. While input is blank this is a HOLD button:
           press = record, slide left = cancel, release = send. */
        if (!input.isBlank()) {
            val sendInteraction = remember { MutableInteractionSource() }
            val sendPressed by sendInteraction.collectIsPressedAsState()
            Box(
                Modifier
                    .size(48.dp)
                    .pressScale(sendInteraction)
                    .clip(CircleShape)
                    .background(goldFill())
                    .clickable(
                        interactionSource = sendInteraction,
                        indication = null,
                    ) { onSend() },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = AmberInk,
                    modifier = Modifier.size(23.dp).scale(if (sendPressed) 0.9f else 1f),
                )
            }
        } else {
            HoldMicButton(
                recording = recording,
                onStartRecord = onStartRecord,
                onFinishRecord = onFinishRecord,
            )
        }
    }
}

/**
 * The hold-to-record mic: press to start recording, keep holding and slide
 * left past the threshold to cancel (turns into a red trash), release to
 * send. The button physically follows the finger while sliding.
 */
@Composable
private fun HoldMicButton(
    recording: Boolean,
    onStartRecord: () -> Unit,
    onFinishRecord: (cancelled: Boolean) -> Unit,
) {
    val haptics = rememberHaptics()
    val density = LocalDensity.current
    val cancelDist = with(density) { 88.dp.toPx() }
    var dragX by remember { mutableStateOf(0f) }
    val cancelArmed = dragX <= -cancelDist
    val animX by animateFloatAsState(if (recording) dragX else 0f, spring(stiffness = 900f), label = "micdrag")

    Box(
        Modifier
            .size(48.dp)
            .offset { IntOffset((if (recording) animX else 0f).roundToInt(), 0) }
            .clip(CircleShape)
            .background(if (cancelArmed) Brush.linearGradient(listOf(Color.White, Color.White)) else goldFill())
            .border(1.dp, if (cancelArmed) Red else Color.Transparent, CircleShape)
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    dragX = 0f
                    var armed = false
                    onStartRecord()
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull() ?: break
                        val dx = change.positionChange().x
                        if (dx != 0f) dragX = (dragX + dx).coerceIn(-cancelDist * 1.5f, 0f)
                        val nowArmed = dragX <= -cancelDist
                        if (nowArmed && !armed) haptics.heavy()
                        armed = nowArmed
                        event.changes.forEach { it.consume() }
                        if (event.changes.all { !it.pressed }) break
                    }
                    val cancelled = dragX <= -cancelDist
                    dragX = 0f
                    onFinishRecord(cancelled)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (cancelArmed) Icons.Filled.Delete else Icons.Filled.Mic,
            contentDescription = if (cancelArmed) "Release to cancel" else "Hold to record",
            tint = if (cancelArmed) Red else AmberInk,
            modifier = Modifier.size(23.dp),
        )
    }
}

/** Small breathing red dot for the recording panel. */
@Composable
private fun PulsingDot() {
    val t = rememberInfiniteTransition(label = "recdot")
    val a by t.animateFloat(
        initialValue = 1f,
        targetValue = 0.25f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "alpha",
    )
    Box(
        Modifier
            .size(9.dp)
            .clip(CircleShape)
            .background(Red.copy(alpha = a)),
    )
}

/** Snapshot of a chat list row → a pseudo conversation object for instant paint. */
private fun convRowSnapshot(convId: String): JSONObject? {
    val row = ScreenStore.convs.firstOrNull { it.optString("id") == convId } ?: return null
    val other = JSONObject()
        .put("id", row.optJSONObject("other")?.optString("id") ?: "")
        .put("displayName", row.optJSONObject("other")?.optString("displayName") ?: "")
        .put("avatarUrl", row.optJSONObject("other")?.optString("avatarUrl") ?: "")
        .put("online", row.optJSONObject("other")?.optBoolean("online") ?: false)
    return JSONObject()
        .put("id", convId)
        .put("isGroup", row.optBoolean("isGroup"))
        .put("title", row.optString("title"))
        .put("other", other)
}

/* ------------------------------------------------------------------ */

@Composable
private fun MessageRow(
    m: JSONObject,
    isGroup: Boolean,
    myId: String,
    otherReadAt: String?,
    player: VoicePlayer,
    pendingEcho: Boolean = false,
    onDelete: (String) -> Unit,
) {
    val ctx = LocalContext.current
    val mine = m.optString("senderId") == myId
    val kind = m.optString("kind")

    if (kind == "SYSTEM" && !isCallLog(m)) {
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color(0x337A6F63))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Text(m.optString("body"), fontSize = 12.sp, color = Muted)
            }
        }
        return
    }
    if (kind == "CALL" || isCallLog(m)) {
        CallLogBubble(m, mine, pendingEcho)
        return
    }

    var showDelete by remember { mutableStateOf(false) }
    if (showDelete && mine && !pendingEcho) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("Delete message?") },
            text = { Text("This only deletes it for you.") },
            confirmButton = {
                TextButton(onClick = {
                    showDelete = false
                    onDelete(m.optString("id"))
                }) { Text("Delete", color = Red) }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("Cancel", color = Muted) } },
        )
    }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp)
            .animateContentSize(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Box(
                Modifier
                    .widthIn(min = 72.dp, max = 280.dp)
                    .wrapContentWidth()
                    .clip(
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (mine) 16.dp else 5.dp,
                            bottomEnd = if (mine) 5.dp else 16.dp,
                        ),
                    )
                    .background(if (mine) goldFill() else Brush.linearGradient(listOf(Card, Card)))
                    .clickable { if (mine && !pendingEcho) showDelete = true }
                    .padding(start = 10.dp, top = 7.dp, end = 8.dp, bottom = 5.dp),
            ) {
                val senderName = m.optString("senderName").takeIf { it.isNotBlank() } ?: ""
                Column(Modifier.padding(end = 52.dp, bottom = 2.dp)) {
                    if (!mine && isGroup && senderName.isNotBlank()) {
                        Text(senderName, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = GoldDeep)
                    }
                    when (kind) {
                        "IMAGE" -> ImageBubble(m, mine)
                        "STICKER" -> Text(m.optString("body"), fontSize = 56.sp)
                        "FILE" -> FileBubble(m, mine, player, pendingEcho)
                        "DELETED" -> Text(
                            "This message was deleted",
                            fontSize = 13.5.sp,
                            fontStyle = FontStyle.Italic,
                            color = if (mine) Color(0xE6FFFFFF) else Muted,
                        )
                        else -> Text(m.optString("body"), fontSize = 14.5.sp, color = Ink)
                    }
                }
                Row(
                    Modifier.align(Alignment.BottomEnd),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        msgStamp(m.optString("createdAt")),
                        fontSize = 10.sp,
                        color = if (mine) Color(0xD9FFFFFF) else Muted,
                    )
                    if (mine) {
                        Spacer(Modifier.width(3.dp))
                        TickIcon(m, pendingEcho, otherReadAt)
                    }
                }
            }
        }
    }
}

@Composable
private fun ImageBubble(m: JSONObject, mine: Boolean) {
    val url = m.optString("mediaUrl").takeIf { it.isNotBlank() }
    Box(
        Modifier
            .widthIn(max = 260.dp, min = 180.dp)
            .height(160.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x22000000)),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank()) {
            CircularProgressIndicator(color = if (mine) AmberInk else Gold, modifier = Modifier.size(22.dp))
        } else {
            KpNetImage(
                url,
                "Photo",
                Modifier.fillMaxSize(),
                androidx.compose.ui.layout.ContentScale.FillWidth,
            )
        }
    }
}

@Composable
private fun FileBubble(m: JSONObject, mine: Boolean, player: VoicePlayer, pendingEcho: Boolean = false) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = m.optString("id")
    val fileKey = m.optString("fileKey")
    val fileName = m.optString("fileName").ifBlank { "File" }
    val fileType = m.optString("fileType")
    val isImage = fileType.startsWith("image") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".png")
    if (isImage) {
        val url = if (fileKey.isNotBlank()) "/api/files/$fileKey" else m.optString("mediaUrl")
        ImageBubble(JSONObject().put("mediaUrl", url), mine)
        return
    }
    val isVoice = fileType.startsWith("audio") || fileName.endsWith(".m4a") || fileName.endsWith(".mp3") ||
        m.optJSONObject("meta")?.optBoolean("voice") == true
    val playing = player.playingId == id
    val loading = player.loadingId == id

    if (isVoice) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier
                    .size(38.dp)
                    .pressScale(interaction)
                    .clip(CircleShape)
                    .background(if (mine) Color(0x33FFFFFF) else GoldSoft)
                    .clickable(interactionSource = interaction, indication = null) {
                        if (pendingEcho || fileKey.isBlank()) return@clickable // still uploading
                        if (player.playingId == id) {
                            player.stop()
                        } else {
                            player.toggle(ctx, id, fileKey)
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                when {
                    loading -> CircularProgressIndicator(
                        color = if (mine) AmberInk else GoldDeep,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                    playing -> Icon(
                        Icons.Filled.Pause,
                        contentDescription = "Pause",
                        tint = if (mine) Ink else GoldDeep,
                        modifier = Modifier.size(22.dp).scale(if (pressed) 0.85f else 1f),
                    )
                    else -> Icon(
                        Icons.Filled.PlayArrow,
                        contentDescription = "Play",
                        tint = if (mine) Ink else GoldDeep,
                        modifier = Modifier.size(22.dp).scale(if (pressed) 0.85f else 1f),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Column {
                Text("Voice message", fontSize = 14.sp, color = Ink)
                val secs = m.optJSONObject("meta")?.optInt("seconds") ?: 0
                Text(
                    if (secs > 0) "%d:%02d".format(secs / 60, secs % 60)
                    else if (pendingEcho) "Sending…"
                    else FilesUtil.displaySize(m.optInt("fileSize")),
                    fontSize = 11.sp,
                    color = if (mine) Color(0x99FFFFFF) else Muted,
                )
            }
        }
        return
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (mine) Color(0x33FFFFFF) else GoldSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.InsertDriveFile,
                contentDescription = "File",
                tint = if (mine) AmberInk else GoldDeep,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.widthIn(max = 180.dp)) {
            Text(fileName, fontSize = 14.sp, color = Ink, maxLines = 2)
            Text(
                FilesUtil.displaySize(m.optInt("fileSize")),
                fontSize = 11.sp,
                color = if (mine) Color(0x99FFFFFF) else Muted,
            )
        }
        Spacer(Modifier.width(6.dp))
        TextButton(onClick = {
            scope.launch {
                runCatching {
                    val bytes = withContext(Dispatchers.IO) { Api.download(fileKey) }
                    FilesUtil.open(ctx, fileName, bytes, fileType)
                }
            }
        }) {
            Text("Open", color = if (mine) Color.White else GoldDeep, fontWeight = FontWeight.SemiBold)
        }
    }
}

private fun msgStamp(iso: String): String {
    if (iso.isBlank()) return ""
    return try {
        val z = java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
        String.format("%02d:%02d", z.hour, z.minute)
    } catch (e: Exception) {
        ""
    }
}

/** Instant-safe "has the other side read this message" check. */
private fun isReadByOther(otherReadAt: String?, createdAt: String): Boolean {
    if (otherReadAt.isNullOrBlank()) return false
    val read = runCatching { java.time.Instant.parse(otherReadAt) }.getOrNull() ?: return false
    val sent = runCatching { java.time.Instant.parse(createdAt) }.getOrNull() ?: return false
    return !read.isBefore(sent)
}

private fun cTheme(c: JSONObject?) = c?.optString("theme")?.ifBlank { "default" } ?: "default"

private fun chatWallpaper(theme: String) =
    when (theme) {
        "mint" -> Color(0xFFECFDF5)
        "night" -> Color(0xFF292524)
        "rose" -> Color(0xFFFFF1F2)
        else -> Cream
    }

@Composable
private fun ChatSearchSheet(
    convId: String,
    query: String,
    onQuery: (String) -> Unit,
    hits: List<JSONObject>,
    onHits: (List<JSONObject>) -> Unit,
    onClose: () -> Unit,
    onPick: (String) -> Unit,
) {
    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            onHits(emptyList())
            return@LaunchedEffect
        }
        delay(220)
        runCatching {
            val data = withContext(Dispatchers.IO) {
                Api.get("/api/conversations/$convId/messages/search?q=${Api.q(query.trim())}", true)
            }
            onHits(data.arr("items").objects())
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .background(Card)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(
                value = query,
                onValueChange = onQuery,
                textStyle = TextStyle(color = Ink, fontSize = 15.sp),
                modifier = Modifier.weight(1f).padding(8.dp),
                decorationBox = { inner ->
                    if (query.isEmpty()) Text("Search this chat", color = Muted, fontSize = 15.sp)
                    inner()
                },
            )
            TextButton(onClick = onClose) { Text("Close", color = GoldDeep) }
        }
        hits.take(12).forEach { m ->
            Text(
                m.optString("body").ifBlank { m.optString("fileName").ifBlank { "Media" } },
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onPick(m.optString("id")) }
                    .padding(vertical = 8.dp, horizontal = 4.dp),
                color = Ink,
                fontSize = 14.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (query.trim().length >= 2 && hits.isEmpty()) {
            Text("No matches", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
        }
    }
}

@Composable
private fun DisappearDialog(current: Int, onClose: () -> Unit, onPick: (Int) -> Unit) {
    val options = listOf(0 to "Off", 86400 to "24 hours", 604800 to "7 days", 7776000 to "90 days")
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Disappearing messages") },
        text = {
            Column {
                options.forEach { (sec, label) ->
                    Text(
                        if (sec == current) "●  $label" else "○  $label",
                        modifier = Modifier.fillMaxWidth().clickable { onPick(sec) }.padding(vertical = 8.dp),
                        color = Ink,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Close", color = GoldDeep) } },
    )
}

@Composable
private fun ThemeDialog(current: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    val options = listOf("default" to "Cream", "mint" to "Mint", "rose" to "Rose", "night" to "Night")
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Chat theme") },
        text = {
            Column {
                options.forEach { (id, label) ->
                    Text(
                        if (id == current) "●  $label" else "○  $label",
                        modifier = Modifier.fillMaxWidth().clickable { onPick(id) }.padding(vertical = 8.dp),
                        color = Ink,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Close", color = GoldDeep) } },
    )
}

@Composable
private fun TickIcon(m: JSONObject, pendingEcho: Boolean, otherReadAt: String?) {
    if (pendingEcho) {
        Icon(Icons.Filled.Schedule, "Sending", tint = Color(0xB3FFFFFF), modifier = Modifier.size(12.dp))
        return
    }
    val seen = isReadByOther(otherReadAt, m.optString("createdAt"))
    val delivered = m.optIso("deliveredAt") != null
    when {
        seen -> Icon(Icons.Filled.DoneAll, "Seen", tint = Color(0xFF53BDEB), modifier = Modifier.size(13.dp))
        delivered -> Icon(Icons.Filled.DoneAll, "Delivered", tint = Color(0xB3FFFFFF), modifier = Modifier.size(13.dp))
        else -> Icon(Icons.Filled.Done, "Sent", tint = Color(0xB3FFFFFF), modifier = Modifier.size(13.dp))
    }
}

private fun isCallLog(m: JSONObject): Boolean {
    if (m.optString("kind") == "CALL") return true
    val b = m.optString("body").lowercase()
    return b.contains("voice call") || b.contains("video call") || b.startsWith("missed ") || b.startsWith("declined ")
}

@Composable
private fun CallLogBubble(m: JSONObject, mine: Boolean, pendingEcho: Boolean) {
    val meta = m.optJSONObject("meta")
    val body = m.optString("body")
    val video = body.contains("Video", true) || meta?.optString("callKind") == "VIDEO"
    val missed = body.contains("Missed", true) || body.contains("No answer", true) ||
        meta?.optString("status") == "MISSED"
    val declined = body.contains("Declined", true) || meta?.optString("status") == "DECLINED"
    val seconds = meta?.optInt("seconds") ?: 0
    val title = if (video) "Video call" else "Voice call"
    val sub =
        when {
            declined -> "Declined"
            missed -> "No answer"
            seconds > 0 -> "%d:%02d".format(seconds / 60, seconds % 60)
            else -> body.substringAfter("·").trim().ifBlank { " " }
        }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Row(
            Modifier
                .widthIn(max = 260.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (mine) goldFill() else Brush.linearGradient(listOf(Card, Card)))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(if (mine) Color(0x33FFFFFF) else GoldSoft),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (missed || declined) Icons.Filled.CallMissed else Icons.Filled.Call,
                    contentDescription = title,
                    tint = if (missed) Red else if (mine) Ink else GoldDeep,
                    modifier = Modifier.size(20.dp),
                )
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text(title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text(sub, fontSize = 12.sp, color = if (mine) Color(0xCCFFFFFF) else Muted)
            }
            Spacer(Modifier.width(12.dp))
            Text(msgStamp(m.optString("createdAt")), fontSize = 10.sp, color = if (mine) Color(0xD9FFFFFF) else Muted)
        }
    }
}
