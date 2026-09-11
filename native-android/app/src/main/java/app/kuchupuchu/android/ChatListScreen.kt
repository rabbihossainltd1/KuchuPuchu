package app.kuchupuchu.android

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectVerticalDragGestures
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.GroupAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Alignment
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
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
    var homeMenu by remember { mutableStateOf(false) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val haptics = rememberHaptics()
    // Owner round 17: the archive pull has TWO triggers — the list overscroll
    // (as before) AND a plain vertical drag on the header/tabs area, so a ROM
    // with odd overscroll dispatch can't kill the gesture.
    val archivePull = remember { ArchivePullState() }
    val density = LocalDensity.current
    archivePull.thresholdPx = with(density) { 90.dp.toPx() }
    archivePull.maxPx = archivePull.thresholdPx * 1.6f
    // Owner round 18: the chats list's own state feeds the "am I at the top?"
    // probe, so the pre-scroll interceptor only bites at the top edge.
    val chatsListState = rememberLazyListState()
    // layoutInfo (not firstVisibleItemOffset — that property is
    // experimental-api in this compose version and CI rejected it).
    archivePull.canPull = {
        val first = chatsListState.layoutInfo.visibleItemsInfo.firstOrNull()
        first == null || (first.index == 0 && first.offset == 0)
    }
    val archiveDrag = Modifier.pointerInput(Unit) {
        detectVerticalDragGestures(
            onVerticalDrag = { change, dy ->
                change.consume()
                archivePull.pull = (archivePull.pull + dy).coerceIn(0f, archivePull.maxPx)
            },
            onDragEnd = { archivePull.pull = 0f },
            onDragCancel = { archivePull.pull = 0f },
        )
    }

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
                Api.PollCadence.succeeded()
                loading = false
                if (refreshAgain.get()) delay(200)
                } while (refreshAgain.get())
            } catch (_: Exception) {
                Api.PollCadence.failed()
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
                "hello" -> refresh()
                "conv" -> {
                    refresh()
                    // Owner round 15: realtime list — don't wait for the full
                    // refetch; fetch and merge the ONE changed conversation
                    // so the preview, badge and order move the instant the
                    // poke lands.
                    val cid = ev.optString("conversationId")
                    if (cid.isNotBlank()) {
                        scope.launch {
                            runCatching {
                                val one =
                                    withContext(Dispatchers.IO) {
                                        Api.get("/api/conversations/$cid", true)
                                    }.optJSONObject("conversation") ?: return@launch
                                // The open chat marks itself read; never
                                // flash a badge for what's on screen.
                                if (Store.route == "chat/$cid") one.put("unread", 0)
                                ScreenStore.upsertConv(one)
                            }
                        }
                    }
                }
                // "call" pokes are CallEngine's business, not the list's.
            }
        }
        var lastForeground = Store.foreground
        var lastSafetyRefresh = 0L
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
                // PollCadence grows the gap while requests keep failing, and a
                // Retry-After from the API pauses the loop outright — see Api.kt.
                delay(
                    if (Api.inCooldown()) 30_000
                    else Api.PollCadence.tick(KpSocket.userLive()),
                )
                val fg = Store.foreground
                val justReturned = fg && !lastForeground
                lastForeground = fg
                // Owner round 17: half-open sockets (no close frame, "live"
                // forever) meant NO refresh AND NO fallback — the list froze
                // until a chat was reopened (the AI-reply visibility bug that
                // survived round 16). While foreground, a cheap marker-gated
                // refresh runs every 8s no matter what the socket says; the
                // events still do the instant updates.
                if (fg) {
                    val now = System.currentTimeMillis()
                    if (justReturned || !KpSocket.userLive()) {
                        refresh()
                        lastSafetyRefresh = now
                    } else if (now - lastSafetyRefresh >= 4_000) {
                        lastSafetyRefresh = now
                        refresh()
                    }
                }
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
            // Owner round 32 (item 12): while chats are ticked the bar shows
            // the count, a close (X) and a ⋮ that reopens the SAME sheet.
            val selecting = tab == 0 && ListSelect.active
            androidx.activity.compose.BackHandler(enabled = selecting) { ListSelect.clear() }
            // Leaving the screen ends select mode — nobody returns to a stale
            // set of ticks.
            androidx.compose.runtime.DisposableEffect(Unit) { onDispose { ListSelect.clear() } }
            if (selecting) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 6.dp, end = 6.dp, top = 10.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = { haptics.tap(); ListSelect.clear() }) {
                        Icon(Icons.Filled.Close, "Close", tint = Ink, modifier = Modifier.size(24.dp))
                    }
                    Text(
                        "${ListSelect.ids.size} selected",
                        fontSize = 19.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ink,
                        maxLines = 1,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        enabled = ListSelect.ids.isNotEmpty(),
                        onClick = {
                            haptics.tap()
                            val first = ListSelect.ids.firstOrNull() ?: return@IconButton
                            ListSelect.sheetFor = convs.firstOrNull { it.optString("id") == first } ?: JSONObject().put("id", first)
                        },
                    ) {
                        Icon(Icons.Filled.MoreVert, "Menu", tint = Ink, modifier = Modifier.size(26.dp))
                    }
                }
            } else {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 6.dp, top = 10.dp, bottom = 2.dp)
                    .then(archiveDrag),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("KuchuPuchu", fontSize = 23.sp, fontWeight = FontWeight.Bold, color = Ink)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { nav.navigate("search") }) {
                    Icon(Icons.Filled.Search, "Search", tint = Ink, modifier = Modifier.size(26.dp))
                }
                // Owner round 28: the settings cog is gone — a ⋮ menu carries
                // Settings, Profile, About Us, New group, New contact, All
                // contacts. Every entry is a real screen, nothing is a demo.
                Box {
                    IconButton(onClick = { haptics.tap(); homeMenu = true }) {
                        Icon(Icons.Filled.MoreVert, "Menu", tint = Ink, modifier = Modifier.size(26.dp))
                    }
                    androidx.compose.material3.DropdownMenu(
                        expanded = homeMenu,
                        onDismissRequest = { homeMenu = false },
                        // Theme surface, not the M3 default tint (the mismatch
                        // the owner flagged on the status menu).
                        containerColor = Card,
                        shape = RoundedCornerShape(16.dp),
                        tonalElevation = 0.dp,
                        shadowElevation = 6.dp,
                    ) {
                        // Owner round 31: this exact order.
                        HomeMenuItem(Icons.Filled.Person, "My Profile") { homeMenu = false; nav.navigate("profile/${Store.myId()}") }
                        HomeMenuItem(Icons.Filled.PersonAdd, "New contact") { homeMenu = false; nav.navigate("newcontact") }
                        HomeMenuItem(Icons.Filled.Contacts, "All contacts") { homeMenu = false; nav.navigate("contacts") }
                        HomeMenuItem(Icons.Filled.GroupAdd, "New group") { homeMenu = false; nav.navigate("newgroup") }
                        HomeMenuItem(Icons.Filled.Settings, "Settings") { homeMenu = false; nav.navigate("settings") }
                        // Owner round 32 (item 3): no About Us here — it lives
                        // under Settings › App.
                    }
                }
            }
            }
            // Owner round 32 (item 12): the long-press / ⋮ sheet.
            ListSelect.sheetFor?.let { target ->
                ChatRowSheet(
                    target = target,
                    nav = nav,
                    onChange = ::refresh,
                    onDismiss = { ListSelect.sheetFor = null },
                )
            }

            /* ---------- big top tabs ---------- */
            // Owner round 31 (item 26): hidden chats do not count — a badge
            // nobody can trace to a visible row is just confusing.
            val unreadTotal = convs.filter { !it.optBoolean("hidden") }.sumOf { it.optInt("unread", 0) }
            val unseenStatus = ScreenStore.statuses.any { !it.optBoolean("mine") && !it.optBoolean("allViewed") }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 4.dp)
                    .then(archiveDrag),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TopTab(Icons.Filled.Chat, "Chats", tab == 0, unreadTotal, modifier = Modifier.weight(1f)) { haptics.tap(); tab = 0 }
                TopTab(Icons.Filled.Circle, "Status", tab == 1, dot = unseenStatus, modifier = Modifier.weight(1f)) { haptics.tap(); ListSelect.clear(); tab = 1 }
                TopTab(Icons.Filled.Call, "Calls", tab == 2, modifier = Modifier.weight(1f)) { haptics.tap(); ListSelect.clear(); tab = 2 }
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
                0 -> ArchivePullArea(nav, archivePull) { ChatListBody(convs, loading, nav, ::refresh, chatsListState, archivePull) }
                1 -> StatusScreen(nav)
                2 -> CallsScreen(nav)
            }
        }

        /* ---------- gold FAB (chats tab only — no overlap with status FABs) ---------- */
        if (tab == 0) {
            FloatingActionButton(
                onClick = { haptics.tap(); nav.navigate("newchat") },
                shape = CircleShape,
                // Owner round 20: blue action accent in dark-blue mode.
                containerColor = ActionBlue,
                contentColor = ActionBlueInk,
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
 * Owner round 32 (item 12): chat-list multi-select. `ids` = ticked rows;
 * `sheetFor` = the chat whose long-press sheet is open (null = closed);
 * `active` = the list is in select mode (rounded checks on every row).
 * Screen-wide (not per row) so the top bar can swap to the selection bar.
 */
internal object ListSelect {
    val ids = mutableStateListOf<String>()
    var active by mutableStateOf(false)
    var sheetFor by mutableStateOf<JSONObject?>(null)

    fun clear() {
        ids.clear()
        active = false
        sheetFor = null
    }

    fun toggle(id: String) {
        if (id in ids) ids.remove(id) else ids.add(id)
    }
}

/** Owner round 17: shared pull state — the HEADER/TABS drag and the list
 *  overscroll both feed it, so the archive pull works even when the ROM's
 *  overscroll dispatch behaves oddly (the list-only path silently died on
 *  the owner's device). */
private class ArchivePullState {
    var pull by mutableStateOf(0f)
    var hold by mutableStateOf(0f)
    var logo by mutableStateOf(false)
    var thresholdPx = 0f
    var maxPx = 0f

    /** True when the chats list sits at its very top — only then does a
     *  downward drag mean "pull for archive" (Owner round 18: pulls on top of
     *  ROWS never reached us because Android 12+'s stretch effect eats the
     *  leftover BEFORE a parent's onPostScroll sees it). */
    var canPull: () -> Boolean = { true }
}

/**
 * Pull-down gesture on the chats list: pulling past ~90dp at the top and
 * holding for 2s opens the archived chats.
 */
@Composable
private fun ArchivePullArea(nav: NavController, state: ArchivePullState, content: @Composable () -> Unit) {
    val haptics = rememberHaptics()
    val density = LocalDensity.current
    val threshold = with(density) { 90.dp.toPx() }
    state.thresholdPx = threshold
    state.maxPx = threshold * 1.6f
    val pull = state.pull
    val holdProgress = state.hold
    val logoShown = state.logo
    // Owner round 13 (2026-09-05): the archive now opens by PULL + HOLD —
    // pull the list down past the mark and keep holding: a progress bar
    // fills over three seconds, then the ARCHIVED logo pops in (animated)
    // and the screen opens. Works from the blank area AND on top of rows.
    // Owner round 19: the nested-scroll feed is GONE — the ROM's overscroll
    // and the list both got their hands on the delta before us on some
    // devices, so pulls over ROWS never arrived ("user er upor diye swipe
    // korle ashe na"). The feed is now a PASS-THROUGH pointer observer on
    // the list itself (see ChatListBody): it watches drags without consuming
    // them, so scrolling, row swipes and the stretch effect all still work,
    // while any downward drag at the list's top feeds the archive pull.
    // Owner round 13b: keying the effect on `pull` restarted the coroutine
    // on EVERY overscroll pixel — coroutine churn read as main-screen jank.
    // The effect runs once; snapshotFlow fires only when the held/not-held
    // crossing actually changes.
    LaunchedEffect(Unit) {
        snapshotFlow { state.pull >= state.thresholdPx }.collect { held ->
            if (held) {
                // Owner round 15: hold time 3s -> 2s.
                val start = System.currentTimeMillis()
                while (state.pull >= state.thresholdPx && System.currentTimeMillis() - start < 2000) {
                    state.hold = (System.currentTimeMillis() - start) / 2000f
                    delay(50)
                }
                if (state.pull >= state.thresholdPx) {
                    state.hold = 1f
                    state.logo = true
                    // Owner round 32 (item 40): the archive opening is felt.
                    haptics.confirm()
                    delay(450)
                    nav.navigate("archive")
                    state.logo = false
                }
            }
            state.hold = 0f
            state.pull = 0f
        }
    }
    Box(Modifier.fillMaxSize()) {
        content()
        if (pull > threshold * 0.3f || logoShown) {
            // Owner round 14/15: animation ONLY — the archive icon with a
            // circular progress ring that fills over the 2s hold, then the
            // icon turns into a green TICK and the archive opens. No pill,
            // no border, no text.
            if (logoShown) {
                // Owner round 16: no text, no green — the SAME archive icon,
                // in the app's gold, with its full ring; springs once, then
                // the archive opens.
                val pop = remember { androidx.compose.animation.core.Animatable(0.35f) }
                LaunchedEffect(Unit) {
                    pop.animateTo(
                        1f,
                        spring(dampingRatio = androidx.compose.animation.core.Spring.DampingRatioMediumBouncy),
                    )
                }
                Box(
                    Modifier.align(Alignment.TopCenter).padding(top = 14.dp).scale(pop.value),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        progress = { 1f },
                        color = ActionBlue,
                        strokeWidth = 3.dp,
                        trackColor = ActionBlueDeep.copy(alpha = 0.15f),
                        modifier = Modifier.size(46.dp),
                    )
                    Icon(Icons.Filled.Archive, null, tint = ActionBlueDeep, modifier = Modifier.size(22.dp))
                }
            } else {
                Box(
                    Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 14.dp)
                        .size(46.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        progress = { holdProgress },
                        color = ActionBlue,
                        strokeWidth = 3.dp,
                        trackColor = ActionBlueDeep.copy(alpha = 0.15f),
                        modifier = Modifier.fillMaxSize(),
                    )
                    Icon(Icons.Filled.Archive, null, tint = ActionBlueDeep, modifier = Modifier.size(22.dp))
                }
            }
        }
    }
}

