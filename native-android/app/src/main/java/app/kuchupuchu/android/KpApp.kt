package app.kuchupuchu.android

import android.app.Application
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
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

    DisposableEffect(engine) {
        engine.onChange = { call = it }
        engine.start(ctx)
        onDispose { engine.onChange = null }
    }

    LaunchedEffect(Api.token) {
        if (Api.token.isNullOrBlank()) {
            session.loading = false
            route = "login"
            return@LaunchedEffect
        }
        session.loading = true
        val ok =
            withContext(Dispatchers.IO) {
                runCatching {
                    val me = Api.get("/api/me").optJSONObject("user")
                    val convos = Api.get("/api/conversations").arr("items").objects()
                    val notes = Api.get("/api/notifications")
                    val feed = runCatching { Api.get("/api/feed").arr("items").objects() }.getOrDefault(emptyList())
                    val stories = runCatching { Api.get("/api/stories").arr("items").objects() }.getOrDefault(emptyList())
                    val recs =
                        runCatching { Api.get("/api/discover/recommendations").arr("items").objects() }
                            .getOrDefault(emptyList())
                    withContext(Dispatchers.Main) {
                        session.me = me
                        replaceList(session.inbox, convos)
                        session.unread = convos.sumOf { it.optInt("unread") }
                        session.noteCount = notes.optInt("unread")
                        replaceList(session.feed, feed)
                        replaceList(session.stories, stories)
                        replaceList(session.recs, recs)
                    }
                    true
                }.getOrDefault(false)
            }
        session.loading = false
        route = if (ok) "tabs/home" else "login"
        if (!ok) Api.saveToken(ctx, null)
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
    }
}

fun logout(ctx: Context, session: Session, go: (String) -> Unit) {
    Api.saveToken(ctx, null)
    session.me = null
    go("login")
}
