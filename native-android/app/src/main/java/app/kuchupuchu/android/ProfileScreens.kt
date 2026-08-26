package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Videocam
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ProfileScreen(session: Session, onRoute: (String) -> Unit, mine: Boolean = true) {
    val user = session.me ?: JSONObject()
    val friends = remember { mutableStateListOf<JSONObject>() }
    LaunchedEffect(user.optString("id")) {
        withContext(Dispatchers.IO) {
            runCatching {
                friends.clear()
                friends.addAll(Api.get("/api/friends").arr("items").objects())
            }
        }
    }
    LazyColumn(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        item { ProfileHero(user, friends.size, user.optInt("reputation"), user.walletBal()) }
        item { AboutCard(user) }
        if (friends.isNotEmpty()) {
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(14.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Friends", fontWeight = FontWeight.SemiBold)
                        Text("See all", color = Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { onRoute("friends") })
                    }
                    Spacer(Modifier.height(10.dp))
                    friends.take(6).chunked(3).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                            row.forEach { u ->
                                Column(Modifier.clickable { onRoute("player/${u.userId()}") }.padding(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Avatar(u, 56.dp, online = u.optBoolean("online"))
                                    Text(u.name(), fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
        mine
    }
}

@Composable
fun ProfileHero(user: JSONObject, friends: Int, reputation: Int, coins: Int) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp))) {
        Box(Modifier.fillMaxWidth().height(120.dp).background(Brush.linearGradient(listOf(Color(0xFFFDE68A), Color(0xFFFDBA74), Color(0xFFF59E0B)))))
        Row(Modifier.offset(y = (-28).dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.Bottom) {
            Box(Modifier.clip(CircleShape).border(3.dp, Color.White, CircleShape)) {
                Avatar(user, 72.dp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.padding(bottom = 4.dp)) {
                Text(user.name(), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text("@${user.uid()}", color = Muted, fontSize = 13.sp)
            }
        }
        Column(Modifier.padding(16.dp).offset(y = (-18).dp)) {
            if (user.optString("bio").isNotBlank()) Text(user.optString("bio"))
            Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("$friends friends", color = Muted, fontSize = 13.sp)
                Text("$reputation reputation", color = Muted, fontSize = 13.sp)
                Text("$coins coins", color = Muted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun AboutCard(user: JSONObject) {
    val p = user.profile()
    val rows =
        listOf(
            "Free Fire UID" to p.optString("ffUid"),
            "IGN" to p.optString("ffIgn"),
            "Email" to user.optString("email"),
            "Facebook" to p.optString("facebookId"),
            "WhatsApp" to p.optString("whatsapp"),
            "Instagram" to p.optString("instagram"),
            "Rank" to p.optString("rank"),
            "Server" to p.optString("serverRegion"),
            "Area" to listOf(user.optString("district"), user.optString("country")).filter { it.isNotBlank() }.joinToString(" · "),
            "Relationship" to p.optString("relationshipStatus"),
        ).filter { it.second.isNotBlank() }
    if (rows.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp).clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(16.dp)) {
        Text("About", fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(10.dp))
        rows.forEach { (k, v) ->
            Row(Modifier.padding(vertical = 5.dp)) {
                Text(k, color = Muted, fontSize = 13.sp, modifier = Modifier.width(130.dp))
                Text(v, fontSize = 14.sp)
            }
        }
    }
}

@Composable
fun EditProfileScreen(session: Session, done: () -> Unit) {
    val user = session.me ?: JSONObject()
    val p0 = user.profile()
    var displayName by remember { mutableStateOf(user.optString("displayName")) }
    var username by remember { mutableStateOf(user.optString("username")) }
    var bio by remember { mutableStateOf(user.optString("bio")) }
    var ffUid by remember { mutableStateOf(p0.optString("ffUid")) }
    var ffIgn by remember { mutableStateOf(p0.optString("ffIgn")) }
    var facebook by remember { mutableStateOf(p0.optString("facebookId")) }
    var whatsapp by remember { mutableStateOf(p0.optString("whatsapp")) }
    var instagram by remember { mutableStateOf(p0.optString("instagram")) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Bg).verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CloseIcon(done)
            Text("Edit profile", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        }
        Spacer(Modifier.height(12.dp))
        listOf(
            "Display name" to displayName,
            "Username" to username,
            "Bio" to bio,
            "Free Fire UID" to ffUid,
            "IGN" to ffIgn,
            "Facebook" to facebook,
            "WhatsApp" to whatsapp,
            "Instagram" to instagram,
        ).forEach { _ -> }
        OutlinedTextField(displayName, { displayName = it }, label = { Text("Display name") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(username, { username = it }, label = { Text("Username") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(bio, { bio = it }, label = { Text("Bio") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(ffUid, { ffUid = it }, label = { Text("Free Fire UID") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(ffIgn, { ffIgn = it }, label = { Text("IGN") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(facebook, { facebook = it }, label = { Text("Facebook") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(whatsapp, { whatsapp = it }, label = { Text("WhatsApp") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(instagram, { instagram = it }, label = { Text("Instagram") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(16.dp))
        AccentBtn("Save changes") {
            scope.launch {
                val body =
                    JSONObject()
                        .put("displayName", displayName)
                        .put("username", username)
                        .put("bio", bio)
                        .put("ffUid", ffUid)
                        .put("ffIgn", ffIgn)
                        .put("facebookId", facebook)
                        .put("whatsapp", whatsapp)
                        .put("instagram", instagram)
                val data = withContext(Dispatchers.IO) { runCatching { Api.patch("/api/me/profile", body) }.getOrNull() }
                session.me = data?.optJSONObject("user") ?: session.me
                done()
            }
        }
    }
}

@Composable
fun PlayerScreen(userId: String, session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    var user by remember { mutableStateOf(JSONObject()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(userId) {
        withContext(Dispatchers.IO) {
            runCatching { user = Api.get("/api/users/$userId").optJSONObject("user") ?: JSONObject() }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Spacer(Modifier.weight(1f))
            IconBtn(Icons.Outlined.Call) { engine.startCall(userId, "AUDIO", user.name()) }
            IconBtn(Icons.Outlined.Videocam) { engine.startCall(userId, "VIDEO", user.name()) }
        }
        LazyColumn(Modifier.padding(12.dp)) {
            item {
                ProfileHero(user, 0, user.optInt("reputation"), 0)
                AboutCard(user)
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AccentBtn("Add") {
                        scope.launch(Dispatchers.IO) {
                            runCatching { Api.post("/api/friend-requests", JSONObject().put("userId", userId)) }
                        }
                    }
                    AccentBtn("Message") {
                        scope.launch {
                            val data =
                                withContext(Dispatchers.IO) {
                                    runCatching { Api.post("/api/conversations", JSONObject().put("userId", userId)) }.getOrNull()
                                }
                            val id = data?.optJSONObject("conversation")?.optString("id")
                            if (!id.isNullOrBlank()) onRoute("chat/$id")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun FriendsScreen(session: Session, onRoute: (String) -> Unit) {
    val friends = remember { mutableStateListOf<JSONObject>() }
    val people = remember { mutableStateListOf<JSONObject>() }
    var q by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    suspend fun load(query: String) {
        withContext(Dispatchers.IO) {
            runCatching {
                friends.clear()
                friends.addAll(Api.get("/api/friends").arr("items").objects())
                val recs = Api.get("/api/discover/recommendations").arr("items").objects()
                val search = if (query.isBlank()) emptyList() else Api.get("/api/discover?q=${Api.q(query)}").arr("items").objects()
                val ids = friends.map { it.userId() }.toSet()
                people.clear()
                people.addAll((recs + search).filter { it.userId() !in ids }.distinctBy { it.userId() })
            }
        }
    }
    LaunchedEffect(Unit) { load("") }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        OutlinedTextField(q, { q = it }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Search players") }, singleLine = true)
        Spacer(Modifier.height(8.dp))
        AccentBtn("Search") { scope.launch { load(q) } }
        Text("Your friends", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
        LazyColumn {
            itemsIndexed(friends) { _, u ->
                PersonMini(u, onOpen = { onRoute("player/${u.userId()}") })
            }
            item { Text("People you may know", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp)) }
            itemsIndexed(people) { _, u ->
                PersonMini(u, onOpen = { onRoute("player/${u.userId()}") }) {
                    Text(
                        "Add",
                        color = Accent,
                        modifier = Modifier.clickable {
                            scope.launch(Dispatchers.IO) {
                                runCatching { Api.post("/api/friend-requests", JSONObject().put("userId", u.userId())) }
                            }
                        }.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
fun RequestsScreen(session: Session, onRoute: (String) -> Unit) {
    val items = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                items.clear()
                items.addAll(Api.get("/api/friend-requests").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        LazyColumn {
            itemsIndexed(items) { _, r ->
                val from = r.optJSONObject("from") ?: r
                PersonMini(from, onOpen = { onRoute("player/${from.userId()}") }) {
                    AccentBtn("Accept") {
                        scope.launch {
                            withContext(Dispatchers.IO) { runCatching { Api.post("/api/friend-requests/${r.optString("id")}/accept") } }
                            items.remove(r)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(session: Session, onRoute: (String) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val p = session.me?.optJSONObject("privacy") ?: JSONObject()
    var showDistrict by remember { mutableStateOf(p.optBoolean("showDistrict")) }
    var showUid by remember { mutableStateOf(p.optBoolean("showFfUid")) }
    var showRel by remember { mutableStateOf(p.optBoolean("showRelationship")) }
    var discoverable by remember { mutableStateOf(p.optBoolean("discoverable", true)) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().background(Bg).padding(16.dp)) {
        Text("Settings", fontWeight = FontWeight.SemiBold, fontSize = 22.sp)
        Spacer(Modifier.height(12.dp))
        Column(Modifier.clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Line, RoundedCornerShape(14.dp)).padding(14.dp)) {
            SwitchRow("Show district", showDistrict) { showDistrict = it }
            SwitchRow("Show UID", showUid) { showUid = it }
            SwitchRow("Show relationship", showRel) { showRel = it }
            SwitchRow("Show in Find duo", discoverable) { discoverable = it }
            Spacer(Modifier.height(8.dp))
            AccentBtn("Save privacy") {
                scope.launch(Dispatchers.IO) {
                    runCatching {
                        Api.patch(
                            "/api/me/privacy",
                            JSONObject()
                                .put("showDistrict", showDistrict)
                                .put("showFfUid", showUid)
                                .put("showRelationship", showRel)
                                .put("discoverable", discoverable),
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text("Sign out", color = Muted, modifier = Modifier.clickable { logout(ctx, session, onRoute) }.padding(8.dp))
    }
}

@Composable
private fun SwitchRow(label: String, on: Boolean, set: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { set(!on) }.padding(vertical = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label)
        Text(if (on) "On" else "Off", color = if (on) Accent else Muted, fontWeight = FontWeight.Medium)
    }
}
