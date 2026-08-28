package app.kuchupuchu.android

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.RemoveRedEye
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.foundation.Image
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
    val others = groups.filter { !it.optBoolean("mine") }

    Box(Modifier.fillMaxSize().background(Cream)) {
        Column(Modifier.fillMaxSize()) {
            Text(
                "Status",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = Ink,
                modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 10.dp),
            )

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
                                    Store.me?.optString("avatarUrl"),
                                    60.dp,
                                    segments = myStatuses.size,
                                    seen = false,
                                )
                            } else {
                                KpAvatar(Store.myName(), Store.me?.optString("avatarUrl"), 60.dp, ring = false)
                            }
                            Box(
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .size(22.dp)
                                    .clip(CircleShape)
                                    .background(Color.White),
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
                                        "My updates · ${statusStamp(last)}" +
                                            (if (views > 0) " · $views view${if (views == 1) "" else "s"}" else "")
                                    }
                                },
                                fontSize = 13.sp,
                                color = Muted,
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
                                user.optString("displayName"),
                                user.optString("avatarUrl"),
                                60.dp,
                                segments = statuses.size,
                                seen = allViewed,
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
                                    "${statuses.size} update${if (statuses.size > 1) "s" else ""} · ${statusStamp(lastAt)}",
                                    fontSize = 13.sp,
                                    color = Muted,
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
                if (ScreenStore.statusesLoaded && others.isEmpty()) {
                    item(key = "empty") {
                        Box(Modifier.fillMaxWidth().padding(top = 20.dp), contentAlignment = Alignment.Center) {
                            Text(
                                "No friend statuses yet. Chats korle ekhane status dekha jabe.",
                                fontSize = 13.5.sp,
                                color = Muted,
                                textAlign = TextAlign.Center,
                            )
                        }
                    }
                }
            }
        }

        /* WhatsApp-style stacked FABs: pencil = text status, camera = photo */
        Column(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 20.dp, bottom = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            androidx.compose.material3.SmallFloatingActionButton(
                onClick = { haptics.tap(); composeText = true },
                shape = CircleShape,
                containerColor = Card,
                contentColor = GoldDeep,
                modifier = Modifier.padding(bottom = 14.dp).size(46.dp),
            ) {
                Icon(Icons.Filled.Edit, contentDescription = "Text status", modifier = Modifier.size(22.dp))
            }
            androidx.compose.material3.FloatingActionButton(
                onClick = { haptics.tap(); nav.navigate("statusphoto") },
                shape = CircleShape,
                containerColor = Gold,
                contentColor = AmberInk,
                modifier = Modifier.size(60.dp),
            ) {
                Icon(Icons.Filled.PhotoCamera, contentDescription = "Photo or video status", modifier = Modifier.size(28.dp))
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
        Column(Modifier.fillMaxSize().imePadding()) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onDone) {
                    Icon(Icons.Filled.Close, "Close", tint = Ink)
                }
                Text("Text status", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .height(380.dp)
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
            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.End) {
                GoldBtn(
                    if (busy) "…" else "Post status",
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
    var viewers by remember { mutableStateOf("") }
    var viewersError by remember { mutableStateOf(false) }
    var fetched by remember { mutableStateOf(false) }

    /* instant paint from cache, then silent refresh */
    LaunchedEffect(Unit) {
        groups.clear()
        groups.addAll(ScreenStore.statuses)
        try {
            val data = withContext(Dispatchers.IO) { Api.get("/api/statuses", true) }
            val fresh = data.arr("items").objects()
            groups.clear()
            groups.addAll(fresh)
            ScreenStore.setStatuses(fresh)
        } catch (_: Exception) {
        } finally {
            fetched = true
        }
    }

    val group =
        if (whose == "mine") groups.firstOrNull { it.optBoolean("mine") }
        else groups.firstOrNull { it.optJSONObject("user")?.optString("id") == whose }
    val statuses = group?.arr("statuses")?.objects() ?: emptyList()
    val user = group?.optJSONObject("user")
    val isMine = group?.optBoolean("mine") == true

    /* auto-advance + mark viewed — pauses while the viewers sheet is open */
    LaunchedEffect(statuses.size, idx, showViewers, replyFocused) {
        if (statuses.isEmpty() || idx >= statuses.size || showViewers || replyFocused) return@LaunchedEffect
        val s = statuses[idx]
        if (!isMine) {
            runCatching { withContext(Dispatchers.IO) { Api.post("/api/statuses/${s.optString("id")}/view") } }
        }
        progress = 0f
        val hold = if (s.optString("kind") == "VIDEO") 60_000L else 5_000L
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < hold) {
            progress = (System.currentTimeMillis() - start) / hold.toFloat()
            delay(50)
        }
        if (idx + 1 < statuses.size) {
            idx++
        } else {
            nav.popBackStack() // last status finished — close like WhatsApp
        }
    }

    fun deleteStatus() {
        if (idx >= statuses.size) return
        val s = statuses[idx]
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { Api.delete("/api/statuses/${s.optString("id")}") } }
            nav.popBackStack()
        }
    }

    fun sendReply() {
        if (reply.isBlank() || user == null || isMine) return
        val target = user.optString("id")
        val text = reply.trim()
        val snippet = statuses.getOrNull(idx)?.optString("text")?.take(40).orEmpty()
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
                reply = ""
                replyError = ""
                replyFocused = false
            } catch (e: Exception) {
                replyError = e.message ?: "Reply didn't send. Try again."
            }
        }
    }

    fun openViewers() {
        if (idx >= statuses.size) return
        val s = statuses[idx]
        showViewers = true
        viewers = ""
        viewersError = false
        scope.launch {
            runCatching {
                val data = withContext(Dispatchers.IO) { Api.get("/api/statuses/${s.optString("id")}/viewers", true) }
                viewers = data.arr("viewers").objects().joinToString("\n") { v ->
                    (v.optJSONObject("user")?.optString("displayName") ?: "?") + "|" +
                        listStamp(v.optString("viewedAt"))
                }
            }.onFailure { viewersError = true }
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
            val s = statuses[minOf(idx, statuses.size - 1)]

            /* background: photo or gradient text card */
            if (s.optString("kind") == "IMAGE" || s.optString("kind") == "VIDEO") {
                if (s.optString("kind") == "VIDEO") {
                    StatusVideoPlayer("${Api.BASE}/api/statuses/${s.optString("id")}/media")
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

            /* progress segments + header */
            Column(Modifier.fillMaxSize()) {
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
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    KpAvatar(
                        user?.optString("displayName") ?: Store.myName(),
                        user?.optString("avatarUrl") ?: Store.me?.optString("avatarUrl"),
                        42.dp,
                        ring = false,
                    )
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(
                            user?.optString("displayName") ?: "My status",
                            color = Color.White,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 15.sp,
                        )
                        Text(
                            statusStamp(s.optString("createdAt")),
                            color = Color.White.copy(alpha = 0.75f),
                            fontSize = 12.sp,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { nav.popBackStack() }) {
                        Icon(Icons.Filled.Close, "Close", tint = Color.White)
                    }
                    if (isMine) {
                        IconButton(onClick = { openViewers() }) {
                            Icon(Icons.Filled.RemoveRedEye, "Viewers", tint = Color.White)
                        }
                        IconButton(onClick = { deleteStatus() }) {
                            Icon(Icons.Filled.Delete, "Delete", tint = Color.White)
                        }
                    }
                }
                /* tap zones: left = previous, right = next — they fill the
                   middle area only, so header + reply stay tappable */
                Row(Modifier.weight(1f).fillMaxWidth()) {
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .clickable { if (idx > 0) { idx--; progress = 0f } },
                    )
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .clickable {
                                progress = 0f
                                if (idx + 1 < statuses.size) idx++ else nav.popBackStack()
                            },
                    )
                }
                /* reply bar or my-status views hint */
                if (isMine) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                            .clip(RoundedCornerShape(24.dp))
                            .background(Color(0x33FFFFFF))
                            .clickable { openViewers() }
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Filled.RemoveRedEye,
                            contentDescription = "Views",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            "${s.optInt("viewers", 0)} view${if (s.optInt("viewers", 0) == 1) "" else "s"} · tap for the list",
                            color = Color.White,
                            fontSize = 13.sp,
                        )
                    }
                } else {
                    Row(
                        Modifier
                            .fillMaxWidth()
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
                                        "Reply to ${user?.optString("displayName") ?: ""}…",
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
        AlertDialog(
            onDismissRequest = { showViewers = false },
            title = { Text("Viewed by") },
            text = {
                Column {
                    if (viewersError) {
                        Text("Couldn't load viewers. Try again.", color = Red, fontSize = 14.sp)
                    } else if (viewers.isBlank()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(color = Gold, modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text("Loading…", color = Muted)
                        }
                    } else if (viewers == "\n" || viewers.lines().all { it.isBlank() }) {
                        Text("No views yet.", color = Muted, fontSize = 14.sp)
                    } else {
                        viewers.lines().filter { it.isNotBlank() }.forEach { line ->
                            val parts = line.split("|")
                            val name = parts.getOrElse(0) { "?" }
                            val at = parts.getOrElse(1) { "" }
                            Row(
                                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                KpAvatar(name, null, 36.dp, ring = false)
                                Spacer(Modifier.width(10.dp))
                                Text(name, fontSize = 14.5.sp, fontWeight = FontWeight.Medium)
                                Spacer(Modifier.weight(1f))
                                Text(at, fontSize = 12.sp, color = Muted)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showViewers = false }) { Text("Close", color = GoldDeep) }
            },
        )
    }
}

@Composable
private fun StatusVideoPlayer(url: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var path by remember(url) { mutableStateOf<String?>(null) }
    LaunchedEffect(url) {
        path = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = Api.download(url)
                val f = java.io.File(ctx.cacheDir, "status_${url.hashCode()}.mp4")
                f.writeBytes(bytes)
                f.absolutePath
            }.getOrNull()
        }
    }
    if (path == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Gold)
        }
        return
    }
    androidx.compose.ui.viewinterop.AndroidView(
        factory = { c ->
            android.widget.VideoView(c).apply {
                setVideoPath(path)
                setOnPreparedListener { it.isLooping = false; start() }
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

private fun progressTo(i: Int, current: Int, p: Float): Float =
    when {
        i < current -> 1f
        i > current -> 0f
        else -> p
    }
