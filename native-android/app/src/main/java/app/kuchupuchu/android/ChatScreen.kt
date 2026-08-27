package app.kuchupuchu.android

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import kotlin.math.abs

/**
 * Chat screen — locked design #7 "Chat Box":
 * subtle coin wallpaper, gradient outgoing bubbles, white incoming,
 * voice bubbles, file bubbles, read ticks, day dividers.
 */
@Composable
fun ChatScreen(nav: NavController, convId: String) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val conv = remember { mutableStateOf<JSONObject?>(null) }
    val msgs = remember { mutableStateListOf<JSONObject>() }
    var input by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var showAttach by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var otherReadAt by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val player = remember { VoicePlayer() }

    fun refreshMeta() {
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId", true) }
                conv.value = data.optJSONObject("conversation")
                // Read ticks: the other member's last_read_at.
                conv.value?.arr("members")?.objects()?.forEach { m ->
                    val u = m.optJSONObject("user")
                    if (u != null && u.optString("id") != Store.myId()) {
                        otherReadAt = m.optString("lastReadAt").takeIf { it.isNotBlank() }
                    }
                }
            }
        }
    }

    fun refreshMessages(scroll: Boolean = false) {
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId/messages", true) }
                val fresh = data.arr("items").objects()
                val changed = fresh.size != msgs.size ||
                    (fresh.isNotEmpty() && msgs.isNotEmpty() && fresh.last().optString("id") != msgs.last().optString("id"))
                msgs.clear()
                msgs.addAll(fresh)
                if (scroll || changed) listState.animateScrollToItem(maxOf(0, msgs.size - 1))
            } catch (_: Exception) {
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        loading = true
        refreshMeta()
        refreshMessages(true)
        // mark read
        runCatching { withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/read") } }
        while (true) {
            if (Store.foreground && Store.route == "chat/$convId") {
                refreshMessages()
                refreshMeta()
            }
            delay(4_000)
        }
    }
    LaunchedEffect(Unit) { Store.route = "chat/$convId" }

    fun sendText(body: String) {
        if (body.isBlank()) return
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    Api.post(
                        "/api/conversations/$convId/messages",
                        JSONObject().put("body", body.trim()),
                    )
                }
                refreshMessages(true)
            } catch (e: Exception) {
                error = e.message ?: "Could not send."
            }
        }
    }

    fun sendImage(dataUrl: String) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    Api.post(
                        "/api/conversations/$convId/messages",
                        JSONObject().put("kind", "IMAGE").put("imageData", dataUrl),
                    )
                }
                refreshMessages(true)
            } catch (e: Exception) {
                error = e.message ?: "Could not send photo."
            }
        }
    }

    fun sendFile(name: String, mime: String, bytes: ByteArray) {
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
                            .put("fileSize", bytes.size),
                    )
                }
                refreshMessages(true)
            } catch (e: Exception) {
                error = e.message ?: "Could not send file."
            }
        }
    }

    fun sendVoice(file: File, seconds: Int) {
        scope.launch {
            try {
                val bytes = withContext(Dispatchers.IO) { file.readBytes() }
                val name = "voice_${System.currentTimeMillis()}.m4a"
                val data = withContext(Dispatchers.IO) { Api.upload(name, "audio/mp4", bytes) }
                withContext(Dispatchers.IO) {
                    Api.post(
                        "/api/conversations/$convId/messages",
                        JSONObject()
                            .put("kind", "FILE")
                            .put("fileKey", data.optString("fileKey"))
                            .put("fileName", name)
                            .put("fileType", "audio/mp4")
                            .put("fileSize", bytes.size)
                            .put("meta", JSONObject().put("voice", true).put("seconds", seconds)),
                    )
                }
                refreshMessages(true)
            } catch (e: Exception) {
                error = e.message ?: "Could not send voice note."
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Cream)) {
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
            KpAvatar(title, avatarUrl, 40.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Ink)
                Text(
                    when {
                        isGroup -> "${c?.arr("members")?.length() ?: 0} members"
                        online -> "online"
                        else -> "tap to refresh"
                    },
                    fontSize = 11.5.sp,
                    color = if (online) Green else Muted,
                )
            }
            if (!isGroup && c != null) {
                val otherId = c.optJSONObject("other")?.optString("id") ?: ""
                if (otherId.isNotBlank()) {
                    IconButton(onClick = {
                        CallEngine.instance?.startCall(otherId, "AUDIO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Call, "Voice call", tint = GoldDeep, modifier = Modifier.size(23.dp))
                    }
                    IconButton(onClick = {
                        CallEngine.instance?.startCall(otherId, "VIDEO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Videocam, "Video call", tint = GoldDeep, modifier = Modifier.size(25.dp))
                    }
                }
            }
        }

        /* ---------------- message list on coin wallpaper ---------------- */
        Box(Modifier.weight(1f).fillMaxWidth()) {
            CoinWallpaper()
            if (loading && msgs.isEmpty()) {
                CircularProgressIndicator(
                    color = Gold,
                    modifier = Modifier.align(Alignment.Center),
                )
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 10.dp, end = 10.dp, top = 6.dp, bottom = 10.dp,
                ),
            ) {
                items(msgs, key = { it.optString("id") }) { m ->
                    MessageRow(
                        m,
                        isGroup,
                        myId = Store.myId(),
                        otherReadAt = otherReadAt,
                        player = player,
                    )
                }
                if (msgs.isEmpty() && !loading) {
                    item {
                        Box(Modifier.fillMaxWidth().padding(top = 60.dp), contentAlignment = Alignment.Center) {
                            Text("Say hi 👋", color = Muted, fontSize = 14.sp)
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
                Text(error, color = Red, fontSize = 13.sp, modifier = Modifier.weight(1f))
                IconButton(onClick = { error = "" }, Modifier.size(26.dp)) {
                    Icon(Icons.Filled.Close, "Dismiss", tint = Red, modifier = Modifier.size(16.dp))
                }
            }
        }

        /* ---------------- composer ---------------- */
        if (showAttach) {
            AttachSheet(
                onDismiss = { showAttach = false },
                onSendText = { sendText(it) },
                onSendImage = { sendImage(it) },
                onSendFile = { n, m, b -> sendFile(n, m, b) },
            )
        }
        if (recording) {
            RecordingBar(
                onCancel = {
                    VoiceNote.cancel()
                    recording = false
                },
                onSend = {
                    val result = VoiceNote.stop()
                    recording = false
                    if (result != null) sendVoice(result.first, result.second)
                },
            )
        } else {
            Composer(
                input = input,
                onInput = { input = it },
                onAttach = { showAttach = true },
                onSend = {
                    sendText(input)
                    input = ""
                },
                onMic = {
                    if (VoiceNote.start(ctx)) recording = true
                },
            )
        }
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
                val r = 7.dp.toPx() + (abs((x * 31 + y * 17) % 5f)) * 1.2f
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
    onSend: () -> Unit,
    onMic: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(Cream)
            .imePadding()
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(
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
                Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    if (input.isEmpty()) {
                        Text("Message", color = Muted, fontSize = 15.sp)
                    }
                    BasicTextField(
                        value = input,
                        onValueChange = onInput,
                        textStyle = androidx.compose.ui.text.TextStyle(
                            color = Ink,
                            fontSize = 15.sp,
                        ),
                        maxLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(if (input.isBlank()) Gold else goldFill()),
            contentAlignment = Alignment.Center,
        ) {
            IconButton(onClick = { if (input.isBlank()) onMic() else onSend() }) {
                Icon(
                    if (input.isBlank()) Icons.Filled.Mic else Icons.AutoMirrored.Filled.Send,
                    contentDescription = if (input.isBlank()) "Voice note" else "Send",
                    tint = AmberInk,
                    modifier = Modifier.size(23.dp),
                )
            }
        }
    }
}

@Composable
private fun RecordingBar(onCancel: () -> Unit, onSend: () -> Unit) {
    var secs by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        while (VoiceNote.isRecording) {
            secs++
            delay(1000)
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(Cream)
            .imePadding()
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onCancel) {
            Icon(Icons.Filled.Close, "Cancel", tint = Red)
        }
        Box(
            Modifier
                .weight(1f)
                .clip(RoundedCornerShape(22.dp))
                .background(Card)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(9.dp)
                        .clip(CircleShape)
                        .background(Red),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    "Recording · %d:%02d".format(secs / 60, secs % 60),
                    color = Ink,
                    fontSize = 14.sp,
                )
            }
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(goldFill()),
            contentAlignment = Alignment.Center,
        ) {
            IconButton(onClick = onSend) {
                Icon(Icons.AutoMirrored.Filled.Send, "Send voice note", tint = AmberInk, modifier = Modifier.size(23.dp))
            }
        }
    }
}

/* ------------------------------------------------------------------ */

@Composable
private fun MessageRow(
    m: JSONObject,
    isGroup: Boolean,
    myId: String,
    otherReadAt: String?,
    player: VoicePlayer,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val mine = m.optString("senderId") == myId
    val kind = m.optString("kind")

    if (kind == "SYSTEM") {
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

    var showDelete by remember { mutableStateOf(false) }
    if (showDelete && mine) {
        AlertDialog(
            onDismissRequest = { showDelete = false },
            title = { Text("Delete message?") },
            text = { Text("This only deletes it for you.") },
            confirmButton = {
                TextButton(onClick = {
                    showDelete = false
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) { Api.delete("/api/messages/${m.optString("id")}") }
                        }
                    }
                }) { Text("Delete", color = Red) }
            },
            dismissButton = { TextButton(onClick = { showDelete = false }) { Text("Cancel", color = Muted) } },
        )
    }

    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Box(
                Modifier
                    .widthIn(max = 290.dp)
                    .clip(
                        RoundedCornerShape(
                            topStart = 16.dp,
                            topEnd = 16.dp,
                            bottomStart = if (mine) 16.dp else 5.dp,
                            bottomEnd = if (mine) 5.dp else 16.dp,
                        ),
                    )
                    .background(if (mine) goldFill() else Card)
                    .clickable { if (mine) showDelete = true }
                    .padding(10.dp),
            ) {
                val senderName = m.optString("senderName").takeIf { it.isNotBlank() } ?: ""
                if (!mine && isGroup && senderName.isNotBlank()) {
                    Text(
                        senderName,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = GoldDeep,
                    )
                }
                when (kind) {
                    "IMAGE" -> ImageBubble(m, mine)
                    "FILE" -> FileBubble(m, mine, player)
                    "DELETED" -> Text(
                        "🚫 This message was deleted",
                        fontSize = 13.5.sp,
                        fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                        color = if (mine) Color(0xE6FFFFFF) else Muted,
                    )
                    else -> Text(
                        m.optString("body"),
                        fontSize = 14.5.sp,
                        color = Ink,
                    )
                }
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        msgStamp(m.optString("createdAt")),
                        fontSize = 10.sp,
                        color = if (mine) Color(0x99FFFFFF).copy(alpha = 0.85f) else Muted,
                    )
                    if (mine) {
                        Spacer(Modifier.width(4.dp))
                        val read = otherReadAt != null && otherReadAt >= m.optString("createdAt")
                        Icon(
                            if (read) Icons.Filled.DoneAll else Icons.Filled.Done,
                            contentDescription = if (read) "Read" else "Sent",
                            tint = if (read) Color(0xFFFFFFFF) else Color(0xCCFFFFFF),
                            modifier = Modifier.size(13.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ImageBubble(m: JSONObject, mine: Boolean) {
    val url = m.optString("mediaUrl").takeIf { it.isNotBlank() }
    val bmp = rememberBitmap(url)
    if (bmp != null) {
        androidx.compose.foundation.Image(
            bmp,
            contentDescription = "Photo",
            modifier = Modifier
                .widthIn(max = 260.dp, min = 180.dp)
                .clip(RoundedCornerShape(12.dp)),
            contentScale = androidx.compose.ui.layout.ContentScale.FillWidth,
        )
    } else {
        Box(
            Modifier
                .widthIn(min = 150.dp)
                .height(110.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0x22000000)),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(color = if (mine) AmberInk else Gold, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun FileBubble(m: JSONObject, mine: Boolean, player: VoicePlayer) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = m.optString("id")
    val fileKey = m.optString("fileKey")
    val fileName = m.optString("fileName").ifBlank { "File" }
    val fileType = m.optString("fileType")
    val isVoice = fileType.startsWith("audio") || fileName.endsWith(".m4a") || fileName.endsWith(".mp3")
    var playing by remember { mutableStateOf(player.playingId == id) }

    if (isVoice) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(if (mine) Color(0x33FFFFFF) else GoldSoft),
                contentAlignment = Alignment.Center,
            ) {
                IconButton(onClick = {
                    val url = Api.BASE + (if (fileKey.startsWith("/")) fileKey else "/api/files/$fileKey")
                    val started = player.toggle(id, url)
                    playing = started || player.playingId == id
                }) {
                    Icon(
                        if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (playing) "Pause" else "Play",
                        tint = if (mine) Ink else GoldDeep,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    "Voice message",
                    fontSize = 14.sp,
                    color = Ink,
                )
                val secs = m.optJSONObject("meta")?.optInt("seconds") ?: 0
                Text(
                    if (secs > 0) "%d:%02d · %s".format(secs / 60, secs % 60, FilesUtil.displaySize(m.optInt("fileSize")))
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
