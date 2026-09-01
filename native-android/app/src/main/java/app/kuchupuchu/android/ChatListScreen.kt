package app.kuchupuchu.android

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
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
import kotlin.math.roundToInt

/**
 * Chat List — locked design #7 "Gradient Rings".
 * Cream background, white 16dp cards with soft shadow, amber gradient
 * ring avatars, big top tabs (Chats / Status / Calls), gold FAB,
 * swipe actions for mute + delete.
 */
@Composable
fun ChatListScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val convs = ScreenStore.convs
    var loading by remember { mutableStateOf(!ScreenStore.convsLoaded) }
    // Saveable: coming back from a chat / status viewer returns to the SAME
    // tab instead of jumping to Chats every time.
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val haptics = rememberHaptics()

    // FOUR things can ask for the same list at the same instant: the socket
    // "hello" on connect, the socket "conv" poke, the push path bumping
    // ScreenStore.poke, and the foreground/reconnect tick. Each one used to run
    // its own /api/conversations round trip + full parse + setConvs write, so an
    // incoming message while a chat was open meant 2-3 list recompositions in a
    // row — that is exactly what "laggy" feels like. One flight at a time now,
    // with a single trailing pass so a trigger that arrives mid-flight is not
    // lost (dropping it would delay the badge until the next tick).
    val refreshInflight = remember { java.util.concurrent.atomic.AtomicBoolean(false) }
    val refreshAgain = remember { java.util.concurrent.atomic.AtomicBoolean(false) }

    fun refresh() {
        if (!refreshInflight.compareAndSet(false, true)) {
            refreshAgain.set(true)
            return
        }
        scope.launch {
            try {
                do {
                    refreshAgain.set(false)
                // Cheap freshness check: send back the last marker; an
                // unchanged tick returns a tiny payload and skips parse/
                // diff/notify entirely. Full data still arrives whenever
                // anything actually moved.
                val m = ScreenStore.convsMarker
                val url =
                    if (m.isBlank()) "/api/conversations"
                    else "/api/conversations?marker=$m"
                val data = withContext(Dispatchers.IO) { Api.get(url, true) }
                if (data.optBoolean("unchanged")) {
                    loading = false
                    return@launch
                }
                ScreenStore.convsMarker = data.optString("marker")
                val items = data.arr("items").objects()
                // NON-FOREGROUND guard: posting a card here (on a fresh list
                // sync) used to fire even when the app was open on ANOTHER
                // screen, which is the locked "open other screen -> sound only,
                // NO card" bug. The FCM data push is the single notification
                // source: it posts the rich Reply/Like/Read card in background
                // and is sound-only in foreground. This list-refresh path only
                // carries the unread badge / preview / reorder (setConvs below)
                // and, in background, MAY post a card as a fallback if the push
                // did not. It must never fire while the app is on screen.
                val fg = Store.foreground
                items.forEach { c ->
                    val id = c.optString("id")
                    val last = c.optString("lastMessageAt")
                    val unread = c.optInt("unread", 0)
                    if (!fg && ScreenStore.shouldNotifyChat(id, last, unread)) {
                        val name =
                            if (c.optBoolean("isGroup")) c.optString("title").ifBlank { "Group" }
                            else c.optJSONObject("other")?.optText("displayName")?.ifBlank { "KuchuPuchu" } ?: "KuchuPuchu"
                        KpNotify.message(ctx, name, c.optString("lastMessage"), id)
                    }
                }
                ScreenStore.setConvs(items)
                loading = false
                if (refreshAgain.get()) delay(200)
                } while (refreshAgain.get())
            } catch (_: Exception) {
                loading = false
            } finally {
                refreshInflight.set(false)
            }
        }
    }

    LaunchedEffect(Unit) {
        refresh()
        // v3.7 realtime: the user channel pushes a poke the instant anything
        // changes (new message, read, group rename). The ticker below only
        // fires when the socket is DOWN or the app just came forward. The
        // socket itself is owned at the process level now (MainActivity joins
        // it and never leaves), so it stays up when this screen is not in
        // front — that is what lets a backgrounded process keep rich action
        // cards. Here we only subscribe to events.
        val removeListener = KpSocket.onEvent { ev ->
            when (ev.optString("type")) {
                "hello", "conv" -> refresh()
                // "call" pokes are CallEngine's business, not the list's.
            }
        }
        var lastForeground = Store.foreground
        try {
            while (true) {
                // v3.9: the 2s tick was never a 2s REQUEST — `refresh()` below
                // only runs when the socket is down or the app just came
                // forward, and the forward case is already event-driven
                // (onResume bumps ScreenStore.poke, which the effect under this
                // one listens to). So with a healthy socket the loop's only
                // job is to notice that the socket DIED — waking twice a
                // second for that is pure battery. 10s bounds that detection,
                // and the moment the socket is down we are back to a 2s poll.
                delay(if (KpSocket.userLive()) 10_000 else 2_000)
                val fg = Store.foreground
                val justReturned = fg && !lastForeground
                lastForeground = fg
                if (fg && (justReturned || !KpSocket.userLive())) refresh()
            }
        } finally {
            removeListener()
            // NO KpSocket.leaveUser() here: the user channel is owned by
            // MainActivity for the process lifetime, so leaving it on this
            // screen's dispose would close the socket (and kill background
            // rich cards) merely by navigating to a chat.
        }
    }
    // onResume pokes this — the list syncs the moment the app comes forward.
    LaunchedEffect(ScreenStore.poke) {
        if (Store.foreground) refresh()
    }

    Box(Modifier.fillMaxSize().background(Cream)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            /* ---------- top bar ---------- */
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 6.dp, top = 10.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("KuchuPuchu", fontSize = 23.sp, fontWeight = FontWeight.Bold, color = Ink)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { nav.navigate("search") }) {
                    Icon(Icons.Filled.Search, "Search", tint = Ink, modifier = Modifier.size(26.dp))
                }
                IconButton(onClick = { nav.navigate("settings") }) {
                    Icon(Icons.Filled.Settings, "Settings", tint = Ink, modifier = Modifier.size(26.dp))
                }
            }

            /* ---------- big top tabs ---------- */
            val unreadTotal = convs.sumOf { it.optInt("unread", 0) }
            val unseenStatus = ScreenStore.statuses.any { !it.optBoolean("mine") && !it.optBoolean("allViewed") }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TopTab(Icons.Filled.Chat, "Chats", tab == 0, unreadTotal, modifier = Modifier.weight(1f)) { haptics.tap(); tab = 0 }
                TopTab(Icons.Filled.Circle, "Status", tab == 1, dot = unseenStatus, modifier = Modifier.weight(1f)) { haptics.tap(); tab = 1 }
                TopTab(Icons.Filled.Call, "Calls", tab == 2, modifier = Modifier.weight(1f)) { haptics.tap(); tab = 2 }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .height(1.dp)
                    .background(Line),
            )

            /* ---------- tab bodies ---------- */
            when (tab) {
                0 -> ArchivePullArea(nav) { ChatListBody(convs, loading, nav, ::refresh) }
                1 -> StatusScreen(nav)
                2 -> CallsScreen(nav)
            }
        }

        /* ---------- gold FAB (chats tab only — no overlap with status FABs) ---------- */
        if (tab == 0) {
            FloatingActionButton(
                onClick = { haptics.tap(); nav.navigate("newchat") },
                shape = CircleShape,
                containerColor = Gold,
                contentColor = AmberInk,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(20.dp)
                    .size(52.dp)
                    .shadow(8.dp, CircleShape),
            ) {
                Icon(
                    Icons.Filled.DriveFileRenameOutline,
                    contentDescription = "New chat",
                    modifier = Modifier.size(24.dp),
                )
            }
        }
    }
}

