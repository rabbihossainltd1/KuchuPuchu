package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.HideSource
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.RemoveRedEye
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Status list — WhatsApp-style: "My status" row with an add badge on top,
 * then Recent updates with segmented rings that gray out once viewed.
 */
@Composable
fun StatusScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val groups = ScreenStore.statuses
    var composeText by remember { mutableStateOf(false) }
    val haptics = rememberHaptics()

    fun refresh() {
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) { Api.get("/api/statuses") }
                ScreenStore.setStatuses(data.arr("items").objects())
            } catch (_: Exception) {
            }
        }
    }

    LaunchedEffect(Unit) {
        refresh()
    }

    val mine = groups.firstOrNull { it.optBoolean("mine") }
    val others = groups.filter { !it.optBoolean("mine") && it.optJSONObject("user")?.optString("id") !in ScreenStore.hiddenStatusUserIds }

    Box(Modifier.fillMaxSize().background(Cream)) {
        Column(Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(
                    start = 8.dp, end = 8.dp, bottom = 24.dp,
                ),
            ) {
                /* ---- my status row ---- */
                item(key = "my_status") {
                    val myStatuses = mine?.arr("statuses")?.objects() ?: emptyList()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable {
                                haptics.tap()
                                if (myStatuses.isNotEmpty()) nav.navigate("statusview/mine") else nav.navigate("statusphoto")
                            }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box {
                            if (myStatuses.isNotEmpty()) {
                                StatusRingAvatar(
                                    Store.myName(),
                                    Store.me?.optIso("avatarUrl"),
                                    60.dp,
                                    segments = myStatuses.size,
                                    seen = false,
                                    avatarRef = Store.me?.optIso("avatarRef"),
                                )
                            } else {
                                KpAvatar(
                                    Store.myName(),
                                    Store.me?.optIso("avatarUrl"),
                                    60.dp,
                                    ring = false,
                                    avatarRef = Store.me?.optIso("avatarRef"),
                                )
                            }
                            // The little "+" opens the same thing as the row:
                            // your latest status if one exists, else composer.
                            Box(
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .size(22.dp)
                                    .clip(CircleShape)
                                    .background(Color.White)
                                    .clickable {
                                        haptics.tap()
                                        if (myStatuses.isNotEmpty()) nav.navigate("statusview/mine") else nav.navigate("statusphoto")
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    Modifier
                                        .size(20.dp)
                                        .clip(CircleShape)
                                        .background(Gold),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        Icons.Filled.Add,
                                        contentDescription = "Add status",
                                        tint = AmberInk,
                                        modifier = Modifier.size(14.dp),
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text(
                                "My status",
                                fontSize = 16.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Ink,
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                when {
                                    myStatuses.isEmpty() -> "Tap to add a status update"
                                    else -> {
                                        val views = myStatuses.sumOf { it.optInt("viewers", 0) }
                                        val last = myStatuses.maxOfOrNull { it.optString("createdAt") } ?: ""
                                        "My updates · ${statusStampShort(last)}" +
                                            (if (views > 0) " · $views view${if (views == 1) "" else "s"}" else "")
                                    }
                                },
                                fontSize = 13.sp,
                                color = Muted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }

                /* ---- recent updates ---- */
                if (others.isNotEmpty()) {
                    item(key = "recent_header") {
                        Text(
                            "Recent updates",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Muted,
                            modifier = Modifier.padding(start = 20.dp, top = 10.dp, bottom = 4.dp),
                        )
                    }
                    items(others, key = { it.optJSONObject("user")?.optString("id") ?: it.toString() }) { g ->
                        val user = g.optJSONObject("user") ?: return@items
                        val allViewed = g.optBoolean("allViewed")
                        val statuses = g.arr("statuses").objects()
                        val lastAt = statuses.maxOfOrNull { it.optString("createdAt") } ?: ""
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clickable {
                                    haptics.tap()
                                    nav.navigate("statusview/${user.optString("id")}")
                                }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            StatusRingAvatar(
                                user.optText("displayName"),
                                user.optText("avatarUrl"),
                                60.dp,
                                segments = statuses.size,
                                seen = allViewed,
                                // The token, not just the snapshot: without it this row
                                // could only ever paint the data-URI that happened to be
                                // in the `/api/statuses` response it was rendered from —
                                // so a contact who changed their photo stayed on the old
                                // one until that endpoint was next fetched, while the
                                // chat list beside it was already current.
                                avatarRef = user.optIso("avatarRef"),
                            )
                            Spacer(Modifier.width(14.dp))
                            Column {
                                Text(
                                    user.optString("displayName"),
                                    fontSize = 16.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Ink,
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    "${statuses.size} update${if (statuses.size > 1) "s" else ""} · ${statusStampShort(lastAt)}",
                                    fontSize = 13.sp,
                                    color = Muted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }

                if (!ScreenStore.statusesLoaded) {
                    item(key = "loading") {
                        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Gold, modifier = Modifier.size(28.dp))
                        }
                    }
                }
            }
        }

        /* WhatsApp-style stacked FABs: pencil = text status, camera = photo */
        Column(
            Modifier
                .align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(end = 20.dp, bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            androidx.compose.material3.SmallFloatingActionButton(
                onClick = { haptics.tap(); composeText = true },
                shape = CircleShape,
                containerColor = Card,
                contentColor = GoldDeep,
                modifier = Modifier.padding(bottom = 14.dp).size(40.dp),
            ) {
                Icon(Icons.Filled.Edit, contentDescription = "Text status", modifier = Modifier.size(19.dp))
            }
            androidx.compose.material3.FloatingActionButton(
                onClick = { haptics.tap(); nav.navigate("statusphoto") },
                shape = CircleShape,
                containerColor = Gold,
                contentColor = AmberInk,
                modifier = Modifier.size(52.dp),
            ) {
                Icon(Icons.Filled.PhotoCamera, contentDescription = "Photo or video status", modifier = Modifier.size(24.dp))
            }
        }
    }

    if (composeText) {
        Dialog(
            onDismissRequest = { composeText = false },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            StatusComposer {
                composeText = false
                refresh()
            }
        }
    }
}

/**
 * Text status composer — big text over a gradient card, pick a background.
 */
@Composable
fun StatusComposer(onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var style by remember { mutableStateOf("amber") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    val gradients = mapOf(
        "amber" to listOf(Color(0xFFFDE68A), Color(0xFFF59E0B)),
        "sunset" to listOf(Color(0xFFFDA4AF), Color(0xE11D48)),
        "mint" to listOf(Color(0xFFA7F3D0), Color(0xFF059669)),
        "ocean" to listOf(Color(0xFFBAE6FD), Color(0xFF0284C7)),
        "berry" to listOf(Color(0xFFDDD6FE), Color(0xFF7C3AED)),
        "ink" to listOf(Color(0xFF44403C), Color(0xFF1C1917)),
    )
    val colors = gradients[style]!!

    Box(Modifier.fillMaxSize().background(Cream)) {
        Column(Modifier.fillMaxSize().statusBarsPadding().imePadding()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDone) {
                    Icon(Icons.Filled.Close, "Close", tint = Ink)
                }
                Text("Text status", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
            }
            // Flexible height: takes the space left over after the input and
            // buttons, so "Post status" never slides off-screen on short
            // devices (the fixed 380dp used to push it out of view).
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .weight(1f)
                    .heightIn(min = 180.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Brush.linearGradient(colors))
                    .clickable { },
                contentAlignment = Alignment.Center,
            ) {
                if (text.isEmpty()) {
                    Text(
                        "Tap kore likha shuru korun…",
                        color = Color.White.copy(alpha = 0.75f),
                        fontSize = 17.sp,
                        textAlign = TextAlign.Center,
                    )
                } else {
                    Text(
                        text,
                        color = Color.White,
                        fontSize = 26.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(28.dp),
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                gradients.forEach { (name, cols) ->
                    Box(
                        Modifier
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(cols))
                            .clickable { style = name },
                    )
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card)
                    .padding(14.dp),
            ) {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it.take(500) },
                    textStyle = androidx.compose.ui.text.TextStyle(color = Ink, fontSize = 15.sp),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        if (text.isEmpty()) Text("Apnar status…", color = Muted, fontSize = 15.sp)
                        inner()
                    },
                )
            }
            if (error.isNotBlank()) {
                Text(error, color = Red, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 18.dp))
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                GoldBtn(
                    "Post status",
                    enabled = text.isNotBlank() && !busy,
                ) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) {
                                Api.post(
                                    "/api/statuses",
                                    JSONObject().put("kind", "TEXT").put("text", text.trim()).put("bgStyle", style),
                                )
                            }
                            onDone()
                        } catch (e: Exception) {
                            error = e.message ?: "Could not post."
                        } finally {
                            busy = false
                        }
                    }
                }
            }
        }
    }
}

