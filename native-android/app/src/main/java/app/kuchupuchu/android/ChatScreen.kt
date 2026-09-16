package app.kuchupuchu.android

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
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
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.gestures.scrollBy
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
import androidx.compose.material.icons.filled.Description
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
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
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Dp
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
import android.view.ViewTreeObserver
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToInt
import kotlin.random.Random

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
    /** Owner round 42 (item 3): what the AI is making (image|text). */
    val typingKind: String?,
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
    // Owner round 41 (item 2): the panel reports its fullscreen
    // flips here so the composer below can stay until they happen.
    var attachFs by remember { mutableStateOf(false) }
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
    var voiceBinNonce by remember { mutableStateOf(0) }
    // Owner round 33 (item 11b): rows that appeared AFTER the chat opened
    // (my sends, live arrivals) rise into the list; rows painted from the
    // store or a page fetch stay still. Keyed by clientId-or-id, one shot.
    val bornKeys = remember { HashSet<String>() }
    // Item 11b: a message that is being deleted shrinks away first; the
    // rows themselves leave when the vanish has played.
    val vanishingIds = remember { mutableStateListOf<String>() }
    // Owner round 34 (item 3): ids whose vanish already played (a departed
    // row animates once, never loops).
    val vanishedOnce = remember { HashSet<String>() }
    // Owner round 13: swipe a bubble right to quote-reply to it.
    var replyTo by remember { mutableStateOf<JSONObject?>(null) }
    // Owner round 15: swipe-to-reply now also OPENS the keyboard — a bump
    // here drives the composer's focus+IME (0 = never).
    var replyFocusNonce by remember { mutableStateOf(0) }
    // Owner round 33 (item 17): the row a quote tap just jumped to (it
    // flashes once in the chat accent); "" = nothing flashing.
    var flashId by remember { mutableStateOf("") }
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
    // Owner round 42 (item 3): the AI's current make (image|text), refreshed
    // on the same poll — assigned raw (never guarded) so a text prompt after
    // an image one clears the shimmer card on the next tick.
    var otherTypingKind by remember { mutableStateOf<String?>(null) }
    // Word-by-word reveal for a freshly-arrived KuchuPuchu AI reply (owner
    // round 2026-09-04). Only messages CREATED after this screen opened are
    // animated, so conversation history never re-types itself on open.
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
    // Owner round 45 (item 7): the panel reports its loaded recents; the
    // lone-pick pencil stages them for the editor's browse mode.
    var attachPool by remember { mutableStateOf(listOf<MediaItem>()) }
    // Owner round 46: morph-&-fly send (the owner's savedly demo port) —
    // a clone launches from whatever fired the send (input pill, mic/send
    // slot, panel send circle) and flies an arced, wobbling path onto the
    // hidden echo row. Launch rects are captured on layout; the baton is
    // ONE-SHOT (a tap arms it, the send consumes it), so a stray rect can
    // never fly some later send.
    var fieldRect by remember { mutableStateOf(Rect.Zero) }
    var actionRect by remember { mutableStateOf(Rect.Zero) }
    var attachSendRect by remember { mutableStateOf(Rect.Zero) }
    var sendFromRect by remember { mutableStateOf(Rect.Zero) }
    val flyQueue = remember { mutableStateListOf<FlySpec>() }
    val flyHidden = remember { mutableStateListOf<String>() }
    var flyTarget by remember { mutableStateOf<Rect?>(null) }
    var flyLanded by remember { mutableStateOf<String?>(null) }
    var flyFlash by remember { mutableStateOf<Rect?>(null) }
    // Owner round 47: the overlay lives inside the messages Box now — its
    // own origin converts the rows' root-space rects to local ones.
    var flyOx by remember { mutableStateOf(0f) }
    var flyOy by remember { mutableStateOf(0f) }
    // Owner round 45 (item 5): r44-3's deselect confirm is retired — every
    // close clears the ticks (back/swipe both mean "get me out").
    // Owner round 32 (item 17): the attach panel's "view once" switch — armed
    // for one batch, reset once it goes out.
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
    // Owner round 34 (item 6): the viewer pages through these photos;
    // viewerAt tracks the page the chrome acts on (single photos: one).
    var viewerPhotos by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var viewerStart by remember { mutableStateOf(0) }
    var viewerAt by remember { mutableStateOf(0) }
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
        var next = ScreenStore.msgsOf(convId).filter { it.optString("id") !in ScreenStore.hiddenMsgIds }
        // Owner round 34 (item 3): a row that came back may vanish again if
        // it departs again — only the currently missing stay remembered.
        vanishedOnce.removeAll(next.map { it.optString("id") }.toSet())
        if (msgs.isEmpty()) {
            msgs.addAll(next)
            return
        }
        // Owner round 39 (item 3): the server soft-deletes (kind='DELETED'
        // rows stay in the GET), but a tombstone object must never replace
        // a live row — same contentType-flip disposal as the socket frame.
        // A tombstone for a vanishing row is dropped from this paint (the
        // missing-id hold below keeps the original); a tombstone for a
        // fresh LIVE row starts its vanish on the original. After onGone
        // removes the original the next paint takes the tombstone itself
        // (filtered from view, like any tombstone) instead of re-vanishing.
        val liveIds = msgs.filter { it.optString("kind") != "DELETED" }.map { it.optString("id") }.toSet()
        val freshTombs =
            next.filter {
                it.optString("kind") == "DELETED" &&
                    it.optString("id") in liveIds &&
                    it.optString("id") !in vanishingIds
            }
        if (freshTombs.isNotEmpty()) {
            val tombIds = freshTombs.map { it.optString("id") }
            vanishingIds.addAll(tombIds)
            vanishedOnce.addAll(tombIds)
        }
        next = next.filter { it.optString("kind") != "DELETED" || it.optString("id") !in vanishingIds }
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
        // Owner round 34 (item 3): rows mid-vanish (my delete) and rows the
        // PEER just deleted hold their place for the whole dust show instead
        // of popping instantly — a poll tick landing mid-animation used to
        // drop them early, and peer-deletes never animated at all.
        // Owner round 35 (item 1): the hold IS the GRACE_MS window — sized
        // past the worst-case show (see DeleteAnim), never under it.
        val hold = oldIds.filter { it.isNotBlank() && it !in newIds && it !in ScreenStore.hiddenMsgIds && (it in vanishingIds || it !in vanishedOnce) }
        if (hold.isNotEmpty()) {
            val fresh = hold.filter { it !in vanishingIds }
            vanishingIds.addAll(fresh)
            vanishedOnce.addAll(fresh)
            val keep = msgs.filter { it.optString("id") in hold }
            val pos = msgs.map { it.optString("id") }.withIndex().associate { it.value to it.index }
            val merged = (next + keep).sortedBy { pos[it.optString("id")] ?: Int.MAX_VALUE }
            msgs.clear()
            msgs.addAll(merged)
            scope.launch {
                delay(DeleteAnim.GRACE_MS)
                // Off-screen rows never play (no onDone): force-release so a
                // later paint drops them instead of holding ghosts.
                vanishingIds.removeAll(hold.toSet())
                paintFromStore()
            }
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
                                typingKind = data.optString("typingKind").takeIf { it.isNotBlank() },
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
                otherTypingKind = parsed.typingKind
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
                            // Owner round 34 (item 16a): a spent view-once is
                            // GONE server-side — the row plays the vanish show
                            // and leaves, no tombstone, on both sides.
                            if (liveMsg.optString("kind") == "VANISHED" && liveId.isNotBlank()) {
                                if (msgs.any { it.optString("id") == liveId } && liveId !in vanishingIds) {
                                    vanishingIds.add(liveId)
                                    vanishedOnce.add(liveId)
                                    scope.launch {
                                        delay(DeleteAnim.GRACE_MS)
                                        msgs.removeAll { it.optString("id") == liveId }
                                        vanishingIds.remove(liveId)
                                        ScreenStore.pokeInbox()
                                    }
                                }
                                return@let
                            }
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
                                // Owner round 34 (item 15): an answered request
                                // card vanishes instead of tombstoning — the
                                // server hard-deleted the row and only borrows
                                // the DELETED frame to reach open chats.
                                idxExisting >= 0 && liveMsg.optString("kind") == "DELETED" &&
                                    msgs[idxExisting].optString("kind") == "UNBLOCK_ASK" ->
                                    msgs.removeAt(idxExisting)
                                // Owner round 39 (item 3): a DELETED frame never
                                // swaps the row's object — the swap flips
                                // contentType (TEXT→DELETED), LazyColumn
                                // disposes the shell, and the dust canvas dies
                                // ~200ms in (own unsends aborted; peer deletes
                                // popped with no show at all). Own unsends are
                                // already in vanishingIds (the frame is
                                // ACK-only); a peer's delete starts the vanish
                                // on the ORIGINAL so it dusts out like ours.
                                // Removal stays at onGone + the next paint.
                                idxExisting >= 0 && liveMsg.optString("kind") == "DELETED" -> {
                                    if (liveId.isNotBlank() && liveId !in vanishingIds) {
                                        vanishingIds.add(liveId)
                                        vanishedOnce.add(liveId)
                                    }
                                }
                                idxExisting >= 0 -> msgs[idxExisting] = liveMsg
                                liveCid.isNotBlank() && msgs.any { it.optString("clientId") == liveCid } ->
                                    msgs[msgs.indexOfFirst { it.optString("clientId") == liveCid }] = liveMsg
                                // New inbound message: chronological = append at the
                                // end (the thread is oldest-first).
                                else -> {
                                    // Owner round 33 (item 2): the fast paint
                                    // appended the bubble but never moved the
                                    // viewport — and the marker GET that
                                    // followed saw nothing "new" to scroll for.
                                    // Follow the thread when the reader was at
                                    // (or one bubble from) the bottom; a reader
                                    // scrolled up is left alone.
                                    val info = listState.layoutInfo
                                    val follow =
                                        !listState.isScrollInProgress &&
                                            info.visibleItemsInfo.lastOrNull()?.index?.let { it >= info.totalItemsCount - 2 } == true &&
                                            // Owner round 39 (item 4): an AI text
                                            // reply reveals itself word by word and
                                            // pins the viewport on every tick — a
                                            // second animated scroll here fights it
                                            // and the thread flickers/jumps on
                                            // arrival. The reveal owns the pinning.
                                            !(convId.endsWith("_kp_ai_bot") &&
                                                liveMsg.optString("senderId") == "kp_ai_bot" &&
                                                liveMsg.optString("kind") == "TEXT")
                                    // Owner round 33 (item 11b): a live arrival rises in.
                                    bornKeys.add(liveMsg.optString("clientId").ifBlank { liveMsg.optString("id") })
                                    msgs.add(liveMsg)
                                    // Our own optimistic bubble from a previous send
                                    // that the server just confirmed.
                                    pending.removeAll { it.optString("clientId") == liveCid }
                                    if (follow) {
                                        scope.launch {
                                            val total = msgs.size + pending.size
                                            if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }
                                        }
                                    }
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
    // Owner round 33 (item 17): suspending — the scroll trigger below runs
    // it from its collector, and the quote jump awaits page after page until
    // the original message is on the list.
    suspend fun loadOlder() {
        val cur = olderCursor ?: return
        if (!hasMoreOlder) return
        if (!loadingOlder.compareAndSet(false, true)) return
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
    // the safe form.
    // Owner round 45 (item 3): the 250 ms teleport scroll is gone — the
    // thread's bottom padding rides the bar's own glide (rememberImeGlidePx),
    // so the opening keyboard lifts the rows WITH the bar (no double motion).

    // Owner round 33 (item 4): the POST's own response row is painted straight
    // away — the same merge the socket's "message" frame does — instead of a
    // marker GET round trip after every send.
    fun paintSent(row: JSONObject) {
        val id = row.optString("id")
        val cid = row.optString("clientId")
        if (id.isBlank()) return
        val idx = msgs.indexOfFirst { it.optString("id") == id || (cid.isNotBlank() && it.optString("clientId") == cid) }
        // Owner round 33 (item 2): decided BEFORE the rows move.
        val info = listState.layoutInfo
        val follow =
            !listState.isScrollInProgress &&
                info.visibleItemsInfo.lastOrNull()?.index?.let { it >= info.totalItemsCount - 2 } == true
        if (idx >= 0) msgs[idx] = row else msgs.add(row)
        pending.removeAll { it.optString("clientId") == cid || it.optString("id") == id }
        // Painted here = not "new" for the next marker GET (no second scroll / read post).
        if (idx < 0) lastTopId = id
        ScreenStore.setMsgs(convId, msgs.toList())
        if (follow) {
            scope.launch {
                val total = msgs.size + pending.size
                if (total > 0) runCatching { listState.animateScrollToItem(total - 1) }
            }
        }
    }

    // Owner round 46: hide the just-painted echo row and queue its clone.
    // cloneType drives only the clone's FACE (TEXT pill / PHOTO / VIDEO /
    // DOC / VOICE) — the flight engine is the same for everyone.
    fun launchFly(clientId: String, cloneType: String, body: String = "") {
        val from = sendFromRect
        sendFromRect = Rect.Zero
        if (from.width <= 0f || from.isEmpty) return
        flyTarget = null
        flyHidden.add(clientId)
        flyQueue.add(FlySpec(clientId, cloneType, body, from))
    }

    fun sendText(body: String, kind: String = "TEXT") {
        if (body.isBlank()) return
        val clientId = "c_${java.util.UUID.randomUUID()}"
        val payload = JSONObject().put("kind", kind).put("body", body).put("clientId", clientId)
        // Owner round 13: attach the quoted message when replying.
        replyTo?.optString("id")?.takeIf { it.isNotBlank() }?.let { payload.put("replyTo", it) }
        replyTo = null
        bornKeys.add(clientId)
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", kind)
                .put("body", body)
                .put("createdAt", java.time.Instant.now().toString()),
        )
        launchFly(clientId, "TEXT", body)
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
                // Owner round 34 (item 15): a refusal from the BLOCK wall
                // stays silent — the composer is already gone, so a toast
                // would be noise over the "unavailable" line.
                val walled = e.message?.contains("can't reach") == true
                if (!walled) error = e.message?.takeIf { it.isNotBlank() } ?: "Could not send."
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

    fun sendImage(dataUrl: String, album: String? = null, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "") {
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
                            .put("body", caption)
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
        bornKeys.add(clientId)
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "IMAGE")
                .put("body", caption)
                .put("hasImage", true)
                .put("fileName", "photo.jpg")
                .put("fileType", "image/jpeg")
                .put("mediaUrl", dataUrl)
                .also { row -> metaWith(0, 0)?.let { row.put("meta", it) } }
                .also { row -> if (viewOnce) row.put("viewOnce", true) }
                .put("createdAt", java.time.Instant.now().toString()),
        )
        launchFly(clientId, "PHOTO")
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
                    .put("body", caption)
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

    fun sendFile(name: String, mime: String, file: File, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "") {
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
                            .put("body", caption)
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
        bornKeys.add(clientId)
        pending.add(
            JSONObject()
                .put("id", clientId)
                .put("clientId", clientId)
                .put("senderId", Store.myId())
                .put("kind", "FILE")
                .put("fileName", name)
                .put("fileType", mime)
                .put("fileSize", file.length().toInt())
                .put("body", caption)
                // Kept for tap-to-retry after a failed send (the cached copy is
                // only deleted once the send succeeds) — like voicePath.
                .put("docPath", file.absolutePath)
                .put("createdAt", java.time.Instant.now().toString())
                .also { if (docMeta != null) it.put("meta", docMeta) }
                .also { if (viewOnce && !asDocument) it.put("viewOnce", true) },
        )
        launchFly(clientId, if (mime.startsWith("video")) "VIDEO" else "DOC")
        scope.launch { runCatching { listState.animateScrollToItem(msgs.size + pending.size - 1) } }
        runCatching { KpSounds.send(ctx) }
        // Owner round 32 (item 34): the upload + POST run on Uploads' own
        // scope — this screen only awaits the outcome for its bubble. They
        // used to run on the composition scope, so backing out of the chat
        // mid-upload cancelled the coroutine and the file never arrived.
        // Owner round 33 (item 3): queue-first — the copy is already on disk
        // (docPath), so the queue itself can upload it later when the send
        // was started offline; the outcome is painted here while alive.
        // Owner round 34 (item 16b): a captioned clip carries its caption in
        // the payload (the queue posts it as-is); anything else keeps the
        // default body.
        val captionPayload =
            if (caption.isBlank()) {
                null
            } else {
                JSONObject()
                    .put("kind", "FILE")
                    .put("fileName", name)
                    .put("fileType", mime)
                    .put("fileSize", file.length())
                    .put("body", caption)
                    .put("clientId", clientId)
                    .also { if (docMeta != null) it.put("meta", docMeta) }
            }
        // The outcome callback is the same on both arms — only the body differs.
        if (captionPayload == null) {
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
        } else {
            Uploads.sendFile(convId, clientId, name, mime, file, docMeta, captionPayload) { outcome ->
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
        bornKeys.add(clientId)
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
        launchFly(clientId, "VOICE")
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
    suspend fun readAndSendImage(uri: Uri, album: String?, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "", hd: Boolean = false) {
        // 720px / ~100KB: the old 960px/220KB photos took minutes to send AND load
        // on slow mobile data (the "image loads forever" report).
        // High-quality photos: 1440px, ~380KB inline budget (server caps at 450K).
        // Owner round 34 (item 16b): HD caps for an HD pick (the editor's
        // switch); the standard caps stay the fast default.
        val dataUrl =
            withContext(Dispatchers.IO) {
                FilesUtil.imageToDataUrl(
                    uri,
                    ctx,
                    maxSide = if (hd) 2560 else 1440,
                    maxChars = if (hd) 1_600_000 else 380_000,
                )
            }
        if (dataUrl == null) {
            error = "Could not read that photo — try another one."
        } else {
            error = ""
            sendImage(dataUrl, album, viewOnce, sendAt, caption)
        }
    }

    fun handleImagePicked(uri: Uri, album: String? = null) {
        scope.launch { readAndSendImage(uri, album) }
    }

    fun handleDocumentPicked(uri: Uri, asDocument: Boolean = false, viewOnce: Boolean = false, sendAt: java.time.Instant? = null, caption: String = "") {
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
            sendFile(name, mime, file, asDocument, viewOnce, sendAt, caption)
        }
    }
    // Owner round 32 (item 19): the media editor hands its result back here —
    // a drawn-on photo / trimmed clip goes out like any picked media.
    LaunchedEffect(convId) {
        ScreenStore.pendingEdited.collect { edited ->
            if (edited == null || edited.convId != convId) return@collect
            ScreenStore.pendingEdited.value = null
            when (val m = edited.media) {
                is EditedMedia.Photo -> sendImage(m.dataUrl, null, edited.viewOnce, caption = edited.caption)
                is EditedMedia.Video -> sendFile("video.mp4", m.mime, m.file, viewOnce = edited.viewOnce, caption = edited.caption)
                is EditedMedia.Untouched ->
                    if (m.isVideo) handleDocumentPicked(m.uri, viewOnce = edited.viewOnce, caption = edited.caption)
                    else readAndSendImage(m.uri, null, viewOnce = edited.viewOnce, caption = edited.caption)
                is EditedMedia.Failed -> error = m.message
            }
        }
    }
    // Owner round 39 (item 8): the welcome used to fire only at login —
    // old accounts (and threads emptied by a session reset) opened an
    // empty AI chat with no greeting. The server guards once-per-account,
    // so re-firing on every AI-chat open is safe; the socket paints the
    // greeting live in the open thread.
    LaunchedEffect(convId) {
        if (convId.endsWith("_kp_ai_bot")) {
            scope.launch(Dispatchers.IO) {
                runCatching { Api.post("/api/ai/welcome", JSONObject()) }
            }
        }
    }
    // Owner round 34 (item 16b): the editor's + staged the current pick as
    // the batch's first item — prepend it and reopen the panel for more.
    // Owner round 39 (item 6): the panel pencil's trip carries replaceUri —
    // the staged photo swaps into the original's seat instead.
    LaunchedEffect(convId) {
        ScreenStore.pendingAddMore.collect { more ->
            if (more == null || more.convId != convId) return@collect
            ScreenStore.pendingAddMore.value = null
            if (more.replaceUri.isNotBlank()) {
                val at = attachSel.indexOfFirst { it.uri.toString() == more.replaceUri }
                if (at >= 0) attachSel[at] = more.item else attachSel.add(0, more.item)
            } else {
                attachSel.add(0, more.item)
            }
            showAttach = true
        }
    }

    fun sendAttachSelection(sendAt: java.time.Instant? = null) {
        val batch = attachSel.toList()
        attachSel.clear()
        showAttach = false
        // Owner round 36 (item 1): the panel's ① switch is gone — once
        // rides PER ITEM now (armed in the editor before staging), so a
        // mixed batch just works: once photos go out single, the rest
        // share the album.
        // Owner round 31 (item 29): two or more photos picked together go out
        // as ONE album — each still its own message row, sharing meta.album.
        val album = if (batch.count { !it.isVideo && !it.once } >= 2) newAlbumId() else null
        scope.launch {
            // Owner round 32 (item 48): photos are read one after another, in
            // the order they were ticked, so the pending rows (and the album's
            // row order on the server) follow the selection instead of whichever
            // decode happened to finish first. Each upload still runs on its
            // own coroutine inside sendImage, so they overlap on the wire.
            batch.forEach { item ->
                if (item.once) {
                    if (item.isVideo) handleDocumentPicked(item.uri, viewOnce = true, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, null, viewOnce = true, sendAt = sendAt, caption = item.caption, hd = item.hd)
                } else {
                    if (item.isVideo) handleDocumentPicked(item.uri, sendAt = sendAt, caption = item.caption) else readAndSendImage(item.uri, album, sendAt = sendAt, caption = item.caption, hd = item.hd)
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
            // Owner round 33 (item 11b): the strip plays the bin drop.
            voiceBinNonce++
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
        // Owner round 33 (item 11b): the bubbles explode while the server
        // delete runs; the list drops them on the next paint.
        vanishingIds.addAll(ids)
        scope.launch {
            ids.forEach { id ->
                runCatching { withContext(Dispatchers.IO) { Api.delete("/api/messages/$id") } }
            }
            // Owner round 34 (item 3): the window is explicit — even an
            // instant server must not repaint before the show played.
            delay(DeleteAnim.GRACE_MS)
            refreshMessages()
        }
    }

    fun deleteForMe() {
        val ids = selected.toList()
        selected.clear()
        reactionFor = null
        showEmojiSheet = false
        // Owner round 34 (item 3): the show gets an EXPLICIT window — the
        // rows hide only after it played. They used to hide instantly and
        // the repaint raced the animation, so deletes popped with no show.
        vanishingIds.addAll(ids)
        scope.launch {
            delay(DeleteAnim.GRACE_MS)
            ids.forEach { ScreenStore.hideMessage(it) }
            paintFromStore()
        }
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
    // Owner round 34 (item 15): the block wall. Either direction kills the
    // composer; only the blocked side gets the one Request Unblock button
    // (unblockAsked = already spent for this block).
    val blockedMe = !isGroup && c?.optBoolean("blockedMe") == true
    val blockedByMe = !isGroup && c?.optBoolean("blockedByMe") == true
    val blockWall = blockedMe || blockedByMe
    val unblockAsked = c?.optBoolean("unblockAsked") == true
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

    // Owner round 43 (item 7): a reply can take 25s+ (image gen) — longer
    // than the screen timeout, so the phone slept mid-reply (fade to black).
    // Owner round 45 (item 1): keying the hold on aiTyping flipped the
    // window flag on every send and off on every arrival — a window-flag
    // change re-runs the panel's dim/restore pass, which read as the
    // screen dimming (and the thread flickering) on each AI reply. Hold
    // it for the whole open AI chat instead: nothing toggles mid-thread,
    // and the screen still stays awake through a 25 s generation. (Same
    // shared-window edge as before: a call screen up at dispose time
    // re-adds its own hold on the next status change.)
    DisposableEffect(isAiChat) {
        val win = MainActivity.current?.window
        if (isAiChat) win?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { if (isAiChat) win?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    // Owner round 16: starting a reply grows the quote bar + keyboard over
    // the newest rows — jump the thread up so nothing hides under them.
    LaunchedEffect(replyTo?.optString("id")) {
        if (replyTo != null) {
            delay(160)
            val total = listState.layoutInfo.totalItemsCount
            if (total > 0) listState.animateScrollToItem(total - 1)
        }
    }

    // Owner round 45 (item 1): every ENTRANCE effect is gone — the per-word
    // AI reply reveal AND the born pop-in. A new row simply appears; both
    // animations read as a screen-wide twitch/dim on the owner's device
    // (and the reveal was exactly the "animation/effect" he asked about).
    val other = c?.optJSONObject("other")
    // Owner round 47 (item 3+4): the r45b "pad the list bottom with the
    // glide" idea failed on his device — growing contentPadding never
    // moves already-laid rows (the latest message stayed buried under the
    // bar) AND it opened a scrollable void past the list end (swiping
    // flung the rows off the top). The padding is constant again; the
    // glide's own per-frame DELTA scrolls the list itself by the same
    // amount, so the rows physically ride the bar up on open and settle
    // back down on close — but only while the thread is parked at the
    // bottom. This also restores a VISIBLE glide on open (his #4: "on
    // open nothing happens, close feels like it glides").
    val glidePx = rememberImeGlidePx()
    val imeGlideDp = with(LocalDensity.current) { glidePx.toDp() }
    var glideApplied by remember { mutableStateOf(0) }
    LaunchedEffect(Unit) {
        snapshotFlow { glidePx }.collect { cur ->
            val delta = cur - glideApplied
            glideApplied = cur
            val info = listState.layoutInfo
            if (delta != 0 && info.totalItemsCount > 0 &&
                (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 2) {
                runCatching { listState.scrollBy(delta.toFloat()) }
            }
        }
    }
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
            if (!isGroup && c != null && !botChat && !requestOpen && !blockWall) {
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
                        // options — nothing else (r34-17: plus "Scheduled
                        // messages", only while this chat has parked rows).
                        if (scheduledRows.isNotEmpty()) {
                            KpSheetRow(Icons.Filled.Schedule, "Scheduled messages") { menuOpen = false; showScheduled = true }
                        }
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
                        // Owner round 34 (item 17): parked rows are managed
                        // from the ⋮ menu — this row shows only while any exist.
                        if (scheduledRows.isNotEmpty()) {
                            KpSheetRow(Icons.Filled.Schedule, "Scheduled messages") { menuOpen = false; showScheduled = true }
                        }
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
                        if (scheduledRows.isNotEmpty()) {
                            KpSheetRow(Icons.Filled.Schedule, "Scheduled messages") { menuOpen = false; showScheduled = true }
                        }
                        KpSheetRow(Icons.Filled.GroupAdd, "New group") { menuOpen = false; nav.navigate("newgroup") }
                        if (otherUserId.isNotBlank()) {
                            // Owner round 30: "View contact" only when this person is
                            // already in the phone book; otherwise offer to add them
                            // (name — and number, when they share it — pre-filled).
                            // Owner round 33 (item 14): their number in the book counts too.
                            val inBook = PhoneBook.entries.any { it.user?.optString("id") == otherUserId } ||
                                PhoneBook.hasNumber(c?.optJSONObject("other")?.optText("phone"))
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
                        // Owner round 38 (item 4): …except MID-SHOW. The live
                        // DELETED frame lands ~200ms into the dust and used
                        // to filter the row straight out — disposing the
                        // shell, aborting the canvas, reading as "removed
                        // before the animation completes". A vanishing row
                        // stays rendered until its own onGone lands, then
                        // vanishes like any other tombstone.
                        (m.optString("kind") != "DELETED" || albumPhotos(m).any { it.optString("id") in vanishingIds }) && run {
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
            // Owner round 33 (item 17): tap a quote → scroll to the original
            // (paging back through history when it is not loaded yet, bounded)
            // and flash its row once. A deleted / hidden original is left alone.
            // Owner round 34 (item 12): the in-chat search picks ride this too
            // (it sits above the search sheet so the sheet can reach it).
            val jumpPad = with(LocalDensity.current) { 72.dp.roundToPx() }
            fun jumpTo(id: String) {
                scope.launch {
                    if (pending.any { it.optString("id") == id || it.optString("clientId") == id }) return@launch
                    fun rowOf() = groupedMsgs.indexOfFirst { row -> albumPhotos(row).any { it.optString("id") == id } }
                    var i = rowOf()
                    var pages = 0
                    var waits = 0
                    while (i < 0 && pages < 10 && waits < 50) {
                        if (msgs.any { it.optString("id") == id }) break
                        if (!hasMoreOlder) break
                        if (loadingOlder.get()) {
                            waits++
                            delay(100)
                        } else {
                            loadOlder()
                            pages++
                        }
                        i = rowOf()
                    }
                    if (i < 0) return@launch
                    runCatching { listState.animateScrollToItem(i, -jumpPad) }
                    flashId = id
                    delay(1500)
                    if (flashId == id) flashId = ""
                }
            }
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
                    // Owner round 34 (item 12): a search hit rides the
                    // quote-tap path — page back when unloaded, land on the
                    // folded row, flash it once.
                    onPick = { id ->
                        showChatSearch = false
                        jumpTo(id)
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
                    // Owner round 45 (item 1): NO pop-in, no reveal, no
                    // entrance of any kind — the row renders as-is (every
                    // animated birth read as a screen-wide flicker on the
                    // owner's device). The key is still consumed so a later
                    // pass never reads it as new.
                    val rowKey = m.optString("clientId").ifBlank { m.optString("id") }
                    bornKeys.remove(rowKey)
                    // Owner round 46: after the fly-send clone lands ON this
                    // key the real bubble plays its landing bounce
                    // (0.85 -> 1.06 -> 0.98 -> 1, 280 ms — the demo's
                    // spring-curve keyframes).
                    val flyLand = remember(rowKey) { Animatable(1f) }
                    LaunchedEffect(flyLanded) {
                        if (flyLanded == rowKey) {
                            flyLand.snapTo(0.85f)
                            flyLand.animateTo(1.06f, tween(110, easing = FastOutLinearInEasing))
                            flyLand.animateTo(0.98f, tween(85, easing = LinearOutSlowInEasing))
                            flyLand.animateTo(1f, tween(85, easing = FastOutSlowInEasing))
                            flyLanded = null
                        }
                    }
                    val vanishing = albumPhotos(m).any { it.optString("id") in vanishingIds }
                    // Owner round 33 (item 17): the jumped-to row flashes once.
                    val flashing = flashId.isNotBlank() && albumPhotos(m).any { it.optString("id") == flashId }
                    val flashAlpha by animateFloatAsState(
                        if (flashing) 0.24f else 0f,
                        tween(if (flashing) 180 else 700),
                        label = "quoteflash",
                    )
                    // Owner round 35 (item 1): when a row leaves, the
                    // survivors glide into its place instead of jumping.
                    // Owner round 45 (item 1): keep the delete glide but
                    // switch the default fade off — that fade flashed over
                    // the dark wallpaper on every new row (the "the whole
                    // screen dims for a second" ghost).
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .animateItem(fadeInSpec = null, fadeOutSpec = null)
                            // Owner round 46: hidden while this row's clone
                            // is mid-flight; reports the landing rect live
                            // (the list may still be scrolling to bottom).
                            .alpha(if (rowKey in flyHidden) 0f else 1f)
                            .onGloballyPositioned {
                                if (rowKey in flyHidden && flyQueue.firstOrNull()?.key == rowKey) flyTarget = it.boundsInRoot()
                            }
                            .graphicsLayer {
                                if (flyLand.value != 1f) {
                                    scaleX = flyLand.value
                                    scaleY = flyLand.value
                                    transformOrigin = TransformOrigin.Center
                                }
                            },
                    ) {
                        DeleteRowShell(
                            m = m,
                            rowKey = rowKey,
                            born = false, // Owner round 45: never pops in — the row is simply here
                            rowSelected = rowSelected,
                            vanishing = vanishing,
                            onGone = {
                                val gone = albumPhotos(m).map { it.optString("id") }
                                vanishingIds.removeAll(gone.toSet())
                                // Owner round 39 (item 3): the dusted originals
                                // leave exactly at dust end (the next paint
                                // takes the server's tombstone, filtered from
                                // view) — and without live originals left, a
                                // later paint can never re-vanish the id.
                                msgs.removeAll { it.optString("id") in gone }
                                if (gone.any { it in ScreenStore.hiddenMsgIds }) paintFromStore()
                            },
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
                            onOpenImage = { msg ->
                                // Owner round 35 (item 5): a tapped photo
                                // opens WITH its send-mates — swiping walks
                                // the whole group from the tapped one. (A lone
                                // photo's group is itself: same as before.)
                                val all = albumPhotos(m)
                                viewerPhotos = all
                                viewerStart =
                                    all.indexOfFirst { it.optString("id") == msg.optString("id") }.coerceAtLeast(0)
                                viewerAt = viewerStart
                            },
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
                            onJumpTo = { jumpTo(it) },
                            askName = rawTitle,
                            onUnblockAsk = { msg ->
                                scope.launch {
                                    val ok = runCatching {
                                        withContext(Dispatchers.IO) { Api.delete("/api/blocks/${msg.optString("senderId")}") }
                                    }.getOrNull()?.let { !it.has("error") } == true
                                    if (ok) {
                                        haptics.confirm()
                                        Cache.bust("/api/conversations/$convId")
                                        refreshMeta()
                                        refreshMessages(forceNetwork = true)
                                        ScreenStore.pokeInbox()
                                    } else {
                                        error = "Could not unblock. Try again."
                                    }
                                }
                            },
                            onIgnoreAsk = { msg ->
                                scope.launch {
                                    val ok = runCatching {
                                        withContext(Dispatchers.IO) {
                                            Api.post("/api/blocks/request/ignore", JSONObject().put("userId", msg.optString("senderId")))
                                        }
                                    }.getOrNull()?.let { !it.has("error") } == true
                                    if (ok) {
                                        haptics.tap()
                                        refreshMessages(forceNetwork = true)
                                        ScreenStore.pokeInbox()
                                    } else {
                                        error = "Could not ignore. Try again."
                                    }
                                }
                            },
                        )
                    }
                        if (flashAlpha > 0.004f) Box(Modifier.matchParentSize().background(chatAccent(chatTheme).copy(alpha = flashAlpha)))
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
                    // Owner round 45: no pop-in anywhere — but the key is
                    // still consumed here so it can never linger for a
                    // later pass.
                    val rowKey = m.optString("clientId").ifBlank { m.optString("id") }
                    bornKeys.remove(rowKey)
                    // Owner round 46: same hide/target/landing contract as
                    // the thread rows above — the send's echo row is THIS
                    // one until the server ack swaps it into the thread.
                    val flyLand = remember(rowKey) { Animatable(1f) }
                    LaunchedEffect(flyLanded) {
                        if (flyLanded == rowKey) {
                            flyLand.snapTo(0.85f)
                            flyLand.animateTo(1.06f, tween(110, easing = FastOutLinearInEasing))
                            flyLand.animateTo(0.98f, tween(85, easing = LinearOutSlowInEasing))
                            flyLand.animateTo(1f, tween(85, easing = FastOutSlowInEasing))
                            flyLanded = null
                        }
                    }
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .alpha(if (rowKey in flyHidden) 0f else 1f)
                            .onGloballyPositioned {
                                if (rowKey in flyHidden && flyQueue.firstOrNull()?.key == rowKey) flyTarget = it.boundsInRoot()
                            }
                            .graphicsLayer {
                                if (flyLand.value != 1f) {
                                    scaleX = flyLand.value
                                    scaleY = flyLand.value
                                    transformOrigin = TransformOrigin.Center
                                }
                            },
                    ) {
                        MessageRow(
                            m,
                            isGroup,
                            Store.myId(),
                            otherReadAt,
                            player,
                            pendingEcho = true,
                            theme = chatTheme,
                            onOpenAlbum = { msg -> albumMsg = msg },
                            quoteFor = { rid -> (msgs + pending).firstOrNull { it.optString("id") == rid } },
                            onJumpTo = { jumpTo(it) },
                        )
                    }
                }
                // Owner round 4: one pretty bouncing-dots bubble whenever
                // EITHER side is typing — the AI composing, or the other
                // person's typing lease (the header used to carry this).
                if (aiTyping || typingLeaseActive) {
                    // Owner round 42 (item 3): an image coming gets the
                    // shimmer photo-card, not the typing dots.
                    item(key = "typing-bubble") {
                        if (aiTyping && otherTypingKind == "image") ImageCreatingBubble()
                        else TypingBubble(chatAccent(chatTheme))
                    }
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

            // Owner round 47 (fly-send placement fix): the overlay lives
            // INSIDE the messages Box. As a root-Column sibling after the
            // composer it was a REAL layout child — its clone/glow boxes
            // consumed Column height, squashed the weighted list to zero
            // and shot the composer pill to the top on every send
            // ("message bar ta top a uthe jai" — the owner was right, the
            // position was a shortcut, not the animation itself). Box
            // children wrap, so this draws without touching any layout;
            // Compose doesn't clip, so the clone still flies from the
            // composer below up into the list.
            if (flyQueue.isNotEmpty() || flyFlash != null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .onGloballyPositioned {
                            flyOx = it.boundsInRoot().left
                            flyOy = it.boundsInRoot().top
                        },
                ) {
                    val ox = flyOx
                    val oy = flyOy
                    val flyNow = flyQueue.firstOrNull()
                    if (flyNow != null) {
                        // Watchdog — an echo that never reports a rect (odd
                        // race at the end of a long list) lands at once.
                        LaunchedEffect(flyNow.key) {
                            delay(400)
                            if (flyTarget == null && flyQueue.firstOrNull()?.key == flyNow.key) {
                                flyHidden.remove(flyNow.key)
                                flyQueue.removeAll { it.key == flyNow.key }
                            }
                        }
                        flyTarget?.let { tgt ->
                            KpFlySend(
                                spec = FlySpec(flyNow.key, flyNow.cloneType, flyNow.body, flyNow.from.translate(Offset(-ox, -oy))),
                                target = { (flyTarget ?: tgt).translate(Offset(-ox, -oy)) },
                                accent = chatAccent(chatTheme),
                            ) {
                                flyHidden.remove(flyNow.key)
                                flyLanded = flyNow.key
                                flyFlash = tgt
                                flyQueue.removeAll { it.key == flyNow.key }
                                flyTarget = null
                            }
                        }
                    }
                    flyFlash?.let { r ->
                        KpFlyLandFlash(r.translate(Offset(-ox, -oy)), chatAccent(chatTheme)) { flyFlash = null }
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
        // Owner round 34 (item 17): the chip is TRANSIENT — it flashes for a
        // few seconds whenever the parked set (re)loads, then hides itself
        // (the ⋮ menu carries "Scheduled messages" from then on).
        var schedFlashUntil by remember { mutableStateOf(0L) }
        LaunchedEffect(scheduledRows.size) {
            if (scheduledRows.isNotEmpty()) {
                schedFlashUntil = System.currentTimeMillis() + 4000L
                delay(4000L)
                schedFlashUntil = 0L
            }
        }
        if (scheduledRows.isNotEmpty() && System.currentTimeMillis() < schedFlashUntil) {
            ScheduledChip(scheduledRows, chatTheme) { showScheduled = true }
        }
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
        if (blockWall) {
            // Owner round 38 (item 1): the wall is ONE thin row — the
            // unavailable line and the buttons NEVER stack (that stacking
            // is what made it fat). Two pills side by side: the way back
            // (Unblock for the blocker, one Request Unblock for the
            // blocked side) + Delete chat in red, always. Once the
            // request is spent, only the thin unavailable line remains.
            var askedSent by remember { mutableStateOf(false) }
            var asking by remember { mutableStateOf(false) }
            var unblocking by remember { mutableStateOf(false) }
            var deleting by remember { mutableStateOf(false) }
            // One small pill seat for all three actions — same size as
            // every other button in the app, never fat (owner rule).
            @Composable
            fun wallPill(label: String, busy: Boolean, red: Boolean, onTap: () -> Unit) {
                val bg = if (busy) Line else if (red) Red else ActionBlue
                val ink = if (busy) Muted else if (red) Color.White else ActionBlueInk
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(bg)
                        .clickable(enabled = !busy) { onTap() }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        color = ink,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                    )
                }
            }
            fun deleteWallChat() {
                deleting = true
                scope.launch {
                    val gone = runCatching {
                        withContext(Dispatchers.IO) { Api.delete("/api/conversations/$convId") }
                    }.getOrNull()?.let { !it.has("error") } == true
                    deleting = false
                    if (gone) {
                        haptics.confirm()
                        ScreenStore.dropConv(convId)
                        ScreenStore.pokeInbox()
                        Store.route = ""
                        nav.popBackStack()
                    } else {
                        error = "Could not delete the chat. Try again."
                    }
                }
            }
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Card)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (blockedByMe || (blockedMe && !unblockAsked && !askedSent)) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (blockedByMe) {
                            wallPill(if (unblocking) "Unblocking…" else "Unblock", unblocking, false) {
                                unblocking = true
                                scope.launch {
                                    val freed = runCatching {
                                        withContext(Dispatchers.IO) {
                                            Api.delete("/api/blocks/$otherUserId")
                                        }
                                    }.getOrNull()?.let { !it.has("error") } == true
                                    unblocking = false
                                    if (freed) {
                                        haptics.confirm()
                                        Cache.bust("/api/conversations/$convId")
                                        refreshMeta()
                                        ScreenStore.pokeInbox()
                                    } else {
                                        error = "Could not unblock. Try again."
                                    }
                                }
                            }
                        } else if (blockedMe && !unblockAsked && !askedSent) {
                            wallPill(if (asking) "Sending…" else "Request Unblock", asking, false) {
                                asking = true
                                scope.launch {
                                    val sent = runCatching {
                                        withContext(Dispatchers.IO) {
                                            Api.post("/api/blocks/request", JSONObject().put("userId", otherUserId))
                                        }
                                    }.getOrNull()?.let { !it.has("error") } == true
                                    asking = false
                                    if (sent) {
                                        haptics.confirm()
                                        askedSent = true
                                        ScreenStore.pokeInbox()
                                    } else {
                                        error = "Could not send the request. Try again."
                                    }
                                }
                            }
                        }
                        wallPill(if (deleting) "Deleting…" else "Delete chat", deleting, true) {
                            deleteWallChat()
                        }
                    }
                } else {
                    Text(
                        "This User Is Unavailable",
                        fontSize = 13.sp,
                        color = Muted,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                    )
                }
            }
        } else if (requestPending) {
            // Owner round 32 (item 38): message request — Accept or Block
            // before anything else. Accept = POST /accept (the chat becomes a
            // normal one on both sides); Block = the same block the profile
            // sheet writes, then back to the list.
            var deciding by remember { mutableStateOf(false) }
            // Owner round 35 (item 7): compact decision halves, same as
            // every other button in the app.
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Card)
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
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
                        .padding(vertical = 7.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Block", color = Red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
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
                        .padding(vertical = 7.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Accept", color = ActionBlueInk, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
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
        // Owner round 41 (item 2): the composer stays while the attach
        // panel is freshly open — it hides only once the user ticked a
        // photo or swiped the panel up (r40 hid it from the first tap).
        } else if (!showAttach || (attachSel.isEmpty() && !attachFs)) {
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
                sendFromRect = fieldRect
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
            padForIme = if (!showAttach && !showStickers) imeGlideDp else 0.dp,
            onFieldRect = { fieldRect = it },
            onActionRect = { actionRect = it },
            onFinishRecord = { cancelled ->
                if (!cancelled) sendFromRect = actionRect
                finishRecording(cancelled)
            },
            voiceBinNonce = voiceBinNonce,
            selectCount = selected.size,
            onSendSelection = {
                sendFromRect = actionRect
                sendSelectedMedia()
            },
        )
        }

        /* ---------------- inline panels — the attach panel owns the bottom
           (the composer hides while it is open); NOT fullscreen until the
           user taps/swipes the handle up ---------------- */
        if (showAttach) {
            // Owner round 33 (item 11b): the panel pops up from the bar.
            Box(Modifier.popUp()) {
            AttachPanel(
                sel = attachSel,
                onSendBatch = {
                    sendFromRect = attachSendRect
                    sendAttachSelection()
                },
                // Owner round 45 (item 5): ANY close forgets the ticks —
                // reopening used to find the last batch still selected (the
                // state lives up here, above the panel). The r44-3 confirm
                // sheet is gone with it (r45-4 retired its only trigger).
                onDismiss = {
                    attachSel.clear()
                    showAttach = false
                    attachFs = false
                },
                onFullscreenChange = { attachFs = it },
                onPool = { attachPool = it },
                // Owner round 46: the panel's send circle reports its rect
                // — the batch fly clone launches from there.
                onSendRect = { attachSendRect = it },
                // Owner round 32 (item 19): hold the panel's Send → a time
                // (item 18's sheet); Edit on a single pick → the light editor.
                onScheduleBatch = { showScheduleMedia = true },
                // Owner round 36 (item 1): the editor always opens
                // unarmed — once is the editor's own toggle now.
                onEdit = { item ->
                    ScreenStore.editTitle = title
                    // Owner round 39 (item 6): the pencil on a MULTI batch
                    // keeps the batch — Done stages the edited photo back
                    // (replacing this uri). A lone pick sends as before.
                    if (attachSel.size > 1) ScreenStore.editStageUri = item.uri.toString()
                    else {
                        ScreenStore.editStageUri = null
                        attachSel.clear()
                        // Owner round 45 (item 7): the lone-pick pencil
                        // browses the whole pool (a batch pencil must
                        // return to its staged uri — no browsing there).
                        ScreenStore.editPool = attachPool
                    }
                    showAttach = false
                    nav.navigate("mediaedit/$convId/0/${statusPickArg(item)}")
                },
                onImagePicked = { uri -> handleImagePicked(uri) },
                onDocumentPicked = { uri -> handleDocumentPicked(uri, asDocument = true) },
                onContactPicked = ::handleContactPicked,
                onLocationRequested = ::handleLocationRequested,
            )
            }
        }
        if (showStickers) {
            Box(Modifier.popUp()) {
            StickerPanel(
                onDismiss = { showStickers = false },
                onSend = {
                    showStickers = false
                    sendText(it, "STICKER")
                },
            )
            }
        }
        androidx.activity.compose.BackHandler(enabled = showAttach || showStickers) {
            // Owner round 45 (item 5): back is a real leave — the ticks die
            // with the panel, so a reopen starts clean.
            if (showAttach) attachSel.clear()
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
                    val all = albumPhotos(m)
                    viewerPhotos = all
                    viewerStart = all.indexOfFirst { it.optString("id") == photo.optString("id") }.coerceAtLeast(0)
                    viewerAt = viewerStart
                },
            )
        }
        if (viewerPhotos.isNotEmpty()) {
            val m = viewerPhotos[viewerAt.coerceIn(viewerPhotos.indices)]
            // Owner round 31: the app's own photo viewer (MediaViewer.kt).
            val who =
                if (m.optString("senderId") == Store.myId()) "You"
                else m.optText("senderName").ifBlank { rawTitle }
            // Owner round 32 (item 17): a view-once photo — capture guard on,
            // no Save / Forward, and the single opening is spent the moment the
            // picture is on screen (the row vanishes everywhere).
            val once = isViewOnce(m)
            KpPhotoViewer(
                url = messageMediaUrl(m),
                title = who,
                subtitle = if (once) "View once" else viewerStamp(m.optText("createdAt")),
                onClose = { viewerPhotos = emptyList() },
                onForward =
                    if (privateChat || once) {
                        null
                    } else {
                        {
                            viewerPhotos = emptyList()
                            if (m.optString("id") !in selected) selected.clear()
                            selected.add(m.optString("id"))
                            forwarding = true
                        }
                    },
                canSave = !privateChat && !once,
                secure = privateChat || once,
                // Owner round 39 (item 1): Edit — same gate as Forward
                // (private chats + view-once never expose it). The current
                // page downloads into cache and opens in the existing
                // media editor; Done hands back pendingEdited, which this
                // chat already sends like any picked media. Applies to
                // every chat photo alike — AI-made pictures included.
                onEdit =
                    if (privateChat || once) {
                        null
                    } else {
                        {
                            val editMsg = viewerPhotos[viewerAt.coerceIn(viewerPhotos.indices)]
                            viewerPhotos = emptyList()
                            scope.launch {
                                val bytes =
                                    withContext(Dispatchers.IO) {
                                        runCatching {
                                            val u = messageMediaUrl(editMsg)
                                            if (u.startsWith("data:")) {
                                                android.util.Base64.decode(u.substringAfter(","), android.util.Base64.DEFAULT)
                                            } else {
                                                Api.download(u)
                                            }
                                        }.getOrNull()
                                    }
                                if (bytes == null) {
                                    error = "Could not download the photo."
                                } else {
                                    val uri = FilesUtil.cacheFile(ctx, "viewer-edit.jpg", bytes, "image/jpeg")
                                    ScreenStore.editTitle = title
                                    nav.navigate("mediaedit/$convId/0/${statusPickArg(MediaItem(uri, false, 0, "", System.currentTimeMillis()))}")
                                }
                            }
                        }
                    },
                onShown = if (once) ({ ViewOnce.spend(m.optString("id")) }) else null,
                urls = viewerPhotos.map { messageMediaUrl(it) },
                subtitles = viewerPhotos.map { if (isViewOnce(it)) "View once" else viewerStamp(it.optText("createdAt")) },
                startIndex = viewerStart,
                onPageChanged = { viewerAt = it },
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
    // Owner round 33 (item 11b): counts up on every cancelled recording —
    // the strip plays the bin drop for that many ms before the pill returns.
    voiceBinNonce: Int = 0,
    selectCount: Int = 0,
    onSendSelection: () -> Unit = {},
    theme: String = "",
    // Owner round 33 (item 11c): false while an inline panel is open — the
    // panel carries the keyboard padding then (its search box opens the IME).
    // Owner round 45 (item 3): a Dp now — the shared glide value (0 while
    // a panel is open keeps the bar down over it).
    padForIme: Dp = 0.dp,
    // Owner round 46: report the input pill's + the mic/send slot's rect so
    // the fly-send clone launches from exactly what the user touched.
    onFieldRect: (Rect) -> Unit = {},
    onActionRect: (Rect) -> Unit = {},
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
    // Owner round 33 (item 11b): a cancelled recording plays the bin for
    // 520 ms in the strip's place — the lid lifts, the note drops in, the
    // lid closes — and only then does the pill come back.
    var binPlaying by remember { mutableStateOf(false) }
    LaunchedEffect(voiceBinNonce) {
        if (voiceBinNonce > 0) {
            binPlaying = true
            delay(520)
            binPlaying = false
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            // Owner round 15: the bar itself is TRANSPARENT — the themed
            // wallpaper (which spans the whole screen) shows through; only
            // the input pill and the send button keep their own surfaces.
            .padding(bottom = padForIme)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (binPlaying && !recording) {
            Row(
                Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                VoiceBinDrop(accent)
            }
        } else if (!recording) {
            Column(
                Modifier
                    .weight(1f)
                    .heightIn(min = 38.dp)
                    // Owner round 18: the pill is BACK — only the recording
                    // strip is transparent (that was the ask). Owner round 19:
                    // the pill takes the chat theme's accent tint.
                    .clip(RoundedCornerShape(19.dp))
                    .background(accent.copy(alpha = 0.16f))
                    .onGloballyPositioned { onFieldRect(it.boundsInRoot()) }
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
                    .onGloballyPositioned { onActionRect(it.boundsInRoot()) }
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
            Box(Modifier.onGloballyPositioned { onActionRect(it.boundsInRoot()) }) {
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

/** Owner round 46 (morph-&-fly send): one queued flight spec per send. */
private class FlySpec(
    val key: String,
    val cloneType: String, // TEXT / PHOTO / VIDEO / DOC / VOICE
    val body: String,
    val from: Rect,
)

/** One trail dot: where it was born, how it drifts, when it dies. */
private class FlyDot(
    val x: Float,
    val y: Float,
    val accent: Boolean,
    val born: Long,
    val dur: Int,
    val driftX: Float,
    val driftY: Float,
    val radius: Float,
)

/**
 * Owner round 46: the fly engine itself — a direct port of the owner's
 * demo (`message-send-animation`): 620 ms linear-driven, ease-out-cubic
 * lerp of position/size, a −56 dp sine arc, a decaying 4° wobble, the
 * pill→bubble color+border morph at 45 %, a radial glow peaking mid-flight
 * (0.35 alpha — the web demo's blur(14px) mapped to a gradient, since
 * Modifier.blur needs API 31 and our floor is 24), ~26 ms spawn of glowing
 * trail dots that drift down and fade over 380–580 ms, a 5 % scale pulse,
 * and a 0.88 fade-out at the end. The target rect is re-read EVERY frame
 * (the demo's fixed rect assumed a settled list; ours scrolls to bottom
 * during the flight).
 */
@Composable
private fun KpFlySend(
    spec: FlySpec,
    target: () -> Rect,
    accent: Color,
    onLanded: () -> Unit,
) {
    val density = LocalDensity.current
    val t = remember { Animatable(0f) }
    val dots = remember { mutableStateListOf<FlyDot>() }
    val pillBg = Color(0xFF2A2F38)
    val pillEdge = Color(0xFF3A3F47)
    LaunchedEffect(Unit) {
        launch {
            while (true) {
                delay(26)
                val r = t.value
                if (r >= 0.85f) break
                val tgt = target()
                val e = 1f - (1f - r) * (1f - r) * (1f - r)
                val lift = with(density) { (-56).dp.toPx() }
                val arcY = kotlin.math.sin(r * Math.PI).toFloat() * lift
                val w = spec.from.width + (tgt.width - spec.from.width) * e
                val cx = spec.from.left + (tgt.left - spec.from.left) * e + w / 2f
                val cy = spec.from.top +
                    (tgt.top - spec.from.top) * e +
                    arcY + (spec.from.height + (tgt.height - spec.from.height) * e) / 2f
                dots.add(
                    FlyDot(
                        cx,
                        cy,
                        e > 0.45f,
                        System.currentTimeMillis(),
                        380 + Random.nextInt(200),
                        (Random.nextFloat() - 0.5f) * 18f * density.density,
                        (6f + Random.nextFloat() * 14f) * density.density,
                        (2f + Random.nextFloat() * 2f) * density.density,
                    ),
                )
            }
        }
        t.animateTo(1f, tween(620, easing = LinearEasing))
        onLanded()
    }
    val raw = t.value
    val tgt = target()
    val e = 1f - (1f - raw) * (1f - raw) * (1f - raw)
    val lift = with(density) { (-56).dp.toPx() }
    val cx = spec.from.left + (tgt.left - spec.from.left) * e
    val cy = spec.from.top + (tgt.top - spec.from.top) * e + kotlin.math.sin(raw * Math.PI).toFloat() * lift
    val w = spec.from.width + (tgt.width - spec.from.width) * e
    val h = spec.from.height + (tgt.height - spec.from.height) * e
    val wobble = (kotlin.math.sin(raw * 2.0 * Math.PI) * (1f - raw) * 4.0).toFloat()
    val pulse = 1f + kotlin.math.sin(raw * Math.PI).toFloat() * 0.05f
    val fade = if (raw > 0.88f) (1f - (raw - 0.88f) / 0.12f).coerceIn(0f, 1f) else 1f
    val wDp = with(density) { w.toDp() }
    val hDp = with(density) { h.toDp() }
    // trail: spawned dots, drawn root-absolute; reading t.value here keeps
    // the draw phase invalidating every frame so the dots drift/fade.
    Canvas(Modifier.fillMaxSize()) {
        val now = System.currentTimeMillis()
        val it2 = dots.iterator()
        while (it2.hasNext()) {
            if (now - it2.next().born > 580) it2.remove()
        }
        if (t.value < 1f) {
            dots.forEach { d ->
                val dt = ((now - d.born).toFloat() / d.dur).coerceIn(0f, 1f)
                val c = if (d.accent) accent else Color.White.copy(alpha = 0.7f)
                drawCircle(
                    color = c.copy(alpha = 0.9f * (1f - dt)),
                    radius = d.radius,
                    center = Offset(d.x + d.driftX * dt, d.y + d.driftY * dt),
                )
            }
        }
    }
    // trailing glow (the demo's blurred div) — a radial gradient halo.
    Box(
        Modifier
            .offset { IntOffset((cx - w * 0.06f).roundToInt(), (cy - h * 0.06f).roundToInt()) }
            .size(with(density) { (w * 1.12f).toDp() }, with(density) { (h * 1.12f).toDp() })
            .graphicsLayer { alpha = kotlin.math.sin(raw * Math.PI).toFloat() * 0.35f * fade }
            .background(Brush.radialGradient(listOf(accent, Color.Transparent)), CircleShape),
    )
    // the clone: pill at the start of the flight, bubble past 45 %.
    Box(
        Modifier
            .offset { IntOffset(cx.roundToInt(), cy.roundToInt()) }
            .size(wDp, hDp)
            .graphicsLayer {
                rotationZ = wobble
                scaleX = pulse
                scaleY = pulse
                this.alpha = fade
                transformOrigin = TransformOrigin.Center
            }
            .clip(RoundedCornerShape(if (e > 0.45f) 16.dp else 20.dp))
            .background(if (e > 0.45f) accent else pillBg)
            .then(if (e > 0.45f) Modifier else Modifier.border(0.5.dp, pillEdge, RoundedCornerShape(20.dp))),
    ) {
        when (spec.cloneType) {
            "TEXT" ->
                Text(
                    spec.body,
                    color = Color.White,
                    fontSize = 14.sp,
                    lineHeight = 18.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.align(Alignment.CenterStart).padding(horizontal = 12.dp),
                )
            "PHOTO" -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Brush.linearGradient(listOf(Color(0xFF6A8CAF), Color(0xFF3D5872)))),
                ) {
                    Icon(Icons.Filled.Image, null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.align(Alignment.Center).size(wDp / 3))
                }
            }
            "VIDEO" -> {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Brush.linearGradient(listOf(Color(0xFF4A4F5A), Color(0xFF23262C)))),
                ) {
                    Box(Modifier.align(Alignment.Center).size(wDp / 3).clip(CircleShape).background(Color.White.copy(alpha = 0.9f))) {
                        Icon(Icons.Filled.PlayArrow, null, tint = Color(0xFF23262C), modifier = Modifier.align(Alignment.Center).size(wDp / 5))
                    }
                }
            }
            "VOICE" -> {
                Row(
                    Modifier.align(Alignment.CenterStart).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(hDp * 0.65f).clip(CircleShape).background(Color.White)) {
                        Icon(Icons.Filled.PlayArrow, null, tint = accent, modifier = Modifier.align(Alignment.Center).size(hDp * 0.4f))
                    }
                    Spacer(Modifier.width(6.dp))
                    listOf(6, 12, 8, 14, 10, 16, 7, 13, 9, 15, 11, 6).forEach { bh ->
                        Box(Modifier.width(3.dp).height(bh.dp).clip(RoundedCornerShape(1.5.dp)).background(Color.White.copy(alpha = 0.55f)))
                        Spacer(Modifier.width(3.dp))
                    }
                }
            }
            else -> {
                // DOC — the demo's white "ext" disc + two text lines.
                Row(
                    Modifier.align(Alignment.CenterStart).padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(hDp * 0.55f).clip(CircleShape).background(Color.White)) {
                        Icon(Icons.Filled.Description, null, tint = accent, modifier = Modifier.align(Alignment.Center).size(hDp * 0.32f))
                    }
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(spec.body.ifBlank { "Document" }, color = Color.White, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("KuchuPuchu", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

/** The 260 ms accent flash at the landing rect (the demo's box-shadow glow). */
@Composable
private fun KpFlyLandFlash(rect: Rect, accent: Color, onDone: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        t.animateTo(1f, tween(260, easing = LinearEasing))
        onDone()
    }
    val grow = 1f + t.value * 0.22f
    Box(
        Modifier
            .offset {
                IntOffset(
                    (rect.left - rect.width * (grow - 1f) / 2f).roundToInt(),
                    (rect.top - rect.height * (grow - 1f) / 2f).roundToInt(),
                )
            }
            .size(with(LocalDensity.current) { (rect.width * grow).toDp() }, with(LocalDensity.current) { (rect.height * grow).toDp() })
            .graphicsLayer { alpha = (1f - t.value) * 0.45f }
            .background(Brush.radialGradient(listOf(accent, Color.Transparent)), CircleShape),
    )
}

/**
 * Owner round 33 (item 11b): the voice-cancel dustbin. Sits at the left of
 * the strip (where the mic slid to); the lid tilts open, a small note pill
 * drops from the timer's height into the can, the lid snaps shut. 520 ms.
 */
@Composable
internal fun VoiceBinDrop(accent: Color) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) { t.animateTo(1f, tween(520, easing = LinearEasing)) }
    val v = t.value
    // lid: open over the first 30 %, closed again over the last 25 %
    val lid =
        when {
            v < 0.3f -> v / 0.3f
            v > 0.75f -> 1f - (v - 0.75f) / 0.25f
            else -> 1f
        }
    // note: falls between 20 % and 70 %, fades as it passes the rim
    val drop = ((v - 0.2f) / 0.5f).coerceIn(0f, 1f)
    Box(Modifier.size(width = 56.dp, height = 40.dp), contentAlignment = Alignment.BottomStart) {
        Canvas(Modifier.matchParentSize()) {
            val w = size.width
            val h = size.height
            val canW = 22.dp.toPx()
            val canH = 18.dp.toPx()
            val left = 6.dp.toPx()
            val top = h - canH - 2.dp.toPx()
            // can body
            drawRoundRect(
                color = Red,
                topLeft = Offset(left, top),
                size = androidx.compose.ui.geometry.Size(canW, canH),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
            )
            // lid: rotates up around its left hinge
            val hinge = Offset(left - 1.dp.toPx(), top - 1.dp.toPx())
            withTransform({ rotate(-55f * lid, hinge) }) {
                drawRoundRect(
                    color = Red,
                    topLeft = Offset(hinge.x, hinge.y - 3.dp.toPx()),
                    size = androidx.compose.ui.geometry.Size(canW + 2.dp.toPx(), 3.dp.toPx()),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(1.5.dp.toPx()),
                )
            }
            // the note: a short accent pill falling into the can
            if (drop > 0f && drop < 1f) {
                val y = (2.dp.toPx()) + drop * (top - 2.dp.toPx())
                drawRoundRect(
                    color = accent.copy(alpha = 1f - drop * drop),
                    topLeft = Offset(left + canW / 2f - 8.dp.toPx(), y),
                    size = androidx.compose.ui.geometry.Size(16.dp.toPx(), 5.dp.toPx()),
                    cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.5.dp.toPx()),
                )
            }
            // keep the unused width reserved so the row does not jump
            if (w < 0f) drawCircle(Color.Transparent, 0f)
        }
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
@Composable
/**
 * Owner round 45 (item 3): ONE shared keyboard glide. The r44 form was a
 * Modifier on the composer only — the keyboard's open snapped the BAR up
 * while the teleported list followed 250 ms late, which read as a
 * flicker on his device. Now the same spring value feeds the bar's
 * bottom pad AND the thread's bottom contentPadding: both rise together,
 * the teleport scroll is gone. The height still comes from the root
 * insets (r44: WindowInsets.ime does not resolve on this BOM), the
 * listener stays behind the round-13 isAlive guard, and the critical
 * spring tracks the close's frame stream while gliding the open's jump.
 */
private fun rememberImeGlidePx(): Int {
    val view = LocalView.current
    var targetPx by remember { mutableStateOf(0) }
    DisposableEffect(view) {
        val tree = view.viewTreeObserver
        val listener =
            ViewTreeObserver.OnGlobalLayoutListener {
                targetPx =
                    runCatching {
                        ViewCompat.getRootWindowInsets(view)
                            ?.getInsets(WindowInsetsCompat.Type.ime())
                            ?.bottom ?: 0
                    }.getOrDefault(0)
            }
        runCatching { if (tree.isAlive) tree.addOnGlobalLayoutListener(listener) }
        runCatching { listener.onGlobalLayout() }
        onDispose {
            runCatching {
                if (tree.isAlive) tree.removeOnGlobalLayoutListener(listener)
            }
        }
    }
    val glided by
        animateIntAsState(
            targetPx,
            spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessHigh),
            label = "imeglide",
        )
    return glided
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

/** Owner round 33 (item 17): what a quoted message IS — "Photo" / "Video" /
 *  "Voice message" / "Document" for media, "" for anything that reads as text. */
internal fun quoteKind(m: JSONObject): String {
    val kind = m.optString("kind")
    if (kind == "IMAGE") return "Photo"
    if (kind == "VIDEO") return "Video"
    if (kind != "FILE") return ""
    return when {
        sentAsDocument(m) -> "Document"
        fileLooksVoice(m) -> "Voice message"
        fileLooksImage(m) -> "Photo"
        fileLooksVideo(m) -> "Video"
        else -> "Document"
    }
}

/** The quote's words: the body for text, the media word (plus its caption
 *  when there is one) for media, "Sticker" for a custom sticker. */
internal fun quoteText(m: JSONObject): String {
    val body = m.optText("body")
    if (m.optString("kind") == "STICKER" && EmojiRepo.isCustomId(body)) return "Sticker"
    val kind = quoteKind(m)
    if (kind.isBlank()) return body.ifBlank { "Message" }
    return if (body.isBlank()) kind else "$kind \u00b7 $body"
}

/** The picture behind a photo message — mediaUrl, an inline data URL while
 *  pending, or the file key as an /api/files path. */
internal fun photoUrlOf(m: JSONObject): String? =
    m.optText("mediaUrl").takeIf { it.isNotBlank() }
        ?: m.optText("fileKey").takeIf { it.isNotBlank() }?.let { key ->
            if (key.startsWith("data:") || key.startsWith("http") || key.startsWith("/")) key
            else "/api/files/$key"
        }

/** Owner round 33 (item 17): the small content card beside a quote — the
 *  photo itself, the video's cached frame under a play glyph, a mic for a
 *  voice note, a file glyph for a document. A view-once original shows
 *  nothing (its words already say what it is). */
@Composable
private fun QuoteThumb(m: JSONObject, ink: Color) {
    val kind = quoteKind(m)
    if (kind.isBlank() || isViewOnce(m)) return
    val ctx = LocalContext.current
    Spacer(Modifier.width(8.dp))
    Box(
        Modifier.size(34.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x22000000)),
        contentAlignment = Alignment.Center,
    ) {
        when (kind) {
            "Photo" -> KpNetImage(photoUrlOf(m), "Photo", Modifier.fillMaxSize())
            "Video" -> {
                val key = remember(m.optString("id")) { videoCacheFile(ctx, m).absolutePath }
                val frame = remember(key) { VideoThumbs.get(key) ?: VideoThumbs.readThumb(key) }
                if (frame != null) {
                    Image(
                        bitmap = frame.asImageBitmap(),
                        contentDescription = "Video",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                    Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(16.dp))
                } else {
                    Icon(Icons.Filled.Videocam, null, tint = Color.White.copy(alpha = 0.7f), modifier = Modifier.size(18.dp))
                }
            }
            "Voice message" -> Icon(Icons.Filled.Mic, null, tint = ink, modifier = Modifier.size(18.dp))
            else -> Icon(Icons.Filled.InsertDriveFile, null, tint = ink, modifier = Modifier.size(18.dp))
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
    // Owner round 33 (item 17): a media original shows its small content
    // card at the end of the bar (never for a view-once).
    val thumbed = !isViewOnce(replyTo) && quoteKind(replyTo).isNotBlank()
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
                .height(if (thumbed) 34.dp else 22.dp)
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
                    else quoteText(replyTo).take(80),
                )
            },
            fontSize = 12.sp,
            // Owner round 17: gold-on-gold-soft was unreadable — full ink.
            color = Ink,
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (thumbed) QuoteThumb(replyTo, Ink)
        IconButton(onClick = onCancel, modifier = Modifier.size(26.dp)) {
            Icon(Icons.Filled.Close, "Cancel reply", tint = Muted, modifier = Modifier.size(15.dp))
        }
    }
}

// Owner round 34 (item 15): the in-chat unblock-request card. The blocker
// gets Unblock / Ignore; the requester (mine) a muted confirmation line.
// No busy latch: both answers are idempotent, so a double-tap is harmless.
@Composable
private fun UnblockAskCard(
    m: JSONObject,
    mine: Boolean,
    askName: String,
    onUnblock: (JSONObject) -> Unit,
    onIgnore: (JSONObject) -> Unit,
) {
    // Owner round 35 (item 7): compact card, small buttons — like every
    // other pill in the app.
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(Card)
                .padding(horizontal = 14.dp, vertical = 9.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (mine) {
                Text("Unblock requested", fontSize = 13.sp, color = Muted)
            } else {
                Text(
                    (if (askName.isNotBlank()) askName else "This user") + " asked you to unblock them",
                    fontSize = 13.sp,
                    color = Ink,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(Line)
                            .clickable { onIgnore(m) }
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Ignore", color = Muted, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .background(ActionBlue)
                            .clickable { onUnblock(m) }
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) { Text("Unblock", color = ActionBlueInk, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
                }
            }
        }
    }
}

/** Owner round 34 (item 19): bodies longer than this fold with See more. */
private const val BODY_COLLAPSE_LINES = 10

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
    onJumpTo: (String) -> Unit = {},
    onUnblockAsk: (JSONObject) -> Unit = {},
    onIgnoreAsk: (JSONObject) -> Unit = {},
    askName: String = "",
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
    // Owner round 34 (item 15): the one-per-block unblock plea. The blocker
    // answers it right here (Unblock / Ignore); the requester sees a muted
    // "sent" line instead of buttons.
    if (kind == "UNBLOCK_ASK") {
        UnblockAskCard(m, mine, askName, onUnblockAsk, onIgnoreAsk)
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
        AlbumMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onOpenAlbum, onReply, onLongPress, theme)
        return
    }
    // Owner round 34 (item 16a): a view-once photo / video shows the pixels
    // blurred past recognition (original ratio, 1 mark in the middle) and
    // opens the media ONCE for the recipient; the opening deletes the row
    // for everyone, so there is no opened state left to render.
    if (isViewOnce(m)) {
        ViewOnceRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onOpenVideo, onReply, onLongPress, theme)
        return
    }
    if (kind == "IMAGE" || (kind == "FILE" && fileLooksImage(m) && !sentAsDocument(m))) {
        ImageMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onOpenImage, onReply, onLongPress, theme)
        return
    }
    // Owner round 20: videos render as a tappable video bubble and play
    // IN-APP (the system player could never stream these auth-only files).
    if (kind == "FILE" && fileLooksVideo(m) && !sentAsDocument(m)) {
        VideoMessageRow(m, mine, pendingEcho, otherReadAt, selectedIds, onToggleSelect, onReply, onLongPress, onOpenVideo, theme)
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
            // Owner round 33 (item 5): text-like bodies (text, emoji-only,
            // sticker, deleted) carry their stamp INSIDE the column, placed by
            // measurement (KpStamped) — no reserve, no overlay, no band.
            val textLike = kind == "TEXT" || kind == "STICKER" || kind == "DELETED"
            val bubbleShape =
                RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (mine) 16.dp else 5.dp,
                    bottomEnd = if (mine) 5.dp else 16.dp,
                )
            Box(
                Modifier
                    .onGloballyPositioned { DeleteGeoms.put(m, it.boundsInWindow()) }
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
                    .padding(start = 10.dp, top = 4.dp, end = 8.dp, bottom = if (fileRow) 4.dp else if (textLike) 0.dp else 15.dp),
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
                            else q?.let { quoteText(it).take(48) } ?: "Original message"
                        // Owner round 33 (item 17): a media original gets a small
                        // content card beside the words (never for a view-once).
                        val thumbed = q != null && !isViewOnce(q) && quoteKind(q).isNotBlank()
                        Row(
                            Modifier
                                .padding(bottom = 2.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (mine) Color(0x26FFFFFF) else if (KpThemeMode.darkBlue) ActionBlue.copy(alpha = 0.18f) else GoldSoft)
                                // Owner round 33 (item 17): tap the quote → the original
                                // message; a long-press still opens the bubble's sheet.
                                .combinedClickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onLongClick = {
                                        if (!pendingEcho) {
                                            haptics.tap()
                                            if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
                                        }
                                    },
                                ) {
                                    if (selectedIds.isNotEmpty()) {
                                        if (!pendingEcho) onToggleSelect(m)
                                    } else {
                                        haptics.tap()
                                        onJumpTo(rid)
                                    }
                                }
                                .padding(start = 6.dp, end = 8.dp, top = 3.dp, bottom = 3.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Owner round 21: the quote bar takes the chat accent.
                            Box(Modifier.width(2.5.dp).height(if (thumbed) 34.dp else 20.dp).clip(RoundedCornerShape(2.dp)).background(chatAccent(theme)))
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
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (thumbed && q != null) QuoteThumb(q, if (mine) Color(0xE6FFFFFF) else Ink)
                        }
                    }
                    if (!mine && isGroup && senderName.isNotBlank()) {
                        Text(senderName, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = GoldDeep)
                    }
                    // Owner round 34 (item 19): long bodies collapse to ten
                    // lines with a See more / See less toggle under the
                    // bubble. The count is measured unbounded first (a capped
                    // measure could only ever report ten), so a long message
                    // shows full for a frame, then folds. Typing AI replies
                    // stay unbounded until the reveal finishes.
                    val mid = m.optString("id")
                    var bodyLines by remember(mid) { mutableStateOf(0) }
                    var msgExpanded by remember(mid) { mutableStateOf(false) }
                    val typing = revealChars != null && revealChars < m.optText("body").length
                    val capped = !msgExpanded && !typing && bodyLines > BODY_COLLAPSE_LINES
                    // Reports to the stamp holder AND keeps the high-water
                    // line count (monotonic — a capped re-measure must not
                    // shrink it back to ten and strand the toggle).
                    val countLines = { r: TextLayoutResult, report: (TextLayoutResult) -> Unit ->
                        report(r)
                        if (r.lineCount > bodyLines) bodyLines = r.lineCount
                    }
                    when (kind) {
                        "STICKER" -> KpStamped(
                            below = true,
                            stamp = { BubbleStamp(m, mine, pendingEcho, otherReadAt, emojiOnly, stampInk) },
                        ) { _ ->
                            val st = m.optString("body")
                            if (EmojiRepo.isCustomId(st)) CustomEmojiOrFallback(st)
                            else Text(st, fontSize = 56.sp)
                        }
                        "FILE" -> FileBubble(m, mine, player, pendingEcho, onOpenImage, onOpenVideo, theme, onOpenDoc, onToggleSelect, onLongPress, selecting = selectedIds.isNotEmpty())
                        // Owner round 33 (item 5): the stamp is placed by
                        // measurement after the last line (KpStamped) — the
                        // old no-break-space reserve is gone from every text
                        // body: it only fit Roboto, so Bangla and emoji had
                        // the time / ticks on the glyphs.
                        "DELETED" -> KpStamped(
                            stamp = { BubbleStamp(m, mine, pendingEcho, otherReadAt, emojiOnly, stampInk) },
                        ) { onLayout ->
                            Text(
                                "This message was deleted",
                                fontSize = 13.5.sp,
                                fontStyle = FontStyle.Italic,
                                color = Color(0xFF4A463F),
                                onTextLayout = onLayout,
                            )
                        }
                        else -> if (emojiOnly > 0) {
                            // Owner round 32 (item 8): big glyph, stamp under
                            // it (never over it) — now on a measured row.
                            KpStamped(
                                below = true,
                                stamp = { BubbleStamp(m, mine, pendingEcho, otherReadAt, emojiOnly, stampInk) },
                            ) { onLayout ->
                                Text(
                                    m.optText("body").trim(),
                                    fontSize = if (emojiOnly == 1) 44.sp else 34.sp,
                                    lineHeight = if (emojiOnly == 1) 52.sp else 40.sp,
                                    modifier = Modifier.padding(start = 2.dp, end = 2.dp),
                                    maxLines = if (capped) BODY_COLLAPSE_LINES else Int.MAX_VALUE,
                                    overflow = if (capped) TextOverflow.Ellipsis else TextOverflow.Clip,
                                    onTextLayout = { countLines(it, onLayout) },
                                )
                            }
                        } else {
                            val full = m.optText("body")
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
                            KpStamped(
                                stamp = { BubbleStamp(m, mine, pendingEcho, otherReadAt, emojiOnly, stampInk) },
                            ) { onLayout ->
                                if (revealChars != null && revealChars < full.length) {
                                    // The AI reply is still typing itself out —
                                    // reveal up to the current word + a caret.
                                    Text(
                                        full.take(revealChars) + " ▍",
                                        fontSize = 14.5.sp,
                                        lineHeight = 19.sp,
                                        color = bodyInk,
                                        maxLines = if (capped) BODY_COLLAPSE_LINES else Int.MAX_VALUE,
                                        overflow = if (capped) TextOverflow.Ellipsis else TextOverflow.Clip,
                                        onTextLayout = { countLines(it, onLayout) },
                                    )
                                } else if (linked != null) {
                                    Text(
                                        linked,
                                        fontSize = 14.5.sp,
                                        lineHeight = 19.sp,
                                        color = bodyInk,
                                        maxLines = if (capped) BODY_COLLAPSE_LINES else Int.MAX_VALUE,
                                        overflow = if (capped) TextOverflow.Ellipsis else TextOverflow.Clip,
                                        onTextLayout = { countLines(it, onLayout) },
                                    )
                                } else {
                                    Text(
                                        full,
                                        fontSize = 14.5.sp,
                                        lineHeight = 19.sp,
                                        color = bodyInk,
                                        maxLines = if (capped) BODY_COLLAPSE_LINES else Int.MAX_VALUE,
                                        overflow = if (capped) TextOverflow.Ellipsis else TextOverflow.Clip,
                                        onTextLayout = { countLines(it, onLayout) },
                                    )
                                }
                            }
                        }
                    }
                    if (bodyLines > BODY_COLLAPSE_LINES && !typing && selectedIds.isEmpty()) {
                        Text(
                            if (msgExpanded) "See less" else "See more",
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = chatAccent(theme),
                            modifier =
                                Modifier.padding(top = 2.dp).clickable {
                                    haptics.tap()
                                    msgExpanded = !msgExpanded
                                },
                        )
                    }
                }
                // Owner round 12: one pinned stamp row for every bubble,
                // directly in the Box scope — over the bottom edge (photos
                // keep their scrim), always at the bottom-END corner, never
                // on its own text line. Owner round 33 (item 5): text-like
                // bodies place it by measurement inside the column instead
                // (BubbleStamp via KpStamped) — see the TEXT branch above.
                if (!textLike) {
                    Row(
                        Modifier.align(Alignment.BottomEnd).padding(end = 2.dp, bottom = 1.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BubbleStamp(m, mine, pendingEcho, otherReadAt, emojiOnly, stampInk)
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
    pendingEcho: Boolean,
    otherReadAt: String?,
    selectedIds: List<String>,
    onToggleSelect: (JSONObject) -> Unit,
    onReply: (JSONObject) -> Unit,
    onLongPress: (JSONObject) -> Unit,
    onOpen: (JSONObject) -> Unit,
    theme: String,
) {
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val dest = remember(m.optString("id")) { videoCacheFile(ctx, m) }
    val cacheKey = remember(m.optString("id")) { dest.absolutePath }
    // Owner round 33 (item 19): while the clip is still going out, its frame
    // comes from the local copy (docPath) — the cache file only exists once
    // the upload has finished (Outbox.keepVideoCopy) or a download ran.
    val source = remember(m.optString("id"), m.optString("docPath")) {
        m.optString("docPath").takeIf { it.isNotBlank() }?.let { File(it) }?.takeIf { it.exists() } ?: dest
    }
    val upFrac = UploadProgress.fracs[m.optString("clientId")]
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
        if (!source.exists()) return@produceState
        // w, h, durationMs captured out of the IO block for the disk meta.
        var w0 = 0f
        var h0 = 0f
        var ms0 = 0L
        value = withContext(Dispatchers.IO) {
            // No .use{}: close() is API 29+; release() is safe everywhere.
            val r = android.media.MediaMetadataRetriever()
            try {
                r.setDataSource(source.absolutePath)
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
        // Owner round 42 (item 3): the caption stretches this column wider
        // than the frame — without the alignment the frame hugs the wrong
        // side for my own messages.
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Box(
            Modifier
                .offset { IntOffset(replyOffset.roundToInt(), 0) }
                .shadow(2.dp, RoundedCornerShape(12.dp))
                .clip(RoundedCornerShape(12.dp))
                .onGloballyPositioned { DeleteGeoms.put(m, it.boundsInWindow()) }
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
                        if (pendingEcho) return@combinedClickable
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onOpen(m)
                    },
                    onLongClick = {
                        if (pendingEcho) return@combinedClickable
                        haptics.tap()
                        if (selectedIds.isNotEmpty()) onToggleSelect(m) else onLongPress(m)
                    },
                ),
        ) {
            // the frame keeps the video's OWN aspect ratio (16:9 until known)
            // inside the same 120 x 160 dp box as a photo (round 33, item 18)
            Box(
                Modifier
                    .widthIn(max = 120.dp)
                    .heightIn(max = 160.dp)
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
                // Owner round 33 (item 19): a clip still going out shows the
                // determinate upload ring (photo-style) where the play circle
                // sits — with the percentage — then the POST's own wait.
                if (pendingEcho) {
                    Box(
                        Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Color(0x99000000)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (upFrac != null) {
                            CircularProgressIndicator(
                                progress = { upFrac },
                                color = Color.White,
                                strokeWidth = 3.dp,
                                trackColor = Color(0x40FFFFFF),
                                modifier = Modifier.size(32.dp),
                            )
                            Text("${(upFrac * 100).toInt()}%", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                        } else {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 3.dp,
                                modifier = Modifier.size(32.dp),
                            )
                        }
                    }
                } else {
                    Box(
                        Modifier
                            .size(38.dp)
                            .clip(CircleShape)
                            .background(Color(0x99000000)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Filled.PlayArrow, "Play video", tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                }
                // Owner round 33 (item 19): photo-style stamp — a soft scrim, the
                // time and (for our own clips) the sending / sent / delivered /
                // seen ticks; the duration moves to the top-start corner.
                Box(
                    Modifier
                        .matchParentSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Transparent, Color(0x73000000)),
                            ),
                        ),
                )
                if (duration.isNotBlank()) {
                    Text(
                        duration,
                        color = Color.White,
                        fontSize = 11.sp,
                        modifier = Modifier
                            .align(Alignment.TopStart)
                            .padding(6.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(Color(0x88000000))
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
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
        MediaCaption(m.optText("body"), mine, theme)
        MessageReactions(m)
        }
    }
}

/**
 * Owner round 34 (item 16a): the view-once bubble — the photo at its original
 * ratio, fully blurred, with the 1 mark in the middle (tap opens the single
 * viewing); a video gets the same mark on a dark tile. The opening deletes
 * the row for everyone, so there is no "opened" state anymore — the bubble
 * plays the vanish show and leaves. The sender's tap does nothing (they
 * cannot re-see it either). Reply-drag and long-press behave like every
 * other bubble.
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
    // The recipient can open it; the sender never can.
    val openable = !mine && !pendingEcho
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "oncereplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    val rowSelected = m.optString("id") in selectedIds
    val bubbleShape = RoundedCornerShape(12.dp)
    // A photo bubble shows the actual pixels (blurred past recognition); a
    // video or an upload in flight gets the dark tile instead. Data-URI /
    // file-URI echoes never carry remote pixels — tile, not photo.
    val url = photoUrlOf(m)
    val photoUrl =
        if (!video && !pendingEcho && url != null && !url.startsWith("data:") && !url.startsWith("file://")) url
        else null
    var ratio by remember(photoUrl) {
        mutableStateOf(ImageRatios.get(photoUrl).takeIf { it > 0f } ?: 0f)
    }
    val upFrac = UploadProgress.fracs[m.optString("clientId")]
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Box(
                Modifier
                    .offset { IntOffset(replyOffset.roundToInt(), 0) }
                    .onGloballyPositioned { DeleteGeoms.put(m, it.boundsInWindow()) }
                    .widthIn(max = 240.dp)
                    .then(
                        if (video) {
                            Modifier.aspectRatio(16f / 9f)
                        } else if (photoUrl != null && ratio > 0f) {
                            Modifier
                                .heightIn(max = 320.dp)
                                .aspectRatio(ratio)
                        } else {
                            Modifier
                                .widthIn(min = 180.dp)
                                .height(220.dp)
                        },
                    )
                    .shadow(2.dp, bubbleShape)
                    .clip(bubbleShape)
                    .background(Color(0xFF1B1E26))
                    .border(
                        1.dp,
                        if (KpThemeMode.darkBlue) Color(0x668091AC) else Color(0x66444444),
                        bubbleShape,
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
                    }
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
                    ),
                contentAlignment = Alignment.Center,
            ) {
                if (photoUrl != null) {
                    val imageRequest = remember(photoUrl) {
                        coil.request.ImageRequest.Builder(ctx)
                            .data(if (photoUrl.startsWith("http")) photoUrl else Api.BASE + photoUrl)
                            .transformations(ViewOnceBlur)
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
                                ratio = ImageRatios.put(photoUrl, d.intrinsicWidth.toFloat() / d.intrinsicHeight.toFloat())
                            }
                        },
                    )
                    // Dimmer so the white mark never drowns in a bright photo.
                    Box(Modifier.matchParentSize().background(Color(0x40000000)))
                }
                ViewOnceOneIcon(56.dp)
                if (pendingEcho) {
                    // An upload in flight: the determinate ring under the mark.
                    Box(Modifier.matchParentSize().padding(bottom = 14.dp), contentAlignment = Alignment.BottomCenter) {
                        if (upFrac != null) {
                            CircularProgressIndicator(
                                progress = { upFrac },
                                color = Color.White,
                                strokeWidth = 3.dp,
                                trackColor = Color.White.copy(alpha = 0.22f),
                                modifier = Modifier.size(30.dp),
                            )
                        } else {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(30.dp))
                        }
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
                if (rowSelected) Box(Modifier.matchParentSize().background(ActionBlue.copy(alpha = 0.35f)))
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
/** Owner round 33 (item 19): the cache path for a clip by its file KEY —
 *  the same file videoCacheFile() resolves for the server row, so a sent
 *  clip's local copy can be kept as its cache entry (no re-download, and
 *  the bubble's frame survives the swap from echo to server row). */
internal fun videoCacheFileFor(ctx: android.content.Context, fileKey: String): java.io.File =
    videoCacheFile(ctx, JSONObject().put("fileKey", fileKey))

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
    theme: String,
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
        // Owner round 42 (item 3): a captioned photo's column is caption-wide
        // — the photo must hug MY side, not the column's start.
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Box(
            Modifier
                .offset { IntOffset(replyOffset.roundToInt(), 0) }
                .onGloballyPositioned { DeleteGeoms.put(m, it.boundsInWindow()) }
                .widthIn(max = 120.dp) // Owner round 25 / 32 item 29 / 33 item 18: smaller inline preview
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
        MediaCaption(m.optText("body"), mine, theme)
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
                        .put("body", m.optText("body"))
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
                        .put("body", m.optText("body"))
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
                        .put("body", m.optText("body"))
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

/**
 * Owner round 32 (item 17): reports the single opening to the server (POST
 * /api/messages/:id/view). Process-level and de-duplicated per id: the viewer
 * calls it when the picture / clip is on screen, and a recomposition or a
 * second tap in the same second must not fire twice. The VANISHED broadcast
 * that follows plays the vanish show and drops the row on every device
 * (sender included).
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
    theme: String,
) {
    val photos = albumPhotos(m)
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    var replyDrag by remember { mutableStateOf(0f) }
    val replyOffset by animateFloatAsState(replyDrag, spring(stiffness = 1400f), label = "albumreplydrag")
    val replyThreshold = with(LocalDensity.current) { 36.dp.toPx() }
    val shape = RoundedCornerShape(12.dp)
    val gap = 2.dp
    val albumWidth = 208.dp // Owner round 33 (item 18): narrower, like the single photo
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
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            Box(
                Modifier
                    .offset { IntOffset(replyOffset.roundToInt(), 0) }
                    .onGloballyPositioned { DeleteGeoms.put(m, it.boundsInWindow()) }
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
            val albumCaption = photos.map { it.optText("body") }.firstOrNull { it.isNotBlank() }.orEmpty()
            MediaCaption(albumCaption, mine, theme)
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
    onScrub: ((Float?) -> Unit)? = null,
) {
    // Owner round 33 (item 1): the gesture reads the CURRENT callbacks — the
    // pointerInput is keyed on the bars only, so the progress recompositions
    // (12x a second while playing) never restart a drag in flight.
    val seek by rememberUpdatedState(onSeek)
    val scrub by rememberUpdatedState(onScrub)
    Canvas(
        // A quick tap seeks; the down is NOT consumed, so the bubble's own
        // long-press (action sheet) keeps working on the bars — only the
        // tap's up is taken, which also stops the bubble from treating it
        // as a select tap.
        // Owner round 33 (item 1): a LEFT/RIGHT drag on the bars SCRUBS the
        // note instead of arming the reply swipe. The wave sits inside the
        // bubble's pointerInput, so it sees every event first on the Main
        // pass: it claims the horizontal slop, paints the finger's fraction
        // while the drag runs and seeks there on release; the bubble's own
        // swipe sees a consumed change and stands down. Dragging the bubble
        // body around the wave still replies; vertical movement is left to
        // the list; a finger held still past the long-press timeout belongs
        // to the bubble's long-press.
        modifier.pointerInput(bars) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                var dragged = false
                var last = (down.position.x / size.width).coerceIn(0f, 1f)
                // AwaitPointerEventScope's own withTimeoutOrNull (frame-clock aware).
                val slop =
                    withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                        awaitHorizontalTouchSlopOrCancellation(down.id) { change, _ ->
                            change.consume()
                            dragged = true
                            last = (change.position.x / size.width).coerceIn(0f, 1f)
                            scrub?.invoke(last)
                        }
                    }
                if (slop != null) {
                    horizontalDrag(slop.id) { change ->
                        change.consume()
                        last = (change.position.x / size.width).coerceIn(0f, 1f)
                        scrub?.invoke(last)
                    }
                    scrub?.invoke(null)
                    seek(last)
                    return@awaitEachGesture
                }
                if (dragged) scrub?.invoke(null)
                // No drag: an up before the slop (and before the long-press
                // timeout) is a tap — seek there. A cancelled or timed-out
                // gesture (list scroll, long-press) seeks nothing.
                val up = currentEvent.changes.firstOrNull { it.id == down.id }
                if (!dragged && up != null && up.changedToUp()) {
                    up.consume()
                    seek((up.position.x / size.width).coerceIn(0f, 1f))
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

/**
 * Owner round 34 (item 16b): the words under a captioned photo / video /
 * album — the body the editor's caption bar stored. Round 44 (item 6): its
 * OWN bubble below the frame (the owner's call — the shared frame pushed
 * the photo left and sprawled) — text-bubble shape + fill + ink, slim.
 */
@Composable
private fun MediaCaption(body: String, mine: Boolean, theme: String) {
    if (body.isBlank()) return
    // Owner round 45 (item 6): compact — tighter corners, 7x3 padding, no
    // shadow (the media frame above already carries the card), 12.sp on
    // trimmed line height so the caption reads as a tight strip, not a
    // second message.
    val captionShape =
        RoundedCornerShape(
            topStart = 14.dp,
            topEnd = 14.dp,
            bottomStart = if (mine) 14.dp else 5.dp,
            bottomEnd = if (mine) 5.dp else 14.dp,
        )
    Box(
        Modifier
            .padding(top = 2.dp)
            .clip(captionShape)
            .background(if (mine) chatMineFill(theme) else chatOtherFill(theme))
            .padding(horizontal = 7.dp, vertical = 3.dp)
            .widthIn(max = 240.dp),
    ) {
        Text(
            body,
            color = if (mine) Color(0xE6FFFFFF) else Ink,
            fontSize = 12.sp,
            lineHeight = 14.sp,
            style = TextStyle(platformStyle = PlatformTextStyle(includeFontPadding = false)),
        )
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
            // Owner round 32 (item 29) / round 33 (item 18): a small inline
            // preview — at most 120 dp wide and 160 dp tall. The height cap sits
            // BEFORE aspectRatio on purpose: aspectRatio hands its child FIXED
            // constraints, so a heightIn placed after it never applied and
            // portrait shots still ran 267 dp tall. Tap opens the full viewer.
            .widthIn(max = 120.dp)
            .then(
                if (ratio > 0f) {
                    Modifier
                        .heightIn(max = 160.dp)
                        .aspectRatio(ratio)
                } else {
                    Modifier
                        .widthIn(min = 96.dp)
                        .height(120.dp)
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
                        modifier = Modifier.size(34.dp),
                    )
                    Spacer(Modifier.height(3.dp))
                    Text("${(upFrac * 100).toInt()}%", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun FileBubble(
    m: JSONObject,
    mine: Boolean,
    player: VoicePlayer,
    pendingEcho: Boolean = false,
    onOpenImage: (JSONObject) -> Unit = {},
    onOpenVideo: (JSONObject) -> Unit = {},
    theme: String = "darkblue",
    onOpenDoc: (JSONObject) -> Unit = {},
    // Owner round 34 (item 14): press-hold forwards to these (the row's own
    // tap target used to swallow it, so documents had no long-press at all).
    onToggleSelect: (JSONObject) -> Unit = {},
    onLongPress: (JSONObject) -> Unit = {},
    selecting: Boolean = false,
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
        ImageBubble(JSONObject().put("mediaUrl", url).put("body", m.optText("body")), mine)
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
        // Owner round 33 (item 1): while the finger scrubs the bars, the
        // painted fraction (and the time line) follow the finger, not the
        // player; the seek lands on release.
        var scrubAt by remember(id) { mutableStateOf<Float?>(null) }
        val progress = scrubAt ?: if (active) player.progress else 0f
        val ink = if (mine) Color.White else chatAccent(theme)
        val faint = if (mine) Color(0x66FFFFFF) else chatAccent(theme).copy(alpha = 0.35f)
        // Owner round 32 (item 45): compact — a 36dp button against a 22dp
        // wave with the duration right under it; the stamp shares the
        // duration line's right end (the bubble keeps no bottom band for
        // voice notes). It used to be a 30dp wave over a duration line over
        // a blank 15dp band: a 64dp bubble for one line of audio.
        // Owner round 33 (item 1): the wave used to sit HIGHER than the play
        // button — the row centred the whole column (wave + time line) on
        // the button, so the wave itself rode 8dp above its middle. The row
        // is top-aligned now and the column starts 7dp down: the 22dp wave's
        // centre lands exactly on the 36dp button's centre, the time line
        // hangs under it (bubble 45dp, was 38).
        Row(verticalAlignment = Alignment.Top) {
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
            Column(Modifier.padding(top = 7.dp)) {
                VoiceWave(
                    bars = bars,
                    progress = progress,
                    played = ink,
                    rest = faint,
                    modifier = Modifier.width(150.dp).height(22.dp),
                    onSeek = { frac ->
                        if (!pendingEcho && fileKey.isNotBlank()) player.seekTo(ctx, id, fileKey, frac)
                    },
                    onScrub = { frac ->
                        scrubAt = if (!pendingEcho && fileKey.isNotBlank()) frac else null
                    },
                )
                Spacer(Modifier.height(1.dp))
                val secs = m.optJSONObject("meta")?.optInt("seconds") ?: 0
                val vFrac = UploadProgress.fracs[m.optString("clientId")]
                Text(
                    when {
                        vFrac != null -> "Sending · ${(vFrac * 100).toInt()}%"
                        // While it plays (or the finger scrubs), the line
                        // counts the elapsed seconds.
                        (active || scrubAt != null) && secs > 0 -> {
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
                .combinedClickable(
                    onClick = {
                        if (selecting && !pendingEcho) {
                            onToggleSelect(m)
                            return@combinedClickable
                        }
                    if (!ready) {
                        android.widget.Toast.makeText(ctx, "This file is no longer available.", android.widget.Toast.LENGTH_SHORT).show()
                        return@combinedClickable
                    }
                    // Owner round 31: media sent AS a document still opens in
                    // KuchuPuchu's own viewer / player (never a system app);
                    // audio documents play inline through the voice player.
                    when {
                        isImage -> {
                            onOpenImage(m)
                            return@combinedClickable
                        }
                        fileLooksVideo(m) -> {
                            onOpenVideo(m)
                            return@combinedClickable
                        }
                        fileType.startsWith("audio") -> {
                            if (player.playingId == id) player.stop() else player.toggle(ctx, id, fileKey)
                            return@combinedClickable
                        }
                    }
                    // Owner round 32 (item 33): every other document opens in
                    // KuchuPuchu's own viewer screen (PDF pages, text,
                    // pictures, SVG, TIFF, archive contents; ⋮ → Save /
                    // Forward / Open with) — never straight into a system app,
                    // never a dead tap. The screen downloads and caches it.
                    onOpenDoc(m)
                    },
                    onLongClick = {
                        if (!pendingEcho) {
                            haptics.tap()
                            if (selecting) onToggleSelect(m) else onLongPress(m)
                        }
                    },
                ),
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
 * Owner round 33 (item 5): the time (+ ticks for our own rows) of a bubble —
 * ONE definition for the pinned overlay (photos, files) and the measured
 * in-column placement of text bodies (KpStamped). r32-8: no bubble under an
 * emoji-only body, so its stamp reads in the wallpaper's ink.
 */
@Composable
private fun BubbleStamp(
    m: JSONObject,
    mine: Boolean,
    pendingEcho: Boolean,
    otherReadAt: String?,
    emojiOnly: Int,
    stampInk: Color,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            msgStamp(m.optString("createdAt")),
            fontSize = 10.sp,
            lineHeight = 12.sp,
            maxLines = 1,
            softWrap = false,
            color = if (mine && emojiOnly == 0) Color(0xD9FFFFFF) else stampInk,
        )
        if (mine) {
            Spacer(Modifier.width(3.dp))
            TickIcon(m, pendingEcho, otherReadAt, onWallpaper = emojiOnly > 0, ink = stampInk)
        }
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
// Owner round 34 (item 7): the dots ride the chat's accent — they were
// fixed amber (GoldDeep) and glowed cream on the dark-blue theme.
private fun TypingBubble(dot: Color) {
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
                            .background(dot.copy(alpha = 0.35f + 0.65f * lift)),
                    )
                }
            }
        }
    }
}

/**
 * Owner round 42 (item 3): the "image is being created" card — a small
 * photo-shaped shimmer (the shared shimmer pulse + an image glyph), shown
 * while the AI draws instead of the typing dots. No text: the card itself
 * is the status.
 */
@Composable
private fun ImageCreatingBubble() {
    val shimmer = rememberShimmerAlpha()
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.Start,
    ) {
        Box(
            Modifier
                .width(132.dp)
                .height(88.dp)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 5.dp, bottomEnd = 16.dp))
                .background(Line.copy(alpha = shimmer)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Filled.Image,
                contentDescription = "Creating image",
                tint = Muted.copy(alpha = shimmer),
                modifier = Modifier.size(30.dp),
            )
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
