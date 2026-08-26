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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun InboxScreen(session: Session, onRoute: (String) -> Unit) {
    val items = remember { mutableStateListOf<JSONObject>() }
    LaunchedEffect(Unit) {
        while (isActive) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val data = Api.get("/api/conversations")
                    items.clear()
                    items.addAll(data.arr("items").objects())
                    session.unread = items.sumOf { it.optInt("unread") }
                }
            }
            delay(4000)
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Text("Messages", fontWeight = FontWeight.SemiBold, fontSize = 20.sp, modifier = Modifier.padding(16.dp))
        LazyColumn {
            itemsIndexed(items) { _, c ->
                val other = c.optJSONObject("other") ?: JSONObject()
                Row(
                    Modifier.fillMaxWidth().clickable { onRoute("chat/${c.optString("id")}") }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(other, 48.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(other.name(), fontWeight = FontWeight.SemiBold)
                            if (c.optBoolean("muted")) {
                                Spacer(Modifier.width(4.dp))
                                Icon(Icons.Outlined.VolumeOff, null, tint = Muted, modifier = Modifier.height(14.dp))
                            }
                        }
                        Text(c.optJSONObject("lastMessage")?.optString("body").orEmpty().ifBlank { "No messages yet" }, color = Muted, fontSize = 13.sp, maxLines = 1)
                    }
                    if (c.optInt("unread") > 0) {
                        Box(Modifier.background(Accent, RoundedCornerShape(10.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
                            Text("${c.optInt("unread")}", color = androidx.compose.ui.graphics.Color.White, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun AlertsScreen(session: Session, onRoute: (String) -> Unit) {
    val notes = remember { mutableStateListOf<JSONObject>() }
    val reqs = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                notes.clear()
                notes.addAll(Api.get("/api/notifications").arr("items").objects())
                reqs.clear()
                reqs.addAll(Api.get("/api/friend-requests").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        Text("Notifications", fontWeight = FontWeight.SemiBold, fontSize = 20.sp, modifier = Modifier.padding(4.dp))
        val preview = reqs.take(3)
        LazyColumn {
            itemsIndexed(preview) { _, r ->
                val from = r.optJSONObject("from") ?: r
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(from, 42.dp) { onRoute("player/${from.userId()}") }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(from.name(), fontWeight = FontWeight.Medium)
                        Text("sent you a friend request", color = Muted, fontSize = 13.sp)
                    }
                    Text(
                        "Accept",
                        color = Accent,
                        modifier =
                            Modifier.clickable {
                                scope.launch {
                                    withContext(Dispatchers.IO) {
                                        runCatching { Api.post("/api/friend-requests/${r.optString("id")}/accept") }
                                    }
                                    reqs.remove(r)
                                }
                            }.padding(8.dp),
                    )
                }
            }
            if (reqs.size > 3) {
                item {
                    Text("See all", color = Accent, modifier = Modifier.clickable { onRoute("requests") }.padding(8.dp))
                }
            }
            itemsIndexed(notes) { _, n ->
                Row(
                    Modifier.fillMaxWidth().clickable {
                        val link = n.optString("link")
                        val uid = n.optJSONObject("actor")?.userId()
                        if (link.startsWith("/players/")) onRoute("player/${link.removePrefix("/players/")}")
                        else if (!uid.isNullOrBlank()) onRoute("player/$uid")
                    }.padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(n.optJSONObject("actor"), 40.dp)
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(n.optString("title").ifBlank { n.optString("body") }, fontSize = 14.sp)
                        Text(n.optString("createdAt").take(16), color = Muted, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
fun ChatScreen(convoId: String, session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    val messages = remember { mutableStateListOf<JSONObject>() }
    var other by remember { mutableStateOf(JSONObject()) }
    var text by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var muted by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val meId = session.me?.optString("id")

    LaunchedEffect(convoId) {
        while (isActive) {
            withContext(Dispatchers.IO) {
                runCatching {
                    val inbox = Api.get("/api/conversations")
                    val found = inbox.arr("items").objects().find { it.optString("id") == convoId }
                    if (found != null) {
                        other = found.optJSONObject("other") ?: other
                        muted = found.optBoolean("muted")
                    }
                    val data = Api.get("/api/conversations/$convoId/messages")
                    val rows = data.arr("items").objects()
                    messages.clear()
                    messages.addAll(rows)
                }
            }
            delay(1200)
        }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) list.scrollToItem(messages.lastIndex)
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/inbox") }
            Avatar(other, 36.dp) { onRoute("player/${other.userId()}") }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f).clickable { onRoute("player/${other.userId()}") }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(other.name(), fontWeight = FontWeight.SemiBold)
                    if (muted) {
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Outlined.VolumeOff, null, tint = Muted, modifier = Modifier.height(14.dp))
                    }
                }
                Text(if (other.optBoolean("online")) "Active now" else "Offline", color = Muted, fontSize = 11.sp)
            }
            IconBtn(Icons.Outlined.Call) { engine.startCall(other.userId(), "AUDIO", other.name()) }
            IconBtn(Icons.Outlined.Videocam) { engine.startCall(other.userId(), "VIDEO", other.name()) }
            IconBtn(Icons.Outlined.MoreVert) { menu = !menu }
        }
        if (menu) {
            Column(Modifier.align(Alignment.End).padding(end = 12.dp).background(Surface, RoundedCornerShape(12.dp)).padding(8.dp)) {
                listOf("Block", "Delete", "Clear", if (muted) "Unmute" else "Mute").forEach { label ->
                    Text(
                        label,
                        modifier =
                            Modifier.clickable {
                                menu = false
                                scope.launch(Dispatchers.IO) {
                                    when (label) {
                                        "Block" -> Api.post("/api/users/${other.userId()}/block")
                                        "Delete" -> Api.delete("/api/conversations/$convoId")
                                        "Clear" -> Api.post("/api/conversations/$convoId/clear")
                                        else -> Api.post("/api/conversations/$convoId/mute", JSONObject().put("muted", !muted))
                                    }
                                }
                                if (label == "Delete") onRoute("tabs/inbox")
                            }.padding(10.dp),
                    )
                }
            }
        }
        LazyColumn(Modifier.weight(1f).padding(12.dp), state = list) {
            itemsIndexed(messages) { _, m ->
                val mine = m.optString("senderId") == meId
                val kind = m.optString("kind")
                Column(
                    Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
                ) {
                    Box(
                        Modifier.background(if (mine) ColorMine else Surface, RoundedCornerShape(16.dp)).padding(10.dp, 8.dp),
                    ) {
                        when (kind) {
                            "CALL" -> Text("Call · ${m.optString("body")}", color = if (mine) androidx.compose.ui.graphics.Color.White else Ink)
                            else -> Text(m.optString("body"), color = if (mine) androidx.compose.ui.graphics.Color.White else Ink)
                        }
                    }
                    val rec = m.optString("receipt")
                    if (mine && rec.isNotBlank()) {
                        Text(rec, fontSize = 10.sp, color = Muted, modifier = Modifier.padding(top = 2.dp, end = 4.dp))
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Message") },
                singleLine = true,
            )
            Text(
                "Send",
                color = Accent,
                fontWeight = FontWeight.SemiBold,
                modifier =
                    Modifier.clickable {
                        val body = text
                        if (body.isBlank()) return@clickable
                        text = ""
                        val temp =
                            JSONObject()
                                .put("id", "tmp-${System.currentTimeMillis()}")
                                .put("senderId", meId)
                                .put("body", body)
                                .put("kind", "TEXT")
                        messages.add(temp)
                        scope.launch(Dispatchers.IO) {
                            runCatching {
                                Api.post("/api/conversations/$convoId/messages", JSONObject().put("body", body))
                            }
                        }
                    }.padding(10.dp),
            )
        }
    }
}

private val ColorMine = androidx.compose.ui.graphics.Color(0xFF1C1917)
