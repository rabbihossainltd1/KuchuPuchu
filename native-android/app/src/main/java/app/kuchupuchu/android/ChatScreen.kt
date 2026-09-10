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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Reply
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
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.CallMissed
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Edit

import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.Timer
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.withStyle
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
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.navigation.NavController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.net.Uri
import org.json.JSONArray
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
    // Owner round 32 (item 18): hold Send → "send later". The sheet, and the
    // chat's own parked rows (server truth: GET …/scheduled), shown as a
    // clock chip above the composer.
    var showSchedule by remember { mutableStateOf(false) }
    var showScheduled by remember { mutableStateOf(false) }
    // Owner round 32 (item 19): the attach panel's Send held → the same sheet
    // schedules the picked photos / videos.
    var showScheduleMedia by remember { mutableStateOf(false) }
    val scheduledRows = remember { mutableStateListOf<JSONObject>() }
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
    // Owner round 31: long-press opens ONE bottom sheet — the reaction emoji
    // row on top, every message action under it. (No floating bar, no
    // system-style icon strip.) Multi-select is the sheet's "Select" action.
    var actionFor by remember { mutableStateOf<JSONObject?>(null) }

    val selected = remember { mutableStateListOf<String>() }

    fun applyReaction(m: JSONObject, emoji: String) {
        val mid = m.optString("id")
        if (mid.isBlank()) return
        reactionFor = null
        showEmojiSheet = false
        // Owner round 17: reacting also clears that message's selection — it
        // used to stay selected after the emoji landed.
        if (mid in selected) selected.remove(mid)
        // Owner round 21: his reaction sound.
        runCatching { KpSounds.reaction(ctx) }
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
    // Owner round 25: the Saver keeps the exact scroll position across
    // navigation (video player and back) — with the no-yank rules this makes
    // "back from a video returns where I was" guaranteed.
    val listState = rememberSaveable(saver = androidx.compose.foundation.lazy.LazyListState.Saver) {
        androidx.compose.foundation.lazy.LazyListState(0, 0)
    }
    val player = remember { VoicePlayer() }
    var lastTopId by remember { mutableStateOf("") }
    // Freshness marker for this conversation message page (see refreshMessages).
    var msgsMarker by remember { mutableStateOf("") }
    // Burst coalescing for realtime message events: K frames inside one
    // 120ms window trigger ONE marker sync, not K (groups spamming emoji
    // used to fire a request per bubble).
    val msgSyncPending = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    var menuOpen by remember { mutableStateOf(false) }
    // Owner round 32 (item 5): group ⋮ — Leave Group confirm + Add Members picker.
    var confirmLeave by remember { mutableStateOf(false) }
    var showAddMembers by remember { mutableStateOf(false) }
    // Owner round 7: AI-chat incognito — the session is wiped on leaving.
    var aiIncognito by remember { mutableStateOf(false) }
    var showChatSearch by remember { mutableStateOf(false) }
    var showDisappear by remember { mutableStateOf(false) }
    var showTheme by remember { mutableStateOf(false) }
    var muteInFlight by remember { mutableStateOf(false) }
    var searchQ by remember { mutableStateOf("") }
    var searchHits by remember { mutableStateOf(listOf<JSONObject>()) }
    // Selection mode (long-press): delete-for-me / unsend / edit / forward.
    // Attach-panel (gallery grid) selection, hoisted here so the COMPOSER's
    // mic turns into SEND while the panel has picks (WhatsApp behaviour) —
    // the panel itself no longer carries its own send button.
    val attachSel = remember { mutableStateListOf<MediaItem>() }
    // Owner round 32 (item 17): the attach panel's "view once" switch — armed
    // for one batch, reset once it goes out.
    var attachOnce by remember { mutableStateOf(false) }
    // System back during selection CLEARS the selection (WhatsApp) — it must
    // not fling the user out of the chat with bubbles still highlighted.
    androidx.activity.compose.BackHandler(enabled = selected.isNotEmpty()) {
        selected.clear()
    }
    // Owner round 18: system back steps BACK one level — the in-chat search
    // closes first instead of leaving the whole chat.
    androidx.activity.compose.BackHandler(enabled = showChatSearch) {
        showChatSearch = false
    }
    // Owner round 19: back also dismisses the floating reaction bar / emoji
    // sheet (registered last = checked first).
    androidx.activity.compose.BackHandler(enabled = reactionFor != null || showEmojiSheet) {
        // Owner round 25: ONE back closes the reaction bar AND the selection
        // together — two presses felt broken.
        reactionFor = null
        showEmojiSheet = false
        actionFor = null
        selected.clear()
    }
    // Owner round 18: leaving the chat re-marks it read server-side and
    // zeroes the badge NOW. The list used to show a stale unread count after
    // exiting (a poke merge carried the pre-read value back in) until the
    // chat was opened a SECOND time.
    // Owner round 33 (item 3): a send's reply may land after this screen is
    // gone — its state must not be painted into a dead composition.
    val alive = remember(convId) { java.util.concurrent.atomic.AtomicBoolean(true) }
    androidx.compose.runtime.DisposableEffect(convId) {
        onDispose {
            alive.set(false)
            ScreenStore.markRead(convId)
            Thread {
                runCatching { Api.post("/api/conversations/$convId/read") }
            }.start()
        }
    }
    var viewerMsg by remember { mutableStateOf<JSONObject?>(null) }
    // Owner round 31 (item 29): "See all" of a grouped photo bubble.
    var albumMsg by remember { mutableStateOf<JSONObject?>(null) }
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

    // Owner round 33 (item 3): a queue refusal is independent of the page —
    // the text comes back to the composer (§20) and the bubble turns red the
    // moment the chat hears of it. This used to sit behind the marker GET,
    // and an "unchanged" page returned before it ran.
    fun reconcileRefused() {
        if (pending.isEmpty()) return
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

    fun refreshMessages(
        forceScroll: Boolean = false,
        markRead: Boolean = false,
        forceNetwork: Boolean = false,
    ) {
        scope.launch {
            try {
                reconcileRefused()
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
                    reconcileRefused()
                }
                val total = msgs.size + pending.size
                // Only scroll when it matters: explicit send, or a NEW
                // message landed while we're already near the bottom.
                // Round 24: an EMPTY layout (just recomposed — e.g. returning
                // from the video player) used to default nearBottom to TRUE,
                // so any message that arrived during playback yanked the list
                // to the bottom ("play seshe back korle last message e chole
                // jai"). Empty layout now means "unknown, do NOT scroll". The
                // initial landing is owned by didInitialScroll below.
                val nearBottom = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let {
                    it >= total - 2
                } ?: false
                // Round 24: the FIRST fetch of a session had prevTop == "",
                // which made "newMessage" true for a plain load — scrolling
                // right after entering yanked the user to the bottom
                // ("first time scroll korle last message e niye jai").
                // A real new message needs a known previous top.
                val newMessage = prevTop.isNotBlank() && newTop.isNotBlank() && newTop != prevTop
                if (total > 0 && (forceScroll || (newMessage && nearBottom))) {
                    // Owner round 32 (item 48): a scroll that a newer scroll
                    // interrupts throws here; the mark-read below must still run.
                    runCatching { listState.animateScrollToItem(total - 1) }
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
        // Owner round 33 (item 3): whatever this chat still has in the queue
        // file comes back as its clock bubble — a message typed here never
        // vanishes for leaving early or being offline; it goes when it can.
        scope.launch {
            withContext(Dispatchers.IO) { Outbox.awaitLoaded() }
            val known = HashSet<String>()
            msgs.forEach { known.add(it.optString("clientId")); known.add(it.optString("id")) }
            pending.forEach { known.add(it.optString("clientId")) }
            Outbox.pendingFor(convId).forEach { row ->
                if (row.optString("clientId") !in known) pending.add(row)
            }
        }
        // §20: the draft comes back with the chat — but only into an empty
        // composer, so returning from a media picker never overwrites live typing.
        if (input.isBlank()) Drafts.of(convId).takeIf { it.isNotBlank() }?.let { input = it }
        if (ScreenStore.pendingChatSearch == convId) {
            ScreenStore.pendingChatSearch = null
            showChatSearch = true
        }
        KpCrash.mark("chat-paint:${msgs.size}")
        refreshMeta()
        // Owner round 26 (the STILL-broken auto-jump): this opening refresh
        // used forceScroll = true, which bypasses the no-yank guards and
        // yanks to the bottom the moment the first fetch lands — right when
        // the user is already scrolling up, and again on RETURN from the
        // video player (this effect re-runs on every fresh composition).
        // Landing on the newest is didInitialScroll's job; the nearBottom
        // rule handles everything after.
        refreshMessages(markRead = true)
        KpCrash.mark("chat-page:${msgs.size}")
        runCatching { Outbox.flushNow(force = true) }
    }

    /* single stable background refresh loop while this chat is open */
    LaunchedEffect(convId, ScreenStore.poke) {
        if (Store.route == "chat/$convId") refreshMessages()
    }
    // Owner round 31 (item 18): the header (name, picture, username) follows a
    // live profile change; a "conv" frame for THIS chat (group renamed,
    // picture / theme / timer changed by someone else) re-reads the detail.
    LaunchedEffect(convId, ScreenStore.profileVersion) {
        if (ScreenStore.profileVersion > 0) {
            Cache.bust("/api/conversations/$convId")
            refreshMeta()
        }
    }

    // Opening a chat ALWAYS lands on the newest message (instant, not animated,
    // so it never lags behind a fast paint on a slow device).
    // rememberSaveable, not remember: navigating to the video player pops
    // this composable out of composition, and plain remember lost the flag —
    // coming BACK re-ran the jump and the chat landed on the latest message
    // instead of where the video was ("video play kore back korle").
    var didInitialScroll by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(msgs.size, pending.size) {
        if (!didInitialScroll && msgs.isNotEmpty()) {
            didInitialScroll = true
            // Round 24: never fight an in-progress user scroll — if the list
            // filled while the user was already dragging it, leave it alone.
            if (!listState.isScrollInProgress) {
                listState.scrollToItem(msgs.size + pending.size - 1)
            }
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
                // Owner round 31 (item 18): group name / picture / theme /
                // timer changed elsewhere — the open chat repaints its header
                // and wallpaper without a reopen.
                "conv" ->
                    if (ev.optString("conversationId") == convId && !ev.optBoolean("msg")) {
                        Cache.bust("/api/conversations/$convId")
                        refreshMeta()
                    }
                "message" ->
                    if (ev.optString("conversationId") == convId) {
                        // FAST PAINT: the WS "message" frame carries the FULL
                        // message object (msgFrom), so we drop the bubble into
                        // the thread instantly instead of waiting a GET round
                        // trip. The marker-gated reconcile below confirms order
                        // + advances the marker; if the fast-paint ever guessed
                        // wrong (a delete/our own echo racing in), the GET
                        // self-corrects. NOTE: the room broadcast reaches EVERY
                        // socket in the chat — our own included — so our own
                        // sends (and our reactions/edits) echo back here too.
                        ev.optJSONObject("message")?.let { liveMsg ->
                            // Owner round 22/28: the in-chat receive sound (his
                            // pack) only for a bubble SOMEONE ELSE sent. The
                            // echo of our own send used to play it on every
                            // message we typed ("message send korlei receive
                            // sound"); the send/sent tones already cover ours.
                            val fromOther = liveMsg.optString("senderId").let { it.isNotBlank() && it != Store.myId() }
                            val liveId = liveMsg.optString("id")
                            val fresh = msgs.none { it.optString("id") == liveId }
                            if (fromOther && fresh) runCatching { KpSounds.receive(ctx) }
                            val liveCid = liveMsg.optString("clientId")
                            // Owner round 32 (item 18): a parked message the
                            // cron just sent — its chip row forgets it.
                            if (liveCid.isNotBlank() && scheduledRows.any { it.optString("clientId") == liveCid }) {
                                scheduledRows.removeAll { it.optString("clientId") == liveCid }
                            }
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

    // Owner round 33 (item 4): the POST's own response row is painted straight
    // away — the same merge the socket's "message" frame does — instead of a
    // marker GET round trip after every send.
    fun paintSent(row: JSONObject) {
        val id = row.optString("id")
        val cid = row.optString("clientId")
        if (id.isBlank()) return
        val idx = msgs.indexOfFirst { it.optString("id") == id || (cid.isNotBlank() && it.optString("clientId") == cid) }
        if (idx >= 0) msgs[idx] = row else msgs.add(row)
        pending.removeAll { it.optString("clientId") == cid || it.optString("id") == id }
        // Painted here = not "new" for the next marker GET (no second scroll / read post).
        if (idx < 0) lastTopId = id
        ScreenStore.setMsgs(convId, msgs.toList())
    }

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
        // Owner round 32 (item 48): scroll in its own coroutine — a newer
        // scroll cancels the older one, and that must not take the POST with it.
        scope.launch {
            val total = msgs.size + pending.size
            if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }
        }
        // Owner round 11: tap sound on the send itself…
        runCatching { KpSounds.send(ctx) }
        // Owner round 33 (item 3): queue-FIRST, off this screen's scope. The
        // POST used to run on the composable's coroutine scope with the queue
        // as its exception path only: backing out of the chat mid-request
        // cancelled it (the bubble left with the screen and the text with it),
        // and an offline send's bubble was gone on re-entry because nothing
        // painted queued rows. Outbox.send persists the payload before the
        // request leaves; the reply is painted here while the screen is still
        // up, and pendingFor() repaints the clock bubble on re-entry.
        Outbox.send(convId, clientId, payload) { outcome ->
            // …and the owner's "sent" sound when the server accepted it.
            outcome.onSuccess { runCatching { KpSounds.sent(ctx) } }
            if (!alive.get()) return@send false
            outcome.onSuccess { row -> paintSent(row) }
            outcome.onFailure { e ->
                // Refused for good: the bubble turns red now and the text
                // comes back to the composer (§20) — no page fetch in between.
                error = e.message?.takeIf { it.isNotBlank() } ?: "Could not send."
                markPendingFailed(clientId)
                reconcileRefused()
            }
            true
        }
        // The draft's job ends here, not at "server said ok": from now on the
        // text is owned by the server row or by the queue file (and if the
        // queue refuses it for good, that text comes back to the composer).
        Drafts.clear(convId)
    }

    // Owner round 32 (item 18): the chat's parked "send later" rows — mine
    // only, from the server (they live there, not on this device).
    fun loadScheduled() {
        scope.launch {
            val rows = runCatching {
                withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId/scheduled", force = true) }
            }.getOrNull()?.arr("items")?.objects() ?: return@launch
            scheduledRows.clear()
            scheduledRows.addAll(rows)
        }
    }

    fun scheduleText(body: String, at: java.time.Instant) {
        if (body.isBlank()) return
        val clientId = "c_${java.util.UUID.randomUUID()}"
        val payload =
            JSONObject().put("kind", "TEXT").put("body", body).put("clientId", clientId).put("sendAt", at.toString())
        replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }
        replyTo = null
        scope.launch {
            runCatching { KpSounds.send(ctx) }
            try {
                val res = withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                res.optJSONObject("scheduled")?.let { row ->
                    scheduledRows.removeAll { it.optString("id") == row.optString("id") }
                    scheduledRows.add(row)
                    scheduledRows.sortBy { it.optString("sendAt") }
                }
                runCatching { KpSounds.sent(ctx) }
                Drafts.clear(convId)
            } catch (e: Exception) {
                error = (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: "Could not schedule. Try again."
                // The text comes back to the composer: nothing was stored.
                if (input.isBlank()) input = body
            }
        }
    }

    fun cancelScheduled(id: String) {
        scheduledRows.removeAll { it.optString("id") == id }
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { Api.delete("/api/scheduled/$id") } }
            loadScheduled()
        }
    }
    // Owner round 32 (item 18): this chat's parked "send later" rows.
    LaunchedEffect(convId) { loadScheduled() }

    fun sendImage(dataUrl: String, album: String? = null, viewOnce: Boolean = false, sendAt: java.time.Instant? = null) {
        // Owner round 32 (item 19): a photo picked for LATER uploads now and
        // parks on the server (item 18) — no bubble, the clock chip shows it.
        if (sendAt != null) {
            scope.launch {
                val jpeg = withContext(Dispatchers.IO) {
                    runCatching { android.util.Base64.decode(dataUrl.substringAfter(",", ""), android.util.Base64.DEFAULT) }.getOrNull()
                }
                if (jpeg == null || jpeg.isEmpty()) {
                    error = "Could not read that photo."
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
                            .put("clientId", "c_${java.util.UUID.randomUUID()}")
                            .put("sendAt", sendAt.toString())
                    val meta = JSONObject()
                    if (viewOnce) meta.put("viewOnce", true) else if (album != null) meta.put("album", album)
                    if (meta.length() > 0) payload.put("meta", meta)
                    val res = withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                    res.optJSONObject("scheduled")?.let { row ->
                        scheduledRows.removeAll { it.optString("id") == row.optString("id") }
                        scheduledRows.add(row)
                        scheduledRows.sortBy { it.optString("sendAt") }
                    }
                    runCatching { KpSounds.sent(ctx) }
                } catch (e: Exception) {
                    error = (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: "Could not schedule. Try again."
                }
            }
            return
        }
        val clientId = "c_${java.util.UUID.randomUUID()}"
        // Owner round 31 (item 29): photos picked together share one album id
        // (meta.album) — the list folds them into a single grouped bubble.
        // Owner round 32 (item 17): a view-once photo carries meta.viewOnce
        // instead — no album, no dimensions (the bubble is a card, not a preview).
        fun metaWith(w: Int, h: Int): JSONObject? {
            val o = JSONObject()
            if (viewOnce) {
                o.put("viewOnce", true)
                return o
            }
            if (w > 0 && h > 0) o.put("w", w).put("h", h)
            if (album != null) o.put("album", album)
            return if (o.length() > 0) o else null
        }
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
                .also { row -> metaWith(0, 0)?.let { row.put("meta", it) } }
                .also { row -> if (viewOnce) row.put("viewOnce", true) }
                .put("createdAt", java.time.Instant.now().toString()),
        )
        // Owner round 32 (item 48): the jump-to-bottom is its own coroutine.
        // animateScrollToItem is a scroll MUTATION — starting the next one
        // cancels whichever coroutine owns the previous, with a
        // CancellationException thrown at that suspension point. With the
        // scroll inline, photo #2's launch cancelled photo #1's *before its
        // upload began*, #3 cancelled #2, … so of an N-photo album only the
        // last photo ever reached the server ("multi-photo sends one").
        scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }
        scope.launch {
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
            // Owner round 33 (item 3): the upload + POST run on Uploads' own
            // scope, queue-first (the bytes are on disk before the upload
            // starts), so leaving the chat or losing the network mid-way can
            // no longer drop the photo. This screen only paints the outcome.
            val payload =
                JSONObject()
                    .put("kind", "FILE")
                    .put("fileName", "photo.jpg")
                    .put("fileType", "image/jpeg")
                    .put("fileSize", jpeg.size)
                    .put("clientId", clientId)
            metaWith(shotW, shotH)?.let { payload.put("meta", it) }
            Uploads.sendPhoto(ctx, convId, clientId, jpeg, payload) { outcome ->
                // Owner round 21: photo send has its own sound.
                outcome.onSuccess { runCatching { KpSounds.photoSend(ctx) } }
                if (!alive.get()) return@sendPhoto false
                outcome.onSuccess { row -> paintSent(row) }
                outcome.onFailure { e ->
                    error = "Photo: " + (e.message ?: "?") + "  Tap the banner to try again."
                    markPendingFailed(clientId)
                    reconcileRefused()
                }
                true
            }
        }
    }

    fun sendFile(name: String, mime: String, file: File, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null) {
        // Owner round 32 (item 34): the server's 25 MB cap is checked HERE — a
        // bigger file used to upload for minutes and then fail on that check.
        if (file.length() > VideoPlan.UPLOAD_LIMIT) {
            error = "That file is over 25 MB."
            return
        }
        // Owner round 32 (item 19): picked for LATER — upload now, park on the
        // server (item 18); no bubble, the clock chip shows it.
        if (sendAt != null) {
            scope.launch {
                try {
                    val up = withContext(Dispatchers.IO) { Api.uploadFile(name, mime, file) }
                    val key = up.optString("fileKey")
                    if (key.isBlank()) throw ApiException(500, "Upload returned no file key.")
                    val payload =
                        JSONObject()
                            .put("kind", "FILE")
                            .put("fileKey", key)
                            .put("fileName", name)
                            .put("fileType", mime)
                            .put("fileSize", file.length())
                            .put("clientId", "c_${java.util.UUID.randomUUID()}")
                            .put("sendAt", sendAt.toString())
                    when {
                        asDocument -> payload.put("meta", JSONObject().put("document", true))
                        viewOnce -> payload.put("meta", JSONObject().put("viewOnce", true))
                    }
                    val res = withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/messages", payload) }
                    res.optJSONObject("scheduled")?.let { row ->
                        scheduledRows.removeAll { it.optString("id") == row.optString("id") }
                        scheduledRows.add(row)
                        scheduledRows.sortBy { it.optString("sendAt") }
                    }
                    file.delete()
                    runCatching { KpSounds.sent(ctx) }
                } catch (e: Exception) {
                    error = (e as? ApiException)?.message?.takeIf { it.isNotBlank() } ?: "Could not schedule. Try again."
                }
            }
            return
        }
        val clientId = "c_${java.util.UUID.randomUUID()}"
        // Owner round 31 (item 16): a photo/video/audio picked through
        // "Document" travels as a document — meta.document keeps it out of the
        // photo / video bubbles on both sides.
        val docMeta =
            when {
                asDocument -> JSONObject().put("document", true)
                // Owner round 32 (item 17): a view-once video (never a document).
                viewOnce -> JSONObject().put("viewOnce", true)
                else -> null
            }
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "FILE")
                .put("fileName", name)
                .put("fileType", mime)
                .put("fileSize", file.length().toInt())
                // Kept for tap-to-retry after a failed send (the cached copy is
                // only deleted once the send succeeds) — like voicePath.
                .put("docPath", file.absolutePath)
                .put("createdAt", java.time.Instant.now().toString())
                .also { if (docMeta != null) it.put("meta", docMeta) }
                .also { if (viewOnce && !asDocument) it.put("viewOnce", true) },
        )
        scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }
        runCatching { KpSounds.send(ctx) }
        // Owner round 32 (item 34): the upload + POST run on Uploads' own
        // scope — this screen only awaits the outcome for its bubble. They
        // used to run on the composition scope, so backing out of the chat
        // mid-upload cancelled the coroutine and the file never arrived.
        // Owner round 33 (item 3): queue-first — the copy is already on disk
        // (docPath), so the queue itself can upload it later when the send
        // was started offline; the outcome is painted here while alive.
        Uploads.sendFile(convId, clientId, name, mime, file, docMeta) { outcome ->
            outcome.onSuccess { runCatching { KpSounds.sent(ctx) } }
            if (!alive.get()) return@sendFile false
            outcome.onSuccess { row -> paintSent(row) }
            outcome.onFailure { failure ->
                // Before this the optimistic bubble stayed on screen forever
                // looking like it was still uploading: the POST never happened,
                // so no message with this clientId ever came back to match it.
                markPendingFailed(clientId)
                error = (failure.message ?: "Could not send file.") + "  Tap the banner to retry."
                reconcileRefused()
            }
            true
        }
    }

    fun sendVoice(file: File, seconds: Int, name: String, waveform: List<Int> = emptyList()) {
        // Owner round 21: his voice-send sound on the send itself.
        runCatching { KpSounds.voiceSend(ctx) }
        val clientId = "c_${java.util.UUID.randomUUID()}"
        // Owner round 31 (item 27): the recorded bars ride along in meta so the
        // pending bubble, the sent bubble and the receiver all draw the same wave.
        fun voiceMeta() =
            JSONObject().put("voice", true).put("seconds", seconds).put("clientId", clientId)
                .also { if (waveform.isNotEmpty()) it.put("waveform", JSONArray(waveform)) }
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
                .put("meta", voiceMeta())
                .put("createdAt", java.time.Instant.now().toString()),
        )
        // Owner round 32 (item 48): same split as sendImage — a scroll started
        // by anything else must never cancel the upload coroutine.
        scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }
        scope.launch {
            runCatching { KpSounds.send(ctx) }
            // Owner round 33 (item 3): the recording is a file already — the
            // upload + POST run queue-first on Uploads' own scope (the old
            // coroutine here died with the screen and the note with it; a
            // FILE payload without a fileKey is never queued — the queue
            // uploads the local file itself, see Outbox.materialize).
            val payload =
                JSONObject()
                    .put("kind", "FILE")
                    .put("fileName", name)
                    .put("fileType", "audio/mp4")
                    .put("fileSize", file.length())
                    .put("clientId", clientId)
                    .put("meta", voiceMeta())
            Uploads.sendFile(convId, clientId, name, "audio/mp4", file, null, payload) { outcome ->
                outcome.onSuccess { runCatching { KpSounds.sent(ctx) } }
                if (!alive.get()) return@sendFile false
                outcome.onSuccess { row -> paintSent(row) }
                outcome.onFailure { e ->
                    markPendingFailed(clientId)
                    error = (e.message ?: "Could not send that voice note.") + "  Tap the banner to retry."
                    reconcileRefused()
                }
                true
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
    suspend fun readAndSendImage(uri: Uri, album: String?, viewOnce: Boolean = false, sendAt: java.time.Instant? = null) {
        // 720px / ~100KB: the old 960px/220KB photos took minutes to send AND load
        // on slow mobile data (the "image loads forever" report).
        // High-quality photos: 1440px, ~380KB inline budget (server caps at 450K).
        val dataUrl = withContext(Dispatchers.IO) { FilesUtil.imageToDataUrl(uri, ctx, maxSide = 1440, maxChars = 380_000) }
        if (dataUrl == null) {
            error = "Could not read that photo — try another one."
        } else {
            error = ""
            sendImage(dataUrl, album, viewOnce, sendAt)
        }
    }

    fun handleImagePicked(uri: Uri, album: String? = null) {
        scope.launch { readAndSendImage(uri, album) }
    }

    fun handleDocumentPicked(uri: Uri, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null) {
        scope.launch {
            val name = withContext(Dispatchers.IO) { queryName(ctx, uri) }
            // Owner round 32 (item 34): streamed into the cache, never read
            // whole into memory (see FilesUtil.copyDocument).
            val pair = withContext(Dispatchers.IO) { FilesUtil.copyDocument(ctx, uri, name) }
            if (pair == null) {
                error = "Could not read that file — try another one."
                return@launch
            }
            val (mime, file) = pair
            if (file.length() == 0L) {
                file.delete()
                error = "That file is empty."
                return@launch
            }
            error = ""
            sendFile(name, mime, file, asDocument, viewOnce, sendAt)
        }
    }
    // Owner round 32 (item 19): the media editor hands its result back here —
    // a drawn-on photo / trimmed clip goes out like any picked media.
    LaunchedEffect(convId) {
        ScreenStore.pendingEdited.collect { edited ->
            if (edited == null || edited.convId != convId) return@collect
            ScreenStore.pendingEdited.value = null
            when (val m = edited.media) {
                is EditedMedia.Photo -> sendImage(m.dataUrl, null, edited.viewOnce)
                is EditedMedia.Video -> sendFile("video.mp4", m.mime, m.file, viewOnce = edited.viewOnce)
                is EditedMedia.Untouched ->
                    if (m.isVideo) handleDocumentPicked(m.uri, viewOnce = edited.viewOnce)
                    else readAndSendImage(m.uri, null, viewOnce = edited.viewOnce)
                is EditedMedia.Failed -> error = m.message
            }
        }
    }

    fun sendAttachSelection(sendAt: java.time.Instant? = null) {
        val batch = attachSel.toList()
        attachSel.clear()
        showAttach = false
        // Owner round 32 (item 17): the panel's ① switch — this batch goes out
        // view-once (no album: each photo is its own single opening), and the
        // switch disarms itself for the next pick.
        val once = attachOnce
        attachOnce = false
        // Owner round 31 (item 29): two or more photos picked together go out
        // as ONE album — each still its own message row, sharing meta.album.
        val photos = batch.count { !it.isVideo }
        val album = if (photos >= 2 && !once) newAlbumId() else null
        scope.launch {
            // Owner round 32 (item 48): photos are read one after another, in
            // the order they were ticked, so the pending rows (and the album's
            // row order on the server) follow the selection instead of whichever
            // decode happened to finish first. Each upload still runs on its
            // own coroutine inside sendImage, so they overlap on the wire.
            batch.forEach { item ->
                if (once) {
                    if (item.isVideo) handleDocumentPicked(item.uri, viewOnce = true, sendAt = sendAt) else readAndSendImage(item.uri, null, viewOnce = true, sendAt = sendAt)
                } else {
                    if (item.isVideo) handleDocumentPicked(item.uri, sendAt = sendAt) else readAndSendImage(item.uri, album, sendAt = sendAt)
                }
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
            // Owner round 21: his voice-cancel sound.
            runCatching { KpSounds.voiceCancel(ctx) }
            VoiceNote.cancel()
            return
        }
        if (VoiceNote.elapsedMs() < 1000) {
            // Owner round 13: a sub-second tap is a slip, not an error —
            // cancel silently instead of scolding.
            VoiceNote.cancel()
            return
        }
        val take = VoiceNote.stop()
        if (take != null) {
            val name = "voice_${System.currentTimeMillis()}.m4a"
            sendVoice(take.file, take.seconds, name, take.waveform)
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
            (it.optString("kind") == "IMAGE" || it.optString("kind") == "FILE") && !isViewOnce(it)
        }
        if (items.isEmpty()) return
        selected.clear()
        val album = if (items.count { isPhotoMsg(it) } >= 2) newAlbumId() else null
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
                            handleImagePicked(uri, album)
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
        // Owner round 19: ANY performed action (unsend/delete/forward/copy)
        // also drops the reaction bar — the message used to stay "armed"
        // with the quick emojis still floating over it.
        reactionFor = null
        showEmojiSheet = false
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
        reactionFor = null
        showEmojiSheet = false
        ids.forEach { ScreenStore.hideMessage(it) }
        paintFromStore()
    }

    fun forwardSelected(targets: List<String>) {
        val items = selectedMessages()
        forwarding = false
        selected.clear()
        reactionFor = null
        showEmojiSheet = false
        // Owner round 31 (item 29): two or more photos forwarded together
        // arrive as ONE grouped bubble again (a fresh album id — one per
        // target chat, so each chat owns its own group).
        val grouped = items.count { isPhotoMsg(it) } >= 2
        scope.launch {
            // Owner round 32 (items 37/46): every picked chat, one shared
            // off-main forward path (the viewers use it too).
            for (targetConvId in targets) {
                val album = if (grouped) newAlbumId() else null
                for (m in items) {
                    val meta = if (album != null && isPhotoMsg(m)) JSONObject().put("album", album) else null
                    runCatching { forwardMessageTo(targetConvId, m, meta) }
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
    // Owner round 32 (item 38): a 1:1 chat a stranger opened from username
    // search is a message REQUEST until accepted. `requestPending` = this
    // side has to answer (Accept / Block prompt in place of the composer);
    // `requestSent` = this side opened it and waits. Calls, shared media and
    // last seen are withheld on both sides meanwhile (the server refuses too).
    val requestPending = !isGroup && c?.optBoolean("requestPending") == true
    val requestSent = !isGroup && c?.optText("requestFrom")?.takeIf { it.isNotBlank() } == Store.myId()
    val requestOpen = requestPending || requestSent
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
    // Owner round 31: groups carry their own picture (avatarRef "g:<id>@vN").
    val avatarUrl = if (isGroup) c?.optIso("avatarUrl") else c?.optJSONObject("other")?.optIso("avatarUrl")
    // The ref is what makes the header paint without re-fetching: pass it too.
    val avatarRef = if (isGroup) c?.optIso("avatarRef") else c?.optJSONObject("other")?.optIso("avatarRef")
    val online = !isGroup && c?.optJSONObject("other")?.optBoolean("online") == true
    // Official notification account: one-way (owner rule) — no composer.
    val noReply = !isGroup && otherUserId == "kp_official_bot"
    // Owner round 31 item 21: a private profile's chat (theirs, or mine when
    // I am private) is screenshot-blocked, and their photos / videos carry no
    // Save / Forward.
    // Owner round 32 (item 5): a PRIVATE group is guarded the same way — no
    // capture, no Save / Forward, no gallery (the server closes it too).
    val groupAdmin = isGroup && c?.optText("ownerId") == Store.myId()
    val privateGroup = isGroup && c?.optBoolean("privateGroup") == true
    val privateChat = KpSecure.privatePeer(c) || KpSecure.selfPrivate() || privateGroup
    KpSecure.Guard(privateChat)
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
            // Owner round 32 (item 48 family): a user drag owns the scroll
            // mutex, so this programmatic scroll throws — the reveal must keep
            // typing (and reset aiRevealId at the end) instead of dying here
            // and leaving the reply cut off at that word.
            if (nearBottom) runCatching { listState.scrollToItem(info.totalItemsCount - 1) }
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
                IconButton(onClick = { haptics.tap(); selected.clear() }, modifier = Modifier.size(36.dp)) {
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
                        haptics.confirm()
                        android.widget.Toast.makeText(ctx, "Copied", android.widget.Toast.LENGTH_SHORT).show()
                        selected.clear()
                        reactionFor = null
                    }) {
                        Icon(Icons.Filled.ContentCopy, "Copy", tint = Ink, modifier = Modifier.size(21.dp))
                    }
                }
                if (!privateChat && selectedMessages().none { isViewOnce(it) }) {
                    IconButton(onClick = { haptics.tap(); forwarding = true }) {
                        Icon(Icons.AutoMirrored.Filled.Send, "Forward", tint = ActionBlueDeep, modifier = Modifier.size(21.dp))
                    }
                }
                if (single && singleMsg != null && canEdit(singleMsg)) {
                    IconButton(onClick = { haptics.tap(); editing = singleMsg; selected.clear() }) {
                        Icon(Icons.Filled.Edit, "Edit", tint = ActionBlueDeep, modifier = Modifier.size(21.dp))
                    }
                }
                if (single && singleMsg != null && singleMsg.optString("senderId") == Store.myId() && !pendingEchoOf(singleMsg)) {
                    IconButton(onClick = { haptics.heavy(); unsendSelected() }) {
                        Icon(Icons.Filled.DeleteForever, "Delete for everyone", tint = Red, modifier = Modifier.size(21.dp))
                    }
                }
                IconButton(onClick = { haptics.heavy(); deleteForMe() }) {
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
                    // Owner round 31: a group header opens the group profile.
                    if (isGroup) nav.navigate("group/$convId")
                    else if (otherId.isNotBlank()) nav.navigate("profile/$otherId")
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
            KpAvatar(title, avatarUrl, 36.dp, avatarRef = avatarRef) // Owner round 25: choto header avatar
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
                    if (!isGroup) UserBadges(other)
                }
                Text(
                    when {
                        isGroup -> "${c?.arr("members")?.length() ?: 0} members"
                        botChat -> "Official account"
                        requestOpen -> " "
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
            // Owner round 32 (items 5b/5c): a GROUP gets voice + video call
            // buttons — the whole group rings.
            if (isGroup && c != null) {
                HeaderCallBtn(onClick = {
                    gateMicCamera(video = false) {
                        CallEngine.instance?.startGroupCall(convId, "AUDIO", title, avatarRef ?: "")
                    }
                }) {
                    Icon(Icons.Filled.Call, "Group voice call", tint = chatAccent(chatTheme), modifier = Modifier.size(19.dp))
                }
                HeaderCallBtn(onClick = {
                    gateMicCamera(video = true) {
                        CallEngine.instance?.startGroupCall(convId, "VIDEO", title, avatarRef ?: "")
                    }
                }) {
                    Icon(Icons.Filled.Videocam, "Group video call", tint = chatAccent(chatTheme), modifier = Modifier.size(21.dp))
                }
            }
            if (!isGroup && c != null && !botChat && !requestOpen) {
                if (otherId.isNotBlank()) {
                    HeaderCallBtn(onClick = {
                        gateMicCamera(video = false) {
                            CallEngine.instance?.startCall(otherId, "AUDIO", title, avatarUrl ?: "")
                        }
                    }) {
                        Icon(Icons.Filled.Call, "Voice call", tint = chatAccent(chatTheme), modifier = Modifier.size(19.dp))
                    }
                    HeaderCallBtn(onClick = {
                        gateMicCamera(video = true) {
                            CallEngine.instance?.startCall(otherId, "VIDEO", title, avatarUrl ?: "")
                        }
                    }) {
                        Icon(Icons.Filled.Videocam, "Video call", tint = chatAccent(chatTheme), modifier = Modifier.size(21.dp))
                    }
                }
            }
            // Owner round 7: the notifications bot carries NO options menu.
            // Owner round 32 (item 5): the ⋮ is a bottom sheet like every other
            // popup in the app; a GROUP gets its own list — Add Members /
            // Group Media / Theme / Search / Mute-Unmute / Leave Group.
            if (otherUserId != "kp_official_bot") {
                IconButton(onClick = { haptics.tap(); menuOpen = true }, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Filled.MoreVert, "More", tint = Ink, modifier = Modifier.size(22.dp))
                }
            }
        }
        }

        if (menuOpen) {
            val muted = c?.optBoolean("muted") == true
            val toggleMute: () -> Unit = {
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
            }
            KpSheet(onDismiss = { menuOpen = false }) {
                when {
                    otherUserId == "kp_ai_bot" -> {
                        // Owner round 7: the AI chat's own menu, exactly six
                        // options — nothing else.
                        KpSheetRow(Icons.Filled.Schedule, "History") { menuOpen = false; nav.navigate("aihistory") }
                        KpSheetRow(Icons.AutoMirrored.Filled.Chat, "New chat") { menuOpen = false; resetAiSession() }
                        KpSheetRow(Icons.Filled.NotificationsOff, if (muted) "Unmute notifications" else "Mute notifications", onClick = toggleMute)
                        KpSheetRow(Icons.Filled.Palette, "Chat theme") { menuOpen = false; showTheme = true }
                        KpSheetRow(Icons.Filled.VisibilityOff, if (aiIncognito) "Close incognito mode" else "Incognito mode") {
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
                        }
                        KpSheetRow(Icons.Filled.Search, "Search in chat") { menuOpen = false; showChatSearch = true }
                    }
                    isGroup -> {
                        // Owner round 32 (item 5): the group's six, in the
                        // owner's order. Add Members is the admin's (the
                        // server refuses everyone else) and a PRIVATE group
                        // takes no new members and has no media gallery.
                        if (groupAdmin && !privateGroup) {
                            KpSheetRow(Icons.Filled.PersonAdd, "Add Members") { menuOpen = false; showAddMembers = true }
                        }
                        if (!privateGroup) {
                            KpSheetRow(Icons.Filled.PermMedia, "Group Media") { menuOpen = false; nav.navigate("chatmedia/$convId") }
                        }
                        KpSheetRow(Icons.Filled.Palette, "Theme") { menuOpen = false; showTheme = true }
                        KpSheetRow(Icons.Filled.Search, "Search") { menuOpen = false; showChatSearch = true }
                        KpSheetRow(Icons.Filled.NotificationsOff, if (muted) "Unmute" else "Mute", onClick = toggleMute)
                        KpSheetRow(Icons.AutoMirrored.Filled.Logout, "Leave Group", tint = Red) { menuOpen = false; confirmLeave = true }
                    }
                    else -> {
                        KpSheetRow(Icons.Filled.GroupAdd, "New group") { menuOpen = false; nav.navigate("newgroup") }
                        if (otherUserId.isNotBlank()) {
                            // Owner round 30: "View contact" only when this person is
                            // already in the phone book; otherwise offer to add them
                            // (name — and number, when they share it — pre-filled).
                            val inBook = PhoneBook.entries.any { it.user?.optString("id") == otherUserId }
                            KpSheetRow(if (inBook) Icons.Filled.Person else Icons.Filled.PersonAdd, if (inBook) "View contact" else "Add contact") {
                                menuOpen = false
                                if (inBook) {
                                    nav.navigate("profile/$otherUserId")
                                } else {
                                    val n = android.net.Uri.encode(rawTitle.trim())
                                    val p = android.net.Uri.encode(c?.optJSONObject("other")?.optText("phone").orEmpty())
                                    nav.navigate("newcontact?name=$n&phone=$p")
                                }
                            }
                        }
                        // Owner round 15: this opened the GLOBAL search —
                        // in a chat, search means THIS conversation.
                        KpSheetRow(Icons.Filled.Search, "Search in chat") { menuOpen = false; showChatSearch = true }
                        if (!requestOpen) {
                            KpSheetRow(Icons.Filled.PermMedia, "Media, links, and docs") { menuOpen = false; nav.navigate("chatmedia/$convId") }
                        }
                        KpSheetRow(Icons.Filled.NotificationsOff, if (muted) "Unmute notifications" else "Mute notifications", onClick = toggleMute)
                        KpSheetRow(Icons.Filled.Timer, "Disappearing messages") { menuOpen = false; showDisappear = true }
                        KpSheetRow(Icons.Filled.Palette, "Chat theme") { menuOpen = false; showTheme = true }
                    }
                }
            }
        }
        if (confirmLeave) {
            KpConfirmSheet(
                title = "Leave group?",
                confirmLabel = "Leave",
                danger = true,
                onDismiss = { confirmLeave = false },
                onConfirm = {
                    confirmLeave = false
                    scope.launch {
                        val ok =
                            runCatching {
                                withContext(Dispatchers.IO) { Api.delete("/api/conversations/$convId/members/${Store.myId()}") }
                            }.isSuccess
                        if (ok) {
                            ScreenStore.convs.removeAll { it.optString("id") == convId }
                            nav.popBackStack("main", inclusive = false)
                        } else {
                            error = "Could not leave."
                        }
                    }
                },
            )
        }
        if (showAddMembers) {
            val memberIds = c?.arr("members")?.objects()?.mapNotNull { it.optJSONObject("user")?.optString("id") }.orEmpty().toSet()
            AddMembersSheet(
                exclude = memberIds,
                onDismiss = { showAddMembers = false },
                onAdd = { picked ->
                    showAddMembers = false
                    scope.launch {
                        for (u in picked) {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.post("/api/conversations/$convId/members", JSONObject().put("userId", u.optString("id")))
                                }
                            }.onFailure { error = it.message ?: "Could not add ${u.optText("displayName")}." }
                        }
                        refreshMeta()
                    }
                },
            )
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
                        // Owner round 25: unsent messages VANISH — no
                        // "This message was deleted" tombstone any more.
                        m.optString("kind") != "DELETED" && run {
                            val k = m.optString("clientId").ifBlank { m.optString("id") }
                            k.isNotBlank() && seenKeys.add(k)
                        }
                    }
                }
            }
            // Owner round 31 (item 29): photos that share meta.album collapse
            // into ONE grouped bubble (the album's first row carries the
            // others under "kpAlbum"); a lone photo of an album — the rest
            // unsent — is just a photo again.
            val groupedMsgs by remember {
                androidx.compose.runtime.derivedStateOf { foldAlbums(visibleMsgs) }
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
                    groupedMsgs,
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                    contentType = { it.optString("kind") },
                ) { m ->
                    // WhatsApp-style selection: the whole ROW gets a translucent
                    // highlight strip, edge to edge — not just the bubble.
                    val rowSelected = m.optString("id") in selected
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(if (rowSelected) ActionBlue.copy(alpha = 0.16f) else Color.Transparent),
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
                                // Owner round 31 (item 29): a grouped photo
                                // bubble selects / deselects ALL its photos.
                                if (msg.optString("kind") != "DELETED") {
                                    val ids = albumPhotos(msg).map { it.optString("id") }
                                    if (ids.first() in selected) selected.removeAll(ids.toSet())
                                    else ids.forEach { if (it !in selected) selected.add(it) }
                                }
                            },
                            onOpenImage = { msg -> viewerMsg = msg },
                            onOpenAlbum = { msg -> albumMsg = msg },
                            onOpenVideo = { msg ->
                                // Owner round 31: the app's own player (MediaViewer.kt);
                                // the sender rides along as the screen title.
                                val who =
                                    if (msg.optString("senderId") == Store.myId()) "You"
                                    else msg.optText("senderName").ifBlank { rawTitle }
                                // Owner round 32 (item 17): a view-once clip plays
                                // under capture guard with no Save / Forward, and the
                                // player spends the opening once the clip is on screen.
                                val once = isViewOnce(msg)
                                val arg =
                                    JSONObject(msg.toString()).put("kpTitle", who).put("kpPrivate", privateChat || once)
                                        .also { if (once) it.put("kpOnce", true) }
                                nav.navigate("videoplayer/${mediaArg(arg)}")
                            },
                            // Owner round 32 (item 33): documents → the app's own viewer.
                            onOpenDoc = { msg ->
                                val arg = JSONObject(msg.toString()).put("kpPrivate", privateChat)
                                nav.navigate("docviewer/${mediaArg(arg)}")
                            },
                            revealChars = if (m.optString("id") == aiRevealId) aiRevealChars else null,
                            onReply = { haptics.tap(); replyTo = it; replyFocusNonce++ },
                            onLongPress = { msg ->
                                // Owner round 31: the action sheet (reactions on
                                // top). In multi-select mode a long-press just
                                // toggles, like a tap.
                                if (msg.optString("kind") != "DELETED" && selected.isEmpty()) {
                                    actionFor = msg
                                    reactionFor = msg
                                }
                            },
                            quoteFor = { rid -> (msgs + pending).firstOrNull { it.optString("id") == rid } },
                            onMessageOwner = { ownerId -> openChatWithUser(ownerId) },
                            theme = chatTheme,
                        )
                    }
                }
                items(
                    foldAlbums(
                        pending.filter { p ->
                            val cid = p.optString("clientId").ifBlank { p.optString("id") }
                            visibleMsgs.none { it.optString("clientId") == cid || it.optString("id") == cid }
                        },
                    ),
                    key = { it.optString("clientId").ifBlank { it.optString("id") } },
                ) { m ->
                    MessageRow(
                        m,
                        isGroup,
                        Store.myId(),
                        otherReadAt,
                        player,
                        pendingEcho = true,
                        theme = chatTheme,
                        onOpenAlbum = { msg -> albumMsg = msg },
                    )
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
        // Owner round 32 (item 40): a refusal buzzes once when it appears.
        LaunchedEffect(error) { if (error.isNotBlank()) haptics.reject() }
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
                                val docPath = p.optString("docPath")
                                when {
                                    // Owner round 33 (item 3): a queued photo's
                                    // local copy (re-entry echo) re-sends from disk.
                                    url.startsWith("file://") -> scope.launch {
                                        val data = withContext(Dispatchers.IO) {
                                            runCatching {
                                                "data:image/jpeg;base64," +
                                                    android.util.Base64.encodeToString(File(url.removePrefix("file://")).readBytes(), android.util.Base64.NO_WRAP)
                                            }.getOrNull()
                                        }
                                        if (data != null) sendImage(data, p.optJSONObject("meta")?.optString("album")?.ifBlank { null }, isViewOnce(p))
                                    }
                                    // A retried album photo keeps its album;
                                    // a view-once one stays view-once (item 17).
                                    url.isNotBlank() -> sendImage(url, p.optJSONObject("meta")?.optString("album")?.ifBlank { null }, isViewOnce(p))
                                    voicePath.isNotBlank() -> {
                                        val f = File(voicePath)
                                        if (f.exists()) {
                                            sendVoice(
                                                f,
                                                p.optJSONObject("meta")?.optInt("seconds") ?: 0,
                                                p.optString("fileName").ifBlank { "voice.m4a" },
                                                voiceWaveOf(p),
                                            )
                                        }
                                    }
                                    // Owner round 32 (item 34): documents retry
                                    // from their cached copy (kept until sent).
                                    docPath.isNotBlank() -> {
                                        val f = File(docPath)
                                        if (f.exists()) {
                                            sendFile(
                                                p.optString("fileName").ifBlank { f.name },
                                                p.optString("fileType").ifBlank { "application/octet-stream" },
                                                f,
                                                sentAsDocument(p),
                                                isViewOnce(p),
                                            )
                                        }
                                    }
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
        if (showEmojiSheet && reactionFor != null) {
            EmojiSheetDialog { e -> reactionFor?.let { applyReaction(it, e) } }
        }

        /* ---------------- message action sheet (Owner round 31) ----------------
           Long-press → this sheet: quick reactions on top ("+" = full emoji
           sheet), then Reply / Copy / Forward / Edit / Unsend / Delete / Select. */
        actionFor?.let { m ->
            // Owner round 31 (item 29): Forward / Unsend / Delete / Select on
            // a grouped photo bubble act on every photo of the album.
            val albumIds = albumPhotos(m).map { it.optString("id") }
            val mineMsg = m.optString("senderId") == Store.myId()
            val kindM = m.optString("kind")
            val isText = kindM == "TEXT" && m.optText("body").isNotBlank()
            val echo = pendingEchoOf(m)
            fun close() {
                actionFor = null
                reactionFor = null
            }
            KpSheet(onDismiss = { close() }) {
                if (!showEmojiSheet) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        val myReaction = m.optJSONObject("meta")?.optJSONObject("reactions")?.optString(Store.myId()).orEmpty()
                        listOf("👍", "❤️", "😂", "😮", "😢", "🙏").forEach { e ->
                            Text(
                                e,
                                fontSize = 26.sp,
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(if (myReaction == e) ActionBlue.copy(alpha = 0.18f) else Color.Transparent)
                                    .clickable {
                                        applyReaction(m, e)
                                        actionFor = null
                                    }
                                    .padding(7.dp),
                            )
                        }
                        Box(
                            Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .background(ActionBlue.copy(alpha = 0.14f))
                                .clickable { showEmojiSheet = true },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Add, "More emojis", tint = ActionBlueDeep, modifier = Modifier.size(22.dp)) }
                    }
                    Spacer(Modifier.height(4.dp))
                }
                KpSheetRow(Icons.AutoMirrored.Filled.Reply, "Reply") {
                    close()
                    haptics.tap()
                    replyTo = m
                    replyFocusNonce++
                }
                if (isText) {
                    KpSheetRow(Icons.Filled.ContentCopy, "Copy") {
                        close()
                        val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("KuchuPuchu", m.optText("body")))
                        android.widget.Toast.makeText(ctx, "Copied", android.widget.Toast.LENGTH_SHORT).show()
                    }
                }
                // Owner round 31 item 21: no forwarding out of a private chat.
                // Owner round 32 (item 17): nor of a view-once photo / video.
                if (!echo && !privateChat && !isViewOnce(m)) {
                    KpSheetRow(Icons.AutoMirrored.Filled.Send, "Forward") {
                        close()
                        selected.clear()
                        selected.addAll(albumIds)
                        forwarding = true
                    }
                }
                if (canEdit(m)) {
                    KpSheetRow(Icons.Filled.Edit, "Edit") {
                        close()
                        editing = m
                    }
                }
                if (mineMsg && !echo) {
                    // Owner round 32 (item 16): the proper name for it.
                    KpSheetRow(Icons.Filled.DeleteForever, "Delete for everyone", tint = Red) {
                        close()
                        selected.clear()
                        selected.addAll(albumIds)
                        unsendSelected()
                    }
                }
                KpSheetRow(Icons.Filled.Delete, "Delete for me", tint = Red) {
                    close()
                    selected.clear()
                    selected.addAll(albumIds)
                    deleteForMe()
                }
                KpSheetRow(Icons.Filled.CheckCircle, "Select") {
                    close()
                    albumIds.forEach { if (it !in selected) selected.add(it) }
                }
            }
        }

        /* ---------------- composer (doubles as the recording bar) ---------------- */
        // Owner round 32 (item 18): the chat's parked "send later" rows.
        ScheduledChip(scheduledRows, chatTheme) { showScheduled = true }
        if (showSchedule) {
            ScheduleSheet(
                onClose = { showSchedule = false },
                onPick = { at ->
                    showSchedule = false
                    haptics.confirm()
                    showAttach = false
                    showStickers = false
                    scheduleText(input, at)
                    input = ""
                },
            )
        }
        if (showScheduled) {
            ScheduledSheet(
                rows = scheduledRows,
                onClose = { showScheduled = false },
                onCancel = { id -> cancelScheduled(id) },
            )
        }
        if (showScheduleMedia) {
            ScheduleSheet(
                onClose = { showScheduleMedia = false },
                onPick = { at ->
                    showScheduleMedia = false
                    haptics.confirm()
                    sendAttachSelection(sendAt = at)
                },
            )
        }
        ReplyQuoteBar(replyTo, chatTheme) { replyTo = null }
        if (requestPending) {
            // Owner round 32 (item 38): message request — Accept or Block
            // before anything else. Accept = POST /accept (the chat becomes a
            // normal one on both sides); Block = the same block the profile
            // sheet writes, then back to the list.
            var deciding by remember { mutableStateOf(false) }
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Card)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Line)
                        .clickable(enabled = !deciding) {
                            deciding = true
                            scope.launch {
                                val ok = runCatching {
                                    withContext(Dispatchers.IO) {
                                        Api.post("/api/blocks", JSONObject().put("userId", otherUserId))
                                    }
                                }.isSuccess
                                deciding = false
                                if (ok) {
                                    ScreenStore.dropConv(convId)
                                    nav.popBackStack()
                                } else {
                                    error = "Could not block. Try again."
                                }
                            }
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Block", color = Red, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(14.dp))
                        .background(ActionBlue)
                        .clickable(enabled = !deciding) {
                            deciding = true
                            scope.launch {
                                val res = runCatching {
                                    withContext(Dispatchers.IO) { Api.post("/api/conversations/$convId/accept") }
                                }.getOrNull()
                                deciding = false
                                val accepted = res?.optJSONObject("conversation")
                                if (accepted != null) {
                                    conv.value = accepted
                                    ScreenStore.setConvDetail(convId, accepted)
                                    ScreenStore.pokeInbox()
                                } else {
                                    error = "Could not accept. Try again."
                                }
                            }
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Accept", color = ActionBlueInk, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
            }
        } else if (noReply) {
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
            // Owner round 32 (item 18): hold Send → pick a time.
            onScheduleSend = { haptics.tap(); showSchedule = true },
            recording = recording,
            recMs = recMs,
            onStartRecord = {
                haptics.tap()
                showAttach = false
                showStickers = false
                startRecording()
            },
            // Owner round 31 (item 17): the AI hears voice notes now (the
            // worker feeds the clip to Gemini), so the mic works here too.
            micEnabled = true,
            theme = chatTheme,
            onFinishRecord = { cancelled -> finishRecording(cancelled) },
            selectCount = selected.size,
            onSendSelection = { sendSelectedMedia() },
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
                // Owner round 32 (item 19): hold the panel's Send → a time
                // (item 18's sheet); Edit on a single pick → the light editor.
                onScheduleBatch = { showScheduleMedia = true },
                onEdit = { item ->
                    val once = attachOnce
                    attachSel.clear()
                    attachOnce = false
                    showAttach = false
                    nav.navigate("mediaedit/$convId/${if (once) 1 else 0}/${statusPickArg(item)}")
                },
                viewOnce = attachOnce,
                onViewOnce = { attachOnce = it },
                onImagePicked = { uri -> handleImagePicked(uri) },
                onDocumentPicked = { uri -> handleDocumentPicked(uri, asDocument = true) },
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

        albumMsg?.let { m ->
            // Owner round 31 (item 29): every photo of the album, 4 per row;
            // a tap opens the app's own viewer on that photo.
            AlbumSheet(
                photos = albumPhotos(m),
                onClose = { albumMsg = null },
                onOpen = { photo ->
                    albumMsg = null
                    viewerMsg = photo
                },
            )
        }
        viewerMsg?.let { m ->
            // Owner round 31: the app's own photo viewer (MediaViewer.kt).
            val who =
                if (m.optString("senderId") == Store.myId()) "You"
                else m.optText("senderName").ifBlank { rawTitle }
            // Owner round 32 (item 17): a view-once photo — capture guard on,
            // no Save / Forward, and the single opening is spent the moment the
            // picture is on screen (the row flips to "Opened" everywhere).
            val once = isViewOnce(m)
            KpPhotoViewer(
                url = messageMediaUrl(m),
                title = who,
                subtitle = if (once) "View once" else viewerStamp(m.optText("createdAt")),
                onClose = { viewerMsg = null },
                onForward =
                    if (privateChat || once) {
                        null
                    } else {
                        {
                            viewerMsg = null
                            if (m.optString("id") !in selected) selected.clear()
                            selected.add(m.optString("id"))
                            forwarding = true
                        }
                    },
                canSave = !privateChat && !once,
                secure = privateChat || once,
                onShown = if (once) ({ ViewOnce.spend(m.optString("id")) }) else null,
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
                onSend = { targets -> forwardSelected(targets) },
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Composer(
    input: String,
    replyFocusNonce: Int = 0,
    onInput: (String) -> Unit,
    onInputTap: () -> Unit = {},
    onAttach: () -> Unit,
    onSticker: () -> Unit,
    onSend: () -> Unit,
    // Owner round 32 (item 18): long-press on Send (text typed) → schedule.
    onScheduleSend: () -> Unit = {},
    recording: Boolean,
    recMs: Int,
    micEnabled: Boolean = true,
    onStartRecord: () -> Unit,
    onFinishRecord: (cancelled: Boolean) -> Unit,
    selectCount: Int = 0,
    onSendSelection: () -> Unit = {},
    theme: String = "",
) {
    val accent = chatAccent(theme)
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
                    // Owner round 18: the pill is BACK — only the recording
                    // strip is transparent (that was the ask). Owner round 19:
                    // the pill takes the chat theme's accent tint.
                    .clip(RoundedCornerShape(19.dp))
                    .background(accent.copy(alpha = 0.16f))
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
                        Icon(Icons.Filled.Mood, "Stickers", tint = accent, modifier = Modifier.size(20.dp))
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
                            // Owner round 19: the caret follows the chat theme too.
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(accent),
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
                        Icon(Icons.Filled.AttachFile, "Attach", tint = accent, modifier = Modifier.size(20.dp))
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
                Spacer(Modifier.width(10.dp))
                // Owner round 32 (item 45): the last 4 s of mic peaks paint a
                // live wave that grows in from the mic's side; the cancel hint
                // moves next to the mic it refers to. The strip used to be
                // timer + hint with the whole middle blank.
                LiveVoiceWave(color = accent, modifier = Modifier.weight(1f).height(22.dp))
                Spacer(Modifier.width(10.dp))
                Text("‹ Slide to cancel", color = Red, fontSize = 12.5.sp, maxLines = 1)
            }
        }
        Spacer(Modifier.width(6.dp))

        /* mic/send circle. Text typed OR chat media selected (forward) ->
           it's SEND; otherwise a HOLD button: press = record, slide = cancel.
           Owner round 32 (item 19): a gallery pick no longer takes this slot
           — the attach panel has its own Send under the mic. */
        if (!input.isBlank() || selectCount > 0) {
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
                    .background(accent)
                    // Owner round 32 (item 18): tap = send, hold = "send
                    // later" (text only — media goes with its own flow, item 19).
                    .combinedClickable(
                        interactionSource = sendInteraction,
                        indication = null,
                        onLongClick = if (input.isNotBlank()) onScheduleSend else null,
                    ) {
                        if (input.isNotBlank()) onSend() else onSendSelection()
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
                accent = accent,
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
    accent: Color = Gold,
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
            .border(1.5.dp, if (cancelArmed) Red else accent, CircleShape)
            .pointerInput(enabled) {
                awaitEachGesture {
                    // Owner round 31 (item 17): the disabled branch used to
                    // return BEFORE awaiting a pointer — awaitEachGesture then
                    // re-entered instantly with nothing to suspend on, spinning
                    // the main thread until the app froze (the "AI voice
                    // button crash"). Always consume the down first.
                    val down = awaitFirstDown(requireUnconsumed = false)
                    if (!enabled) {
                        down.consume()
                        return@awaitEachGesture
                    }
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
            tint = if (!enabled) Muted else if (cancelArmed) Red else accent,
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
            .background(circleButtonFill())
            .border(1.dp, CircleButtonEdge, CircleShape)
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

/** Edit window: one minute from send, text messages only (enforced server-side too). */
@Composable
private fun EditDialog(original: String, onClose: () -> Unit, onSave: (String) -> Unit) {
    // Owner round 31: a bottom sheet, like every other popup in the app.
    var text by remember { mutableStateOf(original) }
    KpSheet(onDismiss = onClose, title = "Edit message") {
        Column(Modifier.padding(horizontal = 14.dp).imePadding()) {
            OutlinedTextField(
                text,
                { text = it.take(4000) },
                singleLine = false,
                shape = RoundedCornerShape(14.dp),
                maxLines = 4,
                colors =
                    OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = ActionBlue,
                        unfocusedBorderColor = Line,
                        cursorColor = ActionBlue,
                        focusedTextColor = Ink,
                        unfocusedTextColor = Ink,
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            GoldBtn("Save", Modifier.fillMaxWidth(), enabled = text.isNotBlank() && text.trim() != original) {
                onSave(text.trim())
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}

/** Pick a conversation to forward the selected message(s) to. */
@Composable
internal fun ForwardDialog(onClose: () -> Unit, onSend: (List<String>) -> Unit, title: String = "Forward to") {
    // Owner round 14: forward was a cramped popup with mismatched colors —
    // now a FULLSCREEN picker sheet: back arrow header, themed background,
    // the whole conversation list to pick from.
    // Owner round 32 (item 37): tapping a row TICKS it (rounded check), as
    // many chats as wanted; the Send bar at the bottom fires them all at once.
    val convs = ScreenStore.convs
    val picked = remember { mutableStateListOf<String>() }
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
                Text(title, color = Ink, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            }
            Text(
                if (picked.isEmpty()) "${convs.size} chats" else "${picked.size} selected",
                color = Muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
            Spacer(Modifier.height(6.dp))
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (convs.isEmpty()) {
                    item { Text("No chats yet.", color = Muted, fontSize = 14.sp, modifier = Modifier.padding(16.dp)) }
                }
                items(convs, key = { it.optString("id") }) { c ->
                    val id = c.optString("id")
                    val on = id in picked
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
                            .background(if (on) ChipSelected else Card)
                            .border(1.dp, if (on) ActionBlue else Line, RoundedCornerShape(14.dp))
                            .clickable { if (on) picked.remove(id) else picked.add(id) }
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
                        Text(
                            name,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Medium,
                            color = Ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(10.dp))
                        // Rounded check — filled when picked, hollow ring otherwise.
                        Box(
                            Modifier
                                .size(22.dp)
                                .clip(CircleShape)
                                .background(if (on) ActionBlue else Color.Transparent)
                                .border(1.5.dp, if (on) ActionBlue else Muted, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (on) Icon(Icons.Filled.Check, null, tint = ActionBlueInk, modifier = Modifier.size(14.dp))
                        }
                    }
                }
            }
            if (picked.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(Card)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${picked.size} selected",
                        color = Ink,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                        modifier = Modifier.weight(1f),
                    )
                    GoldBtn("Send", modifier = Modifier.width(112.dp)) { onSend(picked.toList()) }
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
        // Owner round 31 item 21: the capture guard must hold from the first
        // frame, not only after the detail fetch.
        .put("privateProfile", row.optJSONObject("other")?.optBoolean("privateProfile") ?: false)
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
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = ActionBlue, contentColor = ActionBlueInk),
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
                    colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Card, contentColor = Red),
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

/** Owner round 32 (item 21): the quoted status inside a status-reply bubble. */
@Composable
private fun StatusQuote(st: JSONObject, mine: Boolean, theme: String) {
    val kind = st.optString("kind")
    val caption = st.optText("text")
    val visual = kind == "IMAGE" || kind == "VIDEO"
    Row(
        Modifier
            .padding(bottom = 3.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (mine) Color(0x26FFFFFF) else if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.18f) else GoldSoft)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(2.5.dp).height(30.dp).clip(RoundedCornerShape(2.dp)).background(chatAccent(theme)))
        Spacer(Modifier.width(6.dp))
        Column(Modifier.weight(1f, fill = false)) {
            Text(
                "Status",
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (mine) Color(0xE6FFFFFF) else Ink,
                maxLines = 1,
            )
            Text(
                caption.ifBlank {
                    when (kind) {
                        "VIDEO" -> "Video"
                        "IMAGE" -> "Photo"
                        else -> "Status"
                    }
                }.take(64),
                fontSize = 11.sp,
                color = if (mine) Color(0xE6FFFFFF) else Ink,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            )
        }
        if (visual) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(34.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x22000000))) {
                KpNetImage(
                    "/api/statuses/${st.optString("id")}/media",
                    "Status",
                    Modifier.fillMaxSize(),
                )
                if (kind == "VIDEO") {
                    Icon(
                        Icons.Filled.PlayArrow,
                        null,
                        tint = Color.White,
                        modifier = Modifier.size(16.dp).align(Alignment.Center),
                    )
                }
            }
        }
    }
}

/** Owner round 13e: the swipe-reply quote bar above the composer. */
/** Owner round 32 (item 18): the chat's parked "send later" rows, as one
 *  compact chip above the composer — count + the next time. Tap → the list. */
@Composable
private fun ScheduledChip(rows: List<JSONObject>, theme: String, onOpen: () -> Unit) {
    if (rows.isEmpty()) return
    val next = rows.minByOrNull { it.optString("sendAt") } ?: return
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.End,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(Card)
                .border(1.dp, Line, RoundedCornerShape(14.dp))
                .clickable(onClick = onOpen)
                .padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Schedule, null, tint = chatAccent(theme), modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                (if (rows.size > 1) "${rows.size} · " else "") + scheduleStamp(next.optString("sendAt")),
                color = Ink,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
        }
    }
}

/** "Today 9:30 PM" / "Tomorrow 8:00 AM" / "12 Sep 8:00 AM" — Bangladesh time. */
internal fun scheduleStamp(iso: String): String {
    val t = runCatching { java.time.Instant.parse(iso) }.getOrNull() ?: return ""
    val z = atDhaka(t)
    val now = dhakaNow()
    val clock =
        String.format(
            "%d:%02d %s",
            (z.hour % 12).let { if (it == 0) 12 else it },
            z.minute,
            if (z.hour >= 12) "PM" else "AM",
        )
    val day =
        when (z.toLocalDate()) {
            now.toLocalDate() -> "Today"
            now.toLocalDate().plusDays(1) -> "Tomorrow"
            else -> "${z.dayOfMonth} ${z.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
        }
    return "$day $clock"
}

/** Owner round 32 (item 18): the "send later" sheet — quick picks first,
 *  then a custom date + time (hour / minute wheels, no dialogs). */
@Composable
private fun ScheduleSheet(onClose: () -> Unit, onPick: (java.time.Instant) -> Unit) {
    val haptics = rememberHaptics()
    val now = dhakaNow().withSecond(0).withNano(0)
    val quick =
        listOf(
            "In 1 hour" to now.plusHours(1),
            "Tonight 9 PM" to now.withHour(21).withMinute(0).let { if (it.isAfter(now)) it else it.plusDays(1) },
            "Tomorrow 8 AM" to now.plusDays(1).withHour(8).withMinute(0),
            "Tomorrow 6 PM" to now.plusDays(1).withHour(18).withMinute(0),
        )
    var custom by remember { mutableStateOf(false) }
    // Custom: day offset (0..29) + 12-hour clock.
    var dayOff by remember { mutableStateOf(0) }
    var hour12 by remember { mutableStateOf(((now.hour + 1) % 12).let { if (it == 0) 12 else it }) }
    var minute by remember { mutableStateOf(0) }
    var pm by remember { mutableStateOf((now.hour + 1) % 24 >= 12) }
    val picked =
        now.toLocalDate().plusDays(dayOff.toLong()).atTime((hour12 % 12) + if (pm) 12 else 0, minute).atZone(DHAKA)
    val valid = picked.isAfter(now)
    KpSheet(onDismiss = onClose, title = "Send later") {
        if (!custom) {
            quick.forEach { (label, at) ->
                KpSheetRow(Icons.Filled.Schedule, label) { onPick(at.toInstant()) }
            }
            KpSheetRow(Icons.Filled.Edit, "Pick date & time") { custom = true }
        } else {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf(0 to "Today", 1 to "Tomorrow", 2 to "In 2 days", 7 to "In a week").forEach { (d, label) ->
                    val on = dayOff == d
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (on) ChipSelected else ChipIdle)
                            .clickable { haptics.tap(); dayOff = d }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label,
                            color = if (on) ActionBlueDeep else Ink,
                            fontSize = 12.sp,
                            fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                NumberWheel(value = hour12, range = 1..12, modifier = Modifier.weight(1f)) { hour12 = it }
                Text(":", color = Ink, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                NumberWheel(value = minute, range = 0..55 step 5, pad = true, modifier = Modifier.weight(1f)) { minute = it }
                Column(Modifier.weight(0.8f), horizontalAlignment = Alignment.CenterHorizontally) {
                    listOf(false to "AM", true to "PM").forEach { (isPm, label) ->
                        val on = pm == isPm
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 2.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(if (on) ChipSelected else ChipIdle)
                                .clickable { haptics.tap(); pm = isPm }
                                .padding(vertical = 8.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                label,
                                color = if (on) ActionBlueDeep else Ink,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
            Text(
                if (valid) scheduleStamp(picked.toInstant().toString()) else "Pick a later time",
                color = if (valid) Ink else Red,
                fontSize = 12.5.sp,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                textAlign = TextAlign.Center,
            )
            GoldBtn(
                "Schedule",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
                enabled = valid,
            ) { onPick(picked.toInstant()) }
        }
    }
}

/** A small − N + stepper (no dialog, no keyboard) for the custom time. */
@Composable
private fun NumberWheel(
    value: Int,
    range: IntProgression,
    modifier: Modifier = Modifier,
    pad: Boolean = false,
    onChange: (Int) -> Unit,
) {
    val values = range.toList()
    val haptics = rememberHaptics()
    val idx = values.indexOf(value).coerceAtLeast(0)
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(ChipIdle)
                .clickable { haptics.tap(); onChange(values[(idx + 1) % values.size]) },
            contentAlignment = Alignment.Center,
        ) { Text("+", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }
        Text(
            if (pad) String.format("%02d", value) else value.toString(),
            color = Ink,
            fontSize = 26.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        Box(
            Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(ChipIdle)
                .clickable { haptics.tap(); onChange(values[(idx - 1 + values.size) % values.size]) },
            contentAlignment = Alignment.Center,
        ) { Text("−", color = Ink, fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }
    }
}

/** Owner round 32 (item 18): the parked rows of this chat — preview · time,
 *  X cancels (server-side; the row simply never goes out). */
@Composable
private fun ScheduledSheet(rows: List<JSONObject>, onClose: () -> Unit, onCancel: (String) -> Unit) {
    val haptics = rememberHaptics()
    LaunchedEffect(rows.size) { if (rows.isEmpty()) onClose() }
    KpSheet(onDismiss = onClose, title = "Scheduled") {
        rows.forEach { r ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Schedule, null, tint = Muted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        r.optString("preview").ifBlank { r.optString("body") }.ifBlank { "Message" },
                        color = Ink,
                        fontSize = 14.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(scheduleStamp(r.optString("sendAt")), color = Muted, fontSize = 12.sp, maxLines = 1)
                }
                IconButton(onClick = { haptics.heavy(); onCancel(r.optString("id")) }, modifier = Modifier.size(30.dp)) {
                    Icon(Icons.Filled.Close, "Cancel", tint = Red, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
private fun ReplyQuoteBar(replyTo: JSONObject?, theme: String, onCancel: () -> Unit) {
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
            .padding(start = 8.dp, end = 4.dp, top = 3.dp, bottom = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .height(22.dp)
                .clip(RoundedCornerShape(2.dp))
                // Owner round 31: the reply "I" bar takes the CHAT's accent
                // (it stayed app-blue under a mint/rose/cream chat).
                .background(chatAccent(theme)),
        )
        Spacer(Modifier.width(8.dp))
        // Owner round 32 (item 22): one line — "You  hello" — instead of a
        // two-line card that pushed the composer up by a whole row.
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                    append(
                        if (replyTo.optString("senderId") == Store.myId()) "You"
                        else (replyTo.optText("senderName") ?: "").ifBlank { "Reply" },
                    )
                }
                append("  ")
                append(
                    if (isViewOnce(replyTo)) (if (fileLooksVideo(replyTo)) "Video · View once" else "Photo · View once")
                    else ((replyTo.optText("body") ?: "").ifBlank { "Media" }).take(80),
                )
            },
            fontSize = 12.sp,
            // Owner round 17: gold-on-gold-soft was unreadable — full ink.
            color = Ink,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onCancel, modifier = Modifier.size(26.dp)) {
            Icon(Icons.Filled.Close, "Cancel reply", tint = Muted, modifier = Modifier.size(15.dp))
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
    theme: String = "darkblue",
    onOpenVideo: (JSONObject) -> Unit = {},
    onOpenAlbum: (JSONObject) -> Unit = {},
    onOpenDoc: (JSONObject) -> Unit = {},
) {
    val mine = m.optString("senderId") == myId
    val kind = m.optString("kind")
    // Owner round 21: event sounds (reply swipe) play from the row itself.
    val ctx = LocalContext.current
    // Owner round 15: the night theme's other-bubble is dark in BOTH app
    // themes — its text needs a light ink or it vanishes in light mode.
    // Owner round 20: the DARK-BLUE default chat has dark bubbles on both
    // sides, so both sides carry the light ink in either app theme.
    val bodyInk = when {
        theme == "darkblue" -> Color(0xFFE6EAF2)
        !mine && theme == "night" -> Color(0xFFE6EAF2)
        else -> Ink
    }
    val stampInk = when {
        theme == "darkblue" -> Color(0xFFA9B4CC)
        !mine && theme == "night" -> Color(0xFFA9B4CC)
        else -> Muted
    }
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
        CallLogBubble(m, mine, pendingEcho, theme)
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
    // Owner round 31 (item 29): photos sent together = one grouped bubble.
    if (m.has("kpAlbum")) {
        AlbumMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onOpenAlbum, onReply, onLongPress)
        return
    }
    // Owner round 32 (item 17): a view-once photo / video never shows a
    // preview — a card ("Photo · View once" / "Opened") that opens the media
    // ONCE for the recipient; the sender only ever sees the card.
    if (isViewOnce(m)) {
        ViewOnceRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onOpenVideo, onReply, onLongPress, theme)
        return
    }
    if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))) {
        ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onReply, onLongPress)
        return
    }
    // Owner round 20: videos render as a tappable video bubble and play
    // IN-APP (the system player could never stream these auth-only files).
    if (kind == "FILE" && fileLooksVideo(m) && !sentAsDocument(m)) {
        VideoMessageRow(m, mine, selectedIds, onToggleSelect, onReply, onLongPress, onOpenVideo)
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
            // Owner round 31: emoji-only texts (1–3) render big, stamp underneath.
            // Owner round 32 (item 15): no "edited" marker anywhere — an edited
            // text is just the text (so an emoji-only edit stays emoji-only too).
            val emojiOnly = if (kind == "TEXT") emojiOnlyCount(m.optText("body")) else 0
            // Owner round 32 (items 45 / 34): a voice note's duration line —
            // and a document row's size line — share ONE line with the stamp,
            // so FILE bubbles keep no bottom band (photos / videos never get here).
            val fileRow = kind == "FILE"
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
                                // Owner round 17: the left swipe was touchy —
                                // it now needs half again as much distance and
                                // barely overshoots.
                                val wasArmed = kotlin.math.abs(replyDrag) >= (if (mine) replyThreshold * 1.5f else replyThreshold)
                                replyDrag =
                                    if (mine) {
                                        (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.5f, 0f)
                                    } else {
                                        (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.8f)
                                    }
                                // Owner round 32 (item 40): the finger feels the
                                // reply point — one tap when the swipe arms.
                                if (!wasArmed && kotlin.math.abs(replyDrag) >= (if (mine) replyThreshold * 1.5f else replyThreshold)) haptics.tap()
                            },
                            onDragEnd = {
                                val need =
                                    if (mine) replyThreshold * 1.5f else replyThreshold
                                val armed = kotlin.math.abs(replyDrag) >= need
                                replyDrag = 0f
                                // Owner round 22: deleted/unsent messages can
                                // no longer be replied to.
                                if (armed && m.optString("kind") != "DELETED") {
                                    // Owner round 21: his reply-swipe sound.
                                    runCatching { KpSounds.replySwipe(ctx) }
                                    onReply(m)
                                }
                            },
                            onDragCancel = { replyDrag = 0f },
                        )
                    }
                    .widthIn(min = if (emojiOnly > 0) 0.dp else 72.dp, max = bubbleMax)
                    .wrapContentWidth()
                    // Owner round 10: the same soft 3D lift the call buttons
                    // have — bubbles float on the wallpaper now.
                    // Owner round 32 (item 8): an emoji-only message has NO
                    // bubble at all — no lift, no fill — the glyph sits on the
                    // wallpaper with its stamp under it.
                    .then(if (emojiOnly > 0) Modifier else Modifier.shadow(2.dp, bubbleShape))
                    .clip(bubbleShape)
                    .background(
                        when {
                            emojiOnly > 0 -> Brush.linearGradient(listOf(Color.Transparent, Color.Transparent))
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
                                // Owner round 31: selection only while selecting;
                                // otherwise the action sheet takes over.
                                if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
                            }
                        },
                    )
                    // Owner round 13: TEXT bubbles reserve the stamp's width
                    // INLINE (trailing non-breaking spaces glued to the last
                    // word — the WhatsApp trick), so the overlay can never
                    // overlap a glyph and never leaves a blank strip under
                    // the text. Other kinds keep the small bottom band —
                    // except FILE rows (items 45 / 34), whose second line
                    // already leaves the stamp its corner.
                    .padding(start = 10.dp, top = 4.dp, end = 8.dp, bottom = if (fileRow) 4.dp else if (kind == "TEXT" && emojiOnly == 0) 0.dp else 15.dp),
            ) {
                val senderName = m.optText("senderName")
                Column {
                    // Owner round 32 (item 21): a reply to a status quotes it —
                    // a small thumbnail for a photo / video status, the caption
                    // for a text one (never the word "null").
                    m.optJSONObject("meta")?.optJSONObject("status")?.let { st ->
                        StatusQuote(st, mine, theme)
                    }
                    // Owner round 13: quoted original when this is a reply.
                    m.optString("replyTo").takeIf { it.isNotBlank() }?.let { rid ->
                        val q = quoteFor(rid)
                        // Owner round 32 (item 22): compact quote — name and
                        // text on ONE line ("You · hello"), a 20 dp stripe,
                        // tighter padding; it used to be a two-line block
                        // nearly as tall as the reply itself.
                        val who =
                            if (q?.optString("senderId") == myId) "You"
                            else (q?.optText("senderName") ?: "").ifBlank { "Original" }
                        val what =
                            if (q != null && isViewOnce(q)) (if (fileLooksVideo(q)) "Video · View once" else "Photo · View once")
                            else q?.optText("body")?.take(48)?.ifBlank { "Media" } ?: "Original message"
                        Row(
                            Modifier
                                .padding(bottom = 2.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (mine) Color(0x26FFFFFF) else if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.18f) else GoldSoft)
                                .padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Owner round 21: the quote bar takes the chat accent.
                            Box(Modifier.width(2.5.dp).height(20.dp).clip(RoundedCornerShape(2.dp)).background(chatAccent(theme)))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                buildAnnotatedString {
                                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(who) }
                                    append("  ")
                                    append(what)
                                },
                                fontSize = 11.sp,
                                // Owner round 16/17: full ink — readable on every themed bubble.
                                color = if (mine) Color(0xE6FFFFFF) else Ink,
                                maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                            )
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
                        "FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme, onOpenDoc)
                        "DELETED" -> Text(
                            // Owner round 18: the same trailing reserve the
                            // text path uses — the stamp sat ON the deleted
                            // text before (normal bubbles: untouched).
                            "This message was deleted" + if (mine) "                  " else "            ",
                            fontSize = 13.5.sp,
                            fontStyle = FontStyle.Italic,
                            color = Color(0xFF4A463F),
                        )
                        else -> if (emojiOnly > 0) {
                            // Owner round 32 (item 8): the stamp row sits in the
                            // 15 dp bottom band below the glyph (never over it);
                            // a little end room keeps a wide tick row clear too.
                            Text(
                                m.optText("body").trim(),
                                fontSize = if (emojiOnly == 1) 44.sp else 34.sp,
                                lineHeight = if (emojiOnly == 1) 52.sp else 40.sp,
                                modifier = Modifier.padding(start = 2.dp, end = if (mine) 30.dp else 10.dp, bottom = 3.dp),
                            )
                        } else {
                            //   runs glue to the last word, so the stamp's
                            // spot travels WITH the final line — no separate
                            // line, no overlap, no drifting left.
                            val reserve = if (mine) "                 " else "            "
                            val full = m.optText("body") + reserve
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
                                // Owner round 32 (item 32): a link in the text
                                // is a real link (underlined, tap opens it) and
                                // the first one gets a preview card above the
                                // text. In select mode taps stay with the bubble.
                                val selecting = selectedIds.isNotEmpty()
                                val linked =
                                    remember(full, bodyInk, selecting) {
                                        if (selecting) null
                                        else Links.annotate(full, bodyInk) { u -> Links.open(ctx, u) }
                                    }
                                val firstLink = remember(full) { Links.first(full) }
                                if (firstLink != null) {
                                    LinkPreviewCard(
                                        url = firstLink,
                                        mine = mine,
                                        ink = bodyInk,
                                        onOpen = if (selecting) null else ({ Links.open(ctx, firstLink) }),
                                    )
                                }
                                if (linked != null) Text(linked, fontSize = 14.5.sp, lineHeight = 19.sp, color = bodyInk)
                                else Text(full, fontSize = 14.5.sp, lineHeight = 19.sp, color = bodyInk)
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
                    Modifier.align(Alignment.BottomEnd).padding(end = 2.dp, bottom = if (kind == "TEXT" && emojiOnly == 0) 3.dp else 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        msgStamp(m.optString("createdAt")),
                        fontSize = 10.sp,
                        // r32-8: no bubble under an emoji — the stamp reads in
                        // the wallpaper's ink instead of bubble-white.
                        color = if (mine && emojiOnly == 0) Color(0xD9FFFFFF) else stampInk,
                    )
                    if (mine) {
                        Spacer(Modifier.width(3.dp))
                        TickIcon(m, pendingEcho, otherReadAt, onWallpaper = emojiOnly > 0, ink = stampInk)
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
        // Owner round 22: bare emojis — no chip background, no border.
        grouped.forEach { (emoji, count) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(emoji, fontSize = 17.sp)
                if (count > 1) {
                    Spacer(Modifier.width(2.dp))
                    Text("$count", fontSize = 10.sp, color = Muted)
                }
            }
        }
    }
}