/**
 * Pull-down gesture on the chats list: pulling past ~110dp at the top and
 * releasing opens the archived chats. A gold hint pill shows while pulling.
 */
@Composable
private fun ArchivePullArea(nav: NavController, content: @Composable () -> Unit) {
    val density = LocalDensity.current
    val threshold = with(density) { 110.dp.toPx() }
    var pull by remember { mutableStateOf(0f) }
    val conn = remember {
        object : androidx.compose.ui.input.nestedscroll.NestedScrollConnection {
            override fun onPostScroll(
                consumed: androidx.compose.ui.geometry.Offset,
                available: androidx.compose.ui.geometry.Offset,
                source: androidx.compose.ui.input.nestedscroll.NestedScrollSource,
            ): androidx.compose.ui.geometry.Offset {
                // Leftover downward scroll = the list is already at its top.
                if (available.y > 0f) pull = (pull + available.y).coerceAtMost(threshold * 1.5f)
                return androidx.compose.ui.geometry.Offset.Zero
            }

            override suspend fun onPostFling(
                consumed: androidx.compose.ui.unit.Velocity,
                available: androidx.compose.ui.unit.Velocity,
            ): androidx.compose.ui.unit.Velocity {
                if (pull > threshold) nav.navigate("archive")
                pull = 0f
                return androidx.compose.ui.unit.Velocity.Zero
            }
        }
    }
    Box(Modifier.fillMaxSize().nestedScroll(conn)) {
        content()
        if (pull > threshold * 0.3f) {
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 4.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(GoldSoft)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Archive, null, tint = GoldDeep, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    if (pull > threshold) "Release for archived chats" else "Pull down for archived chats",
                    fontSize = 12.sp,
                    color = GoldDeep,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

/** Archived chats — swipe a chat right in the main list to put it here. */
@Composable
fun ArchiveScreen(nav: NavController) {
    val convs = ScreenStore.convs
    var rev by remember { mutableStateOf(0) }
    val archived = remember(rev, convs.size) { convs.filter { ScreenStore.isArchived(it.optString("id")) } }
    val ctx = LocalContext.current
    LaunchedEffect(Unit) {
        // The archive screen has no chat-list poll behind it — deleted/unarchived
        // rows used to sit there forever. Sync it on its own.
        //
        // v3.9: "on its own" used to mean a FORCED, marker-less GET of the
        // whole conversation list every 2s — the full payload, parsed and
        // pushed through setConvs, even when nothing had changed. It now uses
        // the same freshness marker the chat list uses, so an idle tick is a
        // tiny {unchanged:true} body, and it backs off to 10s while the user
        // socket is alive. The marker is kept LOCALLY on purpose: advancing
        // ScreenStore.convsMarker from here would make the chat list's next
        // poll come back "unchanged" and skip the shouldNotifyChat pass —
        // messages that landed while this screen was open would never alert.
        var localMarker = ""
        while (true) {
            delay(if (KpSocket.userLive()) 10_000 else 2_000)
            if (Store.foreground) {
                runCatching {
                    val url =
                        if (localMarker.isBlank()) "/api/conversations"
                        else "/api/conversations?marker=$localMarker"
                    val data = withContext(Dispatchers.IO) { Api.get(url, true) }
                    if (!data.optBoolean("unchanged")) {
                        localMarker = data.optString("marker")
                        ScreenStore.setConvs(data.arr("items").objects())
                    }
                }
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Cream).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("Archived", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
            Spacer(Modifier.width(8.dp))
            Text("(${archived.size})", fontSize = 15.sp, color = Muted)
        }
        if (archived.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(
                    icon = Icons.Filled.Archive,
                    title = "No archived chats",
                    note = "Swipe a chat right to archive it",
                )
            }
        } else {
            // Same swipe language as the main list, mirrored for archive:
            // left swipe = Unarchive, right swipe = Mute + Delete.
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(archived, key = { it.optString("id") }) { conv ->
                    SwipeConvRow(conv, nav, { rev++ }, archivedMode = true)
                }
            }
        }
    }
}

/** Big friendly tab pill with optional unread badge / new-status dot. */
@Composable
private fun TopTab(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    badge: Int = 0,
    dot: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tint = if (selected) GoldDeep else Muted
    val bg =
        if (selected) Modifier.background(GoldSoft, RoundedCornerShape(14.dp))
        else Modifier
    Row(
        modifier
            .padding(3.dp)
            .clip(RoundedCornerShape(14.dp))
            .then(bg)
            .clickable { onClick() }
            .padding(horizontal = 6.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (label == "Status") {
            // WhatsApp-style status glyph (ring + dot), not a plain circle.
            StatusGlyphIcon(tint, 19.dp)
        } else {
            Icon(
                icon,
                contentDescription = label,
                tint = tint,
                modifier = Modifier.size(19.dp),
            )
        }
        Spacer(Modifier.width(6.dp))
        Text(
            label,
            color = tint,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            fontSize = 14.sp,
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Clip,
        )
        if (badge > 0) {
            Spacer(Modifier.width(5.dp))
            Box(
                Modifier
                    .defaultMinSize(minWidth = 18.dp, minHeight = 18.dp)
                    .clip(CircleShape)
                    .background(Gold)
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (badge > 99) "99+" else "$badge",
                    color = AmberInk,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = 10.sp,
                )
            }
        }
        if (dot) {
            Spacer(Modifier.width(5.dp))
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(Green),
            )
        }
    }
}

@Composable
private fun ChatListBody(
    convs: List<JSONObject>,
    loading: Boolean,
    nav: NavController,
    onChange: () -> Unit,
) {
    // Archived chats live in their own list (pull down on this list to open).
    val visible = convs.filter { !ScreenStore.isArchived(it.optString("id")) }
    if (visible.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (loading) {
                CircularProgressIndicator(color = Gold)
            } else {
                EmptyState(
                    icon = Icons.Filled.Chat,
                    title = "No chats yet",
                    note = "Tap the gold button to message someone",
                )
            }
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(visible, key = { it.optString("id") }) { conv ->
            SwipeConvRow(conv, nav, onChange)
        }
    }
}

/**
 * One conversation card + bidirectional swipe:
 *   swipe LEFT  → mute / delete (unchanged)
 *   swipe RIGHT → archive (local — pull the list down to reach it)
 */
@Composable
private fun SwipeConvRow(
    conv: JSONObject,
    nav: NavController,
    onChange: () -> Unit,
    archivedMode: Boolean = false,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val density = LocalDensity.current
    val actionWidth = with(density) { 136.dp.toPx() }
    var dragged by remember { mutableStateOf(0f) }
    val offset by animateFloatAsState(dragged, tween(160), label = "swipe")
    val revealedLeft = offset > actionWidth / 2   // card slid left → actions on the right
    val revealedRight = offset < -actionWidth / 2 // card slid right → archive on the left

    Box(Modifier.fillMaxWidth().height(76.dp)) {
        /* revealed actions: delete/mute sit on the RIGHT of the card,
           archive sits on the LEFT */
        Row(Modifier.matchParentSize()) {
            // left slot (revealed by swiping right)
            Row(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Line),
            ) {
                if (offset < 0f && archivedMode) {
                    ActionSlot(
                        icon = if (conv.optBoolean("muted")) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
                        bg = GoldSoft,
                        tint = GoldDeep,
                        label = if (conv.optBoolean("muted")) "Unmute" else "Mute",
                    ) {
                        haptics.confirm()
                        val id = conv.optString("id")
                        val next = !conv.optBoolean("muted")
                        ScreenStore.setMuted(id, next)
                        dragged = 0f
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.post("/api/conversations/$id/mute", JSONObject().put("muted", next))
                                }
                            }.onFailure { ScreenStore.setMuted(id, !next) }
                        }
                    }
                    ActionSlot(
                        icon = Icons.Filled.Delete,
                        bg = Color(0xFFFEE2E2),
                        tint = Red,
                        label = "Delete",
                    ) {
                        scope.launch {
                            haptics.heavy()
                            // Vanish NOW — the server delete runs behind. The old
                            // flow waited for the next poll, so the row sat there
                            // long enough to look like "delete hoi na".
                            ScreenStore.dropConv(conv.optString("id"))
                            android.widget.Toast.makeText(ctx, "Chat deleted", android.widget.Toast.LENGTH_SHORT).show()
                            dragged = 0f
                            onChange()
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.delete("/api/conversations/${conv.optString("id")}")
                                }
                            }
                        }
                    }
                }
                if (offset < 0f && !archivedMode) {
                    ActionSlot(
                        icon = Icons.Filled.Archive,
                        bg = Color(0xFFE7F0E7),
                        tint = Color(0xFF2E7D32),
                        label = "Archive",
                    ) {
                        haptics.confirm()
                        ScreenStore.archiveConv(conv.optString("id"))
                        android.widget.Toast.makeText(ctx, "Chat archived", android.widget.Toast.LENGTH_SHORT).show()
                        dragged = 0f
                        onChange()
                    }
                }
            }
            // right slot (revealed by swiping left)
            Row(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Line),
            ) {
                if (offset >= 0f && archivedMode) {
                    ActionSlot(
                        icon = Icons.Filled.Unarchive,
                        bg = Color(0xFFE7F0E7),
                        tint = Color(0xFF2E7D32),
                        label = "Unarchive",
                    ) {
                        haptics.confirm()
                        ScreenStore.unarchiveConv(conv.optString("id"))
                        android.widget.Toast.makeText(ctx, "Chat unarchived", android.widget.Toast.LENGTH_SHORT).show()
                        dragged = 0f
                        onChange()
                    }
                }
                if (offset >= 0f && !archivedMode) {
                    ActionSlot(
                        icon = if (conv.optBoolean("muted")) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
                        bg = GoldSoft,
                        tint = GoldDeep,
                        label = if (conv.optBoolean("muted")) "Unmute" else "Mute",
                    ) {
                        haptics.confirm()
                        val id = conv.optString("id")
                        val next = !conv.optBoolean("muted")
                        ScreenStore.setMuted(id, next)
                        dragged = 0f
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.post("/api/conversations/$id/mute", JSONObject().put("muted", next))
                                }
                            }.onFailure { ScreenStore.setMuted(id, !next) }
                        }
                    }
                    ActionSlot(
                        icon = Icons.Filled.Delete,
                        bg = Color(0xFFFEE2E2),
                        tint = Red,
                        label = "Delete",
                    ) {
                        scope.launch {
                            haptics.heavy()
                            // Vanish NOW — the server delete runs behind. The old
                            // flow waited for the next poll, so the row sat there
                            // long enough to look like "delete hoi na".
                            ScreenStore.dropConv(conv.optString("id"))
                            android.widget.Toast.makeText(ctx, "Chat deleted", android.widget.Toast.LENGTH_SHORT).show()
                            dragged = 0f
                            onChange()
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    Api.delete("/api/conversations/${conv.optString("id")}")
                                }
                            }
                        }
                    }
                }
            }
        }

        /* the card itself, slid by the swipe (either direction) */
        var buzzedSide by remember { mutableStateOf(0) }
        Box(
            Modifier
                .offset { IntOffset(-offset.roundToInt(), 0) }
                .fillMaxSize()
                .shadow(2.dp, RoundedCornerShape(16.dp))
                .clip(RoundedCornerShape(16.dp))
                .background(Card)
                .pointerInput(conv.optString("id")) {
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            dragged =
                                when {
                                    dragged > actionWidth / 2 -> actionWidth
                                    dragged < -actionWidth / 2 -> -actionWidth
                                    else -> 0f
                                }
                            buzzedSide = 0
                        },
                    ) { _, dragAmount ->
                        dragged = (dragged - dragAmount).coerceIn(-actionWidth, actionWidth)
                        // Haptic once when an action arm opens (left=delete/mute,
                        // right=archive) — the finger learns the threshold.
                        val side = if (dragged > actionWidth / 2) 1 else if (dragged < -actionWidth / 2) -1 else 0
                        if (side != 0 && side != buzzedSide) {
                            buzzedSide = side
                            haptics.tap()
                        }
                    }
                },
        ) {
            ConvCard(conv, nav, revealedLeft || revealedRight) { dragged = 0f }
        }
    }
}

