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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
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
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Reply

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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.OutlinedTextField
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.net.Uri
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
    var lastTypingPing by remember { mutableStateOf(0L) }
    var showAttach by remember { mutableStateOf(false) }
    var showStickers by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recMs by remember { mutableStateOf(0) }
    var uploading by remember { mutableStateOf(0) } // >0 = photo/file uploads in flight
    var error by remember { mutableStateOf("") }
    var otherReadAt by remember { mutableStateOf<String?>(null) }
    // "typing…" lives 6s per ping, refreshed on the messages poll.
    var otherTypingAt by remember { mutableStateOf(0L) }
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
    // Selection mode (long-press): delete-for-me / unsend / edit / forward.
    val selected = remember { mutableStateListOf<String>() }
    // System back during selection CLEARS the selection (WhatsApp) — it must
    // not fling the user out of the chat with bubbles still highlighted.
    androidx.activity.compose.BackHandler(enabled = selected.isNotEmpty()) {
        selected.clear()
    }
    var viewerMsg by remember { mutableStateOf<JSONObject?>(null) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var forwarding by remember { mutableStateOf(false) }

    fun paintFromStore() {
        val next = ScreenStore.msgsOf(convId).filter { it.optString("id") !in ScreenStore.hiddenMsgIds }
        if (msgs.isEmpty()) {
            msgs.addAll(next)
            return
        }
        val oldIds = msgs.map { it.optString("id") }
        val newIds = next.map { it.optString("id") }
        if (oldIds == newIds) {
            // Same ids: only touch the rows whose JSON actually changed —
            // replacing every object re-composed the whole list on EVERY
            // poll tick (800ms), which read as constant scroll jank.
            next.forEachIndexed { i, o ->
                if (msgs[i] != o) msgs[i] = o
            }
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
                    // Skip the state write when nothing changed: assigning a
                    // fresh JSONObject on every poll re-composed the header
                    // (and everything reading conv) 60+ times a minute.
                    if (conv.value != c) conv.value = c
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
                data.optString("typingAt").takeIf { it.isNotBlank() }?.let {
                    (runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() ?: 0L)
                        .takeIf { ms -> ms > 0 }?.let { ms -> otherTypingAt = ms }
                }
                val prevTop = lastTopId
                val newTop = fresh.lastOrNull()?.optString("id") ?: ""
                ScreenStore.setMsgs(convId, fresh)
                paintFromStore()
                if (pending.isNotEmpty()) {
                    pending.removeAll { p ->
                        val cid = p.optString("clientId").ifBlank { "" }
                        cid.isNotBlank() && fresh.any { it.optString("clientId") == cid }
                    }
                    // Failed sends keep their bubble long enough for the error to
                    // be read, then clear instead of spinning forever.
                    pending.removeAll {
                        it.optBoolean("failed") &&
                            System.currentTimeMillis() - it.optLong("failedAt") > 20_000
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
                    // Clear the list badge NOW — waiting for the next list poll
                    // made the unread counter hang around after reading.
                    ScreenStore.markRead(convId)
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
    LaunchedEffect(convId, ScreenStore.poke) {
        if (Store.route == "chat/$convId") refreshMessages()
    }

    // Opening a chat ALWAYS lands on the newest message (instant, not animated,
    // so it never lags behind a fast paint on a slow device).
    var didInitialScroll by remember { mutableStateOf(false) }
    LaunchedEffect(msgs.size, pending.size) {
        if (!didInitialScroll && msgs.isNotEmpty()) {
            listState.scrollToItem(msgs.size + pending.size - 1)
            didInitialScroll = true
        }
    }

    LaunchedEffect(convId) {
        while (true) {
            if (Store.foreground && Store.route == "chat/$convId") {
                refreshMessages()
                delay(800)
            } else {
                delay(2_000)
            }
        }
    }

    /** Flags an optimistic bubble as failed so it stops pretending to upload. */
    fun markPendingFailed(clientId: String) {
        pending.find { it.optString("clientId") == clientId }
            ?.put("failed", true)
            ?.put("failedAt", System.currentTimeMillis())
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
                .put("kind", "IMAGE")
                .put("body", "")
                .put("hasImage", true)
                .put("fileName", "photo.jpg")
                .put("fileType", "image/jpeg")
                .put("mediaUrl", dataUrl)
                .put("createdAt", java.time.Instant.now().toString()),
        )
        scope.launch {
            listState.animateScrollToItem(msgs.size + pending.size - 1)
            val jpeg = withContext(Dispatchers.IO) {
                val b64 = dataUrl.substringAfter(",", "")
                runCatching { android.util.Base64.decode(b64, android.util.Base64.DEFAULT) }.getOrNull()
            }
            if (jpeg == null || jpeg.isEmpty()) {
                error = "Could not read that photo."
                pending.find { it.optString("clientId") == clientId }?.put("failed", true)
                return@launch
            }
            try {
                val up = withContext(Dispatchers.IO) { Api.upload("photo.jpg", "image/jpeg", jpeg) }
                val key = up.optString("fileKey")
                if (key.isBlank()) throw ApiException(500, "Upload returned no file key.")
                val payload =
                    JSONObject()
                        .put("kind", "FILE")
                        .put("fileKey", key)
                        .put("fileName", "photo.jpg")
                        .put("fileType", "image/jpeg")
                        .put("fileSize", jpeg.size)
                        .put("clientId", clientId)
                withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                KpSounds.send(ctx)
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                try {
                    val small = if (dataUrl.length > 400_000) {
                        "data:image/jpeg;base64," + android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP)
                    } else dataUrl
                    val payload = JSONObject().put("kind", "IMAGE").put("imageData", small).put("clientId", clientId)
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
                // Before this the optimistic bubble stayed on screen forever
                // looking like it was still uploading: the POST never happened,
                // so no message with this clientId ever came back to match it.
                markPendingFailed(clientId)
                // No retry hint here on purpose: the picked bytes are gone with
                // the dismissed picker, so "tap to retry" could never work.
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
                // Kept for tap-to-retry after a failed upload (the temp file
                // is only deleted once the send succeeds).
                .put("voicePath", file.absolutePath)
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
                // The old fallback queued a FILE payload with no fileKey. The
                // server rejects that with 400 every time, and because flush()
                // stops at the first failure it wedged every later queued
                // message behind it permanently.
                markPendingFailed(clientId)
                error = (e.message ?: "Could not send that voice note.") + "  Tap the banner to retry."
            }
        }
    }

    /* ---- attachment pickers --------------------------------------------
       AttachSheet is dismissed the instant the user picks something, so it
       cannot do the (slow) decode/read itself: its own coroutine scope dies
       with the sheet and the attachment is silently dropped. These handlers
       run on the *chat* screen's scope instead, which lives as long as the
       chat is open, so gallery / camera / document / audio / contact /
       location all survive the sheet closing. */
    fun handleImagePicked(uri: Uri) {
        scope.launch {
            // 720px / ~100KB: the old 960px/220KB photos took minutes to send AND load
            // on slow mobile data (the "image loads forever" report).
            // High-quality photos: 1440px, ~380KB inline budget (server caps at 450K).
            val dataUrl = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 1440, maxChars = 380_000) }
            if (dataUrl == null) {
                error = "Could not read that photo — try another one."
            } else {
                error = ""
                sendImage(dataUrl)
            }
        }
    }

    fun handleDocumentPicked(uri: Uri) {
        scope.launch {
            val name = withContext(Dispatchers.IO) { queryName(ctx, uri) }
            val pair = withContext(Dispatchers.IO) { FilesUtil.readDocument(ctx, uri) }
            if (pair == null) {
                error = "Could not read that file — try another one."
                return@launch
            }
            val (mime, bytes) = pair
            if (bytes.isEmpty()) {
                error = "That file is empty."
                return@launch
            }
            error = ""
            sendFile(name, mime, bytes)
        }
    }

    fun handleContactPicked(uri: Uri) {
        scope.launch {
            val text = withContext(Dispatchers.IO) { readContact(ctx, uri) }
            if (text.isBlank()) {
                error = "Could not read that contact."
            } else {
                error = ""
                sendText(text)
            }
        }
    }

    fun handleLocationRequested() {
        scope.launch {
            val text = withContext(Dispatchers.IO) { readLocation(ctx) }
            if (text.isBlank()) {
                error = "No recent location available. Turn on location and try again."
            } else {
                error = ""
                sendText(text)
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

    /* ---- selection actions: unsend (everyone) / delete (me) / edit / forward ---- */
    fun pendingEchoOf(m: JSONObject): Boolean =
        pending.any { it.optString("clientId") == m.optString("clientId") || it.optString("id") == m.optString("id") }

    fun selectedMessages(): List<JSONObject> {
        val ids = selected.toList()
        return msgs.filter { it.optString("id") in ids } + pending.filter { it.optString("id") in ids }
    }

    fun canEdit(m: JSONObject): Boolean =
        m.optString("senderId") == Store.myId() &&
            m.optString("kind") == "TEXT" &&
            m.optString("mediaUrl").isBlank() &&
            runCatching {
                java.time.Duration.between(
                    java.time.Instant.parse(m.optString("createdAt")),
                    java.time.Instant.now(),
                ).seconds < 60
            }.getOrDefault(false)

    fun unsendSelected() {
        val ids = selected.toList()
        selected.clear()
        scope.launch {
            ids.forEach { id ->
                runCatching { withContext(Dispatchers.IO) { Api.delete("/api/messages/$id") } }
            }
            refreshMessages()
        }
    }

    fun deleteForMe() {
        val ids = selected.toList()
        selected.clear()
        ids.forEach { ScreenStore.hideMessage(it) }
        paintFromStore()
    }

    fun forwardSelected(targetConvId: String) {
        val items = selectedMessages()
        forwarding = false
        scope.launch {
            for (m in items) {
                runCatching {
                    val key = m.optText("fileKey")
                    when {
                        key.isNotBlank() ->
                            Api.post(
                                "/api/conversations/$targetConvId/messages",
                                JSONObject()
                                    .put("kind", "FILE")
                                    .put("fileKey", key)
                                    .put("fileName", m.optText("fileName").ifBlank { "File" })
                                    .put("fileType", m.optText("fileType").ifBlank { "application/octet-stream" })
                                    .put("fileSize", m.optInt("fileSize")),
                            )
                        m.optText("mediaUrl").startsWith("data:") ->
                            Api.post(
                                "/api/conversations/$targetConvId/messages",
                                JSONObject()
                                    .put("kind", "IMAGE")
                                    .put("imageData", m.optText("mediaUrl")),
                            )
                        m.optText("mediaUrl").isNotBlank() -> {
                            // Server-hosted media (photo message): re-upload to the
                            // target chat so both chats own their own copy.
                            val bytes = withContext(Dispatchers.IO) { Api.download(m.optText("mediaUrl")) }
                            val up = withContext(Dispatchers.IO) {
                                Api.upload(m.optText("fileName").ifBlank { "photo.jpg" }, "image/jpeg", bytes)
                            }
                            Api.post(
                                "/api/conversations/$targetConvId/messages",
                                JSONObject()
                                    .put("kind", "FILE")
                                    .put("fileKey", up.optString("fileKey"))
                                    .put("fileName", m.optText("fileName").ifBlank { "photo.jpg" })
                                    .put("fileType", "image/jpeg")
                                    .put("fileSize", bytes.size),
                            )
                        }
                        else ->
                            Api.post(
                                "/api/conversations/$targetConvId/messages",
                                JSONObject().put("kind", "TEXT").put("body", m.optText("body")),
                            )
                    }
                }
            }
            error = "Forwarded"
        }
    }

    val chatTheme = cTheme(conv.value)
    val single = selected.size == 1
    val singleMsg = if (single) selectedMessages().firstOrNull() else null
    val c = conv.value
    val isGroup = c?.optBoolean("isGroup") == true
    val rawTitle =
        if (isGroup) c?.optText("title")?.ifBlank { "Group" } ?: "…"
        else c?.optJSONObject("other")?.optText("displayName")?.ifBlank { "…" } ?: "…"
    // Long names collapse to the first word so the header always stays a
    // single line (the full name lives on the contact page).
    val title =
        if (rawTitle.length > 14 && rawTitle.contains(' ')) rawTitle.substringBefore(' ') else rawTitle
    val avatarUrl = if (isGroup) null else c?.optJSONObject("other")?.optString("avatarUrl")
    val online = !isGroup && c?.optJSONObject("other")?.optBoolean("online") == true
    val typingNow = !isGroup && System.currentTimeMillis() - otherTypingAt < 6_000
    val other = c?.optJSONObject("other")
    Column(
        Modifier
            .fillMaxSize()
            .background(chatWallpaper(chatTheme))
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        /* ---------------- top bar (or selection bar) ---------------- */
        if (selected.isNotEmpty()) {
            // WhatsApp reference: back arrow, count, then the action icons.
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Cream)
                    .padding(horizontal = 2.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { selected.clear() }) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(28.dp))
                }
                Text(
                    "${selected.size}",
                    fontSize = 19.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                )
                Spacer(Modifier.width(6.dp))
                Spacer(Modifier.weight(1f))
                // Copy (texts), Forward, Unsend (own, single), Delete for me.
                if (selectedMessages().any { it.optString("kind") == "TEXT" && it.optText("body").isNotBlank() }) {
                    IconButton(onClick = {
                        val text = selectedMessages()
                            .filter { it.optString("kind") == "TEXT" }
                            .joinToString("\n") { it.optText("body") }
                        val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("KuchuPuchu", text))
                        android.widget.Toast.makeText(ctx, "Copied", android.widget.Toast.LENGTH_SHORT).show()
                        selected.clear()
                    }) {
                        Icon(Icons.Filled.ContentCopy, "Copy", tint = Ink, modifier = Modifier.size(21.dp))
                    }
                }
                IconButton(onClick = { forwarding = true }) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Forward", tint = GoldDeep, modifier = Modifier.size(21.dp))
                }
                if (single && singleMsg != null && canEdit(singleMsg)) {
                    IconButton(onClick = { editing = singleMsg; selected.clear() }) {
                        Icon(Icons.Filled.Edit, "Edit", tint = GoldDeep, modifier = Modifier.size(21.dp))
                    }
                }
                if (single && singleMsg != null && singleMsg.optString("senderId") == Store.myId() && !pendingEchoOf(singleMsg)) {
                    IconButton(onClick = { unsendSelected() }) {
                        Icon(Icons.Filled.DeleteForever, "Unsend for everyone", tint = Red, modifier = Modifier.size(21.dp))
                    }
                }
                IconButton(onClick = { deleteForMe() }) {
                    Icon(Icons.Filled.Delete, "Delete for me", tint = Red, modifier = Modifier.size(21.dp))
                }
            }
        } else {
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
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(28.dp))
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
                Text(
                    title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    when {
                        isGroup -> "${c?.arr("members")?.length() ?: 0} members"
                        typingNow -> "typing..."
                        online -> "online"
                        else -> otherLastSeen(other?.optText("lastActiveAt"))
                    },
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = when {
                        typingNow -> GoldDeep
                        online -> Green
                        else -> Muted
                    },
                    fontWeight = if (typingNow) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
            }
            if (!isGroup && c != null) {
                if (otherId.isNotBlank()) {
                    HeaderCallBtn(onClick = {
                        CallEngine.instance?.startCall(otherId, "AUDIO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Call, "Voice call", tint = GoldDeep, modifier = Modifier.size(19.dp))
                    }
                    HeaderCallBtn(onClick = {
                        CallEngine.instance?.startCall(otherId, "VIDEO", title, avatarUrl ?: "")
                    }) {
                        Icon(Icons.Filled.Videocam, "Video call", tint = GoldDeep, modifier = Modifier.size(21.dp))
                    }
                }
            }
            Box {
                IconButton(onClick = { menuOpen = true }) {
                    Icon(Icons.Filled.MoreVert, "More", tint = Ink, modifier = Modifier.size(24.dp))
                }
                DropdownMenu(
                    expanded = menuOpen,
                    onDismissRequest = { menuOpen = false },
                    modifier = Modifier.background(Cream),
                ) {
                    DropdownMenuItem(
                        text = { Text("New group", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.GroupAdd, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; nav.navigate("newgroup") },
                    )
                    DropdownMenuItem(
                        text = { Text("View contact", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.Person, null, tint = GoldDeep) },
                        onClick = {
                            menuOpen = false
                            if (!isGroup && otherId.isNotBlank()) nav.navigate("profile/$otherId")
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Search", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.Search, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; nav.navigate("search") },
                    )
                    DropdownMenuItem(
                        text = { Text("Media, links, and docs", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.PermMedia, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; nav.navigate("chatmedia/$convId") },
                    )
                    DropdownMenuItem(
                        text = { Text(if (c?.optBoolean("muted") == true) "Unmute notifications" else "Mute notifications", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.NotificationsOff, null, tint = GoldDeep) },
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
                        text = { Text("Disappearing messages", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.Timer, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; showDisappear = true },
                    )
                    DropdownMenuItem(
                        text = { Text("Chat theme", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.Palette, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; showTheme = true },
                    )
                }
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
                items(
                    msgs,
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                    contentType = { it.optString("kind") },
                ) { m ->
                    // WhatsApp-style selection: the whole ROW gets a translucent
                    // highlight strip, edge to edge — not just the bubble.
                    val rowSelected = m.optString("id") in selected
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(if (rowSelected) Gold.copy(alpha = 0.16f) else Color.Transparent),
                    ) {
                        MessageRow(
                            m,
                            isGroup,
                            Store.myId(),
                            otherReadAt,
                            player,
                            selectedIds = selected.toList(),
                            onToggleSelect = { msg ->
                                // Deleted tombstones are not selectable: they
                                // can't be deleted-again, forwarded or copied.
                                if (msg.optString("kind") != "DELETED") {
                                    val id = msg.optString("id")
                                    if (id in selected) selected.remove(id) else selected.add(id)
                                }
                            },
                            onOpenImage = { msg -> viewerMsg = msg },
                        )
                    }
                }
                items(
                    pending.filter { p ->
                        val cid = p.optString("clientId").ifBlank { p.optString("id") }
                        msgs.none { it.optString("clientId") == cid || it.optString("id") == cid }
                    },
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                ) { m ->
                    MessageRow(m, isGroup, Store.myId(), otherReadAt, player, pendingEcho = true)
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
                            // Drop the old bubbles first: retrying creates NEW
                            // pending entries (new clientIds), and the old ones
                            // would otherwise never match a server message and
                            // stick around forever.
                            pending.removeAll(failed.toSet())
                            failed.forEach { p ->
                                val url = p.optString("mediaUrl")
                                val voicePath = p.optString("voicePath")
                                when {
                                    url.isNotBlank() -> sendImage(url)
                                    voicePath.isNotBlank() -> {
                                        val f = File(voicePath)
                                        if (f.exists()) {
                                            sendVoice(
                                                f,
                                                p.optJSONObject("meta")?.optInt("seconds") ?: 0,
                                                p.optString("fileName").ifBlank { "voice.m4a" },
                                            )
                                        }
                                    }
                                    // Files/documents can't be retried: the bytes
                                    // are gone with the dismissed picker.
                                }
                            }
                        }
                    },
                )
                IconButton(onClick = { error = "" }, Modifier.size(26.dp)) {
                    Icon(Icons.Filled.Close, "Dismiss", tint = Red, modifier = Modifier.size(16.dp))
                }
            }
        }

        /* ---------------- in-chat search (above the composer so it sits at
           the bottom edge WITH the input bar, never underneath it; the
           composer's imePadding lifts both above the keyboard) ---------------- */
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

        /* ---------------- composer (doubles as the recording bar) ---------------- */
        Composer(
            input = input,
            onInput = { v ->
                input = v
                // Typing means the user wants the keyboard, not the panel.
                if (v.isNotBlank() && (showAttach || showStickers)) {
                    showAttach = false
                    showStickers = false
                }
                if (v.isNotBlank()) {
                    val now = System.currentTimeMillis()
                    if (now - lastTypingPing > 3_000) {
                        lastTypingPing = now
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.post("/api/conversations/$convId/typing", JSONObject())
                                }
                            }
                        }
                    }
                }
            },
            onInputTap = {
                if (showAttach || showStickers) {
                    showAttach = false
                    showStickers = false
                }
            },
            onAttach = { haptics.tap(); showStickers = false; showAttach = true },
            onSticker = { haptics.tap(); showAttach = false; showStickers = true },
            onSend = {
                haptics.confirm()
                showAttach = false
                showStickers = false
                sendText(input)
                input = ""
            },
            recording = recording,
            recMs = recMs,
            onStartRecord = {
                haptics.tap()
                showAttach = false
                showStickers = false
                startRecording()
            },
            onFinishRecord = { cancelled -> finishRecording(cancelled) },
        )

        /* ---------------- inline panels — BELOW the message bar, WhatsApp
           style: the bar rides on top of the panel; the panel is NOT
           fullscreen until the user taps/swipes the handle up ---------------- */
        if (showAttach) {
            AttachPanel(
                onDismiss = { showAttach = false },
                onImagePicked = ::handleImagePicked,
                onDocumentPicked = ::handleDocumentPicked,
                onContactPicked = ::handleContactPicked,
                onLocationRequested = ::handleLocationRequested,
            )
        }
        if (showStickers) {
            StickerPanel(
                onDismiss = { showStickers = false },
                onSend = {
                    showStickers = false
                    sendText(it, "STICKER")
                },
            )
        }
        androidx.activity.compose.BackHandler(enabled = showAttach || showStickers) {
            showAttach = false
            showStickers = false
        }
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

        viewerMsg?.let { m ->
            ImageViewerDialog(
                m = m,
                onClose = { viewerMsg = null },
                onForward = {
                    viewerMsg = null
                    if (m.optString("id") !in selected) selected.clear()
                    selected.add(m.optString("id"))
                    forwarding = true
                },
            )
        }
        editing?.let { m ->
            EditDialog(
                original = m.optText("body"),
                onClose = { editing = null },
                onSave = { newText ->
                    val id = m.optString("id")
                    editing = null
                    scope.launch {
                        runCatching {
                            withContext(Dispatchers.IO) {
                                Api.patch("/api/messages/$id", JSONObject().put("body", newText))
                            }
                        }
                        refreshMessages()
                    }
                },
            )
        }
        if (forwarding) {
            ForwardDialog(
                onClose = { forwarding = false },
                onPick = { targetId ->
                    forwardSelected(targetId)
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
    onInputTap: () -> Unit = {},
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
                    // WhatsApp order: stickers LEFT, attach RIGHT.
                    IconButton(onClick = onSticker, Modifier.size(40.dp)) {
                        Icon(Icons.Filled.Mood, "Stickers", tint = GoldDeep, modifier = Modifier.size(24.dp))
                    }
                    Box(Modifier.weight(1f)) {
                        if (input.isEmpty()) {
                            // Same vertical padding as the BasicTextField below,
                            // otherwise the hint floats 8dp above where the
                            // typed text lands.
                            Text(
                                "Message",
                                color = Muted,
                                fontSize = 15.sp,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                        val inputInteraction = remember { MutableInteractionSource() }
                        val inputPressed by inputInteraction.collectIsPressedAsState()
                        LaunchedEffect(inputPressed) {
                            if (inputPressed) onInputTap()
                        }
                        BasicTextField(
                            value = input,
                            onValueChange = onInput,
                            textStyle = TextStyle(color = Ink, fontSize = 15.sp),
                            maxLines = 4,
                            interactionSource = inputInteraction,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        )
                    }
                    IconButton(onClick = onAttach, Modifier.size(40.dp)) {
                        Icon(Icons.Filled.AttachFile, "Attach", tint = GoldDeep, modifier = Modifier.size(24.dp))
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
                    .size(54.dp)
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


/**
 * Small raised 3D circle for the header call icons: top-lit gradient,
 * drop shadow, hairline bevel.
 */
@Composable
private fun HeaderCallBtn(onClick: () -> Unit, icon: @Composable () -> Unit) {
    val haptics = rememberHaptics()
    Box(
        Modifier
            .padding(horizontal = 3.dp)
            .size(38.dp)
            .shadow(4.dp, CircleShape)
            .clip(CircleShape)
            .background(Brush.verticalGradient(listOf(Color(0xFFFFFFFF), Color(0xFFF3E4C6))))
            .border(1.dp, Color(0x24000000), CircleShape)
            .clickable { haptics.tap(); onClick() },
        contentAlignment = Alignment.Center,
    ) { icon() }
}

/**
 * Full-screen photo viewer: pinch/double-tap zoom, pan, save to gallery and
 * forward. Plain taps on chat photos used to offer "delete" — far too easy
 * to hit by accident; now photos OPEN instead.
 */
/**
 * Decoded photo aspect ratios, cached process-wide. LazyColumn discards
 * off-screen items and their remember{} state; without this cache a scrolled
 * photo returned to the placeholder size and "jumped" on the way back.
 */
private object ImageRatios {
    private val map = HashMap<String, Float>()

    fun get(url: String?): Float {
        if (url == null) return 0f
        synchronized(map) { return map[url] ?: 0f }
    }

    fun put(url: String?, ratio: Float): Float {
        if (url != null && ratio > 0f) synchronized(map) { map[url] = ratio }
        return ratio
    }
}

/** Just the time — "3:17 am" today, "yesterday 11:10 pm", then "12 Aug". */
private fun otherLastSeen(iso: String?): String {
    if (iso.isNullOrBlank()) return " "
    val t = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return " "
    val z = t.atZone(java.time.ZoneId.systemDefault())
    val now = java.time.ZonedDateTime.now()
    val h12 = z.hour % 12; val hh = if (h12 == 0) 12 else h12
    val ampm = if (z.hour < 12) "am" else "pm"
    val time = "$hh:%02d $ampm".format(z.minute)
    return when {
        z.toLocalDate() == now.toLocalDate() -> time
        z.toLocalDate() == now.toLocalDate().minusDays(1) -> "yesterday $time"
        else -> "${z.dayOfMonth} ${z.month.toString().take(3).lowercase()}"
    }
}

@Composable
private fun ImageViewerDialog(
    m: JSONObject,
    onClose: () -> Unit,
    onForward: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val url =
        m.optText("mediaUrl").takeIf { it.isNotBlank() }
            ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { key ->
                if (key.startsWith("data:") || key.startsWith("http") || key.startsWith("/")) key
                else "/api/files/$key"
            } ?: ""
    var scale by remember { mutableStateOf(1f) }
    var offX by remember { mutableStateOf(0f) }
    var offY by remember { mutableStateOf(0f) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
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
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(onDoubleTap = {
                            if (scale > 1f) {
                                scale = 1f; offX = 0f; offY = 0f
                            } else {
                                scale = 2.5f
                            }
                        })
                    },
            ) {
                KpNetImage(
                    url,
                    "Photo",
                    Modifier
                        .fillMaxSize()
                        .graphicsLayer(
                            scaleX = scale,
                            scaleY = scale,
                            translationX = offX,
                            translationY = offY,
                        ),
                    androidx.compose.ui.layout.ContentScale.Fit,
                )
            }
            IconButton(onClick = onClose, Modifier.align(Alignment.TopStart).padding(6.dp)) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White)
            }
            // 20% black pill behind the actions: on a white photo the plain
            // white glyphs used to vanish completely.
            Row(
                Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(18.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Color(0x33000000))
                    .padding(horizontal = 26.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(28.dp),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    IconButton(
                        onClick = {
                            scope.launch {
                                val bytes = withContext(Dispatchers.IO) {
                                    runCatching {
                                        if (url.startsWith("data:")) {
                                            android.util.Base64.decode(url.substringAfter(","), android.util.Base64.DEFAULT)
                                        } else if (url.startsWith("http")) {
                                            java.net.URL(url).openStream().use { it.readBytes() }
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
                        },
                    ) {
                        Icon(Icons.Filled.Download, "Save to gallery", tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                    Text("Save", color = Color.White, fontSize = 12.sp)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    IconButton(onClick = onForward) {
                        Icon(Icons.Filled.Reply, "Forward", tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                    Text("Forward", color = Color.White, fontSize = 12.sp)
                }
            }
        }
    }
}

/** Edit window: one minute from send, text messages only (enforced server-side too). */
@Composable
private fun EditDialog(original: String, onClose: () -> Unit, onSave: (String) -> Unit) {
    var text by remember { mutableStateOf(original) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Edit message") },
        text = {
            OutlinedTextField(
                text,
                { text = it.take(4000) },
                singleLine = false,
                maxLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = { if (text.isNotBlank()) onSave(text.trim()) }, enabled = text.isNotBlank()) {
                Text("Save", color = GoldDeep, fontWeight = FontWeight.SemiBold)
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel", color = Muted) } },
    )
}

/** Pick a conversation to forward the selected message(s) to. */
@Composable
private fun ForwardDialog(onClose: () -> Unit, onPick: (String) -> Unit) {
    val convs = ScreenStore.convs
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Forward to") },
        text = {
            LazyColumn(
                Modifier.heightIn(max = 380.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (convs.isEmpty()) {
                    item { Text("No chats yet.", color = Muted, fontSize = 14.sp) }
                }
                items(convs, key = { it.optString("id") }) { c ->
                    val isGroup = c.optBoolean("isGroup")
                    val other = c.optJSONObject("other")
                    val name =
                        if (isGroup) c.optText("title").ifBlank { "Group" }
                        else other?.optText("displayName")?.ifBlank { "Chat" } ?: "Chat"
                    val avatarUrl = if (isGroup) null else other?.optString("avatarUrl")
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Cream)
                            .clickable { onPick(c.optString("id")) }
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KpAvatar(name, avatarUrl, 40.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Cancel", color = Muted) } },
    )
}

/** Snapshot of a chat list row → a pseudo conversation object for instant paint. */
private fun convRowSnapshot(convId: String): JSONObject? {
    val row = ScreenStore.convs.firstOrNull { it.optString("id") == convId } ?: return null
    val other = JSONObject()
        .put("id", row.optJSONObject("other")?.optString("id") ?: "")
        .put("displayName", row.optJSONObject("other")?.optText("displayName") ?: "")
        .put("avatarUrl", row.optJSONObject("other")?.optString("avatarUrl") ?: "")
        .put("online", row.optJSONObject("other")?.optBoolean("online") ?: false)
    return JSONObject()
        .put("id", convId)
        .put("isGroup", row.optBoolean("isGroup"))
        .put("title", row.optString("title"))
        .put("other", other)
}

/* ------------------------------------------------------------------ */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    m: JSONObject,
    isGroup: Boolean,
    myId: String,
    otherReadAt: String?,
    player: VoicePlayer,
    pendingEcho: Boolean = false,
    selectedIds: List<String> = emptyList(),
    onToggleSelect: (JSONObject) -> Unit = {},
    onOpenImage: (JSONObject) -> Unit = {},
) {
    val mine = m.optString("senderId") == myId
    val kind = m.optString("kind")
    val isSelected = m.optString("id") in selectedIds
    val haptics = rememberHaptics()

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
    // Photos skip the chat bubble entirely: the image IS the bubble, with the
    // timestamp and ticks overlaid on the photo (WhatsApp-style). FILE-kind
    // image uploads (picked as documents) get the same treatment.
    if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m))) {
        ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage)
        return
    }

    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
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
                    .background(
                        when {
                            // Deleted tombstones sit in a flat, greyed bubble.
                            m.optString("kind") == "DELETED" ->
                                Brush.linearGradient(listOf(Color(0xFFB9B3A9), Color(0xFFB9B3A9)))
                            mine -> goldFill()
                            else -> Brush.linearGradient(listOf(Card, Card))
                        },
                    )
                    .combinedClickable(
                        onClick = { if (selectedIds.isNotEmpty() && !pendingEcho) onToggleSelect(m) },
                        onLongClick = {
                            if (!pendingEcho) {
                                haptics.tap()
                                onToggleSelect(m)
                            }
                        },
                    )
                    .padding(start = 10.dp, top = 7.dp, end = 8.dp, bottom = 5.dp),
            ) {
                val senderName = m.optText("senderName")
                Column(Modifier.padding(end = 52.dp, bottom = 2.dp)) {
                    if (!mine && isGroup && senderName.isNotBlank()) {
                        Text(senderName, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = GoldDeep)
                    }
                    when (kind) {
                        "STICKER" -> Text(m.optString("body"), fontSize = 56.sp)
                        "FILE" -> FileBubble(m, mine, player, pendingEcho)
                        "DELETED" -> Text(
                            "This message was deleted",
                            fontSize = 13.5.sp,
                            fontStyle = FontStyle.Italic,
                            color = Color(0xFF4A463F),
                        )
                        else -> Text(
                            m.optText("body") + if (m.optBoolean("edited")) "  (edited)" else "",
                            fontSize = 14.5.sp,
                            color = Ink,
                        )
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

/** True when a FILE message is really just a photo (image mime / extension). */
private fun fileLooksImage(m: JSONObject): Boolean {
    val type = m.optString("fileType")
    if (type.startsWith("image")) return true
    val name = m.optString("fileName").lowercase()
    return name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") || name.endsWith(".webp")
}

/**
 * Photo message — no chat-bubble background: the photo is the bubble, with a
 * soft bottom scrim so the timestamp + ticks stay readable on any image.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ImageMessageRow(
    m: JSONObject,
    mine: Boolean,
    pendingEcho: Boolean,
    otherReadAt: String?,
    selectedIds: List<String>,
    onToggleSelect: (JSONObject) -> Unit,
    onOpenImage: (JSONObject) -> Unit,
) {
    val haptics = rememberHaptics()
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            Modifier
                .widthIn(max = 225.dp)
                .clip(RoundedCornerShape(12.dp))
                .combinedClickable(
                    onClick = {
                        if (pendingEcho) return@combinedClickable
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onOpenImage(m)
                    },
                    onLongClick = {
                        if (!pendingEcho) {
                            haptics.tap()
                            onToggleSelect(m)
                        }
                    },
                ),
        ) {
            ImageBubble(m, mine)
            // scrim so the stamp never drowns in a bright photo
            Box(
                Modifier
                    .matchParentSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color.Transparent, Color.Transparent, Color(0x66000000)),
                        ),
                    ),
            )
            Row(
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(horizontal = 8.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    msgStamp(m.optString("createdAt")),
                    fontSize = 10.sp,
                    color = Color.White,
                )
                if (mine) {
                    Spacer(Modifier.width(3.dp))
                    TickIcon(m, pendingEcho, otherReadAt)
                }
            }
        }
    }
}

@Composable
private fun ImageBubble(m: JSONObject, mine: Boolean) {
    // Photos arrive two ways: kind=IMAGE carries mediaUrl (/api/messages/:id/media
    // or an inline dataUrl while pending), but uploads sent as kind=FILE only
    // carry fileKey. Reading mediaUrl alone left every uploaded photo on an
    // infinite spinner — the fileKey→URL conversion used to happen in
    // FileBubble, which the image fast-path now bypasses.
    val url =
        m.optText("mediaUrl").takeIf { it.isNotBlank() }
            ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { key ->
                if (key.startsWith("data:") || key.startsWith("http") || key.startsWith("/")) key
                else "/api/files/$key"
            }
    // ORIGINAL aspect ratio (capped). The ratio lives in a PROCESS-WIDE cache
    // keyed by URL: a LazyColumn disposes off-screen items, so a remember()
    // here was thrown away on every scroll-out and the bubble snapped back to
    // the placeholder size while flinging ("images jump while scrolling").
    var ratio by remember(url) { mutableStateOf(ImageRatios.get(url)) }
    val dataBmp = if (url?.startsWith("data:") == true) rememberBitmap(url) else null
    Box(
        Modifier
            .widthIn(max = 225.dp)
            .then(
                if (ratio > 0f) {
                    Modifier
                        .aspectRatio(ratio.coerceIn(0.55f, 2.6f))
                        .heightIn(max = 280.dp)
                } else {
                    Modifier
                        .widthIn(min = 150.dp)
                        .height(170.dp)
                },
            )
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x22000000)),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank()) {
            CircularProgressIndicator(color = if (mine) AmberInk else Gold, modifier = Modifier.size(22.dp))
        } else if (dataBmp != null) {
            if (ratio <= 0f && dataBmp.height > 0) {
                ratio = ImageRatios.put(url, dataBmp.width.toFloat() / dataBmp.height.toFloat())
            }
            Image(
                dataBmp,
                contentDescription = "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            )
        } else {
            coil.compose.AsyncImage(
                model = coil.request.ImageRequest.Builder(LocalContext.current)
                    .data(if (url.startsWith("http")) url else Api.BASE + url)
                    .crossfade(false)
                    .build(),
                contentDescription = "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                onSuccess = { state ->
                    val d = state.result.drawable
                    if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0 && ratio <= 0f) {
                        ratio = ImageRatios.put(url, d.intrinsicWidth.toFloat() / d.intrinsicHeight.toFloat())
                    }
                },
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

/**
 * Only server-written CALL rows are call logs. This used to sniff the message
 * body as well, so an ordinary "missed you" or "declined the offer" was drawn as
 * a Missed voice call bubble.
 */
private fun isCallLog(m: JSONObject): Boolean = m.optString("kind") == "CALL"

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