/** Owner round 16/17: the full reaction sheet — a BOTTOM sheet, the same
 *  pattern as the login screen's country picker. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun EmojiSheetDialog(onPick: (String) -> Unit) {
    val emojis = listOf(
        "👍", "👎", "❤️", "🩷", "😂", "🥰", "😮", "😢", "😡", "🙏",
        "🔥", "🎉", "😍", "😭", "😅", "🤔", "💯", "👏", "🤝", "😎",
        "🥳", "😴", "🤯", "😱", "🤗", "😇", "😉", "🤫", "✌️", "💪",
        "🌟", "⭐", "❤️‍🔥", "😊", "🙃", "😌", "😬", "🫡", "🤩", "😴",
    )
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = { onPick("") },
        containerColor = Card,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 12.dp, vertical = 6.dp),
        ) {
            Text("React", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp))
            emojis.chunked(5).forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    row.forEach { e ->
                        Text(
                            e,
                            fontSize = 26.sp,
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable { onPick(e) }
                                .padding(8.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
        }
    }
}

/** True when a FILE message is really just a photo (image mime / extension). */
/** Owner round 22: decoded-frame thumbnails cached in MEMORY — a chat's
 *  videos stop re-decoding on every open. */
internal object VideoThumbs {
    /** Memory net for the CURRENT process. */
    private val lru = object : LinkedHashMap<String, android.graphics.Bitmap>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, android.graphics.Bitmap>?): Boolean =
            size > 48
    }

    /**
     * Owner round 23: the LRU died with the process, so every app open
     * re-decoded every video and the bubble flashed the wrong (16:9)
     * placeholder ratio until the retriever finished ("prottekbar app open
     * placeholder a oi ratio te dekhai, catch thake na"). The ratio/duration
     * meta and a small JPEG thumb now persist next to the cached video file —
     * key is the cache file path, so the meta survives restarts and is read
     * synchronously (a few bytes) to size the bubble correctly on the FIRST
     * frame.
     */
    data class Meta(val ratio: Float, val durationMs: Long)

    private fun metaFile(key: String) = java.io.File(key + ".meta")
    private fun thumbFile(key: String) = java.io.File(key + ".thumb.jpg")

    @Synchronized
    fun get(key: String): android.graphics.Bitmap? = lru[key]

    /** Tiny synchronous read — cheap enough for the composition path. */
    fun readMeta(key: String): Meta? = runCatching {
        val p = metaFile(key).takeIf { it.exists() }?.readText()?.split(",") ?: return null
        if (p.size < 3) return null
        val w = p[0].toFloatOrNull() ?: return null
        val h = p[1].toFloatOrNull() ?: return null
        if (w <= 0f || h <= 0f) return null
        Meta((w / h).coerceIn(0.5f, 2.2f), p[2].toLongOrNull() ?: 0L)
    }.getOrNull()

    fun readThumb(key: String): android.graphics.Bitmap? = runCatching {
        val f = thumbFile(key).takeIf { it.exists() } ?: return null
        android.graphics.BitmapFactory.decodeFile(f.absolutePath)
    }.getOrNull()

    @Synchronized
    fun put(key: String, bmp: android.graphics.Bitmap, w: Float = 0f, h: Float = 0f, ms: Long = 0L) {
        lru[key] = bmp
        runCatching {
            if (w > 0f && h > 0f) metaFile(key).writeText("$w,$h,$ms")
            val maxW = 480
            val scaled =
                if (bmp.width > maxW) {
                    android.graphics.Bitmap.createScaledBitmap(bmp, maxW, (bmp.height * maxW / bmp.width).toInt(), true)
                } else {
                    bmp
                }
            thumbFile(key).outputStream().use { out ->
                scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
            }
        }
    }
}

