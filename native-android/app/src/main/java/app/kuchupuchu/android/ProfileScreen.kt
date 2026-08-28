package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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

    Column(Modifier.fillMaxSize().background(Cream)) {
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
        Column(
            Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            KpAvatar(u.optString("displayName"), u.optString("avatarUrl"), 96.dp)
            Spacer(Modifier.height(14.dp))
            Text(u.optString("displayName"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Ink)
            val uname = u.optString("username")
            if (uname.isNotBlank()) Text("@$uname", fontSize = 14.sp, color = Muted)
            Spacer(Modifier.height(8.dp))
            Text(
                if (u.optBoolean("online")) "online" else " ",
                fontSize = 13.sp,
                color = if (u.optBoolean("online")) Green else Muted,
            )
            val about = u.optString("about")
            if (about.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Text(about, fontSize = 14.5.sp, color = Ink)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            ProfileAction("Voice", Icons.Filled.Call) {
                haptics.tap()
                CallEngine.instance?.startCall(userId, "AUDIO", u.optString("displayName"), u.optString("avatarUrl"))
            }
            Spacer(Modifier.width(10.dp))
            ProfileAction("Video", Icons.Filled.Videocam) {
                haptics.tap()
                CallEngine.instance?.startCall(userId, "VIDEO", u.optString("displayName"), u.optString("avatarUrl"))
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
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .padding(horizontal = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(GoldSoft)
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, label, tint = GoldDeep, modifier = Modifier.size(28.dp))
        Spacer(Modifier.height(6.dp))
        Text(label, color = GoldDeep, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
    }
}
