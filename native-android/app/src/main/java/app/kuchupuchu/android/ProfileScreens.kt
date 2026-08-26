package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ProfileScreen(session: Session, onRoute: (String) -> Unit, mine: Boolean, openMenu: () -> Unit) {
    var editing by remember { mutableStateOf(false) }
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
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.fillMaxWidth().padding(6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.width(40.dp))
            Text("Profile", fontWeight = FontWeight.SemiBold)
            Row {
                PencilIcon { editing = !editing }
                MenuIcon(openMenu)
            }
        }
        if (editing) {
            EditProfile(user) { session.me = it; editing = false }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(16.dp)) {
                item { ProfileHead(user) }
                item {
                    Text("${friends.size} friends", color = Muted, modifier = Modifier.padding(vertical = 8.dp))
                }
                itemsIndexed(friends.take(8)) { _, u ->
                    PersonRow(u, onOpen = { onRoute("player/${u.userId()}") })
                }
            }
        }
    }
}

@Composable
fun ProfileHead(user: JSONObject) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Avatar(user, 88.dp)
        Spacer(Modifier.height(8.dp))
        Text(user.name(), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        Text("UID ${user.uid()}", color = Muted, fontSize = 13.sp)
        Spacer(Modifier.height(8.dp))
        if (user.optString("email").isNotBlank()) Text(user.optString("email"), color = Muted, fontSize = 13.sp)
        val bio = user.optString("bio")
        if (bio.isNotBlank()) Text(bio, modifier = Modifier.padding(top = 8.dp))
        val p = user.profile()
        val links =
            listOf(
                "facebook" to p.optString("facebookId"),
                "whatsapp" to p.optString("whatsapp"),
                "instagram" to p.optString("instagram"),
            ).filter { it.second.isNotBlank() }
        if (links.isNotEmpty()) {
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                links.forEach { Text(it.first.replaceFirstChar { c -> c.uppercase() }, color = Accent, fontSize = 13.sp) }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun EditProfile(user: JSONObject, done: (JSONObject) -> Unit) {
    val p0 = user.profile()
    var displayName by remember { mutableStateOf(user.optString("displayName")) }
    var bio by remember { mutableStateOf(user.optString("bio")) }
    var facebook by remember { mutableStateOf(p0.optString("facebookId")) }
    var whatsapp by remember { mutableStateOf(p0.optString("whatsapp")) }
    var instagram by remember { mutableStateOf(p0.optString("instagram")) }
    val scope = rememberCoroutineScope()
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
        listOf(
            "Name" to displayName,
            "Bio" to bio,
            "Facebook" to facebook,
            "WhatsApp" to whatsapp,
            "Instagram" to instagram,
        ).forEach { (label, value) ->
            // values updated via individual fields below
            label
            value
        }
        OutlinedTextField(displayName, { displayName = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(bio, { bio = it }, label = { Text("Bio") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(facebook, { facebook = it }, label = { Text("Facebook") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(whatsapp, { whatsapp = it }, label = { Text("WhatsApp") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(instagram, { instagram = it }, label = { Text("Instagram") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(16.dp))
        Text(
            "Save",
            color = Accent,
            fontWeight = FontWeight.SemiBold,
            modifier =
                Modifier.clickable {
                    scope.launch {
                        val body =
                            JSONObject()
                                .put("displayName", displayName)
                                .put("bio", bio)
                                .put("facebookId", facebook)
                                .put("whatsapp", whatsapp)
                                .put("instagram", instagram)
                        val data = withContext(Dispatchers.IO) { runCatching { Api.patch("/api/me/profile", body) }.getOrNull() }
                        done(data?.optJSONObject("user") ?: user)
                    }
                }.padding(8.dp),
        )
    }
}

@Composable
fun PlayerScreen(userId: String, session: Session, onRoute: (String) -> Unit, engine: CallEngine) {
    var user by remember { mutableStateOf(JSONObject()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(userId) {
        withContext(Dispatchers.IO) {
            runCatching {
                user = Api.get("/api/users/$userId").optJSONObject("user") ?: JSONObject()
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Spacer(Modifier.weight(1f))
            IconBtn(Icons.Outlined.Call) { engine.startCall(userId, "AUDIO", user.name()) }
            IconBtn(Icons.Outlined.Videocam) { engine.startCall(userId, "VIDEO", user.name()) }
        }
        LazyColumn(Modifier.padding(16.dp)) {
            item {
                ProfileHead(user)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    Text(
                        "Add",
                        color = Accent,
                        modifier =
                            Modifier.clickable {
                                scope.launch(Dispatchers.IO) {
                                    runCatching { Api.post("/api/friend-requests", JSONObject().put("userId", userId)) }
                                }
                            }.padding(8.dp),
                    )
                    Text(
                        "Message",
                        color = Accent,
                        modifier =
                            Modifier.clickable {
                                scope.launch {
                                    val data =
                                        withContext(Dispatchers.IO) {
                                            runCatching { Api.post("/api/conversations", JSONObject().put("userId", userId)) }.getOrNull()
                                        }
                                    val id = data?.optJSONObject("conversation")?.optString("id") ?: data?.optString("id")
                                    if (!id.isNullOrBlank()) onRoute("chat/$id")
                                }
                            }.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
fun FriendsScreen(session: Session, onRoute: (String) -> Unit) {
    val items = remember { mutableStateListOf<JSONObject>() }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                items.clear()
                items.addAll(Api.get("/api/friends").arr("items").objects())
            }
        }
    }
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/home") }
            Text("Friends", fontWeight = FontWeight.SemiBold)
        }
        LazyColumn(Modifier.padding(12.dp)) {
            itemsIndexed(items) { _, u -> PersonRow(u, onOpen = { onRoute("player/${u.userId()}") }) }
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
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(Modifier.padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/alerts") }
            Text("Requests", fontWeight = FontWeight.SemiBold)
        }
        LazyColumn(Modifier.padding(12.dp)) {
            itemsIndexed(items) { _, r ->
                val from = r.optJSONObject("from") ?: r
                PersonRow(from, onOpen = { onRoute("player/${from.userId()}") }) {
                    Text(
                        "Accept",
                        color = Accent,
                        modifier =
                            Modifier.clickable {
                                scope.launch {
                                    withContext(Dispatchers.IO) {
                                        runCatching { Api.post("/api/friend-requests/${r.optString("id")}/accept") }
                                    }
                                    items.remove(r)
                                }
                            }.padding(8.dp),
                    )
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(session: Session, onRoute: (String) -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(Modifier.fillMaxSize().background(Bg).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CloseIcon { onRoute("tabs/me") }
            Text("Settings", fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(16.dp))
        Text("Account", fontWeight = FontWeight.Medium, modifier = Modifier.padding(8.dp))
        Text(session.me?.optString("email").orEmpty(), color = Muted, modifier = Modifier.padding(8.dp))
        Text(
            "Log out",
            color = Rose,
            modifier = Modifier.clickable { logout(ctx, session, onRoute) }.padding(8.dp),
        )
    }
}
