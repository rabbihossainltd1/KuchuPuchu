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
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileRenameOutline
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
import androidx.compose.ui.input.pointer.pointerInput
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

    fun refresh() {
        scope.launch {
            try {
                val data = withContext(Dispatchers.IO) { Api.get("/api/conversations", true) }
                val items = data.arr("items").objects()
                items.forEach { c ->
                    val id = c.optString("id")
                    val last = c.optString("lastMessageAt")
                    val unread = c.optInt("unread", 0)
                    if (ScreenStore.shouldNotifyChat(id, last, unread)) {
                        val name =
                            if (c.optBoolean("isGroup")) c.optString("title").ifBlank { "Group" }
                            else c.optJSONObject("other")?.optText("displayName")?.ifBlank { "KuchuPuchu" } ?: "KuchuPuchu"
                        KpNotify.message(ctx, name, c.optString("lastMessage"), id)
                    }
                }
                ScreenStore.setConvs(items)
                loading = false
            } catch (_: Exception) {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) {
        refresh()
        while (true) {
            delay(2_500)
            if (Store.foreground) refresh()
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
                0 -> ChatListBody(convs, loading, nav, ::refresh)
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
                    .size(60.dp)
                    .shadow(8.dp, CircleShape),
            ) {
                Icon(
                    Icons.Filled.DriveFileRenameOutline,
                    contentDescription = "New chat",
                    modifier = Modifier.size(28.dp),
                )
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
    if (convs.isEmpty()) {
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
        items(convs, key = { it.optString("id") }) { conv ->
            SwipeConvRow(conv, nav, onChange)
        }
    }
}

/** One conversation card + swipe-to-reveal mute / delete actions. */
@Composable
private fun SwipeConvRow(conv: JSONObject, nav: NavController, onChange: () -> Unit) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val density = LocalDensity.current
    val actionWidth = with(density) { 136.dp.toPx() }
    var dragged by remember { mutableStateOf(0f) }
    val offset by animateFloatAsState(dragged, tween(160), label = "swipe")
    val revealed = offset > actionWidth / 2

    Box(Modifier.fillMaxWidth().height(76.dp)) {
        /* revealed actions behind the card */
        Row(
            Modifier
                .matchParentSize()
                .clip(RoundedCornerShape(16.dp))
                .background(Line),
        ) {
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
                    runCatching {
                        withContext(Dispatchers.IO) {
                            Api.delete("/api/conversations/${conv.optString("id")}")
                        }
                    }
                    dragged = 0f
                    onChange()
                }
            }
        }

        /* the card itself, slid left by the swipe */
        Box(
            Modifier
                .offset { IntOffset(-offset.roundToInt(), 0) }
                .fillMaxSize()
                .shadow(2.dp, RoundedCornerShape(16.dp))
                .clip(RoundedCornerShape(16.dp))
                .background(Card)
                .pointerInput(conv.optString("id")) {
                    detectHorizontalDragGestures(
                        onDragEnd = { dragged = if (dragged > actionWidth / 2) actionWidth else 0f },
                    ) { _, dragAmount ->
                        dragged = (dragged - dragAmount).coerceIn(0f, actionWidth)
                    }
                },
        ) {
            ConvCard(conv, nav, revealed) { if (revealed) dragged = 0f }
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

@Composable
private fun ConvCard(conv: JSONObject, nav: NavController, revealed: Boolean = false, onCollapse: () -> Unit = {}) {
    val id = conv.optString("id")
    val isGroup = conv.optBoolean("isGroup")
    val other = conv.optJSONObject("other")
    val name =
        if (isGroup) conv.optText("title").ifBlank { "Group" }
        else other?.optText("displayName")?.takeIf { it.isNotBlank() } ?: "Chat"
    val avatarUrl = if (isGroup) null else other?.optString("avatarUrl")
    val preview = conv.optText("lastMessage")
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
            KpAvatar(name, avatarUrl, 54.dp)
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
