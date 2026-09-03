package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallMade
import androidx.compose.material.icons.filled.CallReceived
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Calls tab — locked design #2: date sections (Today / Yesterday / weekday),
 * direction arrows, gold callback buttons.
 */
@Composable
fun CallsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val calls = ScreenStore.calls
    var loading by remember { mutableStateOf(!ScreenStore.callsLoaded) }
    val haptics = rememberHaptics()

    LaunchedEffect(Unit) {
        try {
            val data = withContext(Dispatchers.IO) { Api.get("/api/calls/history") }
            ScreenStore.setCalls(data.arr("items").objects())
        } catch (_: Exception) {
        } finally {
            loading = false
        }
    }

    // Regrouping re-parses every timestamp in the list — memoized on the
    // list identity so scrolling (which just recomposes visible rows, not
    // this screen-level call) no longer re-runs it on every frame. This was
    // the "call tab a scrolling ta laggy" cause.
    val sections = remember(calls) { groupByDay(calls) }

    Column(Modifier.fillMaxSize().background(Cream)) {
        // No "Calls" heading here: this screen only ever appears inside the
        // Calls tab, which is already labelled right above it.
        if (calls.isEmpty() && loading) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Gold)
            }
        } else if (calls.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(
                    icon = Icons.Filled.Call,
                    title = "No calls yet",
                    note = "Start a voice or video call from any chat",
                )
            }
        } else LazyColumn(
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            sections.forEach { (day, items) ->
                item(key = "day_$day") {
                    Text(
                        day,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Muted,
                        modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp),
                    )
                }
                items(items, key = { it.optString("id") }) { call ->
                    CallRow(call) {
                        // open chat with the other person on row tap
                        val otherId =
                            if (call.optBoolean("incoming")) call.optString("callerId")
                            else call.optString("calleeId")
                        if (otherId.isNotBlank()) {
                            val cached = ScreenStore.convIdForUser[otherId]
                            if (cached != null) {
                                nav.navigate("chat/$cached")
                            } else {
                                scope.launch {
                                    runCatching {
                                        val conv = withContext(Dispatchers.IO) {
                                            Api.post("/api/conversations", JSONObject().put("userId", otherId))
                                        }
                                        conv.optJSONObject("conversation")?.optString("id")?.let {
                                            ScreenStore.convIdForUser[otherId] = it
                                            nav.navigate("chat/$it")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CallRow(call: JSONObject, onOpenChat: () -> Unit) {
    val haptics = rememberHaptics()
    val incoming = call.optBoolean("incoming")
    val other = call.optJSONObject("other")
    val name = other?.optText("displayName")?.takeIf { it.isNotBlank() } ?: "Unknown"
    val avatar = other?.optIso("avatarUrl")
    // The worker sends history rows LIGHT (avatarUrl:null + avatarRef) so the
    // payload stays small; KpAvatar resolves the ref through the persistent
    // per-version cache rather than re-transferring a data-URI per row.
    val avatarRef = other?.optIso("avatarRef")
    val kind = call.optString("kind")
    val status = call.optString("status")
    val video = kind == "VIDEO"

    // optIso(): optString() on a JSON null yields the string "null", which is
    // not blank, so this used to try Instant.parse("null") on every missed call
    // and only survived because of the getOrDefault below.
    val started = call.optIso("startedAt").orEmpty()
    val ended = call.optIso("endedAt").orEmpty()
    val seconds =
        if (started.isNotBlank() && ended.isNotBlank()) {
            runCatching {
                java.time.Duration.between(
                    java.time.Instant.parse(started),
                    java.time.Instant.parse(ended),
                ).seconds.toInt()
            }.getOrDefault(0)
        } else 0

    val missed = status == "MISSED" || status == "DECLINED"
    val label =
        when {
            missed -> "Missed ${if (video) "video" else "voice"} call"
            status == "CANCELLED" -> "Cancelled ${if (video) "video" else "voice"} call"
            seconds > 0 -> "${if (video) "Video" else "Voice"} call · %d:%02d".format(seconds / 60, seconds % 60)
            else -> "${if (video) "Video" else "Voice"} call"
        }

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Card)
            .clickable { onOpenChat() }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KpAvatar(name, avatar, 48.dp, ring = false, avatarRef = avatarRef)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                name,
                fontSize = 15.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (missed) Red else Ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (incoming) Icons.Filled.CallReceived else Icons.Filled.CallMade,
                    contentDescription = if (incoming) "Incoming" else "Outgoing",
                    tint = if (missed) Red else Muted,
                    modifier = Modifier.size(14.dp),
                )
                Spacer(Modifier.width(5.dp))
                Text(
                    "$label · ${listStamp(call.optString("createdAt"))}",
                    fontSize = 12.5.sp,
                    color = Muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        /* gold callback buttons */
        val otherId = if (incoming) call.optString("callerId") else call.optString("calleeId")
        if (otherId.isNotBlank()) {
            Box(
                Modifier
                    .padding(horizontal = 3.dp)
                    .size(40.dp)
                    .shadow(4.dp, CircleShape)
                    .clip(CircleShape)
                    .background(Brush.verticalGradient(listOf(Color(0xFFFFFFFF), Color(0xFFF3E4C6))))
                    .border(1.dp, Color(0x24000000), CircleShape)
                    .clickable {
                        haptics.tap()
                        gateMicCamera(video = video) {
                            CallEngine.instance?.startCall(otherId, if (video) "VIDEO" else "AUDIO", name, avatar ?: "")
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (video) Icons.Filled.Videocam else Icons.Filled.Call,
                    contentDescription = "Call back ${if (video) "video" else "voice"}",
                    tint = GoldDeep,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

private fun groupByDay(calls: List<JSONObject>): List<Pair<String, List<JSONObject>>> {
    val today = java.time.LocalDate.now()
    val out = LinkedHashMap<String, MutableList<JSONObject>>()
    for (c in calls) {
        val day =
            runCatching { java.time.Instant.parse(c.optString("createdAt")).atZone(DHAKA).toLocalDate() }
                .getOrNull()
                ?: today
        val label =
            when {
                day == today -> "Today"
                day == today.minusDays(1) -> "Yesterday"
                today.toEpochDay() - day.toEpochDay() < 7 ->
                    day.dayOfWeek.toString().take(3).let { d -> d[0] + d.substring(1).lowercase() }
                else -> "${day.dayOfMonth} ${day.month.toString().take(3).let { m -> m[0] + m.substring(1).lowercase() }}"
            }
        out.getOrPut(label) { ArrayList() }.add(c)
    }
    return out.map { it.key to it.value }
}