/** Owner round 20/22: video bubble — cached thumbnail at the video's OWN
 *  aspect ratio, play affordance, duration (only when known). Selectable,
 *  long-pressable (reactions) and swipe-replyable like photos. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun VideoMessageRow(
    m: JSONObject,
    mine: Boolean,
    selectedIds: List<String>,
    onToggleSelect: (JSONObject) -> Unit,
    onReply: (JSONObject) -> Unit,
    onLongPress: (JSONObject) -> Unit,
    onOpen: (JSONObject) -> Unit,
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val dest = remember(m.optString("id")) { videoCacheFile(ctx, m) }
    val cacheKey = remember(m.optString("id")) { dest.absolutePath }
    // Round 23: seed ratio/duration from the PERSISTENT meta when it exists,
    // so the first frame already carries the video's own aspect ratio instead
    // of flashing 16:9 and jumping once the decoder reports the real size.
    val seedMeta = remember(m.optString("id")) { VideoThumbs.readMeta(cacheKey) }
    var ratio by remember(m.optString("id")) { mutableStateOf(seedMeta?.ratio ?: (16f / 9f)) }
    var duration by remember(m.optString("id")) {
        val ms0 = seedMeta?.durationMs ?: 0L
        mutableStateOf(if (ms0 > 0L) "%d:%02d".format(ms0 / 1000 / 60, ms0 / 1000 % 60) else "")
    }
    val thumb by androidx.compose.runtime.produceState<android.graphics.Bitmap?>(
        VideoThumbs.get(cacheKey) ?: VideoThumbs.readThumb(cacheKey),
        m.optString("id"),
    ) {
        if (value != null) return@produceState
        if (!dest.exists()) return@produceState
        // w, h, durationMs captured out of the IO block for the disk meta.
        var w0 = 0f
        var h0 = 0f
        var ms0 = 0L
        value = withContext(Dispatchers.IO) {
            // No .use{}: close() is API 29+; release() is safe everywhere.
            val r = android.media.MediaMetadataRetriever()
            try {
                r.setDataSource(dest.absolutePath)
                val bmp = r.getFrameAtTime(0L, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                if (bmp != null) {
                    w0 = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toFloatOrNull() ?: 0f
                    h0 = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toFloatOrNull() ?: 0f
                    if (w0 > 0f && h0 > 0f) ratio = (w0 / h0).coerceIn(0.5f, 2.2f)
                    ms0 = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                    if (ms0 > 0L) duration = "%d:%02d".format(ms0 / 1000 / 60, ms0 / 1000 % 60)
                }
                bmp
            } catch (_: Exception) {
                null
            } finally {
                runCatching { r.release() }
            }
        }
        // Persist thumb + meta so the NEXT cold start renders this bubble
        // correctly on the first frame, without re-decoding (round 23).
        value?.let { VideoThumbs.put(cacheKey, it, w0, h0, ms0) }
    }
    // Owner round 22: photos-style reply drag on videos too.
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "vidreplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    val rowSelected = m.optString("id") in selectedIds
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column {
        Box(
            Modifier
                .offset { IntOffset(replyOffset.roundToInt(), 0) }
                .widthIn(max = 235.dp)
                .shadow(2.dp, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xFF0B1220))
                .border(1.dp, if (KpThemeMode.darkBlue) Color(0x668091AC) else Color(0x66444444), RoundedCornerShape(12.dp))
                .pointerInput(m.optString("id")) {
                    detectHorizontalDragGestures(
                        onHorizontalDrag = { change, dragAmount ->
                            change.consume()
                            val wasArmed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                            replyDrag =
                                if (mine) {
                                    (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.4f, 0f)
                                } else {
                                    (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.4f)
                                }
                            if (!wasArmed && kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f) haptics.tap()
                        },
                        onDragEnd = {
                            val armed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                            replyDrag = 0f
                            if (armed && m.optString("kind") != "DELETED") {
                                runCatching { KpSounds.replySwipe(ctx) }
                                onReply(m)
                            }
                        },
                        onDragCancel = { replyDrag = 0f },
                    )
                }
                .combinedClickable(
                    onClick = {
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onOpen(m)
                    },
                    onLongClick = {
                        haptics.tap()
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
                    },
                ),
        ) {
            // the frame keeps the video's OWN aspect ratio (16:9 until known)
            Box(
                Modifier
                    .fillMaxWidth(0.62f)
                    .aspectRatio(ratio)
                    .background(Color(0xFF101A2E)),
                contentAlignment = Alignment.Center,
            ) {
                val bmp = thumb
                if (bmp != null) {
                    androidx.compose.foundation.Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "Video",
                        contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                } else {
                    Icon(
                        Icons.Filled.Videocam,
                        "Video",
                        tint = Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.size(34.dp),
                    )
                }
                Box(
                    Modifier
                        .size(46.dp)
                        .clip(CircleShape)
                        .background(Color(0x99000000)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(30.dp))
                }
                if (duration.isNotBlank()) {
                    Text(
                        duration,
                        color = Color.White,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(6.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0x88000000))
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
                if (rowSelected) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(ActionBlue.copy(alpha = 0.35f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.Check, "Selected", tint = Color.White, modifier = Modifier.size(28.dp))
                    }
                }
            }
        }
        MessageReactions(m)
        }
    }
}

/**
 * Owner round 32 (item 17): the view-once bubble — a compact card in the chat
 * accent with a ① mark and "Photo · View once" / "Video · View once"; after the
 * opening it reads "Opened" (dimmed, no tap). The recipient's tap opens the
 * app's own viewer / player under capture guard; the sender's tap does
 * nothing (they cannot re-see it either). Reply-drag and long-press behave
 * like every other bubble.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ViewOnceRow(
    m: JSONObject,
    mine: Boolean,
    pendingEcho: Boolean,
    otherReadAt: String?,
    selectedIds: List<String>,
    onToggleSelect: (JSONObject) -> Unit,
    onOpenImage: (JSONObject) -> Unit,
    onOpenVideo: (JSONObject) -> Unit,
    onReply: (JSONObject) -> Unit,
    onLongPress: (JSONObject) -> Unit,
    theme: String,
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val video = fileLooksVideo(m)
    val spent = viewOnceSpent(m)
    // The recipient can open it while it is unspent; the sender never can.
    val openable = !mine && !spent && !pendingEcho
    val label =
        when {
            spent -> "Opened"
            video -> "Video · View once"
            else -> "Photo · View once"
        }
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "oncereplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    val rowSelected = m.optString("id") in selectedIds
    val bubbleShape =
        RoundedCornerShape(
            topStart = 16.dp,
            topEnd = 16.dp,
            bottomStart = if (mine) 16.dp else 5.dp,
            bottomEnd = if (mine) 5.dp else 16.dp,
        )
    val ink = if (mine) Color.White else if (theme == "darkblue" || (theme == "night")) Color(0xFFE6EAF2) else Ink
    val stampInk = if (mine) Color(0xD9FFFFFF) else if (theme == "darkblue" || theme == "night") Color(0xFFA9B4CC) else Muted
    val upFrac = UploadProgress.fracs[m.optString("clientId")]
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Box(
                Modifier
                    .offset { IntOffset(replyOffset.roundToInt(), 0) }
                    .pointerInput(m.optString("id")) {
                        detectHorizontalDragGestures(
                            onHorizontalDrag = { change, dragAmount ->
                                change.consume()
                                val wasArmed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                                replyDrag =
                                    if (mine) {
                                        (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.4f, 0f)
                                    } else {
                                        (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.4f)
                                    }
                                if (!wasArmed && kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f) haptics.tap()
                            },
                            onDragEnd = {
                                val armed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                                replyDrag = 0f
                                if (armed) {
                                    runCatching { KpSounds.replySwipe(ctx) }
                                    onReply(m)
                                }
                            },
                            onDragCancel = { replyDrag = 0f },
                        )
                    }
                    .shadow(2.dp, bubbleShape)
                    .clip(bubbleShape)
                    .background(if (mine) chatMineFill(theme) else chatOtherFill(theme))
                    .then(if (rowSelected) Modifier.background(ActionBlue.copy(alpha = 0.35f)) else Modifier)
                    .combinedClickable(
                        onClick = {
                            when {
                                pendingEcho -> {}
                                selectedIds.isNotEmpty() -> onToggleSelect(m)
                                openable -> if (video) onOpenVideo(m) else onOpenImage(m)
                                else -> {}
                            }
                        },
                        onLongClick = {
                            if (!pendingEcho) {
                                haptics.tap()
                                if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
                            }
                        },
                    )
                    .padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 6.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // ① mark — a ring with the digit; struck through once spent.
                        Box(
                            Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .border(1.5.dp, ink.copy(alpha = if (spent) 0.45f else 0.9f), CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (upFrac != null) {
                                CircularProgressIndicator(
                                    progress = { upFrac },
                                    color = ink,
                                    strokeWidth = 2.dp,
                                    trackColor = ink.copy(alpha = 0.22f),
                                    modifier = Modifier.size(26.dp),
                                )
                            } else {
                                Text(
                                    "1",
                                    color = ink.copy(alpha = if (spent) 0.45f else 1f),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    textDecoration = if (spent) androidx.compose.ui.text.style.TextDecoration.LineThrough else null,
                                )
                            }
                        }
                        Spacer(Modifier.width(9.dp))
                        Text(
                            label,
                            color = ink.copy(alpha = if (spent) 0.6f else 1f),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            fontStyle = if (spent) FontStyle.Italic else FontStyle.Normal,
                            maxLines = 1,
                            // the stamp row sits under the text's end
                            modifier = Modifier.padding(end = 6.dp),
                        )
                    }
                    Row(
                        Modifier.align(Alignment.End).padding(top = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(msgStamp(m.optString("createdAt")), fontSize = 10.sp, color = stampInk)
                        if (mine) {
                            Spacer(Modifier.width(3.dp))
                            TickIcon(m, pendingEcho, otherReadAt, onWallpaper = false, ink = stampInk)
                        }
                    }
                }
            }
            MessageReactions(m)
        }
    }
}

/** Owner round 31 (item 16): picked via "Document" — never the photo/video bubble. */
internal fun sentAsDocument(m: JSONObject): Boolean = m.optJSONObject("meta")?.optBoolean("document") == true