@Composable
private fun RowScope.ActionSlot(
    icon: ImageVector,
    bg: Color,
    tint: Color,
    label: String,
    onClick: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxHeight()
            .weight(1f)
            .background(bg)
            .clickable { onClick() },
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(24.dp))
        Spacer(Modifier.height(2.dp))
        Text(label, fontSize = 11.sp, color = tint, fontWeight = FontWeight.Medium)
    }
}

/**
 * Chat-list preview: media never shows its raw file name — "voice_123.m4a"
 * becomes "Voice message", anything photo/video/doc likewise. Text passes
 * through untouched.
 */
private fun friendlyPreview(raw: String): String {
    val t = raw.trim()
    if (t.isBlank()) return "No messages yet"
    val lower = t.lowercase()
    val photoExts = listOf(".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic")
    val videoExts = listOf(".mp4", ".mkv", ".mov", ".webm", ".avi", ".3gp")
    val audioExts = listOf(".m4a", ".mp3", ".aac", ".ogg", ".wav", ".opus", ".flac")
    val docExts = listOf(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".rar", ".txt", ".csv")
    if (t == "Photo" || t == "📷 Photo") return "📷 Photo"
    if (EmojiRepo.isCustomId(t)) return "🙂 Emoji"
    return when {
        lower.startsWith("voice_") || lower.startsWith("voice ") -> "🎤 Voice message"
        lower == "video" -> "🎬 Video"
        photoExts.any { lower.endsWith(it) } || lower.startsWith("photo_") -> "📷 Photo"
        videoExts.any { lower.endsWith(it) } -> "🎬 Video"
        audioExts.any { lower.endsWith(it) } -> "🎤 Voice message"
        docExts.any { lower.endsWith(it) } -> "📄 Document"
        else -> t
    }
}

