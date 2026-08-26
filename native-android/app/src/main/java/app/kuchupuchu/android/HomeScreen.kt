package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun HomeScreen(session: Session, onRoute: (String) -> Unit, searchOpen: Boolean, closeSearch: () -> Unit) {
    val posts = remember { mutableStateListOf<JSONObject>() }
    val recs = remember { mutableStateListOf<JSONObject>() }
    val stories = remember { mutableStateListOf<JSONObject>() }
    val found = remember { mutableStateListOf<JSONObject>() }
    var q by remember { mutableStateOf("") }
    var storyOpen by remember { mutableStateOf(false) }
    var viewer by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load(query: String = q) {
        withContext(Dispatchers.IO) {
            runCatching {
                posts.clear()
                posts.addAll(Api.get("/api/feed").arr("items").objects())
                recs.clear()
                recs.addAll(Api.get("/api/discover/recommendations").arr("items").objects())
                stories.clear()
                stories.addAll(Api.get("/api/stories").arr("items").objects())
                if (query.length >= 2) {
                    found.clear()
                    found.addAll(Api.get("/api/discover?q=${Api.q(query)}").arr("items").objects())
                }
            }
        }
    }

    LaunchedEffect(Unit) { load("") }

    Column(Modifier.fillMaxSize().background(FeedBg)) {
        if (searchOpen) {
            OutlinedTextField(
                value = q,
                onValueChange = {
                    q = it
                    if (it.length >= 2) {
                        scope.launch { load(it) }
                    }
                },
                placeholder = { Text("Search posts and players") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().background(Surface).padding(horizontal = 12.dp, vertical = 8.dp),
                shape = RoundedCornerShape(99.dp),
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Color.Transparent, unfocusedContainerColor = FeedBg, focusedContainerColor = FeedBg),
            )
        }
        if (searchOpen && q.isNotBlank()) {
            LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
                itemsIndexed(found) { _, u ->
                    PersonMini(u, onOpen = { onRoute("player/${u.userId()}") }) {
                        Text(
                            "Add",
                            color = Accent,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.clickable {
                                scope.launch(Dispatchers.IO) {
                                    runCatching { Api.post("/api/friend-requests", JSONObject().put("userId", u.userId())) }
                                }
                            }.padding(8.dp),
                        )
                    }
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Column(Modifier.background(Surface)) {
                        Row(
                            Modifier.fillMaxWidth().clickable { onRoute("compose") }.padding(10.dp, 10.dp, 12.dp, 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(session.me, 40.dp)
                            Spacer(Modifier.width(10.dp))
                            Text("What's on your mind?", color = Muted, fontSize = 15.sp, modifier = Modifier.weight(1f).background(FeedBg, RoundedCornerShape(99.dp)).padding(10.dp, 10.dp))
                            Icon(Icons.Outlined.Image, null, tint = Color(0xFF65A30D))
                        }
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(4.dp, 0.dp, 12.dp, 14.dp)) {
                            CreateStoryCard(session) { storyOpen = true }
                            stories.forEachIndexed { gi, g ->
                                val author = g.optJSONObject("author") ?: JSONObject()
                                val first = g.arr("stories").objects().firstOrNull() ?: JSONObject()
                                StoryCard(author, first, g.optBoolean("seen")) { viewer = gi to 0 }
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                itemsIndexed(posts) { i, post ->
                    PostCard(post, session, onUser = { onRoute("player/${(post.optJSONObject("author") ?: JSONObject()).userId()}") })
                    Spacer(Modifier.height(8.dp))
                    if ((i + 1) % 3 == 0 && recs.isNotEmpty()) {
                        RecBlock(recs.drop((i / 3) * 2).take(2), onRoute)
                        Spacer(Modifier.height(8.dp))
                    }
                }
                if (posts.size < 3 && recs.isNotEmpty()) {
                    item { RecBlock(recs.take(3), onRoute) }
                }
            }
        }
        if (storyOpen) StoryComposer(session, { storyOpen = false }) { scope.launch { load(); storyOpen = false } }
        viewer?.let { (gi, si) ->
            val group = stories.getOrNull(gi)
            if (group != null) {
                StoryViewer(group, si, onClose = { viewer = null }, onStep = { d ->
                    val storiesArr = group.arr("stories").objects()
                    val next = si + d
                    viewer = when {
                        next in storiesArr.indices -> gi to next
                        d > 0 && gi + 1 < stories.size -> (gi + 1) to 0
                        d < 0 && gi > 0 -> {
                            val prev = stories[gi - 1].arr("stories").objects()
                            (gi - 1) to (prev.lastIndex.coerceAtLeast(0))
                        }
                        else -> null
                    }
                })
            }
        }
        closeSearch
    }
}

@Composable
private fun CreateStoryCard(session: Session, onClick: () -> Unit) {
    Column(Modifier.padding(start = 8.dp).width(112.dp).clickable(onClick = onClick)) {
        Box(Modifier.size(112.dp, 196.dp).clip(RoundedCornerShape(14.dp)).background(Surface).border(1.dp, Color(0xFFECE8E1), RoundedCornerShape(14.dp))) {
            Box(Modifier.fillMaxWidth().height(144.dp).background(Brush.verticalGradient(listOf(Color(0xFFF5EFE4), Color(0xFFE8DFD2)))), contentAlignment = Alignment.Center) {
                Avatar(session.me, 56.dp)
            }
            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 42.dp).size(34.dp).clip(CircleShape).background(Accent).border(4.dp, Color.White, CircleShape), contentAlignment = Alignment.Center) {
                Text("+", color = AccentInk, fontWeight = FontWeight.Bold)
            }
            Text("Create story", Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
    }
}

@Composable
private fun StoryCard(author: JSONObject, first: JSONObject, seen: Boolean, onClick: () -> Unit) {
    Box(Modifier.padding(start = 8.dp).size(112.dp, 196.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFE7E3DB)).clickable(onClick = onClick)) {
        val img = first.optString("imageUrl")
        if (img.isNotBlank()) {
            AsyncImage(img, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFFDE68A), Color(0xFFD97706)))), contentAlignment = Alignment.Center) {
                Text(first.optString("body").ifBlank { author.name() }, color = Ink, fontWeight = FontWeight.Bold, fontSize = 15.sp, modifier = Modifier.padding(10.dp))
            }
        }
        Box(Modifier.padding(8.dp).clip(CircleShape).border(2.dp, if (seen) Color(0xFFC4BDB4) else Accent, CircleShape)) {
            Avatar(author, 32.dp)
        }
        Text(author.name(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.align(Alignment.BottomStart).padding(8.dp, 10.dp))
    }
}