/** Owner round 32 (item 45): a voice note (recorded in-app or an audio file
 *  sent as media) — the row uses it to drop the bubble's bottom band. */
internal fun fileLooksVoice(m: JSONObject): Boolean {
    val type = m.optString("fileType")
    val name = m.optString("fileName").lowercase()
    return type.startsWith("audio") || name.endsWith(".m4a") || name.endsWith(".mp3") ||
        m.optJSONObject("meta")?.optBoolean("voice") == true
}

internal fun fileLooksVideo(m: JSONObject): Boolean {
    val type = m.optString("fileType")
    if (type.startsWith("video")) return true
    val name = m.optString("fileName").lowercase()
    return name.endsWith(".mp4") || name.endsWith(".mkv") || name.endsWith(".webm") ||
        name.endsWith(".mov") || name.endsWith(".3gp") || name.endsWith(".avi")
}

/** Owner round 20: videos download to a local cache (files need the auth
 *  header, so a raw URL can never work in a system player) and play in-app. */
internal fun videoCacheFile(ctx: android.content.Context, m: JSONObject): java.io.File {
    val key = m.optText("fileKey").ifBlank {
        m.optText("mediaUrl").replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank { "v" }
    }
    val safe = key.replace(Regex("[^A-Za-z0-9._-]"), "_").takeLast(80)
    return java.io.File(java.io.File(ctx.filesDir, "kp-video-cache").apply { mkdirs() }, safe)
}