@Composable
private fun ConvCard(conv: JSONObject, nav: NavController, revealed: Boolean = false, onCollapse: () -> Unit = {}) {
    val id = conv.optString("id")
    val isGroup = conv.optBoolean("isGroup")
    val other = conv.optJSONObject("other")
    val name =
        if (isGroup) conv.optText("title").ifBlank { "Group" }
        else other?.optText("displayName")?.takeIf { it.isNotBlank() } ?: "Chat"
    val avatarUrl = if (isGroup) null else other?.optString("avatarUrl")
    val avatarRef = if (isGroup) null else other?.optString("avatarRef")
    val preview = friendlyPreview(conv.optText("lastMessage"))
    val stamp = listStamp(conv.optString("lastMessageAt"))
    val unread = conv.optInt("unread", 0)
    val muted = conv.optBoolean("muted")
    val online = !isGroup && other?.optBoolean("online") == true

    Row(
        Modifier
            .fillMaxSize()
            .clickable {
                if (revealed) onCollapse() else nav.navigate("chat/$id")
            }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            KpAvatar(name, avatarUrl, 54.dp, avatarRef = avatarRef)
            if (online) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(13.dp)
                        .clip(CircleShape)
                        .background(Green),
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (muted) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        Icons.Filled.NotificationsOff,
                        contentDescription = "Muted",
                        tint = Muted,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(stamp, fontSize = 12.sp, color = if (unread > 0) GoldDeep else Muted)
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    preview.ifBlank { "No messages yet" },
                    fontSize = 13.5.sp,
                    color = Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .height(22.dp)
                            .widthIn(min = 22.dp)
                            .clip(CircleShape)
                            .background(Gold)
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (unread > 99) "99+" else "$unread",
                            color = AmberInk,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}