/**
 * Status viewer — WhatsApp-style: full-screen, segmented progress, tap
 * sides to move (left = back, right = next), auto-advance, reply bar
 * (others) / viewers + delete (mine). Paints instantly from the cached
 * list and refreshes silently in the background.
 */
@Composable
fun StatusViewerScreen(nav: NavController, whose: String) {
    val scope = rememberCoroutineScope()
    val groups = remember { mutableStateListOf<JSONObject>() }
    var idx by remember { mutableStateOf(0) }
    var progress by remember { mutableStateOf(0f) }
    var reply by remember { mutableStateOf("") }
    var replyFocused by remember { mutableStateOf(false) }
    var replyError by remember { mutableStateOf("") }
    var showViewers by remember { mutableStateOf(false) }
    var viewers by remember { mutableStateOf(listOf<JSONObject>()) }
    var viewersError by remember { mutableStateOf(false) }
    var viewersLoading by remember { mutableStateOf(false) }
    var fetched by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var videoReady by remember { mutableStateOf(false) }
    var videoProgress by remember { mutableStateOf(0f) }
    // Viewed-by lists are cached per status: reopening the sheet must not
    // re-fetch ("viewers list bar bar load hocche").
    val viewersCache = remember { HashMap<String, List<JSONObject>>() }
    // New status => new clip: the readiness flag must reset or the next
    // video's bar would start before its own buffering finished.
    LaunchedEffect(idx) {
        videoReady = false
        videoProgress = 0f
    }
    val ctx = LocalContext.current
    val focusManager = LocalFocusManager.current

    // Dark screen → status bar icons must be white while viewing, and back to
    // dark-on-light when this screen goes away.
    val window = MainActivity.current?.window
    DisposableEffect(Unit) {
        val controller = window?.let { androidx.core.view.WindowCompat.getInsetsController(it, it.decorView) }
        val prev = controller?.isAppearanceLightStatusBars
        controller?.isAppearanceLightStatusBars = false
        onDispose { controller?.isAppearanceLightStatusBars = prev ?: true }
    }

    /* Instant paint from cache. A re-open no longer "loads again": the
       network only fires when the cache is older than 15s, and the current
       status stays anchored (idx follows the id, not the list position). */
    LaunchedEffect(Unit) {
        groups.clear()
        groups.addAll(ScreenStore.statuses)
        fetched = true
        // Remember which status is on screen now (derived from `groups`, which
        // is declared above — `statuses` isn't in scope yet).
        val groupNow =
            if (whose == "mine") groups.firstOrNull { it.optBoolean("mine") }
            else groups.firstOrNull { it.optJSONObject("user")?.optString("id") == whose }
        val currentId = groupNow?.arr("statuses")?.objects()?.getOrNull(idx)?.optString("id")
        val stale = System.currentTimeMillis() - ScreenStore.statusesFetchedAt > 15_000
        if (!stale) return@LaunchedEffect
        try {
            val data = withContext(Dispatchers.IO) { Api.get("/api/statuses", true) }
            val fresh = data.arr("items").objects()
            groups.clear()
            groups.addAll(fresh)
            ScreenStore.setStatuses(fresh)
            // Keep the user on the SAME status after the refresh.
            if (currentId != null) {
                val target = groups
                    .firstOrNull { g -> g.arr("statuses").objects().any { it.optString("id") == currentId } }
                    ?.arr("statuses")?.objects()
                    ?.indexOfFirst { it.optString("id") == currentId }
                if (target != null && target >= 0) idx = target
            }
        } catch (_: Exception) {
        }
    }

    val group =
        if (whose == "mine") groups.firstOrNull { it.optBoolean("mine") }
        else groups.firstOrNull { it.optJSONObject("user")?.optString("id") == whose }
    val statuses = group?.arr("statuses")?.objects() ?: emptyList()
    val user = group?.optJSONObject("user")
    val isMine = group?.optBoolean("mine") == true

    /* auto-advance + mark viewed. One run PER STATUS (keyed on idx), so
       opening/closing the viewers sheet or the keyboard no longer restarts
       the clock and re-fires the /view ping — the clock just PAUSES while
       they are up. For videos the clock only starts when the clip is
       actually PLAYING (buffering used to eat the bar). */
    LaunchedEffect(idx, videoReady) {
        if (statuses.isEmpty() || idx >= statuses.size) return@LaunchedEffect
        val s = statuses[idx]
        if (!isMine) {
            runCatching { withContext(Dispatchers.IO) { Api.post("/api/statuses/${s.optString("id")}/view") } }
        }
        progress = 0f
        val videoSecs = s.optInt("seconds", 0)
        val hold =
            when {
                s.optString("kind") != "VIDEO" -> 5_000L
                videoSecs > 0 -> (videoSecs * 1000L).coerceIn(5_000L, 120_000L)
                else -> 30_000L
            }
        if (s.optString("kind") == "VIDEO" && !videoReady) return@LaunchedEffect
        if (s.optString("kind") == "VIDEO") {
            // VIDEO: the bar mirrors the player's real position (onProgress
            // below) and we advance the moment the clip actually ends — no
            // more 1-2s skew between bar and clip.
            var waited = 0L
            val maxWait = hold + 8_000L
            while (videoProgress < 0.99f && waited < maxWait) {
                if (showViewers || replyFocused) {
                    delay(100)
                    continue
                }
                delay(50)
                waited += 50
            }
        } else {
            var elapsed = 0L
            while (elapsed < hold) {
                if (showViewers || replyFocused) {
                    delay(100)
                    continue
                }
                delay(50)
                elapsed += 50
                progress = elapsed.toFloat() / hold
            }
        }
        if (idx + 1 < statuses.size) {
            idx++
        } else {
            nav.popBackStack() // last status finished — close like WhatsApp
        }
    }

    fun deleteStatus() {
        val s = statuses.getOrNull(idx) ?: return
        val removedId = s.optString("id")
        // Leave the viewer IMMEDIATELY (the old code waited for the API, so a
        // second delete click could double-fire) and prune local state so the
        // next recomposition can't index into a shrunken list — that was the
        // white-screen crash on double-delete. Network delete runs behind.
        groups.clear()
        groups.addAll(statuses.filter { it.optString("id") != removedId })
        ScreenStore.pokeInbox()
        nav.popBackStack()
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { Api.delete("/api/statuses/$removedId") } }
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/statuses", true) }
                ScreenStore.setStatuses(data.arr("items").objects())
            }
        }
    }

    fun sendReply() {
        if (reply.isBlank() || user == null || isMine) return
        val target = user.optString("id")
        val text = reply.trim()
        val snippet = statuses.getOrNull(idx)?.optString("text")?.take(40).orEmpty()
        // Optimistic: the box clears the moment you hit send — the network
        // fires behind and only a failure speaks up.
        reply = ""
        replyError = ""
        replyFocused = false
        // The keyboard MUST fold after send — focus release alone left it up.
        focusManager.clearFocus()
        runCatching { KpSounds.send(ctx) }
        scope.launch {
            try {
                val conv = withContext(Dispatchers.IO) {
                    Api.post("/api/conversations", JSONObject().put("userId", target))
                }
                val cid = conv.optJSONObject("conversation")?.optString("id").orEmpty()
                if (cid.isBlank()) throw Exception("Couldn't open the chat.")
                val body = if (snippet.isBlank()) "↩️ $text" else "↩️ $snippet\n$text"
                withContext(Dispatchers.IO) {
                    Api.post("/api/conversations/$cid/messages", JSONObject().put("body", body))
                }
                ScreenStore.pokeInbox()
            } catch (e: Exception) {
                android.widget.Toast.makeText(
                    ctx,
                    "Reply patha jayni — abar try koro",
                    android.widget.Toast.LENGTH_SHORT,
                ).show()
            }
        }
    }

    fun openViewers() {
        if (idx >= statuses.size) return
        val id = statuses[idx].optString("id")
        showViewers = true
        viewersError = false
        val cached = viewersCache[id]
        if (cached != null) {
            viewers = cached
            viewersLoading = false
            return
        }
        viewers = emptyList()
        viewersLoading = true
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/statuses/$id/viewers", true) }
                val list = data.arr("viewers").objects()
                viewersCache[id] = list
                viewers = list
            }.onFailure { viewersError = true }
                .also { viewersLoading = false }
        }
    }

    /** Open (or create) the 1:1 chat with this user, then go there.
     *  Cached id => navigates the SAME frame, no network wait. */
    fun openChatWith(userId: String) {
        if (userId.isBlank()) return
        val cached = ScreenStore.convIdForUser[userId]
        if (cached != null) {
            showViewers = false
            nav.navigate("chat/$cached")
            return
        }
        scope.launch {
            runCatching {
                val conv = withContext(Dispatchers.IO) { Api.post("/api/conversations", JSONObject().put("userId", userId)) }
                val cid = conv.optJSONObject("conversation")?.optString("id").orEmpty()
                if (cid.isNotBlank()) {
                    ScreenStore.convIdForUser[userId] = cid
                    showViewers = false
                    nav.navigate("chat/$cid")
                }
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Dark)) {
        if (statuses.isEmpty()) {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (!fetched) {
                    CircularProgressIndicator(color = Gold)
                } else {
                    Icon(
                        Icons.Filled.RemoveRedEye,
                        contentDescription = "No status",
                        tint = Color.White.copy(alpha = 0.8f),
                        modifier = Modifier.size(42.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text("No status", color = Color.White.copy(alpha = 0.8f), fontSize = 15.sp)
                }
            }
        } else {
            val s = statuses.getOrNull(minOf(idx, statuses.size - 1)) ?: run {
                // List shrank under us (deleted elsewhere): show the empty
                // state instead of crashing with IndexOutOfBounds (white screen).
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Gold)
                }
                return
            }

            /* background: photo or gradient text card */
            if (s.optString("kind") == "IMAGE" || s.optString("kind") == "VIDEO") {
                if (s.optString("kind") == "VIDEO") {
                    // The clip PAUSES exactly when the progress clock pauses
                    // (views sheet open / reply focused) — video and bar stay
                    // in lock-step instead of the video running on.
                    StatusVideoPlayer(
                        "${Api.BASE}/api/statuses/${s.optString("id")}/media",
                        paused = showViewers || replyFocused,
                        onReady = { videoReady = true },
                        onProgress = { p ->
                            videoProgress = p
                            progress = p
                        },
                    )
                } else {
                    KpNetImage(
                        "${Api.BASE}/api/statuses/${s.optString("id")}/media",
                        "Status photo",
                        Modifier.fillMaxSize(),
                        androidx.compose.ui.layout.ContentScale.Fit,
                    )
                }
                Box(Modifier.fillMaxSize().background(Color(0x66000000)))
            } else {
                val gradients = mapOf(
                    "amber" to listOf(Color(0xFFFDE68A), Color(0xFFF59E0B)),
                    "sunset" to listOf(Color(0xFFFDA4AF), Color(0xE11D48)),
                    "mint" to listOf(Color(0xFFA7F3D0), Color(0xFF059669)),
                    "ocean" to listOf(Color(0xFFBAE6FD), Color(0xFF0284C7)),
                    "berry" to listOf(Color(0xFFDDD6FE), Color(0xFF7C3AED)),
                )
                val cols = gradients[s.optString("bgStyle")] ?: gradients["amber"]!!
                Box(
                    Modifier.fillMaxSize().background(Brush.linearGradient(cols)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        s.optString("text"),
                        color = Color.White,
                        fontSize = 27.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(36.dp),
                    )
                }
            }

            /* progress segments + header.
             *
             * The name used to sit UNDER the clip: the player was a
             * SurfaceView-backed VideoView running with setZOrderOnTop(true),
             * which composites that surface above the WHOLE window - no Compose
             * zIndex could ever beat it (photo statuses looked fine because an
             * image is an ordinary view). The player is a TextureView now, so
             * the header simply draws on top. The cutout padding stays because a
             * tall display cutout is not always covered by statusBarsPadding. */
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .displayCutoutPadding()
                    .padding(top = 4.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    statuses.forEachIndexed { i, _ ->
                        Box(
                            Modifier
                                .weight(1f)
                                .height(3.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(Color.White.copy(alpha = 0.35f)),
                        ) {
                            Box(
                                Modifier
                                    .fillMaxWidth(progressTo(i, idx, progress))
                                    .height(3.dp)
                                    .background(Color.White),
                            )
                        }
                    }
                }
                val openTheirChat: () -> Unit = {
                    val uid = user?.optString("id").orEmpty()
                    if (!isMine && uid.isNotBlank()) {
                        val cached = ScreenStore.convIdForUser[uid]
                        if (cached != null) {
                            nav.navigate("chat/$cached")
                        } else {
                            scope.launch {
                                runCatching {
                                    val conv = withContext(Dispatchers.IO) {
                                        Api.post("/api/conversations", JSONObject().put("userId", uid))
                                    }
                                    val cid = conv.optJSONObject("conversation")?.optString("id").orEmpty()
                                    if (cid.isNotBlank()) {
                                        ScreenStore.convIdForUser[uid] = cid
                                        nav.navigate("chat/$cid")
                                    }
                                }
                            }
                        }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp).let { m ->
                        if (!isMine) m.clickable { openTheirChat() } else m
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    KpAvatar(
                        user?.optText("displayName") ?: Store.myName(),
                        user?.optText("avatarUrl") ?: Store.me?.optIso("avatarUrl"),
                        42.dp,
                        ring = false,
                        avatarRef = user?.optIso("avatarRef") ?: Store.me?.optIso("avatarRef"),
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            user?.optText("displayName") ?: "My status",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            statusStamp(s.optString("createdAt")),
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { nav.popBackStack() }) {
                        Icon(Icons.Filled.Close, "Close", tint = Color.White)
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, "Menu", tint = Color.White)
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            if (isMine) {
                                DropdownMenuItem(
                                    text = { Text("Delete status") },
                                    leadingIcon = { Icon(Icons.Filled.Delete, null, tint = Ink) },
                                    onClick = {
                                        menuOpen = false
                                        confirmDelete = true
                                    },
                                )
                            } else {
                                DropdownMenuItem(
                                    text = { Text("Message") },
                                    leadingIcon = { Icon(Icons.Filled.Chat, null, tint = Ink) },
                                    onClick = {
                                        menuOpen = false
                                        openChatWith(user?.optString("id") ?: "")
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Hide status") },
                                    leadingIcon = { Icon(Icons.Filled.HideSource, null, tint = Ink) },
                                    onClick = {
                                        menuOpen = false
                                        ScreenStore.hideStatusUser(user?.optString("id") ?: "")
                                        android.widget.Toast.makeText(ctx, "Status hidden", android.widget.Toast.LENGTH_SHORT).show()
                                        nav.popBackStack()
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Report") },
                                    leadingIcon = { Icon(Icons.Filled.Flag, null, tint = Ink) },
                                    onClick = {
                                        menuOpen = false
                                        android.widget.Toast.makeText(ctx, "Reported. Thank you.", android.widget.Toast.LENGTH_SHORT).show()
                                    },
                                )
                            }
                        }
                    }
                }
                /* tap zones: left = previous, right = next — they fill the
                   middle area only, so header + reply stay tappable.
                   Vertical swipes: DOWN closes the viewer, UP opens the
                   viewers list (own status) — like WhatsApp. */
                var vDrag by remember { mutableStateOf(0f) }
                Row(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .pointerInput("vswipe", isMine) {
                            detectVerticalDragGestures(
                                onDragEnd = {
                                    if (vDrag > 130f) nav.popBackStack()
                                    else if (vDrag < -130f && isMine) openViewers()
                                    vDrag = 0f
                                },
                            ) { _, amount ->
                                vDrag += amount
                            }
                        }
                        .pointerInput("tapzone") {
                            detectTapGestures { pos ->
                                progress = 0f
                                if (pos.x < size.width / 2f) {
                                    if (idx > 0) idx--
                                } else {
                                    if (idx + 1 < statuses.size) idx++ else nav.popBackStack()
                                }
                            }
                        },
                ) {
                    /* plain split — NO .clickable anywhere here: clickable
                       paints the theme ripple, which showed up as a
                       half-darkened flash on the tapped half. */
                    Box(Modifier.weight(1f).fillMaxSize())
                    Box(Modifier.weight(1f).fillMaxSize())
                }
                /* reply bar or my-status views hint */
                if (isMine) {
                    // No shadow/pill — just the eye; tap opens the sheet and
                    // swiping UP anywhere above it does the same.
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .padding(16.dp)
                            .clickable { openViewers() },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.RemoveRedEye,
                            contentDescription = "Views",
                            tint = Color.White,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            "${s.optInt("viewers", 0)} view${if (s.optInt("viewers", 0) == 1) "" else "s"}",
                            color = Color.White,
                            fontSize = 13.sp,
                        )
                    }
                } else {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .navigationBarsPadding()
                            .imePadding()
                            .padding(12.dp)
                            .clip(RoundedCornerShape(24.dp))
                            .background(Color(0x33FFFFFF))
                            .padding(horizontal = 16.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BasicTextField(
                            value = reply,
                            onValueChange = { reply = it; replyError = "" },
                            textStyle = androidx.compose.ui.text.TextStyle(
                                color = Color.White,
                                fontSize = 14.sp,
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .padding(vertical = 12.dp)
                                .onFocusChanged { replyFocused = it.isFocused },
                            decorationBox = { inner ->
                                if (reply.isEmpty()) {
                                    Text(
                                        "Reply to ${user?.optText("displayName") ?: ""}…",
                                        color = Color.White.copy(alpha = 0.7f),
                                        fontSize = 14.sp,
                                    )
                                }
                                inner()
                            },
                        )
                        IconButton(onClick = { sendReply() }) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                "Send reply",
                                tint = Gold,
                            )
                        }
                    }
                    if (replyError.isNotBlank()) {
                        Text(
                            replyError,
                            color = Color(0xFFFFCDD2),
                            fontSize = 12.sp,
                            modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 8.dp),
                        )
                    }
                }
            }

        }
    }

    if (showViewers) {
        ViewersSheet(
            loading = viewersLoading,
            error = viewersError,
            viewers = viewers,
            onClose = { showViewers = false },
            onOpenChat = { openChatWith(it) },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete status?") },
            text = { Text("This status will be removed for everyone. It cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    deleteStatus()
                }) { Text("Delete", color = Red) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = Muted) } },
        )
    }
}

