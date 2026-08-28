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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.PermMedia
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ProfileScreen(nav: NavController, userId: String) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var user by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf("") }
    var blocked by remember { mutableStateOf(false) }

    LaunchedEffect(userId) {
        runCatching {
            val cached = withContext(Dispatchers.IO) { Api.get("/api/users/$userId") }
            user = cached.optJSONObject("user") ?: user
            error = ""
            val fresh = withContext(Dispatchers.IO) { Api.get("/api/users/$userId", true) }
            user = fresh.optJSONObject("user") ?: user
        }.onFailure {
            if (user == null) error = it.message ?: "Could not load profile."
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Cream)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("Contact", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        val u = user
        if (u == null) {
            Text(error.ifBlank { "Loading…" }, color = Muted, modifier = Modifier.padding(24.dp))
            return
        }
        // Compact header: avatar, name, @username, online, about — no big
        // empty blocks in between (optText keeps JSON-null fields from
        // rendering as the literal string "null").
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            KpAvatar(
                u.optText("displayName").ifBlank { "?" },
                u.optText("avatarUrl").ifBlank { null },
                88.dp,
            )
            Spacer(Modifier.height(10.dp))
            Text(u.optText("displayName").ifBlank { "—" }, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
            val uname = u.optText("username")
            if (uname.isNotBlank()) Text("@$uname", fontSize = 13.5.sp, color = Muted)
            if (u.optBoolean("online")) {
                Spacer(Modifier.height(2.dp))
                Text("online", fontSize = 12.5.sp, color = Green)
            }
            val about = u.optText("about")
            if (about.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(about, fontSize = 13.5.sp, color = Ink, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(Card),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProfileAction(Icons.Filled.Call, "Voice", Modifier.weight(1f)) {
                haptics.tap()
                CallEngine.instance?.startCall(userId, "AUDIO", u.optText("displayName"), u.optText("avatarUrl"))
            }
            ProfileActionDivider()
            ProfileAction(Icons.Filled.Videocam, "Video", Modifier.weight(1f)) {
                haptics.tap()
                CallEngine.instance?.startCall(userId, "VIDEO", u.optText("displayName"), u.optText("avatarUrl"))
            }
            ProfileActionDivider()
            ProfileAction(Icons.Filled.Search, "Search", Modifier.weight(1f)) {
                haptics.tap()
                scope.launch {
                    runCatching {
                        val data = withContext(Dispatchers.IO) {
                            Api.post("/api/conversations", JSONObject().put("userId", userId))
                        }
                        val cid = data.optJSONObject("conversation")?.optString("id").orEmpty()
                        if (cid.isNotBlank()) {
                            ScreenStore.pendingChatSearch = cid
                            nav.navigate("chat/$cid")
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Column(Modifier.padding(horizontal = 16.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.PermMedia, null, tint = GoldDeep)
                Spacer(Modifier.width(12.dp))
                Text("Shared media lives in each chat’s menu → Media, links, and docs", color = Muted, fontSize = 13.5.sp)
            }
            Spacer(Modifier.height(10.dp))
            androidx.compose.foundation.layout.Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Card)
                    .padding(4.dp),
            ) {
                androidx.compose.material3.TextButton(
                    onClick = {
                        scope.launch {
                            runCatching {
                                withContext(Dispatchers.IO) {
                                    if (blocked) Api.delete("/api/blocks/$userId")
                                    else Api.post("/api/blocks", JSONObject().put("userId", userId))
                                }
                                blocked = !blocked
                            }
                        }
                    },
                ) {
                    Icon(Icons.Filled.Block, null, tint = Red, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(if (blocked) "Unblock" else "Block", color = Red)
                }
            }
        }
    }
}

@Composable
private fun ProfileAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .clickable { onClick() }
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = GoldDeep, modifier = Modifier.size(20.dp))
        Spacer(Modifier.height(5.dp))
        Text(label, color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ProfileActionDivider() {
    androidx.compose.foundation.layout.Box(
        Modifier
            .width(1.dp)
            .height(28.dp)
            .background(Line),
    )
}

private fun profileSnapshot(userId: String): JSONObject? {
    ScreenStore.convs.forEach { c ->
        val o = c.optJSONObject("other")
        if (o != null && o.optString("id") == userId) return o
    }
    return Cache.peek("/api/users/$userId")?.optJSONObject("user")
}