/** Archived chats — swipe a chat right in the main list to put it here. */
@Composable
fun ArchiveScreen(nav: NavController) {
    val convs = ScreenStore.convs
    var rev by remember { mutableStateOf(0) }
    // A hidden chat vanishes from here too (round 31 item 26) — it lives only
    // behind the three-finger double-tap.
    val archived = remember(rev, convs.size) { convs.filter { ScreenStore.isArchived(it.optString("id")) && !it.optBoolean("hidden") } }
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
            // PollCadence grows the gap while requests keep failing, and a
            // Retry-After from the API pauses the loop outright — see Api.kt.
            delay(
                if (Api.inCooldown()) 30_000
                else Api.PollCadence.tick(KpSocket.userLive()),
            )
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
            val archiveList = rememberLazyListState()
            CloseSwipeOnScroll(archiveList)
            LazyColumn(
                Modifier.fillMaxSize().then(swipeFocusList()),
                state = archiveList,
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

/**
 * Owner round 32 (item 11): at most ONE swipe row is open at a time. `id` is
 * the row whose actions are showing; every SwipeConvRow watches it and slides
 * shut the moment it is no longer the one. It moves to null when the list
 * scrolls, when a finger lands on blank list space, and when another row is
 * touched (that row then opens on its own swipe, or not at all).
 */
private object SwipeOpen {
    var id by mutableStateOf<String?>(null)

    /** Which row the current down landed on — set by the row (child, Main
     *  pass runs first), read and cleared by the list right after. */
    var downOn: String? = null
}

/** On a row: any touch on ANOTHER row closes the open one. Pass-through. */
private fun swipeFocusTouch(id: String): Modifier =
    Modifier.pointerInput(id) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            SwipeOpen.downOn = id
            if (SwipeOpen.id != null && SwipeOpen.id != id) SwipeOpen.id = null
        }
    }