/**
 * "Viewed by" bottom sheet — slides up from the bottom edge (not a centered
 * popup). Tapping a viewer opens the chat with them.
 */
@Composable
private fun ViewersSheet(
    loading: Boolean,
    error: Boolean,
    viewers: List<JSONObject>,
    onClose: () -> Unit,
    onOpenChat: (String) -> Unit,
) {
    var shown by remember { mutableStateOf(false) }
    val progress by androidx.compose.animation.core.animateFloatAsState(
        targetValue = if (shown) 0f else 1f,
        animationSpec = androidx.compose.animation.core.tween(220),
        label = "sheet",
    )
    LaunchedEffect(Unit) { shown = true }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color(0x52000000))
                .clickable(onClick = onClose),
        ) {
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .graphicsLayer { translationY = progress * 900f }
                    .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                    .background(Card)
                    .clickable(onClick = {})  // don't close when touching the sheet
                    .navigationBarsPadding()
                    .padding(vertical = 10.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Viewed by", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Ink)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, "Close", tint = Muted)
                    }
                }
                when {
                    error -> Text(
                        "Couldn't load viewers. Try again.",
                        color = Red,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                    )
                    loading -> Row(
                        Modifier.padding(18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(color = Gold, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("Loading…", color = Muted)
                    }
                    viewers.isEmpty() -> Text(
                        "No views yet.",
                        color = Muted,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                    )
                    else -> {
                        LazyColumn(Modifier.heightIn(max = 420.dp)) {
                            items(viewers, key = { it.optJSONObject("user")?.optString("id") ?: it.toString() }) { v ->
                                val u = v.optJSONObject("user")
                                val name = u?.optText("displayName") ?: "?"
                                val uid = u?.optString("id") ?: ""
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clickable { onOpenChat(uid) }
                                        .padding(horizontal = 18.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    KpAvatar(
                                        name,
                                        u?.optText("avatarUrl"),
                                        38.dp,
                                        ring = false,
                                        avatarRef = u?.optIso("avatarRef"),
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(name, fontSize = 14.5.sp, fontWeight = FontWeight.Medium, color = Ink)
                                        Text(listStamp(v.optString("viewedAt")), fontSize = 11.5.sp, color = Muted)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Status clip player — TextureView, NOT VideoView.
 *
 * VideoView is a SurfaceView, and this player used to run it with
 * setZOrderOnTop(true) so its surface would not fall behind the Compose layer.
 * That flag puts the surface above the ENTIRE window, so nothing the app draws
 * can cover it: the poster avatar + name row ended up UNDER the video
 * ("status a video ta user er name er upore chole geche") while photo statuses
 * were fine, because an image is an ordinary view. The z-order hack also
 * depended on Android re-ordering surfaces, which sometimes only happened after
 * an unrelated layout pass — hence a clip sitting there not playing until the
 * ⋮ menu forced one ("3 dot a click korle dekhi play hoi").
 *
 * A TextureView renders inside the view hierarchy: no z-order flags, no surface
 * race, nothing to re-trigger, and pause/resume can drive a plain MediaPlayer.
 */
@Composable
private fun StatusVideoPlayer(
    url: String,
    paused: Boolean = false,
    onReady: () -> Unit = {},
    onProgress: (Float) -> Unit = {},
) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var path by remember(url) { mutableStateOf<String?>(null) }
    // VideoView stretched the clip to its own bounds, so the view still MUST
    // match the clip's aspect ratio — otherwise portrait clips fill the screen
    // and come out distorted.
    var aspect by remember(url) { mutableStateOf(9f / 16f) }
    var player by remember(url) { mutableStateOf<StatusClipPlayer?>(null) }

    LaunchedEffect(url) {
        val p = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = Api.download(url)
                val f = java.io.File(ctx.cacheDir, "status_${url.hashCode()}.mp4")
                f.writeBytes(bytes)
                f.absolutePath
            }.getOrNull()
        }
        path = p
        if (p != null) {
            val r = android.media.MediaMetadataRetriever()
            runCatching {
                r.setDataSource(p)
                val w = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toFloatOrNull() ?: 0f
                val h = r.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toFloatOrNull() ?: 0f
                if (w > 0f && h > 0f) aspect = w / h
            }
            runCatching { r.release() }
        }
    }

    // The progress BAR follows the PLAYER's real position — the stored
    // `seconds` metadata used to drift 1-2s from the compressed clip.
    LaunchedEffect(player, paused) {
        while (true) {
            val p = player
            if (p != null && !paused) {
                p.snapshot()?.let { (cur, dur, playing) ->
                    if (dur > 0 && playing) {
                        onProgress((cur.toFloat() / dur).coerceIn(0f, 1f))
                    } else if (dur > 0 && cur > 0) {
                        // playback finished — close the bar
                        onProgress(1f)
                    }
                }
            }
            delay(50)
        }
    }
    // The clip PAUSES exactly when the progress clock pauses (views sheet open /
    // reply focused) — video and bar stay in lock-step instead of the video
    // running on.
    LaunchedEffect(player, paused) { player?.setPaused(paused) }

    val ready = path
    if (ready == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Gold)
        }
        return
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        androidx.compose.ui.viewinterop.AndroidView(
            factory = { c ->
                android.view.TextureView(c).apply {
                    isOpaque = false
                    player = StatusClipPlayer(this, ready, onReady, onProgress).also { it.attach() }
                }
            },
            onRelease = {
                runCatching { player?.release() }
                player = null
            },
            modifier = Modifier.fillMaxSize().aspectRatio(aspect),
        )
    }
}

/** MediaPlayer glued to a TextureView surface, re-attaching itself after the
 *  surface is destroyed (screen off, navigation away) instead of restarting. */
private class StatusClipPlayer(
    private val view: android.view.TextureView,
    private val path: String,
    private val onReady: () -> Unit,
    private val onProgress: (Float) -> Unit,
) : android.view.TextureView.SurfaceTextureListener {

    private var mp: android.media.MediaPlayer? = null
    private var prepared = false
    private var wantPaused = false
    private var resumeAt = 0

    fun attach() {
        view.surfaceTextureListener = this
        if (view.surfaceTexture != null) bind()
    }

    private fun bind() {
        val st = view.surfaceTexture ?: return
        val existing = mp
        if (existing != null) {
            runCatching { existing.setSurface(android.view.Surface(st)) }
            if (resumeAt > 0) runCatching { existing.seekTo(resumeAt) }
            if (!wantPaused) runCatching { existing.start() }
            return
        }
        mp =
            android.media.MediaPlayer().apply {
                runCatching {
                    setDataSource(path)
                    setScreenOnWhilePlaying(true)
                    setOnPreparedListener { p ->
                        prepared = true
                        // The progress bar waits for this instead of racing the
                        // buffering; 1ms in keeps "0:00" from showing a blank.
                        runCatching { if (resumeAt > 0) p.seekTo(resumeAt) else p.seekTo(1) }
                        onReady()
                        if (!wantPaused) runCatching { p.start() }
                    }
                    setOnCompletionListener { onProgress(1f) }
                    // A clip the decoder refuses must not freeze the viewer:
                    // treat it as finished so the segment advances (the old
                    // VideoView just sat there on a black frame).
                    setOnErrorListener { _, _, _ ->
                        onProgress(1f)
                        true
                    }
                    prepareAsync()
                }
            }
        runCatching { mp?.setSurface(android.view.Surface(st)) }
    }

    override fun onSurfaceTextureAvailable(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {
        bind()
    }

    override fun onSurfaceTextureSizeChanged(surface: android.graphics.SurfaceTexture, width: Int, height: Int) {}

    override fun onSurfaceTextureDestroyed(surface: android.graphics.SurfaceTexture): Boolean {
        // Stop the ghost audio-only playback and remember the position, so the
        // clip continues where it was instead of restarting from zero.
        resumeAt = runCatching { mp?.currentPosition ?: resumeAt }.getOrDefault(resumeAt)
        runCatching { mp?.pause() }
        runCatching { mp?.setSurface(null) }
        return true
    }

    override fun onSurfaceTextureUpdated(surface: android.graphics.SurfaceTexture) {}

    fun setPaused(p: Boolean) {
        wantPaused = p
        val m = mp ?: return
        if (!prepared) return
        runCatching { if (p) m.pause() else m.start() }
    }

    /** (positionMs, durationMs, isPlaying), or null until the clip is prepared. */
    fun snapshot(): Triple<Int, Int, Boolean>? {
        val m = mp ?: return null
        if (!prepared) return null
        return runCatching { Triple(m.currentPosition, m.duration, m.isPlaying) }.getOrNull()
    }

    fun release() {
        prepared = false
        runCatching { mp?.stop() }
        runCatching { mp?.release() }
        mp = null
        runCatching { view.surfaceTextureListener = null }
    }
}

private fun progressTo(i: Int, current: Int, p: Float): Float =
    when {
        i < current -> 1f
        i > current -> 0f
        else -> p
    }