internal fun videoSource(m: JSONObject): String {
    val key = m.optText("fileKey")
    if (key.isNotBlank()) return "/api/files/$key"
    return m.optText("mediaUrl")
}

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
    // Owner round 21: the photo reply-swipe sound plays from the row.
    val ctx = LocalContext.current
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
        // Owner round 18: the photo bubble + its reaction chips stack in a
        // column, so a reaction on a PHOTO actually renders (the chips were
        // only wired into the text path — reacting to a photo did nothing
        // visible).
        Column {
        Box(
            Modifier
                .offset { IntOffset(replyOffset.roundToInt(), 0) }
                .widthIn(max = 150.dp) // Owner round 25 / round 32 item 29: smaller inline preview
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
                            // Owner round 17: calmer — needs a longer, more
                            // deliberate drag and barely overshoots.
                            val wasArmed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                            replyDrag =
                                if (mine) {
                                    (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.4f, 0f)
                                } else {
                                    (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.4f)
                                }
                            if (!wasArmed && kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f) haptics.tap()
                        },
                        onDragEnd = {
                            val armed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                            replyDrag = 0f
                            if (armed && m.optString("kind") != "DELETED") {
                                // Owner round 21: his reply-swipe sound.
                                runCatching { KpSounds.replySwipe(ctx) }
                                onReply(m)
                            }
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
                            if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
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
        MessageReactions(m)
        }
    }
}

