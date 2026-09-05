package app.kuchupuchu.android

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.isImeVisible
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
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Language
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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.VisibilityOff
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
 * Everything the background half of a messages refresh derives from the
 * response JSON. It carries no Compose-visible side effects on purpose: the
 * coroutine hands this snapshot back to Main, which is where state changes.
 */
private class MsgPage(
    val marker: String,
    val items: List<JSONObject>,
    val topId: String,
    val readAt: String?,
    val typingAt: Long,
    /** §39: the cursor for one page back, and whether anything older exists. */
    val oldest: JSONObject?,
    val hasMore: Boolean,
)

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
    // §39 paging state. `olderIds` is what lets the rebuild above keep what the
    // user already scrolled back to; the cursor is the (createdAt,rowid) pair the
    // server handed with the page it replaced.
    val olderIds = remember { mutableStateListOf<String>() }
    var olderCursor by remember { mutableStateOf<JSONObject?>(null) }
    var hasMoreOlder by remember { mutableStateOf(false) }
    val loadingOlder = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    var lastTypingPing by remember { mutableStateOf(0L) }
    var showAttach by remember { mutableStateOf(false) }
    var showStickers by remember { mutableStateOf(false) }
    var recording by remember { mutableStateOf(false) }
    var recMs by remember { mutableStateOf(0) }
    // Owner round 13: swipe a bubble right to quote-reply to it.
    var replyTo by remember { mutableStateOf<JSONObject?>(null) }
    // Owner round 15: swipe-to-reply now also OPENS the keyboard — a bump
    // here drives the composer's focus+IME (0 = never).
    var replyFocusNonce by remember { mutableStateOf(0) }
    // Owner round 16: message reactions. Long-press still selects (unchanged)
    // AND raises the quick-emoji bar; "+" opens the full emoji sheet.
    var reactionFor by remember { mutableStateOf<JSONObject?>(null) }
    var showEmojiSheet by remember { mutableStateOf(false) }

    fun applyReaction(m: JSONObject, emoji: String) {
        val mid = m.optString("id")
        if (mid.isBlank()) return
        reactionFor = null
        showEmojiSheet = false
        // Local first — the bubble reacts instantly.
        val idx = msgs.indexOfFirst { it.optString("id") == mid }
        if (idx >= 0) {
            val copy = JSONObject(msgs[idx].toString())
            val meta = copy.optJSONObject("meta") ?: JSONObject().also { copy.put("meta", it) }
            val reactions = meta.optJSONObject("reactions") ?: JSONObject().also { meta.put("reactions", it) }
            if (reactions.optString(Store.myId()) == emoji) reactions.remove(Store.myId())
            else reactions.put(Store.myId(), emoji)
            msgs[idx] = copy
        }
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    Api.post("/api/messages/$mid/react", JSONObject().put("emoji", emoji))
                }
            }
        }
    }
    // First page still in flight → skeleton bubbles instead of a blank void.
    var initialLoad by remember { mutableStateOf(true) }
    var uploading by remember { mutableStateOf(0) } // >0 = photo/file uploads in flight
    var error by remember { mutableStateOf("") }
    var otherReadAt by remember { mutableStateOf<String?>(null) }
    // "typing…" lives 6s per ping, refreshed on the messages poll.
    var otherTypingAt by remember { mutableStateOf(0L) }
    // Word-by-word reveal for a freshly-arrived KuchuPuchu AI reply (owner
    // round 2026-09-04). Only messages CREATED after this screen opened are
    // animated, so conversation history never re-types itself on open.
    val chatOpenedAtMs = remember { System.currentTimeMillis() }
    var aiRevealId by remember { mutableStateOf<String?>(null) }
    var aiRevealChars by remember { mutableStateOf(0) }
    val listState = rememberLazyListState()
    val player = remember { VoicePlayer() }
    var lastTopId by remember { mutableStateOf("") }
    // Freshness marker for this conversation message page (see refreshMessages).
    var msgsMarker by remember { mutableStateOf("") }
    // Burst coalescing for realtime message events: K frames inside one
    // 120ms window trigger ONE marker sync, not K (groups spamming emoji
    // used to fire a request per bubble).
    val msgSyncPending = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    var menuOpen by remember { mutableStateOf(false) }
    // Owner round 7: AI-chat incognito — the session is wiped on leaving.
    var aiIncognito by remember { mutableStateOf(false) }
    var showChatSearch by remember { mutableStateOf(false) }
    var showDisappear by remember { mutableStateOf(false) }
    var showTheme by remember { mutableStateOf(false) }
    var muteInFlight by remember { mutableStateOf(false) }
    var searchQ by remember { mutableStateOf("") }
    var searchHits by remember { mutableStateOf(listOf<JSONObject>()) }
    // Selection mode (long-press): delete-for-me / unsend / edit / forward.
    val selected = remember { mutableStateListOf<String>() }
    // Attach-panel (gallery grid) selection, hoisted here so the COMPOSER's
    // mic turns into SEND while the panel has picks (WhatsApp behaviour) —
    // the panel itself no longer carries its own send button.
    val attachSel = remember { mutableStateListOf<MediaItem>() }
    // System back during selection CLEARS the selection (WhatsApp) — it must
    // not fling the user out of the chat with bubbles still highlighted.
    androidx.activity.compose.BackHandler(enabled = selected.isNotEmpty()) {
        selected.clear()
    }
    var viewerMsg by remember { mutableStateOf<JSONObject?>(null) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var forwarding by remember { mutableStateOf(false) }

    // Owner round 7/8: the AI menu's "New chat" (and Incognito on leave) —
    // archives + wipes this bot conversation server-side and locally, giving
    // the AI a fresh context.
    fun resetAiSession() {
        scope.launch {
            val ok =
                runCatching {
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/reset", JSONObject()) }
                }.isSuccess
            if (ok) {
                msgs.clear()
                pending.clear()
                olderIds.clear()
                olderCursor = null
                hasMoreOlder = false
                lastTopId = ""
                msgsMarker = ""
                ScreenStore.setMsgs(convId, emptyList())
            }
        }
    }

    // Owner-card Message button: open (or create) the direct chat with the
    // owner. Cache-first via convIdForUser so an existing chat opens on the
    // same frame; a first-ever chat costs one POST.
    fun openChatWithUser(userId: String) {
        val cached = ScreenStore.convIdForUser[userId]
        if (cached != null) {
            nav.navigate("chat/$cached")
            return
        }
        scope.launch {
            runCatching {
                val conv =
                    withContext(Dispatchers.IO) {
                        Api.post("/api/conversations", JSONObject().put("userId", userId))
                    }
                conv.optJSONObject("conversation")?.optString("id")?.takeIf { it.isNotBlank() }?.let {
                    ScreenStore.convIdForUser[userId] = it
                    nav.navigate("chat/$it")
                }
            }
        }
    }

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

    fun refreshMessages(
        forceScroll: Boolean = false,
        markRead: Boolean = false,
        forceNetwork: Boolean = false,
    ) {
        scope.launch {
            try {
                // Owner round 15: the skeleton used to be cleared in the same
                // frame the fetch STARTED (refreshMessages returns
                // immediately), so the loading placeholder never showed.
                // It gives way when the first page actually lands — here.
                // Compose state is READ here, on Main, before Main is left
                // behind — and written again only once the work below lands.
                val m = msgsMarker
                val prevTop = lastTopId
                // Cheap freshness check: an unchanged tick returns a tiny
                // payload - no parse, no diff, no state write.
                val url =
                    if (m.isBlank()) "/api/conversations/$convId/messages"
                    else "/api/conversations/$convId/messages?marker=$m"
                // v3.9: only the request itself used to run off-Main. Parsing
                // the page (arr()/objects() rebuilds every bubble), the id diff
                // and the timestamp stamps all executed on the UI thread inside
                // this launch{} — that is where the "jank while someone is
                // typing" frames came from on long threads. The fetch stays on
                // IO, every bit of JSON work moves to Default, and Main keeps
                // only the state writes.
                val parsed =
                    withContext(Dispatchers.Default) {
                        val data = withContext(Dispatchers.IO) { Api.get(url, force = forceNetwork) }
                        if (data.optBoolean("unchanged")) null
                        else {
                            val fresh = data.arr("items").objects()
                            MsgPage(
                                marker = data.optString("marker"),
                                items = fresh,
                                topId = fresh.lastOrNull()?.optString("id") ?: "",
                                readAt = data.optString("readAt").takeIf { it.isNotBlank() },
                                typingAt =
                                    (runCatching {
                                            java.time.Instant.parse(data.optString("typingAt")).toEpochMilli()
                                        }
                                        .getOrNull()
                                        ?: 0L),
                                oldest = data.optJSONObject("oldest"),
                                hasMore = data.optBoolean("hasMore"),
                            )
                        }
                    }
                        ?: return@launch
                val fresh = parsed.items
                msgsMarker = parsed.marker
                // Live read receipts: the sender's ticks turn blue without
                // reopening the chat.
                parsed.readAt?.let { otherReadAt = it }
                if (parsed.typingAt > 0) otherTypingAt = parsed.typingAt
                val newTop = parsed.topId
                // §39: rows the user paged back to are not in the newest window, so
                // a plain rebuild would drop them on the next tick — scroll back two
                // pages, receive one message, watch the chat jump. They are carried
                // over (minus anything the window now contains, so no duplicates).
                val carried =
                    if (olderIds.isEmpty()) emptyList()
                    else {
                        val newest = fresh.mapTo(HashSet()) { it.optString("id") }
                        msgs.filter { it.optString("id") in olderIds && it.optString("id") !in newest }
                    }
                if (olderIds.isEmpty()) olderCursor = parsed.oldest
                hasMoreOlder = parsed.hasMore
                ScreenStore.setMsgs(convId, carried + fresh)
                paintFromStore()
                if (pending.isNotEmpty()) {
                    pending.removeAll { p ->
                        val cid = p.optString("clientId").ifBlank { "" }
                        cid.isNotBlank() && fresh.any { it.optString("clientId") == cid }
                    }
                    // A queued send the server refused for good (banned word,
                    // removed from the chat, over the length limit) never comes
                    // back as a server row, so without this the bubble sits on
                    // "sending" for the rest of the session.
                    // A refused send's text returns here (§20 counterpart of §11).
                    Outbox.takeDroppedBody(convId)?.let { lost ->
                        input = if (input.isBlank()) lost else "$input\n\n$lost"
                        Drafts.set(convId, input)
                    }
                    val refused = Outbox.droppedIds()
                    if (refused.isNotEmpty()) {
                        pending
                            .filter { it.optString("clientId") in refused && !it.optBoolean("failed") }
                            .forEach { it.put("failed", true).put("failedAt", System.currentTimeMillis()) }
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
                    // ...and the OS notification cards too (Owner round 4):
                    // reading live must shrink the number instantly, on every
                    // surface there is.
                    runCatching { KpNotify.cancelConversation(ctx, convId) }
                }
            } catch (_: Exception) {
            } finally {
                // First page landed (or failed) — the skeleton gives way.
                initialLoad = false
            }
        }
    }

    /* instant paint + first refresh */
    LaunchedEffect(convId) {
        KpCrash.mark("chat-open")
        Store.route = "chat/$convId"
        // A new chat is a new history window: paging state must not leak across.
        olderIds.clear()
        olderCursor = null
        hasMoreOlder = false
        paintFromStore()
        // §20: the draft comes back with the chat — but only into an empty
        // composer, so returning from a media picker never overwrites live typing.
        if (input.isBlank()) Drafts.of(convId).takeIf { it.isNotBlank() }?.let { input = it }
        if (ScreenStore.pendingChatSearch == convId) {
            ScreenStore.pendingChatSearch = null
            showChatSearch = true
        }
        KpCrash.mark("chat-paint:${msgs.size}")
        refreshMeta()
        refreshMessages(forceScroll = true, markRead = true)
        KpCrash.mark("chat-page:${msgs.size}")
        runCatching { Outbox.flushNow(force = true) }
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

    // v3.7 realtime: the chat socket delivers message/read/typing events the
    // instant they happen. The ticker below is a FALLBACK only: it forces a
    // refresh (a) right after the app returns to the foreground and (b) on a
    // 10s tick while the chat socket is DOWN.
    // v3.9: the third branch — a forced marker GET roughly every 3s even with
    // the socket alive — is gone. With the socket up it could only ever catch
    // a lost Durable-Object broadcast, and it paid for that with a round trip
    // every 3s for every open chat (plus a full parse, until the parsing move
    // above). A socket that actually reconnects syncs through its "hello"
    // event, and the FCM poke path refreshes unprompted, so the gap that
    // remains is one dropped broadcast inside an open, healthy chat.
    LaunchedEffect(convId) {
        KpSocket.joinChat(convId)
        val removeListener = KpSocket.onEvent { ev ->
            when (ev.optString("type")) {
                // (Re)connected: one catch-up sync covers anything missed.
                "hello" -> refreshMessages(forceNetwork = true)
                "message" ->
                    if (ev.optString("conversationId") == convId) {
                        // FAST PAINT: the WS "message" frame carries the FULL
                        // message object (msgFrom), so we drop the bubble into
                        // the thread instantly instead of waiting a GET round
                        // trip. The marker-gated reconcile below confirms order
                        // + advances the marker; if the fast-paint ever guessed
                        // wrong (a delete/our own echo racing in), the GET
                        // self-corrects. The worker skips the sender, so this
                        // is always SOMEONE ELSE's message (the recipient's own
                        // optimistic bubble lives in `pending`).
                        ev.optJSONObject("message")?.let { liveMsg ->
                            val liveId = liveMsg.optString("id")
                            val liveCid = liveMsg.optString("clientId")
                            val idxExisting = msgs.indexOfFirst { it.optString("id") == liveId }
                            when {
                                // Same id already present -> replace the row, never
                                // double it.
                                idxExisting >= 0 -> msgs[idxExisting] = liveMsg
                                liveCid.isNotBlank() && msgs.any { it.optString("clientId") == liveCid } ->
                                    msgs[msgs.indexOfFirst { it.optString("clientId") == liveCid }] = liveMsg
                                // New inbound message: chronological = append at the
                                // end (the thread is oldest-first).
                                else -> {
                                    msgs.add(liveMsg)
                                    // Our own optimistic bubble from a previous send
                                    // that the server just confirmed.
                                    pending.removeAll { it.optString("clientId") == liveCid }
                                }
                            }
                            ScreenStore.setMsgs(convId, msgs.toList())
                        }
                        // Viewed live with the chat open: the notification
                        // card for this conversation is already stale.
                        runCatching { KpNotify.cancelConversation(ctx, convId) }
                        if (msgSyncPending.compareAndSet(false, true)) {
                            scope.launch {
                                // Force the authoritative GET: a realtime event is
                                // proof the cached page is stale. Without this the
                                // recipient could show typing yet never paint the
                                // message body until reopening the thread.
                                delay(120)
                                msgSyncPending.set(false)
                                // Marker-gated: after the fast-paint above the
                                // marker has moved, so this returns the fresh
                                // page (which matches what we already painted, so
                                // the id-diff is a no-op) and advances the marker.
                                refreshMessages()
                            }
                        }
                    }
                // Receipt + typing events carry their payload — apply directly,
                // no marker GET. Delivery includes exact message ids so only
                // the bubbles fetched by the formerly-offline recipient flip.
                "delivered" ->
                    if (ev.optString("conversationId") == convId) {
                        val at = ev.optString("at")
                        val ids = ev.arr("messageIds")
                        val deliveredIds = buildSet {
                            for (i in 0 until ids.length()) add(ids.optString(i))
                        }
                        msgs.forEachIndexed { i, message ->
                            if (message.optString("id") in deliveredIds && message.optString("deliveredAt").isBlank()) {
                                msgs[i] = JSONObject(message.toString()).put("deliveredAt", at)
                            }
                        }
                    }
                // GROUPS are the exception: blue ticks mean EVERY member has
                // read (the server's MIN()/all-read rule). One member's read
                // frame must not flip them, so a group resyncs instead.
                "read" ->
                    if (
                        ev.optString("conversationId") == convId &&
                        ev.optString("userId") != Store.myId()
                    ) {
                        if (conv.value?.optBoolean("isGroup") == true) refreshMessages()
                        else
                            ev.optString("at").takeIf { it.isNotBlank() }?.let { at ->
                                if (at > (otherReadAt ?: "")) otherReadAt = at
                            }
                    }
                "typing" ->
                    if (
                        ev.optString("conversationId") == convId &&
                        ev.optString("userId") != Store.myId()
                    ) {
                        runCatching { java.time.Instant.parse(ev.optString("at")).toEpochMilli() }
                            .getOrNull()
                            ?.let { ms -> if (ms > 0) otherTypingAt = ms }
                    }
            }
        }
        var lastForeground = Store.foreground
        var lastFallbackRefresh = 0L
        var lastRejoin = 0L
        try {
            while (true) {
                delay(1_000)
                val fg = Store.foreground
                val justReturned = fg && !lastForeground
                lastForeground = fg
                if (!fg) continue
                val onScreen = Store.route == "chat/$convId"
                if (justReturned && onScreen) refreshMessages(forceNetwork = true)
                else if (onScreen) {
                    // Owner round 6: socket down used to mean messages up to
                    // 10s late ("realtime update late"). Two changes: the
                    // fallback poll runs every 3s, and the socket gets an
                    // active rejoin every 10s (a dead channel used to stay
                    // dead until the screen was reopened).
                    //
                    // Owner round 14: the poll only ran while chatLive() was
                    // false — but mobile networks leave HALF-OPEN sockets:
                    // no close frame ever arrives, live stays true, and the
                    // open chat silently stops updating ("reply arrives but
                    // the chat doesn't move"). Now a marker-gated poll also
                    // runs while the socket LOOKS connected (every 8s) as a
                    // safety net; it is near-free when nothing changed.
                    val now = System.currentTimeMillis()
                    val down = !KpSocket.chatLive(convId)
                    if (now - lastFallbackRefresh >= (if (down) 3_000L else 8_000L)) {
                        lastFallbackRefresh = now
                        refreshMessages(forceNetwork = true)
                    }
                    if (now - lastRejoin >= 10_000) {
                        lastRejoin = now
                        KpSocket.joinChat(convId)
                    }
                }
            }
        } finally {
            removeListener()
            KpSocket.leaveChat(convId)
            // Owner round 7: AI incognito mode — leaving the chat wipes the
            // session (best-effort, off the composable's cancelled scope).
            if (aiIncognito && convId.endsWith("_kp_ai_bot")) {
                Thread {
                    runCatching { Api.post("/api/conversations/$convId/reset", JSONObject()) }
                }.start()
            }
        }
    }

    /** Flags an optimistic bubble as failed so it stops pretending to upload. */
    fun markPendingFailed(clientId: String) {
        pending.find { it.optString("clientId") == clientId }
            ?.put("failed", true)
            ?.put("failedAt", System.currentTimeMillis())
    }

    /**
     * §39 "load older": one page back through the (created_at,rowid) cursor.
     *
     * Deliberately NOT Api.get(): a page would be written into the disk cache under
     * its own key, so scrolling back through a busy chat would leave dozens of
     * 50-message JSON files behind for no benefit — the merged list already lives in
     * ScreenStore, which is what paints offline.
     */
    fun loadOlder() {
        val cur = olderCursor ?: return
        if (!hasMoreOlder) return
        if (!loadingOlder.compareAndSet(false, true)) return
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) {
                    Api.request(
                        "/api/conversations/$convId/messages?before=" +
                            java.net.URLEncoder.encode(cur.optString("at"), "UTF-8") +
                            "&beforeRowid=" + cur.optLong("rowid"),
                        "GET",
                        null,
                    )
                }
                val page = data.arr("items").objects()
                val have = msgs.mapTo(HashSet()) { it.optString("id") }
                val freshOld =
                    page.filter {
                        it.optString("id") !in have && it.optString("id") !in ScreenStore.hiddenMsgIds
                    }
                if (freshOld.isNotEmpty()) {
                    olderIds.addAll(freshOld.map { it.optString("id") })
                    ScreenStore.setMsgs(convId, freshOld + msgs.toList())
                    paintFromStore()
                    // The list grew at the TOP by N rows; without this the viewport
                    // keeps the same index and the user is thrown N rows down.
                    listState.scrollToItem(freshOld.size)
                }
                hasMoreOlder = data.optBoolean("hasMore")
                data.optJSONObject("oldest")?.let { olderCursor = it }
            } catch (_: Exception) {
                // A failed page keeps hasMoreOlder true: the next scroll-up tries
                // again. Swallowing it is right — the visible history is unaffected.
            } finally {
                loadingOlder.set(false)
            }
        }
    }

    // Trigger: the user is at the top AND still dragging. Without the scroll flag
    // a settled list at index 0 would re-fire this on every recomposition.
    LaunchedEffect(convId) {
        snapshotFlow { listState.firstVisibleItemIndex to listState.isScrollInProgress }
            .collect { (idx, scrolling) -> if (idx == 0 && scrolling) loadOlder() }
    }

    // Owner round 13 (2026-09-05, fixed 13b): keyboard opening used to COVER
    // the latest messages. The first cut read WindowInsets.ime.getBottom()
    // inside a coroutine snapshotFlow — the exact pattern behind the known
    // "ViewTreeObserver is not alive" crash on navigation (chat open crash).
    // The official isImeVisible flag read IN composition + a keyed effect is
    // the safe form.
    // Owner round 13e: extracted to KpImeAutoScroll below — a local @OptIn
    // val inside this (huge) function produced a VerifyError on device ART.
    KpImeAutoScroll(listState)

    fun sendText(body: String, kind: String = "TEXT") {
        if (body.isBlank()) return
        val clientId = "c_${java.util.UUID.randomUUID()}"
        val payload = JSONObject().put("kind", kind).put("body", body).put("clientId", clientId)
        // Owner round 13: attach the quoted message when replying.
        replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }
        replyTo = null
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
            // Owner round 11: tap sound on the send itself…
            runCatching { KpSounds.send(ctx) }
            try {
                withContext(Dispatchers.IO) {
                    Api.post("/api/conversations/$convId/messages", payload)
                }
                // …and the owner's "sent" sound when the server accepted it.
                runCatching { KpSounds.sent(ctx) }
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                Outbox.add(convId, clientId, payload)
            }
            // The draft's job ends here, not at "server said ok": from now on the
            // text is owned by the server row or by the queue file (and if the
            // queue refuses it for good, that text comes back to the composer).
            Drafts.clear(convId)
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
            runCatching { KpSounds.send(ctx) }
            var shotW = 0
            var shotH = 0
            val jpeg = withContext(Dispatchers.IO) {
                val b64 = dataUrl.substringAfter(",", "")
                val bytes =
                    runCatching { android.util.Base64.decode(b64, android.util.Base64.DEFAULT) }.getOrNull()
                // Header-only read of the bytes we are about to send: this is what
                // the receiver needs to lay the bubble out at the photo's real
                // aspect ratio on its first frame (see mediaW/mediaH in the
                // worker's message shape). ~0.1 ms, and we are already on IO.
                if (bytes != null && bytes.isNotEmpty()) {
                    runCatching {
                        val opts =
                            android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                        shotW = opts.outWidth
                        shotH = opts.outHeight
                    }
                }
                bytes
            }
            if (jpeg == null || jpeg.isEmpty()) {
                error = "Could not read that photo."
                pending.find { it.optString("clientId") == clientId }?.put("failed", true)
                return@launch
            }
            // Our own bubble must not jump either: the true size is already known
            // before the first frame, so the pending row and the ratio cache both
            // get it here rather than waiting for a decode during composition.
            if (shotW > 0 && shotH > 0) {
                pending.find { it.optString("clientId") == clientId }?.put("mediaW", shotW)?.put("mediaH", shotH)
                ImageRatios.put(dataUrl, shotW.toFloat() / shotH.toFloat())
            }
            try {
                val up = withContext(Dispatchers.IO) {
                    Api.upload("photo.jpg", "image/jpeg", jpeg) { w, t -> UploadProgress.set(clientId, 0.9f * w / t) }
                }
                UploadProgress.set(clientId, 0.95f)
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
                if (shotW > 0 && shotH > 0) payload.put("meta", JSONObject().put("w", shotW).put("h", shotH))
                // The server is idempotent by clientId, so one automatic
                // retry after a dropped response/timeout is SAFE — it returns
                // the same message instead of failing the photo.
                try {
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                } catch (e: Exception) {
                    delay(1_500)
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                }
                UploadProgress.done(clientId)
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                try {
                    val small = if (dataUrl.length > 400_000) {
                        "data:image/jpeg;base64," + android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP)
                    } else dataUrl
                    val payload = JSONObject().put("kind", "IMAGE").put("imageData", small).put("clientId", clientId)
                    if (shotW > 0 && shotH > 0) payload.put("meta", JSONObject().put("w", shotW).put("h", shotH))
                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                    UploadProgress.done(clientId)
                    runCatching { KpSounds.sent(ctx) }
                    refreshMessages(forceScroll = true)
                } catch (e2: Exception) {
                    UploadProgress.done(clientId)
                    error = "Photo: " + ((e.message?.take(60) + " / ") ?: "") + (e2.message ?: "?") + "  Tap the banner to try again."
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
            runCatching { KpSounds.send(ctx) }
            try {
                val data = withContext(Dispatchers.IO) {
                    Api.upload(name, mime, bytes) { w, t -> UploadProgress.set(clientId, 0.9f * w / t) }
                }
                UploadProgress.set(clientId, 0.95f)
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
                UploadProgress.done(clientId)
                runCatching { KpSounds.sent(ctx) }
                refreshMessages(forceScroll = true)
            } catch (e: Exception) {
                // Before this the optimistic bubble stayed on screen forever
                // looking like it was still uploading: the POST never happened,
                // so no message with this clientId ever came back to match it.
                UploadProgress.done(clientId)
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
            runCatching { KpSounds.send(ctx) }
            try {
                val bytes = withContext(Dispatchers.IO) { file.readBytes() }
                val data = withContext(Dispatchers.IO) {
                    Api.upload(name, "audio/mp4", bytes) { w, t -> UploadProgress.set(clientId, 0.9f * w / t) }
                }
                UploadProgress.set(clientId, 0.95f)
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
                UploadProgress.done(clientId)
                runCatching { KpSounds.sent(ctx) }
                file.delete()
                refreshMessages(forceScroll = false)
            } catch (e: Exception) {
                UploadProgress.done(clientId)
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

    fun sendAttachSelection() {
        val batch = attachSel.toList()
        attachSel.clear()
        showAttach = false
        scope.launch {
            batch.forEach { item ->
                if (item.isVideo) handleDocumentPicked(item.uri) else handleImagePicked(item.uri)
            }
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
        // Mic is asked HERE — at the feature — not at app launch (owner rule).
        gateMicCamera(video = false) {
            if (!VoiceNote.isRecording) {
                if (VoiceNote.start(ctx)) {
                    recMs = 0
                    recording = true
                } else {
                    error = "Mic is not available. Check the mic permission."
                }
            }
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
            // Owner round 13: a sub-second tap is a slip, not an error —
            // cancel silently instead of scolding.
            VoiceNote.cancel()
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

    /**
     * WhatsApp-style resend: every selected media row (image/video/file)
     * is fetched from its mediaUrl and pushed through the normal send
     * pipeline, preserving selection order.
     */
    fun sendSelectedMedia() {
        val items = selectedMessages().filter {
            it.optString("kind") == "IMAGE" || it.optString("kind") == "FILE"
        }
        if (items.isEmpty()) return
        selected.clear()
        scope.launch {
            for (m in items) {
                val url = m.optString("mediaUrl")
                if (url.isBlank()) continue
                try {
                    val bytes = withContext(Dispatchers.IO) { Api.download(url) }
                    val name = url.substringAfterLast('/').ifBlank { "media.bin" }
                    val f = File(ctx.cacheDir, "resend_${System.currentTimeMillis()}_$name")
                    withContext(Dispatchers.IO) { f.writeBytes(bytes) }
                    val uri = Uri.fromFile(f)
                    val kind = m.optString("kind")
                    withContext(Dispatchers.Main) {
                        if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m))) {
                            handleImagePicked(uri)
                        } else {
                            handleDocumentPicked(uri)
                        }
                    }
                } catch (_: Exception) {
                }
            }
        }
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
    val otherUserId = c?.optJSONObject("other")?.optString("id") ?: ""
    // System accounts: full name in the header (no call buttons there, so
    // space is never a problem) and no call/block actions anywhere.
    val botChat = !isGroup && isKpBot(otherUserId)
    val rawTitle =
        if (isGroup) c?.optText("title")?.ifBlank { "Group" } ?: "…"
        else c?.optJSONObject("other")?.optText("displayName")?.ifBlank { "…" } ?: "…"
    // Long names collapse to the first word so the header always stays a
    // single line (the full name lives on the contact page) — except the
    // bot chats, whose header has no call buttons and always shows the
    // full name (owner rule).
    val title =
        if (botChat || isGroup) rawTitle
        else
            rawTitle.trim().split(Regex("\\s+")).dropWhile { w ->
                w.equals("MD", true) || w.equals("M.D", true) || w.equals("Md.", true) ||
                    w.equals("Mohammad", true) || w.equals("Muhammad", true) || w == "মোঃ"
            }.firstOrNull() ?: rawTitle
    val avatarUrl = if (isGroup) null else c?.optJSONObject("other")?.optIso("avatarUrl")
    // The ref is what makes the header paint without re-fetching: pass it too.
    val avatarRef = if (isGroup) null else c?.optJSONObject("other")?.optIso("avatarRef")
    val online = !isGroup && c?.optJSONObject("other")?.optBoolean("online") == true
    val verified = !isGroup && c?.optJSONObject("other")?.optBoolean("verified") == true
    val moderator = !isGroup && c?.optJSONObject("other")?.optBoolean("moderator") == true
    // Official notification account: one-way (owner rule) — no composer.
    val noReply = !isGroup && otherUserId == "kp_official_bot"
    // Recompose exactly when the six-second typing lease expires. Computing
    // directly from currentTimeMillis() left the label visible indefinitely
    // on an otherwise idle screen because time passing is not Compose state.
    var typingLeaseActive by remember { mutableStateOf(false) }
    LaunchedEffect(otherTypingAt, isGroup) {
        val remaining = 6_000L - (System.currentTimeMillis() - otherTypingAt)
        typingLeaseActive = !isGroup && remaining > 0
        if (typingLeaseActive) {
            delay(remaining)
            typingLeaseActive = false
        }
    }
    // KuchuPuchu AI typing (owner round 2026-09-04): the bot ALWAYS answers
    // the user's latest message (server-guaranteed, with a fallback reply),
    // so "the newest thing in the thread is MY message and it didn't fail"
    // is exactly "the AI is generating right now" — an in-thread typing
    // bubble plus the header label, until the reply lands.
    val isAiChat = !isGroup && otherUserId == "kp_ai_bot"
    val lastInThread = pending.lastOrNull() ?: msgs.lastOrNull()
    val aiTyping =
        isAiChat &&
            lastInThread != null &&
            !lastInThread.optBoolean("failed", false) &&
            lastInThread.optString("senderId") == Store.myId()

    // Owner round 16: starting a reply grows the quote bar + keyboard over
    // the newest rows — jump the thread up so nothing hides under them.
    LaunchedEffect(replyTo?.optString("id")) {
        if (replyTo != null) {
            delay(160)
            val total = listState.layoutInfo.totalItemsCount
            if (total > 0) listState.animateScrollToItem(total - 1)
        }
    }

    // A brand-new AI reply (created after open) types itself out word by word.
    LaunchedEffect(msgs.size) {
        val last = msgs.lastOrNull() ?: return@LaunchedEffect
        if (!convId.endsWith("_kp_ai_bot")) return@LaunchedEffect
        if (last.optString("senderId") != "kp_ai_bot" || last.optString("kind") != "TEXT") return@LaunchedEffect
        val mid = last.optString("id")
        if (mid == aiRevealId) return@LaunchedEffect
        val created =
            runCatching { java.time.Instant.parse(last.optString("createdAt")).toEpochMilli() }.getOrDefault(0L)
        if (created < chatOpenedAtMs) return@LaunchedEffect
        aiRevealChars = 0
        aiRevealId = mid
    }

    LaunchedEffect(aiRevealId) {
        val revealMid = aiRevealId ?: return@LaunchedEffect
        val body = msgs.lastOrNull { it.optString("id") == revealMid }?.optText("body").orEmpty()
        var pos = 0
        while (pos < body.length) {
            delay(if (body.length > 240) 30L else 45L)
            pos = body.indexOf(' ', pos + 1).takeIf { it >= 0 } ?: body.length
            aiRevealChars = pos
            // Stay pinned to the newest line while the reply types itself —
            // unless the user scrolled up to read (their scroll wins).
            val info = listState.layoutInfo
            val nearBottom =
                info.visibleItemsInfo.lastOrNull()?.index?.let { it >= info.totalItemsCount - 2 } == true
            if (nearBottom) listState.scrollToItem(info.totalItemsCount - 1)
        }
        delay(250)
        aiRevealId = null
    }
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
                    .background(chatWallpaper(chatTheme))
                    .padding(horizontal = 2.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { selected.clear() }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
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
                // Owner round 15: the header takes the chat's theme too —
                // a theme change now restyles header, wallpaper and bubbles.
                .background(chatWallpaper(chatTheme))
                // Owner round 7: the blank strip under the header is gone.
                .padding(horizontal = 4.dp, vertical = 0.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = {
                    Store.route = ""
                    player.stop()
                    nav.popBackStack()
                },
                // Material3's IconButton defaults to a 48dp touch target;
                // three/four of these sitting in one Row (back arrow, call,
                // video, more) was inflating the whole header's height well
                // past what the 40dp avatar + two lines of text actually
                // need — that's the "extra empty space under the header"
                // you were seeing. Pinned to match the visual icon size.
                modifier = Modifier.size(36.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
            }
            val otherId = c?.optJSONObject("other")?.optString("id") ?: ""
            Row(
                Modifier.weight(1f).clickable {
                    if (!isGroup && otherId.isNotBlank()) nav.navigate("profile/$otherId")
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
            KpAvatar(title, avatarUrl, 40.dp, avatarRef = avatarRef)
            Spacer(Modifier.width(10.dp))
            // Owner round 4 (2026-09-04): the name sits at the avatar's
            // middle. A draw-time offset (not padding!) moves the text block
            // down WITHOUT growing the header — so the last-seen line lands
            // right under the name and NO extra space appears at the bottom.
            Column(Modifier.weight(1f).offset(y = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (verified) {
                        Spacer(Modifier.width(5.dp))
                        VerifiedBadge()
                    }
                    if (moderator) {
                        Spacer(Modifier.width(5.dp))
                        ModeratorBadge()
                    }
                }
                Text(
                    when {
                        isGroup -> "${c?.arr("members")?.length() ?: 0} members"
                        botChat -> "Official account"
                        online -> "online"
                        else -> otherLastSeen(other?.optText("lastActiveAt"))
                    },
                    // Owner round 5: ONLY this subtitle line rises a touch —
                    // the name, the header height and everything else stay
                    // exactly where they are.
                    // Owner round 6: raised further (net back to the
                    // original line) — only this text moves.
                    modifier = Modifier.offset(y = (-6).dp),
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (online) Green else Muted,
                )
            }
            }
            if (!isGroup && c != null && !botChat) {
                if (otherId.isNotBlank()) {
                    HeaderCallBtn(onClick = {
                        gateMicCamera(video = false) {
                            CallEngine.instance?.startCall(otherId, "AUDIO", title, avatarUrl ?: "")
                        }
                    }) {
                        Icon(Icons.Filled.Call, "Voice call", tint = GoldDeep, modifier = Modifier.size(19.dp))
                    }
                    HeaderCallBtn(onClick = {
                        gateMicCamera(video = true) {
                            CallEngine.instance?.startCall(otherId, "VIDEO", title, avatarUrl ?: "")
                        }
                    }) {
                        Icon(Icons.Filled.Videocam, "Video call", tint = GoldDeep, modifier = Modifier.size(21.dp))
                    }
                }
            }
            // Owner round 7: the notifications bot carries NO options menu.
            if (otherUserId != "kp_official_bot") {
                Box {
                    IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Filled.MoreVert, "More", tint = Ink, modifier = Modifier.size(22.dp))
                    }
                    DropdownMenu(
                        expanded = menuOpen,
                        onDismissRequest = { menuOpen = false },
                        modifier = Modifier.background(Cream),
                    ) {
                    if (otherUserId == "kp_ai_bot") {
                        // Owner round 7: the AI chat's own menu, exactly six
                        // options — nothing else.
                        DropdownMenuItem(
                            text = { Text("History", color = Ink) },
                            leadingIcon = { Icon(Icons.Filled.Schedule, null, tint = GoldDeep) },
                            onClick = { menuOpen = false; nav.navigate("aihistory") },
                        )
                        DropdownMenuItem(
                            text = { Text("New chat", color = Ink) },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Chat, null, tint = GoldDeep) },
                            onClick = { menuOpen = false; resetAiSession() },
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    if (c?.optBoolean("muted") == true) "Unmute notifications" else "Mute notifications",
                                    color = Ink,
                                )
                            },
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
                                    val ok =
                                        runCatching {
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
                            text = { Text("Chat theme", color = Ink) },
                            leadingIcon = { Icon(Icons.Filled.Palette, null, tint = GoldDeep) },
                            onClick = { menuOpen = false; showTheme = true },
                        )
                        DropdownMenuItem(
                            text = {
                                Text(
                                    if (aiIncognito) "Close incognito mode" else "Incognito mode",
                                    color = Ink,
                                )
                            },
                            leadingIcon = {
                                Icon(Icons.Filled.VisibilityOff, null, tint = if (aiIncognito) GoldDeep else Muted)
                            },
                            onClick = {
                                menuOpen = false
                                if (aiIncognito) {
                                    // Close: the incognito run is archived and
                                    // the previous session comes BACK into the
                                    // chat (owner round 11).
                                    aiIncognito = false
                                    scope.launch {
                                        runCatching {
                                            withContext(Dispatchers.IO) {
                                                Api.post("/api/conversations/$convId/restore-latest", JSONObject())
                                            }
                                        }
                                        msgs.clear()
                                        pending.clear()
                                        olderIds.clear()
                                        olderCursor = null
                                        hasMoreOlder = false
                                        lastTopId = ""
                                        msgsMarker = ""
                                        ScreenStore.setMsgs(convId, emptyList())
                                        refreshMessages(forceNetwork = true, forceScroll = true)
                                    }
                                } else {
                                    // Open: archive the current session NOW and
                                    // start clean — nothing further is kept.
                                    aiIncognito = true
                                    resetAiSession()
                                }
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Search in chat", color = Ink) },
                            leadingIcon = { Icon(Icons.Filled.Search, null, tint = GoldDeep) },
                            onClick = { menuOpen = false; showChatSearch = true },
                        )
                    } else {
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
                        // Owner round 15: this opened the GLOBAL search —
                        // in a chat, search means THIS conversation.
                        text = { Text("Search in chat", color = Ink) },
                        leadingIcon = { Icon(Icons.Filled.Search, null, tint = GoldDeep) },
                        onClick = { menuOpen = false; showChatSearch = true },
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
        }
        }

        /* ---------------- message list on coin wallpaper ---------------- */
        Box(Modifier.weight(1f).fillMaxWidth()) {
            CoinWallpaper()
            /* ---------------- in-chat search (Owner round 14: moved to the
               TOP of the screen, floating over the messages, with a rounded
               pill input instead of a flat box strip) ---------------- */
            // Owner round 16: zIndex keeps the bar ABOVE the message list —
            // it was composited underneath, so taps landed on the messages.
            if (showChatSearch) Box(Modifier.align(Alignment.TopCenter).fillMaxWidth().zIndex(6f)) {
                ChatSearchSheet(
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
            }
            // Owner round 16: the skeleton AND "No messages yet" painted at
            // the same time — the empty state only makes sense once the first
            // page has actually landed.
            if (msgs.isEmpty() && pending.isEmpty() && !initialLoad) {
                Box(Modifier.align(Alignment.Center)) {
                    EmptyState(
                        icon = Icons.Filled.Mood,
                        title = "No messages yet",
                        note = "Say hi, send a sticker or a photo",
                    )
                }
            }
            // A retried send used to leave TWO server rows with the same
            // clientId; keys collide and the chat crashed on open ("Key ...
            // was already used"). Render only the first of any duplicate —
            // this also heals chats that already contain dup rows.
            // `derivedStateOf` (not a plain filter) so this list keeps its
            // IDENTITY across recompositions that don't actually touch `msgs`
            // (typing pings, read-receipt polls, header repaints, etc.) —
            // a fresh List every recomposition was defeating LazyColumn's
            // skip-unchanged-items optimisation and read as scroll jank.
            val visibleMsgs by remember {
                androidx.compose.runtime.derivedStateOf {
                    val seenKeys = HashSet<String>()
                    msgs.filter { m ->
                        val k = m.optString("clientId").ifBlank { m.optString("id") }
                        k.isNotBlank() && seenKeys.add(k)
                    }
                }
            }
            if (visibleMsgs.isEmpty() && pending.isEmpty() && initialLoad) {
                // Owner round 13: Facebook-feed style skeletons while the
                // first page loads — never a blank, silent screen.
                Column(Modifier.fillMaxSize().padding(10.dp)) {
                    // Owner round 14: ONE shared pulse for all skeleton rows
                    // (each row used to run its own infinite animation — that
                    // read as cold-open jank).
                    val sh = rememberShimmerAlpha()
                    repeat(7) { i ->
                        KpShimmerRow(alignedEnd = i % 3 == 2, widthDp = 150 + (i % 4) * 55, alpha = sh)
                    }
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
            ) {
                items(
                    visibleMsgs,
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
                            revealChars = if (m.optString("id") == aiRevealId) aiRevealChars else null,
                            onReply = { haptics.tap(); replyTo = it; replyFocusNonce++ },
                            onLongPress = { msg ->
                                // Select stays exactly as it was (owner: "thik
                                // ache") — the emoji bar is the EXTRA action.
                                if (msg.optString("kind") != "DELETED") reactionFor = msg
                            },
                            quoteFor = { rid -> (msgs + pending).firstOrNull { it.optString("id") == rid } },
                            onMessageOwner = { ownerId -> openChatWithUser(ownerId) },
                            theme = chatTheme,
                        )
                    }
                }
                items(
                    pending.filter { p ->
                        val cid = p.optString("clientId").ifBlank { p.optString("id") }
                        visibleMsgs.none { it.optString("clientId") == cid || it.optString("id") == cid }
                    },
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                ) { m ->
                    MessageRow(m, isGroup, Store.myId(), otherReadAt, player, pendingEcho = true, theme = chatTheme)
                }
                // Owner round 4: one pretty bouncing-dots bubble whenever
                // EITHER side is typing — the AI composing, or the other
                // person's typing lease (the header used to carry this).
                if (aiTyping || typingLeaseActive) {
                    item(key = "typing-bubble") { TypingBubble() }
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
                    .background(Red.copy(alpha = 0.14f))
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


        /* ---------------- reaction quick bar (Owner round 16) ----------------
           Long-press selects the message (unchanged) and raises this bar:
           five quick emojis + "+" for the full sheet. */
        reactionFor?.let { target ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 4.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Card)
                    .border(1.dp, Line, RoundedCornerShape(18.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                listOf("👍", "❤️", "😂", "😮", "😢").forEach { e ->
                    Text(
                        e,
                        fontSize = 22.sp,
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { applyReaction(target, e) }
                            .padding(6.dp),
                    )
                }
                Icon(
                    Icons.Filled.Add,
                    "More emojis",
                    tint = GoldDeep,
                    modifier = Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .clickable { showEmojiSheet = true }
                        .padding(4.dp),
                )
                IconButton(onClick = { reactionFor = null }, Modifier.size(28.dp)) {
                    Icon(Icons.Filled.Close, "Close reactions", tint = Muted, modifier = Modifier.size(16.dp))
                }
            }
        }
        if (showEmojiSheet && reactionFor != null) {
            EmojiSheetDialog { e -> reactionFor?.let { applyReaction(it, e) } }
        }

        /* ---------------- composer (doubles as the recording bar) ---------------- */
        ReplyQuoteBar(replyTo) { replyTo = null }
        if (noReply) {
            // Official security account: replies are off (owner rule).
            Text(
                "This account doesn't accept replies",
                fontSize = 12.sp,
                color = Muted,
                textAlign = TextAlign.Center,
                maxLines = 1,
                modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
            )
        } else {
        Composer(
            input = input,
            replyFocusNonce = replyFocusNonce,
            onInput = { v ->
                input = v
                Drafts.set(convId, v)
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
            micEnabled = !isAiChat,
            onFinishRecord = { cancelled -> finishRecording(cancelled) },
            selectCount = selected.size,
            onSendSelection = { sendSelectedMedia() },
            gridSelCount = attachSel.size,
            onSendGrid = { sendAttachSelection() },
        )
        }

        /* ---------------- inline panels — BELOW the message bar, WhatsApp
           style: the bar rides on top of the panel; the panel is NOT
           fullscreen until the user taps/swipes the handle up ---------------- */
        if (showAttach) {
            AttachPanel(
                sel = attachSel,
                onSendBatch = { sendAttachSelection() },
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
    replyFocusNonce: Int = 0,
    onInput: (String) -> Unit,
    onInputTap: () -> Unit = {},
    onAttach: () -> Unit,
    onSticker: () -> Unit,
    onSend: () -> Unit,
    recording: Boolean,
    recMs: Int,
    micEnabled: Boolean = true,
    onStartRecord: () -> Unit,
    onFinishRecord: (cancelled: Boolean) -> Unit,
    selectCount: Int = 0,
    onSendSelection: () -> Unit = {},
    gridSelCount: Int = 0,
    onSendGrid: () -> Unit = {},
) {
    // Attach/sticker MUST close the keyboard first — otherwise both the IME
    // and the inline panel push the composer up at once, which read as a
    // layout "jump" ("upore uthe jai") instead of a clean keyboard->panel swap.
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    // Owner round 15: reply → the composer grabs focus and the keyboard
    // opens by itself.
    val inputFocus = remember { androidx.compose.ui.focus.FocusRequester() }
    LaunchedEffect(replyFocusNonce) {
        if (replyFocusNonce > 0) {
            runCatching { inputFocus.requestFocus() }
            keyboard?.show()
        }
    }
    fun closeKeyboard() {
        keyboard?.hide()
        focusManager.clearFocus(force = true)
    }
    Row(
        Modifier
            .fillMaxWidth()
            // Owner round 15: the bar itself is TRANSPARENT — the themed
            // wallpaper (which spans the whole screen) shows through; only
            // the input pill and the send button keep their own surfaces.
            .imePadding()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!recording) {
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 38.dp)
                    .clip(RoundedCornerShape(19.dp))
                    .background(Card)
                    .padding(horizontal = 2.dp, vertical = 1.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.heightIn(min = 34.dp)) {
                    // WhatsApp order: stickers LEFT, attach RIGHT.
                    IconButton(
                        onClick = {
                            closeKeyboard()
                            onSticker()
                        },
                        Modifier.size(32.dp),
                    ) {
                        Icon(Icons.Filled.Mood, "Stickers", tint = GoldDeep, modifier = Modifier.size(20.dp))
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                        if (input.isEmpty()) {
                            // Same vertical padding as the BasicTextField below,
                            // otherwise the hint floats above where the typed
                            // text lands.
                            Text(
                                "Message",
                                color = Muted,
                                fontSize = 14.sp,
                                modifier = Modifier.padding(vertical = 6.dp),
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
                            textStyle = TextStyle(color = Ink, fontSize = 14.sp, lineHeight = 20.sp),
                            maxLines = 4,
                            interactionSource = inputInteraction,
                            // min height pinned to the placeholder's own line
                            // height so the bar can never shrink the instant
                            // you type the first character — before this,
                            // Text()'s and BasicTextField()'s empty-vs-typed
                            // line metrics differed by a hair and the whole
                            // composer visibly "chepe" (squeezed) on the
                            // empty -> typing transition.
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 20.dp)
                                .padding(vertical = 6.dp)
                                .focusRequester(inputFocus),
                        )
                    }
                    IconButton(
                        onClick = {
                            closeKeyboard()
                            onAttach()
                        },
                        Modifier.size(32.dp),
                    ) {
                        Icon(Icons.Filled.AttachFile, "Attach", tint = GoldDeep, modifier = Modifier.size(20.dp))
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
            /* live recording panel: timer + slide-to-cancel hint.
               Owner round 16: no card background — transparent like the bar. */
            Row(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PulsingDot()
                Spacer(Modifier.width(8.dp))
                Text(
                    "%d:%02d".format(recMs / 1000 / 60, recMs / 1000 % 60),
                    color = Ink,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.width(8.dp))
                Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, modifier = Modifier.weight(1f))
            }
        }
        Spacer(Modifier.width(6.dp))

        /* mic/send circle. Text typed OR media selected -> it's SEND;
           otherwise a HOLD button: press = record, slide = cancel. */
        if (!input.isBlank() || selectCount > 0 || gridSelCount > 0) {
            val sendInteraction = remember { MutableInteractionSource() }
            val sendPressed by sendInteraction.collectIsPressedAsState()
            Box(
                Modifier
                    .size(42.dp)
                    .pressScale(sendInteraction)
                    // Owner round 10: the send/mic circles carry the same 3D
                    // lift as the header call buttons now.
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Gold)
                    .clickable(
                        interactionSource = sendInteraction,
                        indication = null,
                    ) {
                        when {
                            input.isNotBlank() -> onSend()
                            gridSelCount > 0 -> onSendGrid()
                            else -> onSendSelection()
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = AmberInk,
                    modifier = Modifier.size(19.dp).scale(if (sendPressed) 0.9f else 1f),
                )
            }
        } else {
            HoldMicButton(
                recording = recording,
                enabled = micEnabled,
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
    enabled: Boolean = true,
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
            .size(42.dp)
            .offset { IntOffset((if (recording) animX else 0f).roundToInt(), 0) }
            // Owner round 16: still transparent, but with the 3D lift the
            // send circle has — a bare flat icon read as "still not 3D".
            .shadow(3.dp, CircleShape, ambientColor = Color(0x33000000), spotColor = Color(0x33000000))
            .clip(CircleShape)
            .alpha(if (enabled) 1f else 0.4f)
            // Owner round 14: the ring was transparent unless cancel was
            // armed — the owner read the bare icon as "no rounded border".
            .border(1.5.dp, if (cancelArmed) Red else GoldDeep, CircleShape)
            .pointerInput(enabled) {
                awaitEachGesture {
                    if (!enabled) return@awaitEachGesture
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
            tint = if (!enabled) Muted else if (cancelArmed) Red else GoldDeep,
            modifier = Modifier.size(20.dp),
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
/**
 * url → the photo's aspect ratio: in memory AND on disk.
 *
 * The map has to outlive two things. A LazyColumn disposes off-screen items, so a
 * `remember` alone threw the ratio away on every scroll-out and the bubble snapped
 * back to the placeholder size while flinging ("images jump while scrolling").
 * And an in-memory-only map died with the process, so the FIRST scroll after a
 * cold start re-snapped every photo — each snap a re-layout of the whole visible
 * list. That is a large part of "first scroll laggy, second one smooth".
 *
 * Ratios are a few bytes per url, immutable per url, and worthless to lose, so
 * they are persisted (capped, access-ordered, written off the main thread in
 * coalesced batches).
 */
internal object ImageRatios {
    private const val MAX = 8000
    private val map = object : LinkedHashMap<String, Float>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Float>) = size > MAX
    }
    private var file: java.io.File? = null

    /** Until the file has been read, a save would CLOBBER history with a partial map. */
    @Volatile private var loaded = false

    /** Puts that landed before the read finished still have to reach the file. */
    @Volatile private var missedSave = false
    private var scheduled = false
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    /** Called off the main thread (see Cache.init) — it reads and writes files. */
    fun init(ctx: android.content.Context) {
        val f = java.io.File(ctx.filesDir, "kp-ratios.json")
        file = f
        if (loaded) return
        runCatching {
            if (f.exists()) {
                val o = JSONObject(f.readText())
                val keys = o.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = o.optDouble(k, 0.0)
                    if (v > 0.0) map[k] = v.toFloat()
                }
            }
        }
        loaded = true
        if (missedSave) {
            missedSave = false
            scheduleSave()
        }
    }

    fun get(url: String?): Float {
        if (url == null) return 0f
        synchronized(map) { return map[url] ?: 0f }
    }

    fun put(url: String?, ratio: Float): Float {
        if (url == null || ratio <= 0f || ratio.isNaN() || ratio.isInfinite()) return ratio
        synchronized(map) { map[url] = ratio }
        if (!loaded) missedSave = true else scheduleSave()
        return ratio
    }

    /** Many rows entering view at once produce ONE write, off the UI thread. */
    private fun scheduleSave() {
        if (!loaded) return
        synchronized(map) {
            if (scheduled) return
            scheduled = true
        }
        main.postDelayed({
            val snapshot = synchronized(map) {
                scheduled = false
                HashMap(map)
            }
            val f = file ?: return@postDelayed
            Thread {
                runCatching {
                    val o = JSONObject()
                    snapshot.forEach { (k, v) -> o.put(k, v.toDouble()) }
                    val tmp = java.io.File(f.parentFile, f.name + ".tmp")
                    java.io.FileOutputStream(tmp).use { it.write(o.toString().toByteArray()) }
                    if (!tmp.renameTo(f)) runCatching { tmp.delete() }
                }
            }
                .apply {
                    isDaemon = true
                    priority = Thread.MIN_PRIORITY
                    start()
                }
        }, 1200)
    }
}

/** Just the time — "3:17 am" today, "yesterday 11:10 pm", then "12 Aug" —
 *  always in Bangladesh Standard Time (owner rule). */
private fun otherLastSeen(iso: String?): String {
    if (iso.isNullOrBlank()) return " "
    val t = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return " "
    val z = atDhaka(t)
    val now = dhakaNow()
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
            shape = RoundedCornerShape(14.dp),
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
    // Owner round 14: forward was a cramped popup with mismatched colors —
    // now a FULLSCREEN picker sheet: back arrow header, themed background,
    // the whole conversation list to pick from.
    val convs = ScreenStore.convs
    androidx.activity.compose.BackHandler { onClose() }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Cream)
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding(),
        ) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onClose) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.size(26.dp))
                }
                Text("Forward to", color = Ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            }
            Text(
                "${convs.size} chats",
                color = Muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            Spacer(Modifier.height(6.dp))
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (convs.isEmpty()) {
                    item { Text("No chats yet.", color = Muted, fontSize = 14.sp, modifier = Modifier.padding(16.dp)) }
                }
                items(convs, key = { it.optString("id") }) { c ->
                    val isGroup = c.optBoolean("isGroup")
                    val other = c.optJSONObject("other")
                    val name =
                        if (isGroup) c.optText("title").ifBlank { "Group" }
                        else other?.optText("displayName")?.ifBlank { "Chat" } ?: "Chat"
                    val avatarUrl = if (isGroup) null else other?.optIso("avatarUrl")
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Card)
                            .border(1.dp, Line, RoundedCornerShape(14.dp))
                            .clickable { onPick(c.optString("id")) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        KpAvatar(
                            name,
                            avatarUrl,
                            44.dp,
                            avatarRef = if (isGroup) null else other?.optIso("avatarRef"),
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/** Snapshot of a chat list row → a pseudo conversation object for instant paint. */
private fun convRowSnapshot(convId: String): JSONObject? {
    val row = ScreenStore.convs.firstOrNull { it.optString("id") == convId } ?: return null
    val other = JSONObject()
        .put("id", row.optJSONObject("other")?.optString("id") ?: "")
        .put("displayName", row.optJSONObject("other")?.optText("displayName") ?: "")
        .put("avatarUrl", row.optJSONObject("other")?.optIso("avatarUrl").orEmpty())
        // The snapshot is built from a LIGHT chat-list row, so the photo itself is
        // not there — without the ref the header had nothing to resolve and the
        // avatar only appeared after the conversation fetch (the reload flash).
        .put("avatarRef", row.optJSONObject("other")?.optIso("avatarRef").orEmpty())
        .put("online", row.optJSONObject("other")?.optBoolean("online") ?: false)
    return JSONObject()
        .put("id", convId)
        .put("isGroup", row.optBoolean("isGroup"))
        .put("title", row.optString("title"))
        .put("other", other)
}

/* ------------------------------------------------------------------ */

/**
 * Phone auth §14 (owner design): new-device login approval arrives as a chat
 * message from the official "KuchuPuchu" account — details + Accept/Decline
 * live ON the message. The buttons call the same authenticated endpoints the
 * worker gates; after answering, the card freezes to its outcome (which the
 * worker also stamps into the message meta for other clients).
 */
@Composable
private fun LoginApprovalMessage(m: JSONObject) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val meta = m.optJSONObject("meta") ?: JSONObject()
    // Owner round 3 (2026-09-04): buttons live exactly as long as the
    // request does (5 minutes) and a decision sticks for the whole app
    // session (ScreenStore) — Accept/Decline never come back once answered
    // or expired.
    val requestId = meta.optString("requestId")
    val expired = runCatching {
        java.time.Instant.parse(m.optText("createdAt")).plusSeconds(300).isBefore(java.time.Instant.now())
    }.getOrDefault(true)
    var status by remember(m.optString("id")) {
        mutableStateOf(
            ScreenStore.loginApprovals[requestId]
                ?: if (meta.optString("status", "PENDING") == "PENDING" && expired) "EXPIRED"
                else meta.optString("status", "PENDING"),
        )
    }
    var busy by remember(m.optString("id")) { mutableStateOf(false) }
    val device = meta.optString("deviceName").takeIf { it.isNotBlank() } ?: "Another device"
    // Attempt time in Bangladesh Standard Time (owner rule) — the raw UTC
    // string it replaced read as gibberish to everyone.
    val time = runCatching {
        val z = atDhaka(java.time.Instant.parse(m.optText("createdAt")))
        String.format(
            "%d:%02d %s",
            (z.hour % 12).let { if (it == 0) 12 else it },
            z.minute,
            if (z.hour >= 12) "PM" else "AM",
        )
    }.getOrDefault("")
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(GoldSoft)
            .border(
                androidx.compose.foundation.BorderStroke(1.dp, Color(0x33F59E0B)),
                RoundedCornerShape(14.dp),
            )
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(26.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Gold),
                contentAlignment = Alignment.Center,
            ) {
                Text("K", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            Spacer(Modifier.width(8.dp))
            Column {
                Text("KuchuPuchu · Security", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = GoldDeep)
                Text(time + " · Bangladesh time", fontSize = 10.sp, color = Muted, maxLines = 1)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("New sign-in attempt", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(
            "Device: $device wants to sign in to your account with your phone number.",
            fontSize = 12.sp,
            color = Ink,
        )
        // Full origin details (owner rule): where the attempt came from.
        val ip = meta.optString("ip").takeIf { it.isNotBlank() && it != "unknown" }
        val city = meta.optString("city").takeIf { it.isNotBlank() }
        val country = meta.optString("country").takeIf { it.isNotBlank() }
        val place = listOfNotNull(city, country).joinToString(", ")
        if (place.isNotBlank()) {
            Text("Location: $place", fontSize = 12.sp, color = Ink)
        }
        if (ip != null) {
            Text("IP: $ip", fontSize = 12.sp, color = Ink)
        }
        Spacer(Modifier.height(8.dp))
        if (status == "PENDING") {
            Row {
                androidx.compose.material3.Button(
                    onClick = {
                        if (busy) return@Button
                        busy = true
                        Thread {
                            val ok = runCatching {
                                Api.post("/api/auth/login/approve", JSONObject().put("id", meta.optString("requestId")))
                            }.isSuccess
                            if (ok) {
                                ScreenStore.loginApprovals[requestId] = "APPROVED"
                                status = "APPROVED"
                            } else {
                                busy = false
                            }
                        }.start()
                    },
                    enabled = !busy,
                    shape = RoundedCornerShape(10.dp),
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color.White),
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Accept", maxLines = 1, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.width(8.dp))
                androidx.compose.material3.Button(
                    onClick = {
                        if (busy) return@Button
                        busy = true
                        Thread {
                            val ok = runCatching {
                                Api.post("/api/auth/login/decline", JSONObject().put("id", meta.optString("requestId")))
                            }.isSuccess
                            if (ok) {
                                ScreenStore.loginApprovals[requestId] = "DECLINED"
                                status = "DECLINED"
                            } else {
                                busy = false
                            }
                        }.start()
                    },
                    enabled = !busy,
                    shape = RoundedCornerShape(10.dp),
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Red),
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Decline", maxLines = 1, fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            val (label, color) = when (status) {
                "APPROVED" -> "Approved — new device signed in" to Color(0xFF16A34A)
                "DECLINED" -> "⛔ Declined" to Red
                else -> "⏰ Expired" to Muted
            }
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color, maxLines = 1)
        }
    }
}

/**
 * Owner round 13e (2026-09-05): keyboard-open auto-jump extracted from the
 * ChatScreen body. The inline `@OptIn val` inside that huge function made the
 * device's ART verifier reject the whole class (VerifyError: copy-cat) — the
 * chat screen died on open. Small function, annotation at function level.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun KpImeAutoScroll(listState: androidx.compose.foundation.lazy.LazyListState) {
    val imeVisible = WindowInsets.isImeVisible
    LaunchedEffect(imeVisible) {
        if (imeVisible) {
            delay(250)
            val total = listState.layoutInfo.totalItemsCount
            if (total > 0) listState.animateScrollToItem(total - 1)
        }
    }
}

/** Owner round 13e: the swipe-reply quote bar above the composer. */
@Composable
private fun ReplyQuoteBar(replyTo: JSONObject?, onCancel: () -> Unit) {
    if (replyTo == null) return
    // Owner round 16: the old GoldSoft card + Muted text was unreadable —
    // a card surface with a gold bar and full-ink text.
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Card)
            .border(1.dp, Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .height(30.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Gold),
        )
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (replyTo.optString("senderId") == Store.myId()) "You"
                else (replyTo.optText("senderName") ?: "").ifBlank { "Reply" },
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                color = GoldDeep,
                maxLines = 1,
            )
            Text(
                ((replyTo.optText("body") ?: "").ifBlank { "Media message" }).take(80),
                fontSize = 12.sp,
                color = Ink,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onCancel, modifier = Modifier.size(28.dp)) {
            Icon(Icons.Filled.Close, "Cancel reply", tint = Muted, modifier = Modifier.size(16.dp))
        }
    }
}

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
    revealChars: Int? = null,
    onMessageOwner: (String) -> Unit = {},
    onReply: (JSONObject) -> Unit = {},
    onLongPress: (JSONObject) -> Unit = {},
    quoteFor: (String) -> JSONObject? = { null },
    theme: String = "default",
) {
    val mine = m.optString("senderId") == myId
    val kind = m.optString("kind")
    // Owner round 15: the night theme's other-bubble is dark in BOTH app
    // themes — its text needs a light ink or it vanishes in light mode.
    val bodyInk = if (!mine && theme == "night") Color(0xFFE6EAF2) else Ink
    val stampInk = if (!mine && theme == "night") Color(0xFFA9B4CC) else Muted
    val isSelected = m.optString("id") in selectedIds
    val haptics = rememberHaptics()

    if (kind == "LOGIN_APPROVAL") {
        LoginApprovalMessage(m)
        return
    }
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
    // The owner profile card (dropped in by the worker right after the AI
    // answers an owner-identity question): tappable socials/email/website +
    // a direct-message button that opens the owner's chat.
    if (kind == "OWNER_CARD") {
        OwnerCardBubble(m, onMessageOwner)
        return
    }
    // Photos skip the chat bubble entirely: the image IS the bubble, with the
    // timestamp and ticks overlaid on the photo (WhatsApp-style). FILE-kind
    // image uploads (picked as documents) get the same treatment.
    if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m))) {
        ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onReply, onLongPress)
        return
    }

    // Owner round 13: hold-drag a bubble RIGHT to quote-reply. The offset
    // follows the finger up to ~65dp; past 36dp on release it arms the reply.
    // Owner round 16: OWN messages arm the same way to the LEFT.
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "replydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            // Owner round 2026-09-04: long bodies used to flatten at 280dp.
            // The bubble now stretches with the screen (82% of it, floored at
            // the old 280 and capped at 420 for tablets) so the right side
            // uses as much room as there actually is.
            val bubbleMax =
                maxOf(280.dp, minOf(420.dp, (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.82f).dp))
            val bubbleShape =
                RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (mine) 16.dp else 5.dp,
                    bottomEnd = if (mine) 5.dp else 16.dp,
                )
            Box(
                Modifier
                    .offset { IntOffset(replyOffset.roundToInt(), 0) }
                    // Owner round 13b: the hand-rolled awaitEachGesture fought
                    // the list's vertical scrolling (jank + crash on device).
                    // detectHorizontalDragGestures waits for clear horizontal
                    // intent (touch slop) before consuming, so chat scrolling
                    // stays smooth and the reply swipe still works.
                    .pointerInput(m.optString("id")) {
                        detectHorizontalDragGestures(
                            onHorizontalDrag = { change, dragAmount ->
                                change.consume()
                                // Owner round 16: own messages reply by dragging
                                // LEFT; other people's by dragging right.
                                replyDrag =
                                    if (mine) {
                                        (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.8f, 0f)
                                    } else {
                                        (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.8f)
                                    }
                            },
                            onDragEnd = {
                                val armed = kotlin.math.abs(replyDrag) >= replyThreshold
                                replyDrag = 0f
                                if (armed) onReply(m)
                            },
                            onDragCancel = { replyDrag = 0f },
                        )
                    }
                    .widthIn(min = 72.dp, max = bubbleMax)
                    .wrapContentWidth()
                    // Owner round 10: the same soft 3D lift the call buttons
                    // have — bubbles float on the wallpaper now.
                    .shadow(2.dp, bubbleShape)
                    .clip(bubbleShape)
                    .background(
                        when {
                            // Deleted tombstones sit in a flat, greyed bubble.
                            m.optString("kind") == "DELETED" ->
                                Brush.linearGradient(listOf(Color(0xFFB9B3A9), Color(0xFFB9B3A9)))
                            // Owner round 14: the chat theme now restyles the
                            // bubbles, not just the wallpaper.
                            mine -> chatMineFill(theme)
                            else -> chatOtherFill(theme)
                        },
                    )
                    .combinedClickable(
                        onClick = { if (selectedIds.isNotEmpty() && !pendingEcho) onToggleSelect(m) },
                        onLongClick = {
                            if (!pendingEcho) {
                                haptics.tap()
                                onToggleSelect(m)
                                onLongPress(m)
                            }
                        },
                    )
                    // Owner round 13: TEXT bubbles reserve the stamp's width
                    // INLINE (trailing non-breaking spaces glued to the last
                    // word — the WhatsApp trick), so the overlay can never
                    // overlap a glyph and never leaves a blank strip under
                    // the text. Other kinds keep the small bottom band.
                    .padding(start = 10.dp, top = 4.dp, end = 8.dp, bottom = if (kind == "TEXT") 0.dp else 15.dp),
            ) {
                val senderName = m.optText("senderName")
                Column {
                    // Owner round 13: quoted original when this is a reply.
                    m.optString("replyTo").takeIf { it.isNotBlank() }?.let { rid ->
                        val q = quoteFor(rid)
                        Row(
                            Modifier
                                .padding(bottom = 3.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (mine) Color(0x26FFFFFF) else GoldSoft)
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        ) {
                            Box(Modifier.width(2.5.dp).height(26.dp).clip(RoundedCornerShape(2.dp)).background(Gold))
                            Spacer(Modifier.width(6.dp))
                            Column {
                                Text(
                                    if (q?.optString("senderId") == myId) "You"
                                    else (q?.optText("senderName") ?: "").ifBlank { "Original message" },
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = GoldDeep,
                                    maxLines = 1,
                                )
                                Text(
                                    q?.optText("body")?.take(64)?.ifBlank { "Original message" } ?: "Original message",
                                    fontSize = 11.sp,
                                    // Owner round 16: full ink, not muted — the quote
                                    // has to stay readable on every themed bubble.
                                    color = if (mine) Color(0xE6FFFFFF) else Ink,
                                    maxLines = 1,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    if (!mine && isGroup && senderName.isNotBlank()) {
                        Text(senderName, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = GoldDeep)
                    }
                    when (kind) {
                        "STICKER" -> {
                            val st = m.optString("body")
                            if (EmojiRepo.isCustomId(st)) CustomEmojiOrFallback(st)
                            else Text(st, fontSize = 56.sp)
                        }
                        "FILE" -> FileBubble(m, mine, player, pendingEcho)
                        "DELETED" -> Text(
                            "This message was deleted",
                            fontSize = 13.5.sp,
                            fontStyle = FontStyle.Italic,
                            color = Color(0xFF4A463F),
                        )
                        else -> {
                            //   runs glue to the last word, so the stamp's
                            // spot travels WITH the final line — no separate
                            // line, no overlap, no drifting left.
                            val reserve = if (mine) "                 " else "            "
                            val full = m.optText("body") + (if (m.optBoolean("edited")) "  (edited)" else "") + reserve
                            if (revealChars != null && revealChars < full.length) {
                                // The AI reply is still typing itself out —
                                // reveal up to the current word + a caret.
                                Text(
                                    full.take(revealChars) + " ▍",
                                    fontSize = 14.5.sp,
                                    lineHeight = 19.sp,
                                    color = bodyInk,
                                )
                            } else {
                                Text(full, fontSize = 14.5.sp, lineHeight = 19.sp, color = bodyInk)
                            }
                        }
                    }
                }
                // Owner round 12: one pinned stamp row for every bubble,
                // directly in the Box scope — it sits in the reserved bottom
                // band (TEXT) or over the bottom edge (photos keep their
                // scrim), always at the bottom-END corner, never on its own
                // text line.
                Row(
                    Modifier.align(Alignment.BottomEnd).padding(end = 2.dp, bottom = if (kind == "TEXT") 3.dp else 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        msgStamp(m.optString("createdAt")),
                        fontSize = 10.sp,
                        color = if (mine) Color(0xD9FFFFFF) else stampInk,
                    )
                    if (mine) {
                        Spacer(Modifier.width(3.dp))
                        TickIcon(m, pendingEcho, otherReadAt)
                    }
                }
            }
            // Owner round 16: reaction chips under the bubble.
            MessageReactions(m)
        }
    }
}

/** Owner round 16: the reaction chips under a bubble — emoji + count, own
 *  reaction highlighted gold. reactions live in message meta.reactions. */
@Composable
private fun MessageReactions(m: JSONObject) {
    val reactions = m.optJSONObject("meta")?.optJSONObject("reactions") ?: return
    val myId = Store.myId()
    val grouped = LinkedHashMap<String, Int>()
    var iHave = false
    val ks = reactions.keys()
    while (ks.hasNext()) {
        val k = ks.next()
        val e = reactions.optString(k)
        if (e.isBlank()) continue
        grouped[e] = (grouped[e] ?: 0) + 1
        if (k == myId) iHave = true
    }
    if (grouped.isEmpty()) return
    Row(
        Modifier.padding(start = 6.dp, top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        grouped.forEach { (emoji, count) ->
            Row(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (iHave) GoldSoft else Card)
                    .border(1.dp, if (iHave) Gold else Line, RoundedCornerShape(10.dp))
                    .padding(horizontal = 6.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(emoji, fontSize = 12.sp)
                if (count > 1) {
                    Spacer(Modifier.width(3.dp))
                    Text("$count", fontSize = 10.sp, color = Muted)
                }
            }
        }
    }
}

/** Owner round 16: the full reaction sheet — a compact grid of everyday
 *  emojis (the "+" in the quick bar opens this). */
@Composable
private fun EmojiSheetDialog(onPick: (String) -> Unit) {
    val emojis = listOf(
        "👍", "👎", "❤️", "🩷", "😂", "🥰", "😮", "😢", "😡", "🙏",
        "🔥", "🎉", "😍", "😭", "😅", "🤔", "💯", "👏", "🤝", "😎",
        "🥳", "😴", "🤯", "😱", "🤗", "😇", "😉", "🤫", "🤝", "✌️",
        "🙏", "💪", "🌟", "⭐", "❤️‍🔥", "😊", "🙃", "😌", "😬", "🫡",
    )
    AlertDialog(
        onDismissRequest = { onPick("") },
        containerColor = Card,
        title = { Text("React", color = Ink) },
        text = {
            // A simple grid of tappable emojis.
            Column {
                emojis.chunked(5).forEach { row ->
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        row.forEach { e ->
                            Text(
                                e,
                                fontSize = 24.sp,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .clickable { onPick(e) }
                                    .padding(6.dp),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onPick("") }) { Text("Close", color = GoldDeep) }
        },
    )
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
    onReply: (JSONObject) -> Unit = {},
    onLongPress: (JSONObject) -> Unit = {},
) {
    val haptics = rememberHaptics()
    // Owner round 16: photos reply with the same drag as text bubbles —
    // right for other people's, LEFT for your own.
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "imgreplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            Modifier
                .offset { IntOffset(replyOffset.roundToInt(), 0) }
                .widthIn(max = 225.dp)
                // Owner round 10: photos float too — 3D lift + the round-8
                // thin border.
                .shadow(2.dp, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp))
                // Owner round 8/16: thin photo border — gray-BLUE on dark-blue,
                // gray-BLACK on cream, so the frame matches the app theme.
                .border(
                    1.dp,
                    if (KpThemeMode.darkBlue) Color(0x668091AC) else Color(0x66444444),
                    RoundedCornerShape(12.dp),
                )
                .pointerInput(m.optString("id")) {
                    detectHorizontalDragGestures(
                        onHorizontalDrag = { change, dragAmount ->
                            change.consume()
                            replyDrag =
                                if (mine) {
                                    (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.8f, 0f)
                                } else {
                                    (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.8f)
                                }
                        },
                        onDragEnd = {
                            val armed = kotlin.math.abs(replyDrag) >= replyThreshold
                            replyDrag = 0f
                            if (armed) onReply(m)
                        },
                        onDragCancel = { replyDrag = 0f },
                    )
                }
                .combinedClickable(
                    onClick = {
                        if (pendingEcho) return@combinedClickable
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onOpenImage(m)
                    },
                    onLongClick = {
                        if (!pendingEcho) {
                            haptics.tap()
                            onToggleSelect(m)
                            onLongPress(m)
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

/**
 * Live upload fractions keyed by message clientId — bubbles read this to draw
 * a real progress ring ("kototuku send hoyeche") instead of a blind spinner.
 */
object UploadProgress {
    val fracs = androidx.compose.runtime.mutableStateMapOf<String, Float>()

    fun set(id: String, f: Float) {
        if (f >= 1f) return
        fracs[id] = f
    }

    fun done(id: String) {
        fracs.remove(id)
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
    // Frame one, not frame ten: a fresh message carries the photo's dimensions
    // (mediaW/mediaH), so even a photo that has never been seen on this device
    // gets its true box before any byte is fetched. Discovering the ratio from a
    // decode is what previously resized the row mid-scroll.
    val fromPayload = run {
        val pw = m.optInt("mediaW")
        val ph = m.optInt("mediaH")
        if (pw > 0 && ph > 0) pw.toFloat() / ph.toFloat() else 0f
    }
    var ratio by remember(url) {
        mutableStateOf(
            ImageRatios.get(url).takeIf { it > 0f }
                ?: fromPayload.takeIf { it > 0f }?.let { ImageRatios.put(url, it) }
                ?: 0f,
        )
    }
    val dataBmp = if (url?.startsWith("data:") == true) rememberBitmap(url) else null
    Box(
        Modifier
            .widthIn(max = 225.dp)
            .then(
                if (ratio > 0f) {
                    Modifier
                        .aspectRatio(ratio)
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
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
            )
        } else {
            val imageContext = LocalContext.current
            val imageRequest = remember(url) {
                coil.request.ImageRequest.Builder(imageContext)
                    .data(if (url.startsWith("http")) url else Api.BASE + url)
                    .crossfade(false)
                    .size(720)
                    .build()
            }
            coil.compose.AsyncImage(
                model = imageRequest,
                contentDescription = "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                onSuccess = { state ->
                    val d = state.result.drawable
                    if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0 && ratio <= 0f) {
                        ratio = ImageRatios.put(url, d.intrinsicWidth.toFloat() / d.intrinsicHeight.toFloat())
                    }
                },
            )
        }
        // Determinate ring while THIS photo is still uploading — the user sees
        // exactly how much has left, not a spinner that could mean anything.
        val upFrac = UploadProgress.fracs[m.optString("clientId")]
        if (upFrac != null) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0x59000000)),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(
                        progress = { upFrac },
                        color = Color.White,
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(42.dp),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text("${(upFrac * 100).toInt()}%", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun FileBubble(m: JSONObject, mine: Boolean, player: VoicePlayer, pendingEcho: Boolean = false) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = m.optString("id")
    val fileName = m.optString("fileName").ifBlank { "File" }
    val fileType = m.optString("fileType")
    // fileKey OR mediaUrl — older messages only carry mediaUrl; without this
    // fallback those rows were silent dead taps ("kichui hoi na").
    val fileKey =
        m.optText("fileKey").takeIf { it.isNotBlank() }
            ?: m.optText("mediaUrl").takeIf { it.startsWith("/") || it.startsWith("http") } ?: ""
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
                val vFrac = UploadProgress.fracs[m.optString("clientId")]
                Text(
                    when {
                        vFrac != null -> "Sending · ${(vFrac * 100).toInt()}%"
                        secs > 0 -> "%d:%02d".format(secs / 60, secs % 60)
                        pendingEcho -> "Sending…"
                        else -> FilesUtil.displaySize(m.optInt("fileSize"))
                    },
                    fontSize = 11.sp,
                    color = if (mine) Color(0x99FFFFFF) else Muted,
                )
            }
        }
        return
    }

    // Documents: the WHOLE row opens (not just a tiny "Open" button), with a
    // spinner while downloading and a toast if it fails — the old version
    // swallowed every error in runCatching, so a failed download looked like
    // a dead button ("open korte parche na").
    var opening by remember { mutableStateOf(false) }
    // Text-like docs open INSIDE the app — most phones have no .md viewer,
    // which made "Open" feel dead for exactly these files.
    var textDoc by remember { mutableStateOf<String?>(null) }
    val ready = fileKey.isNotBlank()
    fun isTextLike(): Boolean {
        val n = fileName.lowercase()
        return fileType.startsWith("text/") || fileType == "application/json" ||
            n.endsWith(".md") || n.endsWith(".txt") || n.endsWith(".json") ||
            n.endsWith(".csv") || n.endsWith(".log") || n.endsWith(".kt") ||
            n.endsWith(".js") || n.endsWith(".ts") || n.endsWith(".py") ||
            n.endsWith(".html") || n.endsWith(".css")
    }
    val upFrac = UploadProgress.fracs[m.optString("clientId")]
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier
                .width(200.dp) // fixed width so the bubble never grows/shrinks on tap
                .clickable(enabled = !opening) {
                    if (!ready) {
                        android.widget.Toast.makeText(ctx, "This file is no longer available.", android.widget.Toast.LENGTH_SHORT).show()
                        return@clickable
                    }
                    scope.launch {
                        opening = true
                        try {
                            val dir = java.io.File(ctx.cacheDir, "open")
                            if (!dir.exists()) dir.mkdirs()
                            val safe = fileName.replace(Regex("[^A-Za-z0-9._ ()-]"), "_")
                            val dest = java.io.File(dir, System.currentTimeMillis().toString() + "_" + safe)
                            val ok = withContext(Dispatchers.IO) { Api.downloadToFile(fileKey, dest) }
                            if (ok) {
                                if (isTextLike()) {
                                    val body = runCatching {
                                        dest.readText().take(60_000)
                                    }.getOrDefault("")
                                    withContext(Dispatchers.Main) { textDoc = body }
                                } else {
                                    FilesUtil.openFile(ctx, fileName, dest, FilesUtil.mimeFor(fileName, fileType))
                                }
                            } else {
                                android.widget.Toast.makeText(ctx, "Could not download. Please try again.", android.widget.Toast.LENGTH_SHORT).show()
                                dest.delete()
                            }
                        } catch (e: Exception) {
                            android.widget.Toast.makeText(
                                ctx,
                                "Could not open \"${fileName.take(28)}…\". Try again.",
                                android.widget.Toast.LENGTH_SHORT,
                            ).show()
                        }
                        opening = false
                    }
                },
    ) {
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
        Column(Modifier.weight(1f)) {
            Text(
                compactFileName(fileName),
                fontSize = 13.sp,
                color = Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                if (upFrac != null) "Sending · ${(upFrac * 100).toInt()}%"
                else FilesUtil.displaySize(m.optInt("fileSize")),
                fontSize = 11.sp,
                color = if (mine) Color(0x99FFFFFF) else Muted,
                maxLines = 1,
            )
        }
        Spacer(Modifier.width(6.dp))
        // Fixed-size slot: spinner / progress ring / "Open" all render inside
        // the SAME box dimensions so the row never grows or shrinks on tap.
        Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
            when {
                opening -> CircularProgressIndicator(
                    color = if (mine) AmberInk else GoldDeep,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(20.dp),
                )
                upFrac != null -> CircularProgressIndicator(
                    progress = { upFrac },
                    color = if (mine) AmberInk else GoldDeep,
                    strokeWidth = 2.5.dp,
                    modifier = Modifier.size(22.dp),
                )
                ready -> Text(
                    "Open",
                    color = if (mine) Color.White else GoldDeep,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.5.sp,
                    maxLines = 1,
                )
                else -> Text(
                    "…",
                    fontSize = 11.sp,
                    color = if (mine) Color(0x99FFFFFF) else Muted,
                    maxLines = 1,
                )
            }
        }
    }
    textDoc?.let { body ->
        val clipboard = LocalClipboardManager.current
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { textDoc = null },
            confirmButton = {
                TextButton(onClick = {
                    clipboard.setText(androidx.compose.ui.text.AnnotatedString(body))
                    android.widget.Toast.makeText(ctx, "Copy kora holo", android.widget.Toast.LENGTH_SHORT).show()
                }) { Text("Copy", color = GoldDeep, fontWeight = FontWeight.SemiBold) }
            },
            dismissButton = {
                TextButton(onClick = { textDoc = null }) { Text("Close", color = Muted) }
            },
            title = { Text(fileName, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Ink, maxLines = 2) },
            text = {
                Text(
                    body.ifBlank { "(empty file)" },
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    fontSize = 12.5.sp,
                    color = Ink,
                    modifier = Modifier
                        .heightIn(max = 480.dp)
                        .verticalScroll(rememberScrollState()),
                )
            },
        )
    }
}

/**
 * Compact a long filename for the chat bubble: keeps the start (name) and
 * the extension, dots out the middle — e.g. "VID-20260829-WA0001.mp4" with
 * a long stem becomes "VID-202629....mp4". Short names pass through as-is.
 */
private fun compactFileName(name: String, headKeep: Int = 10, tailDots: Int = 4): String {
    if (name.length <= headKeep + tailDots + 5) return name
    val dot = name.lastIndexOf('.')
    val ext = if (dot in 1 until name.length - 1) name.substring(dot) else ""
    val stem = if (dot in 1 until name.length - 1) name.substring(0, dot) else name
    if (stem.length <= headKeep) return name
    return stem.take(headKeep) + ".".repeat(tailDots) + ext
}

// Owner round 6: memoized — Instant.parse + zone math used to run for
// EVERY visible row on EVERY recomposition (selection, typing, receipts),
// which is pure jank on long threads. Timestamps are immutable per iso.
private val stampCache = java.util.concurrent.ConcurrentHashMap<String, String>()

private fun msgStamp(iso: String): String {
    if (iso.isBlank()) return ""
    return stampCache.getOrPut(iso) {
        try {
            val z = atDhaka(java.time.Instant.parse(iso))
            // Owner round 4: 12-hour clock with AM/PM (the 24-hour stamp read
            // as wrong in the AI chat; now every bubble matches the security
            // card's format).
            String.format(
                "%d:%02d %s",
                (z.hour % 12).let { if (it == 0) 12 else it },
                z.minute,
                if (z.hour >= 12) "PM" else "AM",
            )
        } catch (e: Exception) {
            ""
        }
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
        // Owner round 14: hardcoded light tints glared inside the dark-blue
        // app; every wallpaper now has a dark variant of its own.
        "mint" -> if (KpThemeMode.darkBlue) Color(0xFF0C1A15) else Color(0xFFECFDF5)
        "night" -> Color(0xFF0B1220)
        "rose" -> if (KpThemeMode.darkBlue) Color(0xFF23141A) else Color(0xFFFFF1F2)
        else -> Cream
    }

/** My bubble per chat theme (Owner round 14: theme restyles bubbles too). */
private fun chatMineFill(theme: String): Brush =
    when (theme) {
        "mint" -> Brush.linearGradient(listOf(Color(0xFF34D399), Color(0xFF059669)))
        "rose" -> Brush.linearGradient(listOf(Color(0xFFFB7185), Color(0xFFE11D48)))
        "night" -> Brush.linearGradient(listOf(Color(0xFF818CF8), Color(0xFF4F46E5)))
        else -> goldFill()
    }

/** The other side's bubble per chat theme. */
private fun chatOtherFill(theme: String): Brush =
    when (theme) {
        "mint" -> Brush.linearGradient(listOf(if (KpThemeMode.darkBlue) Color(0xFF14261F) else Color(0xFFE7F8F0), if (KpThemeMode.darkBlue) Color(0xFF14261F) else Color(0xFFE7F8F0)))
        "rose" -> Brush.linearGradient(listOf(if (KpThemeMode.darkBlue) Color(0xFF2A1A21) else Color(0xFFFFE9EC), if (KpThemeMode.darkBlue) Color(0xFF2A1A21) else Color(0xFFFFE9EC)))
        "night" -> Brush.linearGradient(listOf(Color(0xFF1E293B), Color(0xFF1E293B)))
        else -> Brush.linearGradient(listOf(Card, Card))
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
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        // Owner round 14: rounded pill search bar (was a boxy full-width
        // strip at the bottom edge of the screen).
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Card)
                .border(1.dp, GoldDeep, RoundedCornerShape(24.dp))
                .padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Search, "Search", tint = Muted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                value = query,
                onValueChange = onQuery,
                singleLine = true,
                textStyle = TextStyle(color = Ink, fontSize = 15.sp),
                modifier = Modifier.weight(1f).padding(vertical = 10.dp),
                decorationBox = { inner ->
                    if (query.isEmpty()) Text("Search this chat", color = Muted, fontSize = 15.sp)
                    inner()
                },
            )
            if (query.isNotEmpty()) {
                Icon(
                    Icons.Filled.Close,
                    "Clear",
                    tint = Muted,
                    modifier = Modifier
                        .size(18.dp)
                        .clip(CircleShape)
                        .clickable { onQuery("") }
                        .padding(2.dp),
                )
            }
            Spacer(Modifier.width(6.dp))
            Icon(
                Icons.Filled.KeyboardArrowDown,
                "Close search",
                tint = GoldDeep,
                modifier = Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .clickable { onClose() }
                    .padding(2.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Card)
                .border(1.dp, Line, RoundedCornerShape(18.dp))
                .padding(horizontal = 14.dp, vertical = 6.dp),
        ) {
            hits.take(12).forEachIndexed { i, m ->
                if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(Line))
                Text(
                    m.optString("body").ifBlank { m.optString("fileName").ifBlank { "Media" } },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(m.optString("id")) }
                        .padding(vertical = 10.dp, horizontal = 4.dp),
                    color = Ink,
                    fontSize = 14.sp,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (query.trim().length >= 2 && hits.isEmpty()) {
                Text("No matches in this chat", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(10.dp))
            }
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
    // Owner round 14: the old dialog used the platform default light sheet —
    // colour mismatch in dark mode — and ● ○ glyphs instead of real swatches.
    data class Opt(val id: String, val label: String, val swatch: Color)
    val options = listOf(
        Opt("default", "Classic", Gold),
        Opt("mint", "Mint", Color(0xFF10B981)),
        Opt("rose", "Rose", Color(0xFFFB7185)),
        Opt("night", "Night", Color(0xFF6366F1)),
    )
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Card,
        title = { Text("Chat theme", color = Ink) },
        text = {
            Column {
                options.forEach { o ->
                    val sel = o.id == current
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (sel) GoldSoft else Color.Transparent)
                            .clickable { onPick(o.id) }
                            .padding(horizontal = 10.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(26.dp)
                                .clip(CircleShape)
                                .background(o.swatch)
                                .border(1.5.dp, if (sel) GoldDeep else Line, CircleShape),
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(o.label, color = Ink, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        if (sel) Text("Applied", color = GoldDeep, fontSize = 12.sp)
                    }
                }
                Text("Changes the wallpaper and bubbles of this chat.", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
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

/**
 * In-thread "KuchuPuchu AI is typing" bubble (owner round 2026-09-04): three
 * dots stepping gold while the reply is being generated, WhatsApp-style.
 */
@Composable
private fun TypingBubble() {
    val phase by rememberInfiniteTransition(label = "typing").animateFloat(
        initialValue = 0f,
        targetValue = 3f,
        animationSpec = infiniteRepeatable(tween(1100, easing = LinearEasing), RepeatMode.Restart),
        label = "phase",
    )
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        Box(
            Modifier
                .widthIn(min = 64.dp)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 5.dp, bottomEnd = 16.dp))
                .background(Brush.linearGradient(listOf(Card, Card)))
                .padding(horizontal = 14.dp, vertical = 13.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                repeat(3) { i ->
                    // Owner round 4: each dot lifts and brightens in turn —
                    // a smooth wave instead of the old hard on/off swap.
                    val t = (phase - i).coerceIn(0f, 1f)
                    val lift = kotlin.math.sin((t * Math.PI).toFloat())
                    Box(
                        Modifier
                            .size(8.dp)
                            .graphicsLayer { translationY = -4.dp.toPx() * lift }
                            .clip(CircleShape)
                            .background(GoldDeep.copy(alpha = 0.35f + 0.65f * lift)),
                    )
                }
            }
        }
    }
}

/**
 * Owner profile card (owner rounds 2026-09-04). Final layout per the owner's
 * own spec: the photo sits on top at the SAME size a sent picture renders
 * (225dp, rounded, tap to view fullscreen); under it the name "MD Rabbi
 * Hossain", his details, then compact social icons and a full-width
 * "Send Message" button that opens a direct chat with his KuchuPuchu
 * account. The card springs in with a scale+fade entrance.
 */
@Composable
private fun OwnerCardBubble(m: JSONObject, onMessageOwner: (String) -> Unit) {
    val ctx = LocalContext.current
    val ownerId = m.optJSONObject("meta")?.optString("ownerUserId").orEmpty()
    fun open(url: String) {
        runCatching {
            ctx.startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)),
            )
        }
    }

    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        // Owner round 6: card widened to 92% of the screen and the photo is
        // now SQUARE — the picture renders far bigger than a normal bubble.
        val cardMax =
            maxOf(300.dp, minOf(440.dp, (androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp * 0.92f).dp))
        Column(
            Modifier
                .width(cardMax)
                .shadow(4.dp, RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 5.dp, bottomEnd = 16.dp))
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 5.dp, bottomEnd = 16.dp))
                .background(Brush.linearGradient(listOf(Card, Card))),
        ) {
            // ---- the photo: sent-picture size, tap to open fullscreen ----
            // Owner round 7: the photo is display-only — tapping does
            // nothing (the owner removed the fullscreen viewer).
            androidx.compose.foundation.Image(
                painter = painterResource(R.drawable.owner_avatar),
                contentDescription = "Rabbi Hossain",
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1f)
                    .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
            )
            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                Text("MD Rabbi Hossain", fontSize = 15.5.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text(
                    "Founder & Developer of KuchuPuchu",
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = GoldDeep,
                )
                Spacer(Modifier.height(3.dp))
                Text("Kaliganj, Jhenaidah, Khulna, Bangladesh", fontSize = 10.sp, color = Muted)
                Spacer(Modifier.height(9.dp))
                // ---- compact social row ----
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OwnerCardIcon(onClick = { open("https://facebook.com/Rabbihossainltd") }) {
                        Icon(painterResource(R.drawable.ic_brand_facebook), "Facebook", tint = Color.Unspecified, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("https://instagram.com/Rabbihossainltd1") }) {
                        Icon(painterResource(R.drawable.ic_brand_instagram), "Instagram", tint = Color.Unspecified, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("https://t.me/Rabbihossainltd0") }) {
                        Icon(painterResource(R.drawable.ic_brand_telegram), "Telegram", tint = Color.Unspecified, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("https://tiktok.com/@Rabbihossainltd") }) {
                        Icon(painterResource(R.drawable.ic_brand_tiktok), "TikTok", tint = Color.Unspecified, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("mailto:info@rabbihossainltd.online") }) {
                        Icon(Icons.Filled.Email, "Email", tint = GoldDeep, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("https://rabbihossainltd.online") }) {
                        Icon(Icons.Filled.Language, "Website", tint = GoldDeep, modifier = Modifier.size(14.dp))
                    }
                }
                Spacer(Modifier.height(10.dp))
                // ---- Send Message: direct chat with the owner's account ----
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (ownerId.isNotBlank()) Gold else Color(0xFFE7E5E4))
                        .clickable(enabled = ownerId.isNotBlank()) { onMessageOwner(ownerId) }
                        .padding(vertical = 9.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Chat,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("Send Message", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }

    // ---- fullscreen photo view (tap the picture) ----
}

@Composable
private fun OwnerCardIcon(onClick: () -> Unit, icon: @Composable () -> Unit) {
    Box(
        Modifier
            .size(27.dp)
            .clip(CircleShape)
            .background(GoldSoft)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        icon()
    }
}