/**
 * On the list: a touch that reached no row (blank space) closes the open
 * row. A touch that landed on a row (that row's observer ran first — Main
 * pass, child before parent — and set `downOn`) leaves it alone. Owner
 * round 33 (item 6): the three-tap hidden-chats opener that lived here is
 * gone — a hidden chat comes back through its secret key typed in Search.
 */
private fun swipeFocusList(): Modifier =
    Modifier.pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            val onRow = SwipeOpen.downOn != null
            SwipeOpen.downOn = null
            if (!onRow) SwipeOpen.id = null
        }
    }

/** Scrolling closes the open row as well. */
@Composable
private fun CloseSwipeOnScroll(listState: LazyListState) {
    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { if (it) SwipeOpen.id = null }
    }
}

/**
 * Owner round 33 (item 6): EVERY hide asks for a secret key — any text,
 * emoji, dots, no format — and typing that exact key in Search is the way
 * back to the chat. One field, one button; the field takes focus as the
 * sheet opens so the keyboard is already up. `onHide` gets the trimmed key;
 * the caller hashes it (ScreenStore.hiddenKeyHash) — the key itself is
 * never stored or sent.
 */
@Composable
internal fun HideKeySheet(onDismiss: () -> Unit, onHide: (String) -> Unit) {
    var key by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        delay(200)
        runCatching { focus.requestFocus() }
    }
    KpSheet(onDismiss = onDismiss, title = "Hide chat") {
        Column(Modifier.padding(horizontal = 14.dp).imePadding()) {
            KpInputField(
                key,
                { key = it.take(64) },
                placeholder = "Secret key",
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (key.isNotBlank()) onHide(key.trim()) }),
                focusRequester = focus,
            )
            Spacer(Modifier.height(12.dp))
            GoldBtn("Hide", Modifier.fillMaxWidth(), enabled = key.isNotBlank()) { onHide(key.trim()) }
            Spacer(Modifier.height(4.dp))
        }
    }
}

