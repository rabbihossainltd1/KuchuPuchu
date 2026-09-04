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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * AI chat History (owner round 8, 2026-09-04): the 3-dot menu's "History"
 * item opens this screen. Every "New chat" / "Incognito" wipe archives the
 * session server-side (ai_sessions); this lists those archives, newest
 * first, and opens any of them read-only.
 */
@Composable
fun AIHistoryScreen(nav: NavController) {
    var sessions by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var open by remember { mutableStateOf<JSONObject?>(null) }
    var msgs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        runCatching {
            val data = withContext(Dispatchers.IO) { Api.get("/api/ai/sessions") }
            sessions = data.arr("sessions").objects()
        }
        loading = false
    }

    LaunchedEffect(open?.optString("id")) {
        val sid = open?.optString("id").orEmpty()
        if (sid.isBlank()) return@LaunchedEffect
        runCatching {
            val data = withContext(Dispatchers.IO) { Api.get("/api/ai/sessions/$sid") }
            msgs = data.arr("messages").objects()
        }
    }

    Column(Modifier.fillMaxSize().background(Cream)) {
        // header
        Row(
            Modifier
                .fillMaxWidth()
                .background(Cream)
                .padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { if (open != null) { open = null; msgs = emptyList() } else nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Back", tint = Ink, modifier = Modifier.padding(top = 12.dp))
            }
            Column(Modifier.padding(start = 4.dp)) {
                Text(
                    if (open != null) "Session" else "AI History",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Ink,
                )
                Text(
                    if (open != null) "Read-only archive" else "Your past KuchuPuchu AI sessions",
                    fontSize = 11.5.sp,
                    color = Muted,
                )
            }
        }

        if (open == null) {
            if (loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Loading…", color = Muted)
                }
            } else if (sessions.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No past sessions yet.\nStart a chat and pick “New chat” —\nthe old one lands here.",
                        color = Muted, lineHeight = 20.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                }
            } else {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
                    items(sessions, key = { it.optString("id") }) { s ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(Card)
                                .clickable { open = s }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                Modifier
                                    .width(38.dp)
                                    .height(38.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(GoldSoft),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(Icons.Filled.Schedule, null, tint = GoldDeep)
                            }
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    prettyRange(s.optText("endedAt")),
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = Ink,
                                )
                                Text(
                                    "${s.optInt("messages")} messages",
                                    fontSize = 12.sp,
                                    color = Muted,
                                )
                            }
                            Text("View", fontSize = 12.5.sp, color = GoldDeep, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(msgs, key = { it.optString("createdAt") + it.optString("senderId") + it.optString("body").take(20) }) { m ->
                    val mine = m.optString("senderId") == Store.myId()
                    val body = m.optText("body").ifBlank { when (m.optString("kind")) { "IMAGE" -> "📷 Photo"; "OWNER_CARD" -> "👤 Owner card"; else -> "" } }
                    if (body.isNotBlank()) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(
                                        if (mine) Brush.linearGradient(listOf(Gold, Gold))
                                        else Brush.linearGradient(listOf(Card, Card)),
                                    )
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                            ) {
                                Text(body, fontSize = 14.sp, color = if (mine) Color.White else Ink, maxLines = 50)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "3 Sep, 2:15 PM" style label for a session's end time (Dhaka zone). */
private fun prettyRange(iso: String): String =
    runCatching {
        val z = atDhaka(java.time.Instant.parse(iso))
        val month = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[z.monthValue - 1]
        val hour = (z.hour % 12).let { if (it == 0) 12 else it }
        "$month ${z.dayOfMonth}, $hour:${String.format("%02d", z.minute)} ${if (z.hour >= 12) "PM" else "AM"}"
    }.getOrDefault("Session")