@Composable
private fun RecBlock(people: List<JSONObject>, onRoute: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().background(Surface).padding(14.dp, 12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("People you may know", fontWeight = FontWeight.SemiBold)
            Text("See all", color = Accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.clickable { onRoute("friends") })
        }
        people.forEach { u ->
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

@Composable
fun PostCard(post: JSONObject, session: Session, onUser: () -> Unit) {
    val author = post.optJSONObject("author") ?: JSONObject()
    val scope = rememberCoroutineScope()
    var liked by remember { mutableStateOf(post.optBoolean("liked")) }
    var likes by remember { mutableStateOf(post.optInt("likeCount")) }
    var commentsOpen by remember { mutableStateOf(false) }
    var comment by remember { mutableStateOf("") }
    val comments = remember { mutableStateListOf<JSONObject>().also { it.addAll(post.arr("comments").objects()) } }
    Column(Modifier.fillMaxWidth().background(Surface).padding(14.dp, 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(onClick = onUser)) {
            Avatar(author, 40.dp, online = author.optBoolean("online"))
            Spacer(Modifier.width(10.dp))
            Column {
                Text(author.name(), fontWeight = FontWeight.SemiBold)
                Text("@${author.uid()} · ${timeAgo(post.optString("createdAt"))} · ${if (post.optString("visibility") == "FRIENDS") "Friends" else "Public"}", color = Muted, fontSize = 13.sp)
            }
        }
        Text(post.optString("body"), fontSize = 16.sp, modifier = Modifier.padding(top = 10.dp, bottom = 8.dp), color = Ink)
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            Row(
                Modifier.weight(1f).clickable {
                    liked = !liked
                    likes += if (liked) 1 else -1
                    scope.launch(Dispatchers.IO) { runCatching { Api.post("/api/posts/${post.optString("id")}/like") } }
                }.padding(8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (liked) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, null, tint = if (liked) Accent else Muted)
                Spacer(Modifier.width(6.dp))
                Text("$likes", color = if (liked) Accent else Muted)
            }
            Row(
                Modifier.weight(1f).clickable { commentsOpen = !commentsOpen }.padding(8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Muted)
                Spacer(Modifier.width(6.dp))
                Text("${post.optInt("commentCount")}", color = Muted)
            }
        }
        if (commentsOpen) {
            comments.forEach { c ->
                val a = c.optJSONObject("author") ?: JSONObject()
                Row(Modifier.padding(top = 8.dp)) {
                    Avatar(a, 28.dp)
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(a.name(), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        Text(c.optString("body"), fontSize = 14.sp)
                    }
                }
            }
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(comment, { comment = it }, modifier = Modifier.weight(1f), placeholder = { Text("Write a comment") }, singleLine = true)
                Text(
                    "Reply",
                    color = Accent,
                    modifier = Modifier.clickable {
                        val body = comment.trim()
                        if (body.isBlank()) return@clickable
                        comment = ""
                        scope.launch {
                            val data = withContext(Dispatchers.IO) {
                                runCatching { Api.post("/api/posts/${post.optString("id")}/comments", JSONObject().put("body", body)) }.getOrNull()
                            }
                            data?.optJSONObject("post")?.arr("comments")?.objects()?.let {
                                comments.clear(); comments.addAll(it)
                            }
                        }
                    }.padding(8.dp),
                )
            }
        }
    }
}

