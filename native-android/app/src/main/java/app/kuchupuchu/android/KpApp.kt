package app.kuchupuchu.android

import android.app.Application
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import org.json.JSONObject

class Session {
    var me by mutableStateOf<JSONObject?>(null)
    var loading by mutableStateOf(true)
    var unread by mutableStateOf(0)
    var noteCount by mutableStateOf(0)
    var feedEpoch by mutableStateOf(0)
    val feed = mutableStateListOf<JSONObject>()
    val stories = mutableStateListOf<JSONObject>()
    val recs = mutableStateListOf<JSONObject>()
    val inbox = mutableStateListOf<JSONObject>()
    val notes = mutableStateListOf<JSONObject>()
    val requests = mutableStateListOf<JSONObject>()
    val friends = mutableStateListOf<JSONObject>()
    private val chats = HashMap<String, SnapshotStateList<JSONObject>>()

    fun chatOf(id: String): SnapshotStateList<JSONObject> =
        synchronized(chats) { chats.getOrPut(id) { mutableStateListOf() } }

    fun clearLists() {
        feed.clear()
        stories.clear()
        recs.clear()
        inbox.clear()
        notes.clear()
        requests.clear()
        friends.clear()
        synchronized(chats) { chats.clear() }
        unread = 0
        noteCount = 0
        feedEpoch = 0
    }
}

@Composable
fun KpApp() {
    val ctx = LocalContext.current
    val session = remember { Session() }
    val engine = remember { CallEngine(ctx.applicationContext as Application) }
    var call by remember { mutableStateOf<CallUi?>(null) }
    var route by remember { mutableStateOf(if (Api.token.isNullOrBlank()) "login" else "boot") }
    val backStack = remember { mutableStateListOf<String>() }

    fun go(next: String) {
        if (next == route) return
        if (next == "login") {
            backStack.clear()
            route = "login"
            return
        }
        if (next.startsWith("tabs/")) {
            backStack.clear()
            route = next
            return
        }
        backStack.add(route)
        if (backStack.size > 24) backStack.removeAt(0)
        route = next
    }

    fun pop(): Boolean {
        if (backStack.isNotEmpty()) {
            route = backStack.removeAt(backStack.lastIndex)
            return true
        }
        if (route != "tabs/home" && route != "login" && route != "boot") {
            route = "tabs/home"
            return true
        }
        return false
    }

    // The sync service reads this to know when the user is looking at a chat
    // or the inbox, so it does not post redundant notifications.
    LaunchedEffect(route) { KpState.route = route }

    DisposableEffect(engine) {
        engine.onChange = { call = it }
        engine.start(ctx)
        onDispose { engine.onChange = null }
    }

    LaunchedEffect(Unit) {
        while (isActive) {
            val chat = MainActivity.pendingChat
            if (!chat.isNullOrBlank()) {
                MainActivity.pendingChat = null
                go("chat/$chat")
            }
            if (MainActivity.pendingAccept) {
                MainActivity.pendingAccept = false
                engine.pendingAccept = true
                engine.answer()
            }
            delay(250)
        }
    }

    LaunchedEffect(Api.token) {
        if (Api.token.isNullOrBlank()) {
            session.loading = false
            route = "login"
            return@LaunchedEffect
        }
        val cachedMe = Disk.get("me")?.optJSONObject("user")
        if (cachedMe != null) {
            session.me = cachedMe
            Disk.get("inbox")?.arr("items")?.objects()?.let {
                replaceList(session.inbox, it)
                session.unread = it.sumOf { row -> row.optInt("unread") }
            }
            Disk.get("feed")?.arr("items")?.objects()?.let { replaceList(session.feed, it) }
            Disk.get("stories")?.arr("items")?.objects()?.let { replaceList(session.stories, it) }
            Disk.get("recs")?.arr("items")?.objects()?.let { replaceList(session.recs, it) }
            Disk.get("notes")?.let { data ->
                replaceList(session.notes, data.arr("items").objects())
                session.noteCount = data.optInt("unread")
            }
            session.loading = false
            if (route == "boot" || route == "login") route = "tabs/home"
        } else {
            session.loading = true
        }
        val ok =
            withContext(Dispatchers.IO) {
                runCatching {
                    val meJson = Api.get("/api/me")
                    val me = meJson.optJSONObject("user")
                    val convosJson = Api.get("/api/conversations")
                    val convos = convosJson.arr("items").objects()
                    val notes = runCatching { Api.get("/api/notifications") }.getOrNull()
                    val feed = runCatching { Api.get("/api/feed") }.getOrNull()
                    val stories = runCatching { Api.get("/api/stories") }.getOrNull()
                    val recs = runCatching { Api.get("/api/discover/recommendations") }.getOrNull()
                    Disk.put("me", meJson)
                    Disk.put("inbox", convosJson)
                    notes?.let { Disk.put("notes", it) }
                    feed?.let { Disk.put("feed", it) }
                    stories?.let { Disk.put("stories", it) }
                    recs?.let { Disk.put("recs", it) }
                    withContext(Dispatchers.Main) {
                        session.me = me
                        replaceList(session.inbox, convos)
                        session.unread = convos.sumOf { it.optInt("unread") }
                        if (notes != null) {
                            replaceList(session.notes, notes.arr("items").objects())
                            session.noteCount = notes.optInt("unread")
                        }
                        feed?.arr("items")?.objects()?.let { replaceList(session.feed, it) }
                        stories?.arr("items")?.objects()?.let { replaceList(session.stories, it) }
                        recs?.arr("items")?.objects()?.let { replaceList(session.recs, it) }
                    }
                    true
                }.getOrDefault(false)
            }
        session.loading = false
        if (session.me != null) {
            if (route == "boot" || route == "login") route = "tabs/home"
            MainActivity.pendingChat?.let { id ->
                MainActivity.pendingChat = null
                go("chat/$id")
            }
        } else {
            route = "login"
            if (!ok) Api.saveToken(ctx, null)
        }
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
        when {
            session.loading && route == "boot" ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Accent)
                }
            route == "login" ->
                LoginScreen(
                    onAuthed = { user ->
                        session.me = user
                        KpSyncService.start(ctx)
                        route = "tabs/home"
                    },
                )
            else ->
                AppShell(
                    session = session,
                    route = route,
                    onRoute = { go(it) },
                    onBack = { pop() },
                    engine = engine,
                )
        }
        call?.let {
            Box(Modifier.fillMaxSize()) {
                CallOverlay(it, engine)
            }
        }
        if (engine.toast.isNotBlank()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
                Box(
                    Modifier.padding(bottom = 24.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(12.dp))
                        .background(androidx.compose.ui.graphics.Color(0xFF1C1917))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                ) {
                    Text(engine.toast, color = androidx.compose.ui.graphics.Color(0xFFF5F5F4), fontSize = 13.sp)
                }
            }
        }
    }
}

fun logout(ctx: Context, session: Session, go: (String) -> Unit) {
    Api.saveToken(ctx, null)
    Cache.bust()
    Disk.clear()
    KpSyncService.stop(ctx)
    MsgNotify.clearAll(ctx)
    session.me = null
    session.clearLists()
    go("login")
}
