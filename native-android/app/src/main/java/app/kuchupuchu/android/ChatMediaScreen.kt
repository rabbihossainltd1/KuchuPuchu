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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable
fun ChatMediaScreen(nav: NavController, convId: String) {
    var tab by remember { mutableIntStateOf(0) }
    var images by remember { mutableStateOf(listOf<JSONObject>()) }
    var docs by remember { mutableStateOf(listOf<JSONObject>()) }
    var links by remember { mutableStateOf(listOf<JSONObject>()) }
    val uri = LocalUriHandler.current

    LaunchedEffect(convId) {
        runCatching {
            val data = withContext(Dispatchers.IO) { Api.get("/api/conversations/$convId/media", true) }
            images = data.arr("images").objects()
            docs = data.arr("docs").objects()
            links = data.arr("links").objects()
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
            Text("Media, links, and docs", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Ink)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
            listOf("Media", "Docs", "Links").forEachIndexed { i, label ->
                val on = tab == i
                Text(
                    label,
                    modifier = Modifier
                        .padding(end = 8.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (on) GoldSoft else Card)
                        .clickable { tab = i }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    color = if (on) GoldDeep else Muted,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        when (tab) {
            0 -> {
                if (images.isEmpty()) {
                    EmptyState(Icons.Filled.InsertDriveFile, "No photos", "Photos sent in this chat show up here")
                } else {
                    // weight(1f) bounds the grid to the space below the tabs —
                    // unconstrained, the last rows could run past the bottom.
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(images, key = { it.optString("id") }) { m ->
                            val url = m.optString("mediaUrl").ifBlank {
                                val key = m.optString("fileKey")
                                if (key.isNotBlank()) "/api/files/$key" else ""
                            }
                            Box(
                                Modifier
                                    .height(110.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Line),
                            ) {
                                if (url.isNotBlank()) {
                                    KpNetImage(
                                        url,
                                        "Photo",
                                        Modifier.fillMaxSize(),
                                        androidx.compose.ui.layout.ContentScale.Crop,
                                    )
                                }
                            }
                        }
                    }
                }
            }
            1 -> LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (docs.isEmpty()) {
                    item { Text("No documents yet.", color = Muted, modifier = Modifier.padding(16.dp)) }
                }
                items(docs, key = { it.optString("id") }) { m ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.InsertDriveFile, null, tint = GoldDeep, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.size(10.dp))
                        Column {
                            Text(m.optString("fileName").ifBlank { "File" }, fontWeight = FontWeight.Medium, color = Ink)
                            Text(msgTime(m.optString("createdAt")), fontSize = 12.sp, color = Muted)
                        }
                    }
                }
            }
            else -> LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (links.isEmpty()) {
                    item { Text("No links yet.", color = Muted, modifier = Modifier.padding(16.dp)) }
                }
                items(links, key = { it.optString("id") }) { m ->
                    val body = m.optString("body")
                    val found = Regex("https?://\\S+").find(body)?.value ?: body
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(Card)
                            .clickable { runCatching { uri.openUri(found) } }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Link, null, tint = GoldDeep)
                        Spacer(Modifier.size(10.dp))
                        Text(found, color = Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

private fun msgTime(iso: String) = listStamp(iso)