@Composable
fun ComposePostScreen(session: Session, done: () -> Unit) {
    var body by remember { mutableStateOf("") }
    var vis by remember { mutableStateOf("PUBLIC") }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(Color(0x661C1917)).clickable(onClick = done)) {
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = 64.dp, start = 14.dp, end = 14.dp)
                .fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Surface).padding(16.dp)
                .clickable(enabled = false) {},
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("Create post", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                CloseIcon(done)
            }
            Spacer(Modifier.height(12.dp))
            Row {
                Avatar(session.me, 40.dp)
                Spacer(Modifier.width(10.dp))
                OutlinedTextField(body, { body = it }, modifier = Modifier.weight(1f).height(140.dp), placeholder = { Text("What's on your mind?") })
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.clip(RoundedCornerShape(99.dp)).background(if (vis == "PUBLIC") AccentSoft else Surface).clickable { vis = "PUBLIC" }.padding(8.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Public, null, tint = AccentDeep, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Public", fontSize = 12.sp, color = AccentDeep)
                }
                Spacer(Modifier.width(6.dp))
                Row(Modifier.clip(RoundedCornerShape(99.dp)).background(if (vis == "FRIENDS") AccentSoft else Surface).clickable { vis = "FRIENDS" }.padding(8.dp, 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Lock, null, tint = Muted, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Friends", fontSize = 12.sp)
                }
                Spacer(Modifier.weight(1f))
                AccentBtn(if (body.isBlank()) "Post" else "Post") {
                    if (body.isBlank()) return@AccentBtn
                    scope.launch {
                        withContext(Dispatchers.IO) {
                            runCatching { Api.post("/api/posts", JSONObject().put("body", body).put("visibility", vis)) }
                        }
                        done()
                    }
                }
            }
        }
    }
}

@Composable
private fun StoryComposer(session: Session, close: () -> Unit, done: () -> Unit) {
    var body by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(Color(0x661C1917)).clickable(onClick = close)) {
        Column(
            Modifier.align(Alignment.TopCenter).padding(top = 64.dp, start = 14.dp, end = 14.dp)
                .fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Surface).padding(16.dp)
                .clickable(enabled = false) {},
        ) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Create story", fontWeight = FontWeight.SemiBold)
                CloseIcon(close)
            }
            OutlinedTextField(body, { body = it }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), placeholder = { Text("Say something…") })
            Spacer(Modifier.height(12.dp))
            AccentBtn("Share story") {
                scope.launch {
                    withContext(Dispatchers.IO) {
                        runCatching {
                            val payload = JSONObject()
                            if (body.isBlank()) payload.put("body", JSONObject.NULL) else payload.put("body", body)
                            Api.post("/api/stories", payload)
                        }
                    }
                    done()
                }
            }
        }
    }
}

@Composable
private fun StoryViewer(group: JSONObject, index: Int, onClose: () -> Unit, onStep: (Int) -> Unit) {
    val author = group.optJSONObject("author") ?: JSONObject()
    val items = group.arr("stories").objects()
    val story = items.getOrNull(index) ?: JSONObject()
    LaunchedEffect(story.optString("id")) {
        withContext(Dispatchers.IO) { runCatching { Api.post("/api/stories/${story.optString("id")}/view") } }
    }
    Box(Modifier.fillMaxSize().background(Color(0xFF1C1917))) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            items.forEachIndexed { i, _ ->
                Box(Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(99.dp)).background(if (i <= index) Color.White else Color(0xFF57534E)))
            }
        }
        Row(Modifier.padding(12.dp, 28.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(author, 36.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(author.name(), color = Color.White, fontWeight = FontWeight.SemiBold)
                Text("${timeAgo(story.optString("createdAt"))} · 24h", color = Color(0xFFD6D3D1), fontSize = 12.sp)
            }
            CloseIcon(onClose)
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            val img = story.optString("imageUrl")
            if (img.isNotBlank()) AsyncImage(img, null, contentScale = ContentScale.Fit)
            if (story.optString("body").isNotBlank()) {
                Text(story.optString("body"), color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp))
            }
        }
        Box(Modifier.fillMaxHeight().width(140.dp).align(Alignment.CenterStart).clickable { onStep(-1) })
        Box(Modifier.fillMaxHeight().width(140.dp).align(Alignment.CenterEnd).clickable { onStep(1) })
    }
}