/** Owner round 19: delivery ticks for a list row — one tick sent, two read.
 *  Owner round 32 (item 28): the middle state exists here too — two grey
 *  ticks once the recipient's device has the message, blue once read — the
 *  same three steps as the bubble, so the list row a sender is looking at
 *  moves the moment the recipient comes back online. */
@Composable
private fun ListTicks(read: Boolean, delivered: Boolean = read) {
    val tint = if (read) ActionBlueDeep else Muted
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Filled.Done,
            null,
            tint = tint,
            modifier = Modifier.size(14.dp),
        )
        if (read || delivered) {
            Icon(
                Icons.Filled.Done,
                null,
                tint = tint,
                modifier = Modifier.size(14.dp).offset(x = (-4).dp),
            )
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
    // Owner round 21: the tabs ride the blue action accent in dark-blue mode.
    val tint = if (selected) ActionBlueDeep else Muted
    val bg =
        if (selected) Modifier.background(ActionBlue.copy(alpha = 0.16f), RoundedCornerShape(14.dp))
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
                    .background(ActionBlue)
                    .padding(horizontal = 4.dp, vertical = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (badge > 99) "99+" else "$badge",
                    color = ActionBlueInk,
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
    listState: LazyListState,
    archivePull: ArchivePullState,
) {
    // Archived chats live in their own list (pull down on this list to open).
    // Owner round 31 (item 26): hidden chats leave the list as well — owner
    // round 33 (item 6): their secret key typed in Search brings them back.
    // Owner round 32 (item 12): pinned chats first (their own recency order),
    // then everything else exactly as the server ordered it.
    val pinned = ScreenStore.pinnedConvIds
    val visible =
        convs
            .filter { !ScreenStore.isArchived(it.optString("id")) && !it.optBoolean("hidden") }
            .sortedByDescending { if (it.optString("id") in pinned) 1 else 0 }
    if (visible.isEmpty()) {
        Box(Modifier.fillMaxSize().then(swipeFocusList()), contentAlignment = Alignment.Center) {
            if (loading) {
                CircularProgressIndicator(color = ActionBlue)
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
    CloseSwipeOnScroll(listState)
    // Owner round 33 (item 2): a chat that just moved to the top is shown,
    // not hidden above the fold (see KpKeepTop).
    KpKeepTop(listState, visible.firstOrNull()?.optString("id"))
    LazyColumn(
        Modifier
            .fillMaxSize()
            .then(swipeFocusList())
            // Owner round 19: THE archive feed — a non-consuming vertical
            // drag observer. It sees drags that start ON TOP OF ROWS (the
            // nested-scroll chain never reliably delivered those on the
            // owner's ROM), never eats a pointer event, so the list scrolls
            // and rows swipe exactly as before. Only a downward drag while
            // the list sits at its very top feeds the pull-hold.
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var pull = 0f
                    var armed = false
                    while (true) {
                        val event = awaitPointerEvent()
                        var dy = 0f
                        event.changes.forEach { dy += it.positionChange().y }
                        if (dy != 0f && archivePull.canPull()) {
                            armed = true
                            pull = (pull + dy).coerceIn(0f, archivePull.maxPx)
                            archivePull.pull = pull
                        } else if (dy != 0f && armed) {
                            pull = (pull + dy).coerceIn(0f, archivePull.maxPx)
                            archivePull.pull = pull
                        }
                        if (event.changes.all { !it.pressed }) break
                    }
                    // Finger lifted: the hold loop's own condition resets it.
                    if (armed) archivePull.pull = 0f
                }
            },
        state = listState,
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
    // Owner round 31 (item 26): flip the server flag optimistically; the row
    // leaves (or re-enters) the main list at once, the worker stops (or
    // resumes) pushing for it, and the list poll confirms.
    var dragged by remember { mutableStateOf(0f) }
    // Owner round 33 (item 6): the Hide slot opens the key sheet; the hide
    // itself carries the key's hash (server + every device of the account).
    var askKey by remember { mutableStateOf(false) }
    fun hide(key: String) {
        haptics.confirm()
        val id = conv.optString("id")
        val hash = ScreenStore.hiddenKeyHash(key)
        ScreenStore.setHidden(id, true, hash)
        android.widget.Toast.makeText(ctx, "Chat hidden", android.widget.Toast.LENGTH_SHORT).show()
        dragged = 0f
        onChange()
        scope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    Api.post("/api/conversations/$id/hide", JSONObject().put("hidden", true).put("key", hash))
                }
            }.onFailure { ScreenStore.setHidden(id, false) }
        }
    }
    val offset by animateFloatAsState(dragged, tween(160), label = "swipe")
    val revealedLeft = offset > actionWidth / 2   // card slid left → actions on the right
    val revealedRight = offset < -actionWidth / 2 // card slid right → archive on the left
    // Owner round 32 (item 11): only the focused row stays open.
    val convId = conv.optString("id")
    LaunchedEffect(SwipeOpen.id) {
        if (SwipeOpen.id != convId && dragged != 0f) dragged = 0f
    }
    if (askKey) {
        HideKeySheet(onDismiss = { askKey = false }) { key ->
            askKey = false
            hide(key)
        }
    }

    Box(Modifier.fillMaxWidth().height(76.dp).then(swipeFocusTouch(convId))) {
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
                        bg = ActionBlue.copy(alpha = 0.18f),
                        tint = ActionBlueDeep,
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
                        bg = SwipeDeleteBg,
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
                        bg = SwipeArchiveBg,
                        tint = SwipeArchiveInk,
                        label = "Archive",
                    ) {
                        haptics.confirm()
                        ScreenStore.archiveConv(conv.optString("id"))
                        android.widget.Toast.makeText(ctx, "Chat archived", android.widget.Toast.LENGTH_SHORT).show()
                        dragged = 0f
                        onChange()
                    }
                    // Owner round 31 (item 26): Hide sits beside Archive.
                    // Owner round 33 (item 6): it asks for the secret key first.
                    ActionSlot(
                        icon = Icons.Filled.VisibilityOff,
                        bg = ActionBlue.copy(alpha = 0.18f),
                        tint = ActionBlueDeep,
                        label = "Hide",
                    ) {
                        haptics.tap()
                        dragged = 0f
                        if (SwipeOpen.id == convId) SwipeOpen.id = null
                        askKey = true
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
                        bg = SwipeArchiveBg,
                        tint = SwipeArchiveInk,
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
                        bg = ActionBlue.copy(alpha = 0.18f),
                        tint = ActionBlueDeep,
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
                        bg = SwipeDeleteBg,
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
                            // Claim (or give up) the single open slot.
                            if (dragged != 0f) SwipeOpen.id = convId
                            else if (SwipeOpen.id == convId) SwipeOpen.id = null
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
            ConvCard(conv, nav, revealedLeft || revealedRight) {
                dragged = 0f
                if (SwipeOpen.id == convId) SwipeOpen.id = null
            }
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
    if (t == "Photo" || t == "📷 Photo") return "Photo"
    // Owner round 32 (item 17): the worker's view-once preview passes through.
    if (t == "Photo · View once" || t == "Video · View once") return t
    if (EmojiRepo.isCustomId(t)) return "Sticker"
    return when {
        lower.startsWith("voice_") || lower.startsWith("voice ") -> "Voice message"
        lower == "video" -> "🎬 Video"
        photoExts.any { lower.endsWith(it) } || lower.startsWith("photo_") -> "Photo"
        videoExts.any { lower.endsWith(it) } -> "🎬 Video"
        audioExts.any { lower.endsWith(it) } -> "Voice message"
        docExts.any { lower.endsWith(it) } -> "📄 Document"
        else -> t
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
private fun ConvCard(conv: JSONObject, nav: NavController, revealed: Boolean = false, onCollapse: () -> Unit = {}) {
    val id = conv.optString("id")
    val haptics = rememberHaptics()
    // Owner round 32 (item 12): long-press = tick this row + open the sheet;
    // in select mode a tap toggles the tick instead of opening the chat.
    val selecting = ListSelect.active
    val ticked = id in ListSelect.ids
    val pinned = ScreenStore.isPinned(id)
    val isGroup = conv.optBoolean("isGroup")
    val other = conv.optJSONObject("other")
    val name =
        if (isGroup) conv.optText("title").ifBlank { "Group" }
        else other?.optText("displayName")?.takeIf { it.isNotBlank() } ?: "Chat"
    // optIso, not optString: the list rows are LIGHT, so avatarUrl is JSON null
    // there, and "null" as a string defeats the avatarRef lookup (see KpAvatar).
    // Owner round 31: a group row shows the group picture (own cache token).
    val avatarUrl = if (isGroup) conv.optIso("avatarUrl") else other?.optIso("avatarUrl")
    val avatarRef = if (isGroup) conv.optIso("avatarRef") else other?.optIso("avatarRef")
    val preview = friendlyPreview(conv.optText("lastMessage"))
    val stamp = listStamp(conv.optString("lastMessageAt"))
    val unread = conv.optInt("unread", 0)
    val muted = conv.optBoolean("muted")
    val online = !isGroup && other?.optBoolean("online") == true

    Row(
        Modifier
            .fillMaxSize()
            .background(if (ticked) ActionBlue.copy(alpha = 0.10f) else Color.Transparent)
            .combinedClickable(
                onClick = {
                    // Owner round 32 (item 40): a selection tick is felt.
                    if (selecting && !revealed) haptics.tap()
                    when {
                        revealed -> onCollapse()
                        selecting -> ListSelect.toggle(id)
                        else -> nav.navigate("chat/$id")
                    }
                },
                onLongClick = {
                    if (revealed) {
                        onCollapse()
                        return@combinedClickable
                    }
                    haptics.heavy()
                    ListSelect.active = true
                    if (id !in ListSelect.ids) ListSelect.ids.add(id)
                    ListSelect.sheetFor = conv
                },
            )
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (selecting) {
            // Rounded check — filled when ticked, hollow ring otherwise.
            Box(
                Modifier
                    .size(22.dp)
                    .clip(CircleShape)
                    .background(if (ticked) ActionBlue else Color.Transparent)
                    .border(1.5.dp, if (ticked) ActionBlue else Muted, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (ticked) Icon(Icons.Filled.Check, null, tint = ActionBlueInk, modifier = Modifier.size(14.dp))
            }
            Spacer(Modifier.width(12.dp))
        }
        Box {
            // Owner round 26: a contact with a live status wears the status
            // ring right in the chat list ("user status share korleo chat
            // list a profile border ashe na"). Dark blue while unseen, gray
            // once everything of theirs has been viewed.
            val statusGroup =
                if (!isGroup) {
                    ScreenStore.statuses.firstOrNull {
                        !it.optBoolean("mine") && it.optJSONObject("user")?.optString("id") == other?.optString("id")
                    }
                } else {
                    null
                }
            if (statusGroup != null) {
                StatusRingAvatar(
                    name,
                    avatarUrl,
                    48.dp,
                    segments = statusGroup.arr("statuses").objects().size,
                    seen = statusGroup.optBoolean("allViewed"),
                    avatarRef = avatarRef,
                )
            } else {
                KpAvatar(name, avatarUrl, 44.dp, avatarRef = avatarRef) // Owner round 25: choto
            }
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
                // This inner Row takes ALL the remaining width, so the time
                // (outside it) is pinned to the far right edge — while inside
                // it the name hugs the left and the verified tick hugs the
                // name (WhatsApp-style). fill=false on the Text is what keeps
                // the tick next to the name instead of at the block's end.
                Row(
                    Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        name,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (!isGroup) UserBadges(other)
                }
                if (pinned) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Filled.PushPin, contentDescription = "Pinned", tint = Muted, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(2.dp))
                }
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
                // Owner round 19: own last message gets its delivery tick in
                // the list rows too (one tick = sent, two = read) — the
                // archived list showed nothing at all.
                // Owner round 32 (item 28): the list payload itself now says
                // who sent the newest message and when it was delivered
                // (lastMessageSenderId / lastMessageDeliveredAt), so the tick
                // no longer depends on a cached page of that chat — a chat
                // never opened on this device shows its tick too, and the
                // recipient's reconnect moves it (sent → delivered → read)
                // through the ordinary list refresh.
                val lastMsg = ScreenStore.lastMsg(id)
                val newestSender = conv.optString("lastMessageSenderId").ifBlank { lastMsg?.optString("senderId").orEmpty() }
                val newestAt = conv.optString("lastMessageAt").ifBlank { lastMsg?.optString("createdAt").orEmpty() }
                val newestDeleted = lastMsg != null && lastMsg.optString("createdAt") == newestAt && lastMsg.optString("kind") == "DELETED"
                if (newestSender.isNotBlank() && newestSender == Store.myId() && !newestDeleted && newestAt.isNotBlank()) {
                    val otherRead = conv.optJSONArray("members")?.objects()?.firstOrNull {
                        it.optJSONObject("user")?.optString("id") != Store.myId()
                    }?.optString("lastReadAt") ?: ""
                    val delivered =
                        conv.optString("lastMessageDeliveredAt").isNotBlank() ||
                            (lastMsg != null && lastMsg.optString("createdAt") == newestAt && lastMsg.optString("deliveredAt").isNotBlank())
                    ListTicks(read = otherRead.isNotBlank() && otherRead >= newestAt, delivered = delivered)
                    Spacer(Modifier.width(4.dp))
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
                            .background(ActionBlue)
                            .padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (unread > 99) "99+" else "$unread",
                            color = ActionBlueInk,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Owner round 32 (item 12): the chat-row sheet — Delete / Mute-Unmute /
 * Pin-Unpin / Create group with (username) / Select. Delete, mute and pin act
 * on EVERY ticked chat (the long-pressed one included); "Create group with"
 * names the long-pressed / first-ticked peer and pre-fills the group picker
 * with all ticked 1:1 peers; "Select" keeps the list in select mode.
 */
@Composable
private fun ChatRowSheet(
    target: JSONObject,
    nav: NavController,
    onChange: () -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val haptics = rememberHaptics()
    val ids = ListSelect.ids.toList().ifEmpty { listOf(target.optString("id")) }
    val rows = ids.mapNotNull { id -> ScreenStore.convs.firstOrNull { it.optString("id") == id } }
    val allMuted = rows.isNotEmpty() && rows.all { it.optBoolean("muted") }
    val allPinned = ids.all { ScreenStore.isPinned(it) }
    val other = target.optJSONObject("other")
    val otherId = other?.optString("id").orEmpty()
    val handle = other?.optText("username").orEmpty().ifBlank { other?.optText("displayName").orEmpty() }
    val canGroup = !target.optBoolean("isGroup") && otherId.isNotBlank() && !isKpBot(otherId)
    var confirmDelete by remember { mutableStateOf(false) }
    if (confirmDelete) {
        KpConfirmSheet(
            title = if (ids.size > 1) "Delete ${ids.size} chats?" else "Delete chat?",
            confirmLabel = "Delete",
            danger = true,
            onDismiss = { confirmDelete = false },
            onConfirm = {
                confirmDelete = false
                haptics.heavy()
                ids.forEach { ScreenStore.dropConv(it) }
                android.widget.Toast.makeText(ctx, if (ids.size > 1) "Chats deleted" else "Chat deleted", android.widget.Toast.LENGTH_SHORT).show()
                ListSelect.clear()
                onChange()
                scope.launch {
                    for (id in ids) {
                        runCatching { withContext(Dispatchers.IO) { Api.delete("/api/conversations/$id") } }
                    }
                }
            },
        )
        return
    }
    KpSheet(onDismiss = onDismiss) {
        KpSheetRow(Icons.Filled.Delete, "Delete", tint = Red) { confirmDelete = true }
        KpSheetRow(
            if (allMuted) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
            if (allMuted) "Unmute" else "Mute",
        ) {
            haptics.confirm()
            val next = !allMuted
            ids.forEach { ScreenStore.setMuted(it, next) }
            ListSelect.clear()
            scope.launch {
                for (id in ids) {
                    runCatching {
                        withContext(Dispatchers.IO) { Api.post("/api/conversations/$id/mute", JSONObject().put("muted", next)) }
                    }.onFailure { ScreenStore.setMuted(id, !next) }
                }
            }
        }
        KpSheetRow(Icons.Filled.PushPin, if (allPinned) "Unpin" else "Pin") {
            haptics.confirm()
            ids.forEach { ScreenStore.setPinned(it, !allPinned) }
            ListSelect.clear()
        }
        if (canGroup) {
            KpSheetRow(Icons.Filled.GroupAdd, "Create group with $handle") {
                haptics.tap()
                // Every ticked 1:1 peer rides along as a pre-picked member.
                val peers =
                    rows.filter { !it.optBoolean("isGroup") }
                        .mapNotNull { it.optJSONObject("other")?.optString("id") }
                        .filter { it.isNotBlank() && !isKpBot(it) }
                        .ifEmpty { listOf(otherId) }
                        .distinct()
                ListSelect.clear()
                nav.navigate("newgroup?with=${peers.joinToString(",")}")
            }
        }
        KpSheetRow(Icons.Filled.CheckCircle, "Select") {
            haptics.tap()
            ListSelect.active = true
            if (target.optString("id") !in ListSelect.ids) ListSelect.ids.add(target.optString("id"))
            onDismiss()
        }
    }
}

/** Owner round 28: one row of the home ⋮ menu — theme ink + blue icon. */
@Composable
private fun HomeMenuItem(icon: ImageVector, label: String, onClick: () -> Unit) {
    androidx.compose.material3.DropdownMenuItem(
        text = { Text(label, color = Ink, fontSize = 15.sp) },
        leadingIcon = { Icon(icon, null, tint = ActionBlueDeep, modifier = Modifier.size(22.dp)) },
        onClick = onClick,
    )
}