/** A photo row: kind IMAGE, or an image FILE that was not sent as a document. */
/**
 * Owner round 32 (item 46): post a copy of [m] into [targetConvId] — used by the
 * chat's multi-select Forward and by the full-screen photo / video viewers.
 * Runs on IO: the old in-composable loop issued the POST on the main thread,
 * which the OS refuses (NetworkOnMainThread), so text forwards silently died
 * inside runCatching while the "Forwarded" toast still showed.
 */
internal suspend fun forwardMessageTo(targetConvId: String, m: JSONObject, albumMeta: JSONObject? = null) {
    withContext(Dispatchers.IO) {
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
                        .put("fileSize", m.optInt("fileSize"))
                        // Owner round 31 (item 27): a forwarded voice note
                        // stays a voice note — duration + bars come along.
                        .also { body ->
                            val vm = m.optJSONObject("meta")
                            if (vm?.optBoolean("voice") == true) {
                                body.put(
                                    "meta",
                                    JSONObject().put("voice", true).put("seconds", vm.optInt("seconds"))
                                        .also { mm -> vm.optJSONArray("waveform")?.let { mm.put("waveform", it) } },
                                )
                            } else if (vm?.optBoolean("document") == true) {
                                body.put("meta", JSONObject().put("document", true))
                            } else {
                                albumMeta?.let { body.put("meta", it) }
                            }
                        },
                )
            m.optText("mediaUrl").startsWith("data:") ->
                Api.post(
                    "/api/conversations/$targetConvId/messages",
                    JSONObject()
                        .put("kind", "IMAGE")
                        .put("imageData", m.optText("mediaUrl"))
                        .also { body -> albumMeta?.let { body.put("meta", it) } },
                )
            m.optText("mediaUrl").isNotBlank() -> {
                // Server-hosted media (photo message): re-upload to the
                // target chat so both chats own their own copy.
                val bytes = Api.download(m.optText("mediaUrl"))
                val up = Api.upload(m.optText("fileName").ifBlank { "photo.jpg" }, "image/jpeg", bytes)
                Api.post(
                    "/api/conversations/$targetConvId/messages",
                    JSONObject()
                        .put("kind", "FILE")
                        .put("fileKey", up.optString("fileKey"))
                        .put("fileName", m.optText("fileName").ifBlank { "photo.jpg" })
                        .put("fileType", "image/jpeg")
                        .put("fileSize", bytes.size)
                        .also { body -> albumMeta?.let { body.put("meta", it) } },
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

private fun isPhotoMsg(m: JSONObject): Boolean {
    val kind = m.optString("kind")
    return kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))
}

/** Owner round 31 (item 29): a fresh album id for photos sent together
 *  (the worker pins the `alb_` shape and length). */
internal fun newAlbumId(): String = "alb_" + java.util.UUID.randomUUID().toString().replace("-", "").take(20)

/** The album a photo row belongs to (meta.album), "" for anything else. */
internal fun albumIdOf(m: JSONObject): String {
    val a = m.optJSONObject("meta")?.optString("album").orEmpty()
    return if (a.isNotBlank() && isPhotoMsg(m) && !isViewOnce(m)) a else ""
}

/** Owner round 32 (item 17): a view-once photo / video (meta.viewOnce). */
internal fun isViewOnce(m: JSONObject): Boolean =
    m.optBoolean("viewOnce") || m.optJSONObject("meta")?.optBoolean("viewOnce") == true

/** Already opened by the recipient (the object is gone). */
internal fun viewOnceSpent(m: JSONObject): Boolean =
    isViewOnce(m) && (m.optText("viewedAt").isNotBlank() || (m.optJSONObject("meta")?.optString("viewedAt").orEmpty().isNotBlank()))

/**
 * Owner round 32 (item 17): reports the single opening to the server (POST
 * /api/messages/:id/view). Process-level and de-duplicated per id: the viewer
 * calls it when the picture / clip is on screen, and a recomposition or a
 * second tap in the same second must not fire twice. The room broadcast that
 * follows repaints the bubble as "Opened" on every device (sender included).
 */
object ViewOnce {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val spent = java.util.Collections.synchronizedSet(HashSet<String>())

    fun spend(messageId: String) {
        if (messageId.isBlank() || !spent.add(messageId)) return
        scope.launch {
            val ok = runCatching { Api.post("/api/messages/$messageId/view", JSONObject()) }.isSuccess
            // A network blip must not leave the opening unreported forever —
            // let the next viewing report again (the server refuses a repeat
            // with 410, which is harmless).
            if (!ok) spent.remove(messageId)
            withContext(Dispatchers.Main) { ScreenStore.pokeInbox() }
        }
    }
}

/**
 * Owner round 31 (item 29): rows that share meta.album (same sender) fold
 * into ONE list row — a copy of the group's first row carrying every photo
 * under "kpAlbum". A group of one (the rest unsent) stays a plain photo, and
 * rows outside any album keep their identity, so LazyColumn's skip-unchanged
 * path is untouched for them.
 */
internal fun foldAlbums(rows: List<JSONObject>): List<JSONObject> {
    if (rows.none { albumIdOf(it).isNotBlank() }) return rows
    val groups = LinkedHashMap<String, MutableList<JSONObject>>()
    for (r in rows) {
        val a = albumIdOf(r)
        if (a.isNotBlank()) groups.getOrPut(r.optString("senderId") + "|" + a) { ArrayList() }.add(r)
    }
    val out = ArrayList<JSONObject>(rows.size)
    val emitted = HashSet<String>()
    for (r in rows) {
        val a = albumIdOf(r)
        if (a.isBlank()) {
            out.add(r)
            continue
        }
        val key = r.optString("senderId") + "|" + a
        val g = groups[key] ?: continue
        if (g.size < 2) {
            out.add(r)
            continue
        }
        if (!emitted.add(key)) continue
        val first = g[0]
        val copy = JSONObject()
        val ks = first.keys()
        while (ks.hasNext()) {
            val k = ks.next()
            copy.put(k, first.opt(k))
        }
        copy.put("kpAlbum", JSONArray(g))
        out.add(copy)
    }
    return out
}

/** The photos of a folded album row (a plain row is its own one-photo list). */
internal fun albumPhotos(m: JSONObject): List<JSONObject> {
    val arr = m.optJSONArray("kpAlbum") ?: return listOf(m)
    val out = ArrayList<JSONObject>(arr.length())
    for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { out.add(it) }
    return if (out.isEmpty()) listOf(m) else out
}

/**
 * Owner round 31 (item 29): photos sent together — ONE bubble. 2 = side by
 * side, 3 = one tall + two stacked, 4 = a 2×2 grid, 5+ = the first row of a
 * 4-column grid: three photos and a dimmed fourth reading "See all". Every
 * tile opens the app's own viewer on THAT photo; the dimmed tile opens the
 * whole album. Long-press on any tile = the usual action sheet (which acts
 * on the whole album); the reply swipe is the photo bubble's.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AlbumMessageRow(
    m: JSONObject,
    mine: Boolean,
    pendingEcho: Boolean,
    otherReadAt: String?,
    selectedIds: List<String>,
    onToggleSelect: (JSONObject) -> Unit,
    onOpenImage: (JSONObject) -> Unit,
    onOpenAlbum: (JSONObject) -> Unit,
    onReply: (JSONObject) -> Unit = {},
    onLongPress: (JSONObject) -> Unit = {},
) {
    val photos = albumPhotos(m)
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "albumreplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    val shape = RoundedCornerShape(12.dp)
    val gap = 2.dp
    val albumWidth = 264.dp
    fun longPress() {
        if (!pendingEcho) {
            haptics.tap()
            if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
        }
    }
    fun tileModifier(base: Modifier, onTap: () -> Unit): Modifier =
        base.combinedClickable(
            onClick = {
                if (pendingEcho) return@combinedClickable
                if (selectedIds.isNotEmpty()) onToggleSelect(m) else onTap()
            },
            onLongClick = { longPress() },
        )
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column {
            Box(
                Modifier
                    .offset { IntOffset(replyOffset.roundToInt(), 0) }
                    .width(albumWidth)
                    .shadow(2.dp, shape)
                    .clip(shape)
                    .border(
                        1.dp,
                        if (KpThemeMode.darkBlue) Color(0x668091AC) else Color(0x66444444),
                        shape,
                    )
                    .pointerInput(m.optString("id")) {
                        detectHorizontalDragGestures(
                            onHorizontalDrag = { change, dragAmount ->
                                change.consume()
                                val wasArmed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                                replyDrag =
                                    if (mine) {
                                        (replyDrag + dragAmount).coerceIn(-replyThreshold * 1.4f, 0f)
                                    } else {
                                        (replyDrag + dragAmount).coerceIn(0f, replyThreshold * 1.4f)
                                    }
                                if (!wasArmed && kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f) haptics.tap()
                            },
                            onDragEnd = {
                                val armed = kotlin.math.abs(replyDrag) >= replyThreshold * 1.4f
                                replyDrag = 0f
                                if (armed) {
                                    runCatching { KpSounds.replySwipe(ctx) }
                                    onReply(m)
                                }
                            },
                            onDragCancel = { replyDrag = 0f },
                        )
                    },
            ) {
                when {
                    photos.size == 2 -> Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                        photos.forEach { p ->
                            AlbumTile(p, tileModifier(Modifier.weight(1f).aspectRatio(1f)) { onOpenImage(p) })
                        }
                    }
                    photos.size == 3 -> Row(
                        Modifier.height((albumWidth - gap) * 2 / 3),
                        horizontalArrangement = Arrangement.spacedBy(gap),
                    ) {
                        AlbumTile(photos[0], tileModifier(Modifier.weight(2f).fillMaxHeight()) { onOpenImage(photos[0]) })
                        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                            AlbumTile(photos[1], tileModifier(Modifier.weight(1f).fillMaxWidth()) { onOpenImage(photos[1]) })
                            AlbumTile(photos[2], tileModifier(Modifier.weight(1f).fillMaxWidth()) { onOpenImage(photos[2]) })
                        }
                    }
                    photos.size == 4 -> Column(verticalArrangement = Arrangement.spacedBy(gap)) {
                        photos.chunked(2).forEach { pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                                pair.forEach { p ->
                                    AlbumTile(p, tileModifier(Modifier.weight(1f).aspectRatio(1f)) { onOpenImage(p) })
                                }
                            }
                        }
                    }
                    else -> Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                        photos.take(3).forEach { p ->
                            AlbumTile(p, tileModifier(Modifier.weight(1f).aspectRatio(1f)) { onOpenImage(p) })
                        }
                        AlbumTile(
                            photos[3],
                            tileModifier(Modifier.weight(1f).aspectRatio(1f)) { onOpenAlbum(m) },
                            dim = true,
                            label = "See all",
                        )
                    }
                }
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
            MessageReactions(m)
        }
    }
}

/** One square of a grouped bubble / the album sheet: centre-cropped photo,
 *  its own upload ring while pending, an optional dim + label overlay. */
@Composable
private fun AlbumTile(
    photo: JSONObject,
    modifier: Modifier,
    dim: Boolean = false,
    label: String? = null,
) {
    val url = messageMediaUrl(photo)
    Box(modifier.background(Color(0x22000000)), contentAlignment = Alignment.Center) {
        if (url.startsWith("data:") || url.startsWith("file://")) {
            val bmp = rememberBitmap(url, 600)
            if (bmp != null) {
                Image(bmp, contentDescription = "Photo", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            }
        } else if (url.isNotBlank()) {
            val tileContext = LocalContext.current
            val req = remember(url) {
                coil.request.ImageRequest.Builder(tileContext)
                    .data(if (url.startsWith("http")) url else Api.BASE + url)
                    .crossfade(false)
                    .size(480)
                    .build()
            }
            coil.compose.AsyncImage(
                model = req,
                contentDescription = "Photo",
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
        val upFrac = UploadProgress.fracs[photo.optString("clientId")]
        if (upFrac != null) {
            Box(Modifier.fillMaxSize().background(Color(0x59000000)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(
                    progress = { upFrac },
                    color = Color.White,
                    strokeWidth = 2.5.dp,
                    modifier = Modifier.size(26.dp),
                )
            }
        }
        if (dim) {
            Box(Modifier.fillMaxSize().background(Color(0x99000000)), contentAlignment = Alignment.Center) {
                Text(label.orEmpty(), color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
        }
    }
}

/** Owner round 31 (item 29): "See all" — every photo of the album, four per
 *  row; a tap opens the app's own viewer on that photo. */
@Composable
private fun AlbumSheet(photos: List<JSONObject>, onClose: () -> Unit, onOpen: (JSONObject) -> Unit) {
    KpSheet(onDismiss = onClose, title = "${photos.size} photos") {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 6.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            photos.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    row.forEach { p ->
                        AlbumTile(
                            p,
                            Modifier
                                .weight(1f)
                                .aspectRatio(1f)
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { onOpen(p) },
                        )
                    }
                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Owner round 31 (item 27): the bars a voice message carries in meta.waveform. */
internal fun voiceWaveOf(m: JSONObject): List<Int> {
    val arr = m.optJSONObject("meta")?.optJSONArray("waveform") ?: return emptyList()
    val out = ArrayList<Int>(arr.length())
    for (i in 0 until arr.length()) out.add(arr.optInt(i))
    return VoiceWaveform.sanitize(out)
}

/**
 * Owner round 31 (item 27): the voice bubble's waveform. Rounded bars, the
 * played part in [played] and the rest in [rest]; a tap or drag anywhere on
 * it seeks to that fraction. Pure Canvas — one draw per progress tick.
 */
@Composable
internal fun VoiceWave(
    bars: List<Int>,
    progress: Float,
    played: Color,
    rest: Color,
    modifier: Modifier = Modifier,
    onSeek: (Float) -> Unit = {},
) {
    Canvas(
        // A quick tap seeks; the down is NOT consumed, so the bubble's own
        // long-press (action sheet) and the reply swipe keep working on the
        // bars — only the tap's up is taken, which also stops the bubble
        // from treating it as a select tap.
        modifier.pointerInput(bars) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                // AwaitPointerEventScope's own withTimeoutOrNull (frame-clock aware).
                val up = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) { waitForUpOrCancellation() }
                if (up != null) {
                    up.consume()
                    onSeek((up.position.x / size.width).coerceIn(0f, 1f))
                }
            }
        },
    ) {
        drawVoiceBars(bars, progress, played, rest)
    }
}

/**
 * Owner round 32 (item 45): the composer's live wave while a note is being
 * recorded — [VoiceNote.livePeaks] read in the draw pass, so a new peak only
 * repaints the strip. Same bars as the bubble, no seeking.
 */
@Composable
private fun LiveVoiceWave(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) { drawVoiceBars(VoiceNote.livePeaks, 1f, color, color, newest = true) }
}

/** The bar picture shared by the bubble and the live strip: 2dp gaps, round
 *  caps, a 3dp dot for silence. With [newest] a canvas too narrow for every
 *  bar at 2dp (the live strip on a small phone) shows the newest ones instead
 *  of squeezing all of them into hairlines. */
internal fun DrawScope.drawVoiceBars(bars: List<Int>, progress: Float, played: Color, rest: Color, newest: Boolean = false) {
    if (bars.isEmpty() || size.width <= 0f) return
    val gap = 2.dp.toPx()
    val fit = ((size.width + gap) / (2.dp.toPx() + gap)).toInt().coerceAtLeast(1)
    val shown = if (newest && bars.size > fit) bars.subList(bars.size - fit, bars.size) else bars
    val n = shown.size
    // Bars never fatten past 3dp on a wide strip — they stay bars, not blocks.
    val stroke = ((size.width - gap * (n - 1)) / n).coerceIn(1.5f, 3.dp.toPx())
    val minH = 3.dp.toPx()
    val mid = size.height / 2f
    val playedUntil = progress.coerceIn(0f, 1f) * size.width
    for (i in 0 until n) {
        val x = i * (stroke + gap) + stroke / 2f
        val h = (minH + (size.height - minH) * (shown[i].coerceIn(0, 100) / 100f)) / 2f
        drawLine(
            color = if (x <= playedUntil) played else rest,
            start = Offset(x, mid - h),
            end = Offset(x, mid + h),
            strokeWidth = stroke,
            cap = StrokeCap.Round,
        )
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

/**
 * Owner round 32 (item 34): document / video sends run on a PROCESS-level
 * scope. They used to run on the chat screen's composition scope, so leaving
 * the chat (or the screen being popped for a viewer) mid-upload cancelled the
 * coroutine and the file silently never arrived. The screen only awaits the
 * outcome for its own bubble; the work outlives it. After a finished upload
 * the message POST is handed to the Outbox on a network failure, so an object
 * that took a minute to send is never thrown away over one dropped response
 * (the server is idempotent by clientId).
 */
object Uploads {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * Owner round 33 (item 3): queue-FIRST for media. The FILE payload goes
     * into the queue file with the local copy's path BEFORE the upload
     * starts; Outbox.send then uploads (Outbox.materialize fills fileKey)
     * and posts on the queue's own scope. Offline, the entry simply waits —
     * the retry clock / network callback uploads and posts it later, chat
     * open or not. [onResult] as in Outbox.send (Main; painted or not).
     * [payload] lets a caller supply its own body (voice meta etc.).
     */
    fun sendFile(
        convId: String,
        clientId: String,
        name: String,
        mime: String,
        file: File,
        meta: JSONObject?,
        payload: JSONObject? = null,
        onResult: ((Result<JSONObject>) -> Boolean)? = null,
    ) {
        val body =
            payload
                ?: JSONObject()
                    .put("kind", "FILE")
                    .put("fileName", name)
                    .put("fileType", mime)
                    .put("fileSize", file.length())
                    .put("clientId", clientId)
                    .also { if (meta != null) it.put("meta", meta) }
        Outbox.send(convId, clientId, body, JSONObject().put("path", file.absolutePath).put("temp", true), onResult)
    }

    /** A photo: the JPEG is written to the queue's media dir first (a send
     *  that never got to upload must survive the process), then travels like
     *  any file. */
    fun sendPhoto(ctx: android.content.Context, convId: String, clientId: String, jpeg: ByteArray, payload: JSONObject, onResult: ((Result<JSONObject>) -> Boolean)? = null) {
        val app = ctx.applicationContext
        scope.launch {
            val f =
                runCatching {
                    val dir = File(app.filesDir, "kp-outbox-media").apply { mkdirs() }
                    File(dir, "$clientId.jpg").also { it.writeBytes(jpeg) }
                }.getOrNull()
            if (f == null) {
                withContext(Dispatchers.Main) { onResult?.invoke(Result.failure(ApiException(0, "Could not keep that photo."))) }
                return@launch
            }
            sendFile(convId, clientId, "photo.jpg", "image/jpeg", f, null, payload, onResult)
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
    val dataBmp = if (url?.startsWith("data:") == true || url?.startsWith("file://") == true) rememberBitmap(url) else null
    Box(
        Modifier
            // Owner round 32 (item 29): a smaller inline preview — 150 dp wide,
            // never taller than 200 dp (portrait shots used to run 280 dp tall).
            // Tap still opens the full-screen viewer.
            .widthIn(max = 150.dp)
            .then(
                if (ratio > 0f) {
                    Modifier
                        .aspectRatio(ratio)
                        .heightIn(max = 200.dp)
                } else {
                    Modifier
                        .widthIn(min = 120.dp)
                        .height(140.dp)
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
private fun FileBubble(
    m: JSONObject,
    mine: Boolean,
    player: VoicePlayer,
    pendingEcho: Boolean = false,
    onOpenImage: (JSONObject) -> Unit = {},
    onOpenVideo: (JSONObject) -> Unit = {},
    theme: String = "darkblue",
    onOpenDoc: (JSONObject) -> Unit = {},
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val id = m.optString("id")
    val fileName = m.optString("fileName").ifBlank { "File" }
    val fileType = m.optString("fileType")
    // fileKey OR mediaUrl — older messages only carry mediaUrl; without this
    // fallback those rows were silent dead taps ("kichui hoi na").
    val fileKey =
        m.optText("fileKey").takeIf { it.isNotBlank() }
            ?: m.optText("mediaUrl").takeIf { it.startsWith("/") || it.startsWith("http") } ?: ""
    val asDocument = sentAsDocument(m)
    val isImage = fileType.startsWith("image") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".png")
    if (isImage && !asDocument) {
        val url = if (fileKey.isNotBlank()) "/api/files/$fileKey" else m.optString("mediaUrl")
        ImageBubble(JSONObject().put("mediaUrl", url), mine)
        return
    }
    val isVoice = !asDocument && fileLooksVoice(m)
    val playing = player.playingId == id
    val loading = player.loadingId == id

    if (isVoice) {
        // Owner round 31 (item 27): a real waveform instead of the "Voice
        // message" label; playback progress is painted ON the bars and a tap
        // on them seeks. Bars come from the recorder (meta.waveform); notes
        // recorded before that get a stable pattern from their id.
        val paused = player.pausedId == id
        val active = playing || paused
        val bars = remember(id) { voiceWaveOf(m).ifEmpty { VoiceWaveform.pseudo(id) } }
        val progress = if (active) player.progress else 0f
        val ink = if (mine) Color.White else chatAccent(theme)
        val faint = if (mine) Color(0x66FFFFFF) else chatAccent(theme).copy(alpha = 0.35f)
        // Owner round 32 (item 45): compact — a 36dp button against a 22dp
        // wave with the duration right under it; the stamp shares the
        // duration line's right end (the bubble keeps no bottom band for
        // voice notes). It used to be a 30dp wave over a duration line over
        // a blank 15dp band: a 64dp bubble for one line of audio.
        Row(verticalAlignment = Alignment.CenterVertically) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier
                    .size(36.dp)
                    .pressScale(interaction)
                    .clip(CircleShape)
                    .background(if (mine) Color(0x33FFFFFF) else chatAccent(theme).copy(alpha = 0.18f))
                    .clickable(interactionSource = interaction, indication = null) {
                        if (pendingEcho || fileKey.isBlank()) return@clickable // still uploading
                        haptics.tap()
                        player.toggle(ctx, id, fileKey)
                    },
                contentAlignment = Alignment.Center,
            ) {
                when {
                    loading -> CircularProgressIndicator(
                        color = ink,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(18.dp),
                    )
                    playing -> Icon(
                        Icons.Filled.Pause,
                        contentDescription = "Pause",
                        tint = ink,
                        modifier = Modifier.size(21.dp).scale(if (pressed) 0.85f else 1f),
                    )
                    else -> Icon(
                        Icons.Filled.PlayArrow,
                        contentDescription = "Play",
                        tint = ink,
                        modifier = Modifier.size(21.dp).scale(if (pressed) 0.85f else 1f),
                    )
                }
            }
            Spacer(Modifier.width(8.dp))
            // Owner round 25: no side padding — the tick+time stamp sits at
            // the right end of the duration line, under the wave.
            Column {
                VoiceWave(
                    bars = bars,
                    progress = progress,
                    played = ink,
                    rest = faint,
                    modifier = Modifier.width(150.dp).height(22.dp),
                    onSeek = { frac ->
                        if (!pendingEcho && fileKey.isNotBlank()) player.seekTo(ctx, id, fileKey, frac)
                    },
                )
                Spacer(Modifier.height(1.dp))
                val secs = m.optJSONObject("meta")?.optInt("seconds") ?: 0
                val vFrac = UploadProgress.fracs[m.optString("clientId")]
                Text(
                    when {
                        vFrac != null -> "Sending · ${(vFrac * 100).toInt()}%"
                        // While it plays, the line counts the elapsed seconds.
                        active && secs > 0 -> {
                            val at = (progress * secs).toInt()
                            "%d:%02d".format(at / 60, at % 60)
                        }
                        secs > 0 -> "%d:%02d".format(secs / 60, secs % 60)
                        pendingEcho -> "Sending…"
                        else -> FilesUtil.displaySize(m.optInt("fileSize"))
                    },
                    fontSize = 11.sp,
                    color = if (mine) Color(0x99FFFFFF) else Muted,
                    maxLines = 1,
                    // Owner round 26: keep the sending/duration line clear of
                    // the bottom-right stamp ("voice sending er somoy overlap").
                    modifier = Modifier.padding(end = if (mine) 50.dp else 34.dp),
                )
            }
        }
        return
    }

    // Documents: the WHOLE row opens (not just a tiny "Open" button), with a
    // spinner while downloading and a toast if it fails — the old version
    // swallowed every error in runCatching, so a failed download looked like
    // a dead button ("open korte parche na").
    val ready = fileKey.isNotBlank()
    val upFrac = UploadProgress.fracs[m.optString("clientId")]
    val docInk = if (mine) AmberInk else chatAccent(theme)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier
                .width(200.dp) // fixed width so the bubble never grows/shrinks on tap
                .clickable {
                    if (!ready) {
                        android.widget.Toast.makeText(ctx, "This file is no longer available.", android.widget.Toast.LENGTH_SHORT).show()
                        return@clickable
                    }
                    // Owner round 31: media sent AS a document still opens in
                    // KuchuPuchu's own viewer / player (never a system app);
                    // audio documents play inline through the voice player.
                    when {
                        isImage -> {
                            onOpenImage(m)
                            return@clickable
                        }
                        fileLooksVideo(m) -> {
                            onOpenVideo(m)
                            return@clickable
                        }
                        fileType.startsWith("audio") -> {
                            if (player.playingId == id) player.stop() else player.toggle(ctx, id, fileKey)
                            return@clickable
                        }
                    }
                    // Owner round 32 (item 33): every other document opens in
                    // KuchuPuchu's own viewer screen (PDF pages, text,
                    // pictures, SVG, TIFF, archive contents; ⋮ → Save /
                    // Forward / Open with) — never straight into a system app,
                    // never a dead tap. The screen downloads and caches it.
                    onOpenDoc(m)
                },
    ) {
        // Owner round 32 (item 34): the upload ring (and the open spinner) wrap
        // the file icon on the LEFT. The old right-hand slot put the ring at
        // the row's bottom-end — exactly where the stamp overlays — so the
        // two collided while sending. The whole row is the tap target, so
        // the "Open" label went with the slot; a file that is gone shows a
        // faded icon instead of "…".
        Box(
            Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (mine) Color(0x33FFFFFF) else chatAccent(theme).copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                when {
                    isImage -> Icons.Filled.Image
                    fileLooksVideo(m) -> Icons.Filled.Videocam
                    fileType.startsWith("audio") -> if (playing) Icons.Filled.Pause else Icons.Filled.MusicNote
                    else -> Icons.Filled.InsertDriveFile
                },
                contentDescription = "File",
                tint = if (mine) AmberInk else chatAccent(theme),
                modifier = Modifier.size(22.dp).alpha(if (ready || upFrac != null) 1f else 0.5f),
            )
            when {
                upFrac != null -> CircularProgressIndicator(
                    progress = { upFrac },
                    color = docInk,
                    strokeWidth = 2.5.dp,
                    trackColor = docInk.copy(alpha = 0.22f),
                    modifier = Modifier.size(36.dp),
                )
                else -> {}
            }
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
                // The stamp overlays this line's right end (no bottom band).
                modifier = Modifier.padding(end = if (mine) 50.dp else 34.dp),
            )
        }
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

// Owner round 20: a chat WITHOUT a theme gets the new DARK-BLUE default
// ("darkblue"); "default" is the explicit classic-cream option.
internal fun cTheme(c: JSONObject?) = c?.optString("theme")?.ifBlank { "darkblue" } ?: "darkblue"

private fun chatWallpaper(theme: String) =
    when (theme) {
        // Owner round 14: hardcoded light tints glared inside the dark-blue
        // app; every wallpaper now has a dark variant of its own.
        "mint" -> if (KpThemeMode.darkBlue) Color(0xFF0C1A15) else Color(0xFFECFDF5)
        "night" -> Color(0xFF0B1220)
        "rose" -> if (KpThemeMode.darkBlue) Color(0xFF23141A) else Color(0xFFFFF1F2)
        // Owner round 20: "default" keeps the classic cream chat; the DEFAULT
        // for every chat without a theme is now DARK BLUE.
        "default" -> Cream
        else -> Color(0xFF0D1524)
    }

/** Owner round 19: one accent per chat theme — the message bar, voice/mic
 *  button and call buttons all take the chat's colour now. */
internal fun chatAccent(theme: String): Color =
    when (theme) {
        "mint" -> Color(0xFF10B981)
        "rose" -> Color(0xFFF43F5E)
        "night" -> Color(0xFF818CF8)
        "default" -> Gold
        // Owner round 20: dark-blue default chat — blue accent everywhere.
        else -> Color(0xFF2F6FED)
    }

/** My bubble per chat theme (Owner round 14: theme restyles bubbles too). */
private fun chatMineFill(theme: String): Brush =
    when (theme) {
        "mint" -> Brush.linearGradient(listOf(Color(0xFF34D399), Color(0xFF059669)))
        "rose" -> Brush.linearGradient(listOf(Color(0xFFFB7185), Color(0xFFE11D48)))
        "night" -> Brush.linearGradient(listOf(Color(0xFF818CF8), Color(0xFF4F46E5)))
        "default" -> goldFill()
        // Owner round 20: dark-blue default chat — blue bubbles.
        else -> Brush.linearGradient(listOf(Color(0xFF2F6FED), Color(0xFF1E40AF)))
    }

/** The other side's bubble per chat theme. */
private fun chatOtherFill(theme: String): Brush =
    when (theme) {
        "mint" -> Brush.linearGradient(listOf(if (KpThemeMode.darkBlue) Color(0xFF14261F) else Color(0xFFE7F8F0), if (KpThemeMode.darkBlue) Color(0xFF14261F) else Color(0xFFE7F8F0)))
        "rose" -> Brush.linearGradient(listOf(if (KpThemeMode.darkBlue) Color(0xFF2A1A21) else Color(0xFFFFE9EC), if (KpThemeMode.darkBlue) Color(0xFF2A1A21) else Color(0xFFFFE9EC)))
        "night" -> Brush.linearGradient(listOf(Color(0xFF1E293B), Color(0xFF1E293B)))
        "default" -> Brush.linearGradient(listOf(Card, Card))
        // Owner round 20: dark-blue default chat — the other side sits on the
        // app's dark navy card.
        else -> Brush.linearGradient(listOf(Color(0xFF16213A), Color(0xFF16213A)))
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
                .border(1.dp, ActionBlue, RoundedCornerShape(24.dp))
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
            // Owner round 26: the extra in-bar clear cross is gone — the X on
            // the right closes the whole search, backspace clears the text.
            Spacer(Modifier.width(6.dp))
            // Owner round 17: the close affordance is a clear X.
            Icon(
                Icons.Filled.Close,
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
        // Owner round 25: nothing renders before the first search — the old
        // empty bordered card read as a stray line under the bar.
        if (hits.isNotEmpty()) Column(
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
    // Owner round 31: bottom sheet with a check on the current choice.
    val options = listOf(0 to "Off", 86400 to "24 hours", 604800 to "7 days", 7776000 to "90 days")
    KpSheet(onDismiss = onClose, title = "Disappearing messages") {
        options.forEach { (sec, label) ->
            KpSheetRow(icon = null, label = label, selected = sec == current) { onPick(sec) }
        }
    }
}

@Composable
private fun ThemeDialog(current: String, onClose: () -> Unit, onPick: (String) -> Unit) {
    val haptics = rememberHaptics()
    // Owner round 14: real swatches. Owner round 31: a bottom sheet.
    data class Opt(val id: String, val label: String, val swatch: Color)
    // Owner round 20: DARK BLUE is the default chat theme; the classic
    // cream chat is an explicit option now.
    val options = listOf(
        Opt("darkblue", "Dark Blue", Color(0xFF2F6FED)),
        Opt("default", "Cream", Gold),
        Opt("mint", "Mint", Color(0xFF10B981)),
        Opt("rose", "Rose", Color(0xFFFB7185)),
        Opt("night", "Night", Color(0xFF6366F1)),
    )
    KpSheet(onDismiss = onClose, title = "Chat theme") {
        options.forEach { o ->
            val sel = o.id == current
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (sel) ActionBlue.copy(alpha = 0.14f) else Color.Transparent)
                    .clickable { haptics.tap(); onPick(o.id) }
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .size(26.dp)
                        .clip(CircleShape)
                        .background(o.swatch)
                        .border(1.5.dp, if (sel) ActionBlueDeep else Line, CircleShape),
                )
                Spacer(Modifier.width(14.dp))
                Text(o.label, color = Ink, fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                if (sel) Icon(Icons.Filled.Check, null, tint = ActionBlueDeep, modifier = Modifier.size(20.dp))
            }
        }
    }
}

@Composable
private fun TickIcon(
    m: JSONObject,
    pendingEcho: Boolean,
    otherReadAt: String?,
    // r32-8: an emoji-only message has no bubble — the grey ticks take the
    // stamp ink so they stay visible on a light wallpaper.
    onWallpaper: Boolean = false,
    ink: Color = Color(0xB3FFFFFF),
) {
    val grey = if (onWallpaper) ink else Color(0xB3FFFFFF)
    if (pendingEcho) {
        Icon(Icons.Filled.Schedule, "Sending", tint = grey, modifier = Modifier.size(12.dp))
        return
    }
    val seen = isReadByOther(otherReadAt, m.optString("createdAt"))
    val delivered = m.optIso("deliveredAt") != null
    when {
        seen -> Icon(Icons.Filled.DoneAll, "Seen", tint = Color(0xFF53BDEB), modifier = Modifier.size(13.dp))
        delivered -> Icon(Icons.Filled.DoneAll, "Delivered", tint = grey, modifier = Modifier.size(13.dp))
        else -> Icon(Icons.Filled.Done, "Sent", tint = grey, modifier = Modifier.size(13.dp))
    }
}

/**
 * Only server-written CALL rows are call logs. This used to sniff the message
 * body as well, so an ordinary "missed you" or "declined the offer" was drawn as
 * a Missed voice call bubble.
 */
private fun isCallLog(m: JSONObject): Boolean = m.optString("kind") == "CALL"

/**
 * Owner round 31: a TEXT body that is ONLY emoji (1–3 of them, no letters)
 * renders big, with the stamp under it instead of over it — the inline
 * reserve trick can't glue spaces to an emoji glyph, so the tick/time used to
 * sit on the emoji.
 */
internal fun emojiOnlyCount(body: String): Int {
    val t = body.trim()
    if (t.isEmpty() || t.length > 24) return 0
    var count = 0
    var i = 0
    while (i < t.length) {
        val cp = t.codePointAt(i)
        val n = Character.charCount(cp)
        val type = Character.getType(cp)
        val isEmojiish =
            type == Character.OTHER_SYMBOL.toInt() ||
                cp in 0x1F000..0x1FAFF ||
                cp in 0x2600..0x27BF ||
                cp in 0x1F1E6..0x1F1FF
        val isJoiner = cp == 0x200D || cp == 0xFE0F || cp in 0x1F3FB..0x1F3FF || type == Character.NON_SPACING_MARK.toInt()
        when {
            isEmojiish -> count++
            isJoiner -> Unit
            cp == ' '.code -> Unit
            else -> return 0
        }
        i += n
    }
    return if (count in 1..3) count else 0
}

@Composable
private fun CallLogBubble(m: JSONObject, mine: Boolean, pendingEcho: Boolean, theme: String) {
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
            else -> body.substringAfter("·").trim()
        }
    // Owner round 31: ONE compact line — icon · "Voice call · 2:31" · time.
    // (The three-line 205dp card was "onek messy".)
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Row(
            Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(if (mine) chatMineFill(theme) else chatOtherFill(theme))
                .padding(start = 8.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(if (mine) Color(0x33FFFFFF) else chatAccent(theme).copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (missed || declined) Icons.Filled.CallMissed else if (video) Icons.Filled.Videocam else Icons.Filled.Call,
                    contentDescription = title,
                    tint = if (missed) Red else if (mine) Color.White else chatAccent(theme),
                    modifier = Modifier.size(14.dp),
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(
                if (sub.isBlank()) title else "$title · $sub",
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium,
                color = if (mine) Color.White else Ink,
                maxLines = 1,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                msgStamp(m.optString("createdAt")),
                fontSize = 10.sp,
                color = if (mine) Color(0xD9FFFFFF) else Muted,
                maxLines = 1,
            )
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
                    color = ActionBlueDeep,
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
                        Icon(Icons.Filled.Email, "Email", tint = ActionBlueDeep, modifier = Modifier.size(14.dp))
                    }
                    OwnerCardIcon(onClick = { open("https://rabbihossainltd.online") }) {
                        Icon(Icons.Filled.Language, "Website", tint = ActionBlueDeep, modifier = Modifier.size(14.dp))
                    }
                }
                Spacer(Modifier.height(10.dp))
                // ---- Send Message: direct chat with the owner's account ----
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (ownerId.isNotBlank()) ActionBlue else Line)
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
            .background(ChipSelected)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        icon()
    }
}
