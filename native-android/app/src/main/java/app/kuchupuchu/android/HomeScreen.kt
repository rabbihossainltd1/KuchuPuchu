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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
fun HomeScreen(session: Session, onRoute: (String) -> Unit, openMenu: () -> Unit) {
    val posts = remember { mutableStateListOf<JSONObject>() }
    val recs = remember { mutableStateListOf<JSONObject>() }
    var q by remember { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    val found = remember { mutableStateListOf<JSONObject>() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            runCatching {
                val feed = Api.get("/api/feed")
                posts.clear()
                posts.addAll(feed.arr("items").objects())
                val people = Api.get("/api/discover/recommendations")
                recs.clear()
                recs.addAll(people.arr("items").objects())
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Search, null, tint = Muted, modifier = Modifier.padding(start = 6.dp))
            OutlinedTextField(
                value = q,
                onValueChange = {
                    q = it
                    searching = it.isNotBlank()
                    if (it.length >= 2) {
                        scope.launch {
                            val data = withContext(Dispatchers.IO) { runCatching { Api.get("/api/discover?q=${Api.q(it)}") }.getOrNull() }
                            found.clear()
                            data?.arr("items")?.objects()?.let { found.addAll(it) }
                        }
                    }
                },
                placeholder = { Text("Search") },
                singleLine = true,
                modifier = Modifier.weight(1f).padding(horizontal = 4.dp),
            )
            PlusIcon { onRoute("compose") }
            MenuIcon(openMenu)
        }
        if (searching) {
            LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
                itemsIndexed(found) { _, u ->
                    PersonRow(u, onOpen = { onRoute("player/${u.userId()}") })
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                itemsIndexed(posts) { i, post ->
                    PostCard(post, onUser = { onRoute("player/${(post.optJSONObject("author") ?: JSONObject()).userId()}") })
                    if (i == 2 && recs.isNotEmpty()) {
                        RecStrip(recs, onRoute)
                    }
                }
            }
        }
    }
}

@Composable
private fun RecStrip(recs: List<JSONObject>, onRoute: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(12.dp).background(Surface, RoundedCornerShape(14.dp)).padding(12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("People you may know", fontWeight = FontWeight.SemiBold)
            TextButton(onClick = { onRoute("friends") }) { Text("See all", color = Accent) }
        }
        recs.take(4).forEach { u ->
            PersonRow(u, onOpen = { onRoute("player/${u.userId()}") })
        }
    }
}

@Composable
fun PersonRow(u: JSONObject, onOpen: () -> Unit, trailing: @Composable (() -> Unit)? = null) {
    val scope = rememberCoroutineScope()
    var rel by remember { mutableStateOf(u.optString("relation")) }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(u, 44.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(u.name(), fontWeight = FontWeight.Medium)
            Text(u.uid(), color = Muted, fontSize = 12.sp)
        }
        if (trailing != null) trailing()
        else if (rel != "self" && rel != "friends") {
            Text(
                if (rel == "outgoing") "Requested" else "Add",
                color = Accent,
                fontWeight = FontWeight.Medium,
                modifier =
                    Modifier.clickable {
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                runCatching { Api.post("/api/friend-requests", JSONObject().put("userId", u.userId())) }
                            }
                            rel = "outgoing"
                        }
                    }.padding(8.dp),
            )
        }
    }
}

@Composable
fun PostCard(post: JSONObject, onUser: () -> Unit) {
    val author = post.optJSONObject("author") ?: JSONObject()
    val scope = rememberCoroutineScope()
    var liked by remember { mutableStateOf(post.optBoolean("liked")) }
    var likes by remember { mutableStateOf(post.optInt("likeCount")) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).background(Surface, RoundedCornerShape(14.dp)).padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(onClick = onUser)) {
            Avatar(author, 36.dp)
            Spacer(Modifier.width(8.dp))
            Column {
                Text(author.name(), fontWeight = FontWeight.SemiBold)
                Text(post.optString("createdAt").take(16), color = Muted, fontSize = 11.sp)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(post.optString("body"), fontSize = 15.sp)
        Spacer(Modifier.height(10.dp))
        Row {
            Row(
                Modifier.clickable {
                    liked = !liked
                    likes += if (liked) 1 else -1
                    scope.launch(Dispatchers.IO) {
                        runCatching { Api.post("/api/posts/${post.optString("id")}/like") }
                    }
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.FavoriteBorder, null, tint = if (liked) Rose else Muted)
                Spacer(Modifier.width(4.dp))
                Text("$likes", color = Muted, fontSize = 13.sp)
            }
            Spacer(Modifier.width(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.ChatBubbleOutline, null, tint = Muted)
                Spacer(Modifier.width(4.dp))
                Text("${post.optInt("commentCount")}", color = Muted, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun ComposePostScreen(session: Session, done: () -> Unit) {
    var body by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            CloseIcon(done)
            Text("New post", fontWeight = FontWeight.SemiBold)
            Text(
                "Share",
                color = Accent,
                fontWeight = FontWeight.SemiBold,
                modifier =
                    Modifier.clickable {
                        scope.launch {
                            withContext(Dispatchers.IO) {
                                runCatching { Api.post("/api/posts", JSONObject().put("body", body)) }
                            }
                            done()
                        }
                    }.padding(8.dp),
            )
        }
        OutlinedTextField(value = body, onValueChange = { body = it }, modifier = Modifier.fillMaxWidth().weight(1f), placeholder = { Text("What's on your mind?") })
    }
}
