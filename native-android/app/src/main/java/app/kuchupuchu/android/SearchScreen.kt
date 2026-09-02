package app.kuchupuchu.android

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Search — locked design #1: filter chips (All / Chats / Media / Documents)
 * and gold-highlighted matches across people, conversations and messages.
 */
@Composable
fun SearchScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("all") }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var searching by remember { mutableStateOf(false) }

    fun openChatWith(userId: String) {
        // Cache first (ScreenStore fills it from every chat-list refresh): a
        // chat the user already has opens on the SAME frame instead of after a
        // POST /api/conversations round trip. Unknown user -> create path.
        val cached = ScreenStore.convIdForUser[userId]
        if (cached != null) {
            nav.navigate("chat/$cached") { popUpTo("main") }
            return
        }
        scope.launch {
            runCatching {
                val conv = withContext(Dispatchers.IO) {
                    Api.post("/api/conversations", JSONObject().put("userId", userId))
                }
                conv.optJSONObject("conversation")?.optString("id")?.let {
                    ScreenStore.convIdForUser[userId] = it
                    nav.navigate("chat/$it") { popUpTo("main") }
                }
            }
        }
    }

    LaunchedEffect(query) {
        if (query.trim().length < 2) {
            result = null
            return@LaunchedEffect
        }
        delay(250)
        searching = true
        try {
            result = withContext(Dispatchers.IO) { Api.get("/api/search?q=${Api.q(query.trim())}", true) }
        } catch (_: Exception) {
        } finally {
            searching = false
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
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { nav.popBackStack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Ink)
            }
            Text("Search", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Ink)
        }

        OutlinedTextField(
            query,
            { query = it },
            placeholder = { Text("Search people, chats, messages", fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            singleLine = true,
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp),
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .height(52.dp),
        )

        /* filter chips */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            listOf("all" to "All", "chats" to "Chats", "media" to "Media", "docs" to "Docs").forEach { (id, label) ->
                val selected = filter == id
                Box(
                    Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (selected) Gold else Card)
                        .clickable { filter = id }
                        .padding(horizontal = 13.dp, vertical = 7.dp),
                ) {
                    Text(
                        label,
                        color = if (selected) AmberInk else Muted,
                        fontSize = 13.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Clip,
                    )
                }
            }
        }

        val users = result?.arr("users")?.objects() ?: emptyList()
        val chats = result?.arr("chats")?.objects() ?: emptyList()
        val allMessages = result?.arr("messages")?.objects() ?: emptyList()
        val media = allMessages.filter { it.optString("kind") == "IMAGE" }
        val docs = allMessages.filter { it.optString("kind") == "FILE" }
        val messages = when (filter) {
            "media" -> media
            "docs" -> docs
            else -> allMessages
        }

        if (query.trim().length < 2) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(
                    icon = Icons.Filled.Search,
                    title = "Search",
                    note = "People, chat ba message khujun",
                )
            }
        } else if (searching && result == null) {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                androidx.compose.material3.CircularProgressIndicator(color = Gold)
            }
        } else {
            LazyColumn(
                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (filter == "all" && users.isNotEmpty()) {
                    item { SectionLabel("People") }
                    items(users, key = { "u" + it.optString("id") }) { u ->
                        ResultCard(onClick = { haptics.tap(); openChatWith(u.optString("id")) }) {
                            KpAvatar(u.optString("displayName"), u.optIso("avatarUrl"), 42.dp, ring = false, avatarRef = u.optIso("avatarRef"))
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Highlight(u.optText("displayName"), query)
                                val un = u.optString("username")
                                if (un.isNotBlank()) Highlight("@$un", query, fontSize = 12f)
                            }
                        }
                    }
                }
                if (filter == "all" || filter == "chats") {
                    val namedChats =
                        if (filter == "all") chats.filter { c ->
                            // only list chats whose own title matches the query
                            c.optString("title").lowercase().contains(query.trim().lowercase()) ||
                                (c.optJSONObject("other")?.optString("displayName") ?: "").lowercase().contains(query.trim().lowercase())
                        } else chats
                    if (namedChats.isNotEmpty()) {
                        item { SectionLabel("Chats") }
                        items(namedChats, key = { "c" + it.optString("id") }) { c ->
                            val other = c.optJSONObject("other")
                            val title =
                                if (c.optBoolean("isGroup")) c.optString("title")
                                else other?.optText("displayName")?.ifBlank { "Chat" } ?: "Chat"
                            ResultCard(onClick = {
                                nav.navigate("chat/${c.optString("id")}") { popUpTo("main") }
                            }) {
                                KpAvatar(
                                    title,
                                    if (c.optBoolean("isGroup")) null else other?.optIso("avatarUrl"),
                                    42.dp,
                                    ring = false,
                                    avatarRef = if (c.optBoolean("isGroup")) null else other?.optIso("avatarRef"),
                                )
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Highlight(title, query)
                                    Text(c.optString("lastMessage"), fontSize = 12.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
                if ((filter == "all" || filter == "chats" || filter == "media") && media.isNotEmpty() && filter != "docs") {
                    if (filter == "media" || filter == "all") {
                        item { SectionLabel("Media") }
                        items(media, key = { "m" + it.optString("id") }) { m ->
                            ResultCard(onClick = { nav.navigate("chat/${m.optString("convoId")}") { popUpTo("main") } }) {
                                Icon(Icons.Filled.Photo, "Photo", tint = Gold, modifier = Modifier.size(28.dp))
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Text(m.optString("body").ifBlank { "Photo" }, fontSize = 13.5.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(
                                        (m.optString("convTitle").ifBlank { "Chat" }) + " · " + listStamp(m.optString("createdAt")),
                                        fontSize = 11.5.sp,
                                        color = Muted,
                                    )
                                }
                            }
                        }
                    }
                }
                if (filter == "all" || filter == "docs") {
                    if (docs.isNotEmpty()) {
                        item { SectionLabel("Documents") }
                        items(docs, key = { "d" + it.optString("id") }) { m ->
                            ResultCard(onClick = { nav.navigate("chat/${m.optString("convoId")}") { popUpTo("main") } }) {
                                Icon(Icons.Filled.InsertDriveFile, "File", tint = GoldDeep, modifier = Modifier.size(26.dp))
                                Spacer(Modifier.width(12.dp))
                                Column {
                                    Highlight(m.optString("fileName").ifBlank { m.optString("body").ifBlank { "File" } }, query)
                                    Text(
                                        (m.optString("convTitle").ifBlank { "Chat" }) + " · " + listStamp(m.optString("createdAt")),
                                        fontSize = 11.5.sp,
                                        color = Muted,
                                    )
                                }
                            }
                        }
                    }
                    if (filter == "all" || filter == "chats") {
                        val textMessages = allMessages.filter { it.optString("kind") == "TEXT" }
                        if (textMessages.isNotEmpty()) {
                            item { SectionLabel("Messages") }
                            items(textMessages, key = { "t" + it.optString("id") }) { m ->
                                ResultCard(onClick = { nav.navigate("chat/${m.optString("convoId")}") { popUpTo("main") } }) {
                                    Column {
                                        Highlight(m.optString("body"), query)
                                        Text(
                                            (m.optString("convTitle").ifBlank { "Chat" }) + " · " + listStamp(m.optString("createdAt")),
                                            fontSize = 11.5.sp,
                                            color = Muted,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                if (users.isEmpty() && chats.isEmpty() && allMessages.isEmpty()) {
                    item {
                        Text(
                            "Kichu paoa jay nai “${query.trim()}” er jonno",
                            Modifier.fillMaxWidth().padding(24.dp),
                            fontSize = 14.sp,
                            color = Muted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionLabel(label: String) {
    Text(
        label,
        fontSize = 12.5.sp,
        fontWeight = FontWeight.SemiBold,
        color = GoldDeep,
        modifier = Modifier.padding(start = 8.dp, top = 10.dp, bottom = 2.dp),
    )
}

@Composable
private fun ResultCard(onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Card)
            .let { m -> if (onClick != null) m.clickable { onClick() } else m }
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) { content() }
}

/** Gold-highlighted text: matched part shows in bold gold. */
@Composable
private fun Highlight(text: String, query: String, fontSize: Float = 14f) {
    val annotated: AnnotatedString =
        if (query.isBlank()) {
            AnnotatedString(text)
        } else {
            val lower = text.lowercase()
            val q = query.trim().lowercase()
            buildAnnotatedString {
                var start = 0
                while (true) {
                    val idx = lower.indexOf(q, start)
                    if (idx < 0 || q.isEmpty()) break
                    append(text.substring(start, idx))
                    pushStyle(SpanStyle(color = GoldDeep, fontWeight = FontWeight.Bold, background = GoldSoft))
                    append(text.substring(idx, idx + q.length))
                    pop()
                    start = idx + q.length
                }
                if (start < text.length) append(text.substring(start))
            }
        }
    Text(annotated, fontSize = fontSize.sp, color = Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
}
