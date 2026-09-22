package app.kuchupuchu.android

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.LottieConstants
import com.airbnb.lottie.compose.rememberLottieComposition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * v205 - owner feedback from screenshot 2026-09-22 15:11
 * - RED: bottom category system removed entirely
 * - BLUE: top tab pill made thin (32dp bar, 28dp pill, 16dp icons, 3dp vertical padding) per inner buttons
 * - GREEN: sticker tab icon was Text("▭") blank rectangle -> fixed to Star icon (was not loading)
 * - Swipe tab switch now smooth via AnimatedContent slide
 * - GIFs: old Lottie GIFs were actually stickers -> moved to sticker tab; GIF tab now uses Tenor real GIFs via network (no app size increase)
 * - Search button now working for all tabs (emoji/gif/sticker)
 * - Emoji animate after sent, not during sending (ChatScreen fix)
 */
@Composable
fun StickerPanel(
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
    onInsert: ((String) -> Unit)? = null,
) {
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(0) } // 0 emoji, 1 GIF, 2 sticker
    var query by remember { mutableStateOf("") }
    var recents by remember { mutableStateOf(listOf<String>()) }
    val searchFocus = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    var showSearchInput by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    val searching = imeShowing()

    // When IME shows, we are in search mode - show the 44dp strip
    // Also show search input if active
    LaunchedEffect(searching) {
        if (!searching && query.isBlank()) {
            showSearchInput = false
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(Card)
            .imePadding()
            .padding(top = 2.dp, bottom = 0.dp)
            .pointerInput(tab) {
                var drag = 0f
                var dir = 0
                detectHorizontalDragGestures(
                    onDragStart = { drag = 0f; dir = 0 },
                    onHorizontalDrag = { _, amount ->
                        drag += amount
                        if (dir == 0) {
                            dir = if (amount < 0) -1 else 1
                        }
                    },
                    onDragEnd = {
                        if (drag < -80) {
                            tab = (tab + 1) % 3
                            haptics.tap()
                        } else if (drag > 80) {
                            tab = if (tab - 1 < 0) 2 else tab - 1
                            haptics.tap()
                        }
                    },
                )
            },
    ) {
        // ---- THIN TOP BAR (BLUE fix) ----
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 2.dp)
                .height(32.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = "Search",
                tint = Muted,
                modifier = Modifier
                    .size(18.dp)
                    .clickable {
                        haptics.tap()
                        showSearchInput = true
                        try {
                            searchFocus.requestFocus()
                            keyboardController?.show()
                        } catch (_: Exception) {}
                    },
            )
            Spacer(Modifier.width(6.dp))
            Row(
                Modifier
                    .weight(1f)
                    .height(28.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(ChipIdle)
                    .padding(1.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (tab == 0) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 0 }
                        .padding(vertical = 3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Mood, "Emoji", tint = if (tab == 0) ActionBlueDeep else Muted, modifier = Modifier.size(16.dp))
                }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (tab == 1) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 1 }
                        .padding(vertical = 3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("GIF", color = if (tab == 1) ActionBlueDeep else Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (tab == 2) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 2 }
                        .padding(vertical = 3.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    // GREEN fix: was Text("▭") blank rectangle not loading -> now Star icon
                    Icon(Icons.Filled.Star, "Sticker", tint = if (tab == 2) ActionBlueDeep else Muted, modifier = Modifier.size(16.dp))
                }
            }
            Spacer(Modifier.width(6.dp))
            Icon(
                Icons.Filled.Backspace,
                contentDescription = "Delete",
                tint = Muted,
                modifier = Modifier
                    .size(18.dp)
                    .clickable {
                        haptics.tap()
                        if (query.isNotEmpty()) query = query.dropLast(1)
                        else {
                            showSearchInput = false
                            keyboardController?.hide()
                        }
                    },
            )
        }

        // Search input field - shown when active or query present
        if (showSearchInput || query.isNotBlank() || searching) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 6.dp, vertical = 2.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(ChipIdle)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TextStyle(color = Ink, fontSize = 12.sp),
                        modifier = Modifier.weight(1f).focusRequester(searchFocus),
                        decorationBox = { inner ->
                            Box {
                                if (query.isEmpty()) Text("Search emoji, GIF, sticker", color = Muted.copy(alpha = 0.7f), fontSize = 12.sp)
                                inner()
                            }
                        },
                    )
                    if (query.isNotEmpty()) {
                        Text("✕", color = Muted, fontSize = 11.sp, modifier = Modifier.clickable { query = ""; showSearchInput = false; keyboardController?.hide() }.padding(start = 6.dp))
                    }
                }
            }
        }

        val matches = stickerMatches(query, 0)

        if (searching) {
            // Compact search strip when keyboard up - 44dp LazyRow
            val strip = if (query.isBlank()) (recents + matches).distinct().take(30) else matches.take(30)
            LazyRow(
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 1.dp),
                horizontalArrangement = Arrangement.spacedBy(1.dp),
                modifier = Modifier.fillMaxWidth().height(44.dp),
            ) {
                items(strip.size) { i ->
                    val sticker = strip[i]
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (pressed) ChipIdle else Color.Transparent)
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.tap()
                                saveStickerRecent(sticker)
                                if (onInsert != null) onInsert(sticker) else onSend(sticker)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(sticker, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                    }
                }
            }
        } else {
            // Smooth tab switch animation
            AnimatedContent(
                targetState = tab,
                transitionSpec = {
                    val dir = if (targetState > initialState) 1 else -1
                    slideInHorizontally(animationSpec = tween(250), initialOffsetX = { it * dir }) togetherWith
                            slideOutHorizontally(animationSpec = tween(250), targetOffsetX = { -it * dir })
                },
                label = "stickerTab",
            ) { currentTab ->
                when (currentTab) {
                    0 -> EmojiGrid(query = query, recents = recents, onInsert = onInsert, onSend = onSend)
                    1 -> TenorGifGrid(query = query, onInsert = onInsert, onSend = onSend)
                    else -> StickerGrid(query = query, onInsert = onInsert, onSend = onSend)
                }
            }
        }
    }
}

@Composable
private fun EmojiGrid(query: String, recents: List<String>, onInsert: ((String) -> Unit)?, onSend: (String) -> Unit) {
    val haptics = rememberHaptics()
    if (query.isNotBlank()) {
        val matches = stickerMatches(query, 0)
        LazyVerticalGrid(
            columns = GridCells.Fixed(8),
            contentPadding = PaddingValues(horizontal = 2.dp, vertical = 1.dp),
            modifier = Modifier.fillMaxWidth().height(220.dp),
            horizontalArrangement = Arrangement.spacedBy(1.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            items(matches.distinct()) { sticker ->
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Box(
                    Modifier.fillMaxWidth().height(36.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (pressed) ChipIdle else Color.Transparent)
                        .clickable(interactionSource = interaction, indication = null) {
                            haptics.tap()
                            saveStickerRecent(sticker)
                            if (onInsert != null) onInsert(sticker) else onSend(sticker)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(sticker, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                }
            }
        }
    } else {
        val allEmojis = Stickers.packs.flatMap { it.second }.distinct()
        val display = if (recents.isNotEmpty()) (recents.take(16) + allEmojis).distinct().take(160) else allEmojis.take(160)
        LazyVerticalGrid(
            columns = GridCells.Fixed(8),
            contentPadding = PaddingValues(horizontal = 2.dp, vertical = 1.dp),
            modifier = Modifier.fillMaxWidth().height(220.dp),
            horizontalArrangement = Arrangement.spacedBy(1.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            items(display) { sticker ->
                val interaction = remember { MutableInteractionSource() }
                val pressed by interaction.collectIsPressedAsState()
                Box(
                    Modifier.fillMaxWidth().height(36.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (pressed) ChipIdle else Color.Transparent)
                        .clickable(interactionSource = interaction, indication = null) {
                            haptics.tap()
                            saveStickerRecent(sticker)
                            if (onInsert != null) onInsert(sticker) else onSend(sticker)
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(sticker, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                }
            }
        }
    }
}

@Composable
private fun StickerGrid(query: String, onInsert: ((String) -> Unit)?, onSend: (String) -> Unit) {
    val haptics = rememberHaptics()
    // Old Lottie GIFs are actually stickers -> move to sticker tab per owner
    val lottieStickers = remember { GifRepo.gifs }
    val allStickers = remember(query) {
        val base = lottieStickers.map { it.emoji }.distinct()
        val emojiStickers = Stickers.packs.flatMap { it.second }.take(32).distinct()
        val combined = (base + emojiStickers).distinct()
        if (query.isBlank()) combined
        else combined.filter { it.contains(query, ignoreCase = true) || Stickers.packs.any { p -> p.first.contains(query, ignoreCase = true) && p.second.contains(it) } }.take(60)
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
        modifier = Modifier.fillMaxWidth().height(220.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(allStickers.size) { idx ->
            val sticker = allStickers[idx]
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            // Try to find if this sticker has Lottie
            val gifItem = lottieStickers.find { it.emoji == sticker }
            Box(
                Modifier.fillMaxWidth().height(52.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (pressed) ChipSelected else ChipIdle)
                    .clickable(interactionSource = interaction, indication = null) {
                        haptics.tap()
                        saveStickerRecent(sticker)
                        if (onInsert != null) onInsert(sticker) else onSend(sticker)
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (gifItem != null) {
                    val isBundled = remember(gifItem.codepoint) { NotoBundled.isBundled(gifItem.codepoint) }
                    val spec = remember(gifItem.codepoint, isBundled) {
                        if (isBundled) LottieCompositionSpec.Asset(GifRepo.lottieAssetPath(gifItem.codepoint))
                        else LottieCompositionSpec.Url(GifRepo.lottieUrl(gifItem.codepoint))
                    }
                    val composition by rememberLottieComposition(spec)
                    if (composition != null) {
                        LottieAnimation(composition = composition, iterations = LottieConstants.IterateForever, modifier = Modifier.size(36.dp).scale(if (pressed) 1.15f else 1f))
                    } else {
                        Text(sticker, fontSize = 26.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                    }
                } else {
                    Text(sticker, fontSize = 26.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                }
            }
        }
    }
}

data class TenorGifItem(val id: String, val url: String, val preview: String)

@Composable
private fun TenorGifGrid(query: String, onInsert: ((String) -> Unit)?, onSend: (String) -> Unit) {
    val haptics = rememberHaptics()
    var gifs by remember { mutableStateOf<List<TenorGifItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    // Fetch trending or search
    LaunchedEffect(query) {
        loading = true
        error = null
        try {
            val fetched = withContext(Dispatchers.IO) {
                fetchTenorGifs(if (query.isBlank()) null else query)
            }
            gifs = fetched
        } catch (e: Exception) {
            error = e.message
            // Fallback to empty, keep loading false
            gifs = emptyList()
        } finally {
            loading = false
        }
    }

    if (loading) {
        Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
            Text("Loading GIFs...", color = Muted, fontSize = 12.sp)
        }
        return
    }

    if (gifs.isEmpty()) {
        Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (error != null) "No GIFs found" else "Search GIFs on Tenor", color = Muted, fontSize = 12.sp)
                if (query.isBlank()) {
                    Text("Type to search", color = Muted.copy(alpha = 0.7f), fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
        return
    }

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
        modifier = Modifier.fillMaxWidth().height(220.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items(gifs.size) { idx ->
            val item = gifs[idx]
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier.fillMaxWidth().height(70.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (pressed) ChipIdle else Color(0xFF1A1A1A))
                    .clickable(interactionSource = interaction, indication = null) {
                        haptics.tap()
                        // GIFs are sent as URL? For now send as sticker emoji placeholder but with URL
                        // We send the URL as FILE kind? For simplicity, send as TEXT with URL, or as STICKER with URL
                        // Owner wants real GIFs, not stickers - so we send as GIF kind via onSend
                        // Using onInsert for composer? GIFs should insert as URL? We'll send directly as file-like
                        // For now, use onSend with URL - ChatScreen will handle as FILE? Actually we send as TEXT with URL
                        // Better: send the GIF URL as a message that will be rendered as image
                        if (onInsert != null) onInsert(item.url) else onSend(item.url)
                    },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(
                    model = item.preview.ifBlank { item.url },
                    contentDescription = "GIF",
                    modifier = Modifier.fillMaxWidth().height(70.dp).clip(RoundedCornerShape(8.dp)).scale(if (pressed) 1.05f else 1f),
                )
            }
        }
    }
}

private fun fetchTenorGifs(search: String?): List<TenorGifItem> {
    return try {
        val client = okhttp3.OkHttpClient.Builder().callTimeout(10, java.util.concurrent.TimeUnit.SECONDS).build()
        // Using Tenor v2 demo key - public, no app size increase
        val apiKey = "AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ"
        val clientKey = "kuchupuchu"
        val url = if (search.isNullOrBlank()) {
            "https://tenor.googleapis.com/v2/trending?key=$apiKey&client_key=$clientKey&limit=24&media_filter=gif,tinygif"
        } else {
            val enc = java.net.URLEncoder.encode(search, "UTF-8")
            "https://tenor.googleapis.com/v2/search?q=$enc&key=$apiKey&client_key=$clientKey&limit=24&media_filter=gif,tinygif"
        }
        val req = okhttp3.Request.Builder().url(url).get().build()
        val resp = client.newCall(req).execute()
        if (!resp.isSuccessful) return emptyList()
        val body = resp.body?.string() ?: return emptyList()
        val json = JSONObject(body)
        val results = json.optJSONArray("results") ?: return emptyList()
        val out = mutableListOf<TenorGifItem>()
        for (i in 0 until results.length()) {
            val obj = results.optJSONObject(i) ?: continue
            val id = obj.optString("id", "")
            val media = obj.optJSONObject("media_formats") ?: continue
            val gifObj = media.optJSONObject("gif") ?: media.optJSONObject("tinygif") ?: media.optJSONObject("mediumgif") ?: continue
            val gifUrl = gifObj.optString("url", "")
            val previewObj = media.optJSONObject("tinygif") ?: gifObj
            val previewUrl = previewObj.optString("url", gifUrl)
            if (gifUrl.isNotBlank()) {
                out.add(TenorGifItem(id = id, url = gifUrl, preview = previewUrl))
            }
        }
        out
    } catch (_: Exception) {
        emptyList()
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun imeShowing(): Boolean = WindowInsets.isImeVisible

private fun stickerMatches(query: String, pack: Int): List<String> {
    val q = query.trim()
    if (q.isBlank()) return Stickers.packs.getOrNull(pack)?.second ?: Stickers.packs[0].second
    val byName = Stickers.packs.filter { it.first.contains(q, ignoreCase = true) }.flatMap { it.second }
    val byGlyph = Stickers.packs.asSequence().flatMap { it.second }.filter { it.contains(q) }.toList()
    // Also search by emoji name via simple mapping? For now name + glyph
    return (byName + byGlyph).distinct().take(60)
}

private fun loadStickerRecents(): List<String> =
    runCatching {
        val ctx = MainActivity.current ?: return emptyList()
        val prefs = ctx.getSharedPreferences("kp", 0)
        val raw = prefs.getString("sticker_recents", null) ?: return emptyList()
        val arr = org.json.JSONArray(raw)
        (0 until arr.length()).map { arr.optString(it) }
    }.getOrDefault(emptyList())

private fun saveStickerRecent(sticker: String) {
    runCatching {
        val ctx = MainActivity.current ?: return
        val prefs = ctx.getSharedPreferences("kp", 0)
        val current = ArrayDeque(loadStickerRecents())
        current.remove(sticker)
        current.addFirst(sticker)
        while (current.size > 8) current.removeLast()
        prefs.edit().putString("sticker_recents", org.json.JSONArray(current.toList()).toString()).apply()
    }
}

object Stickers {
    val packs = listOf(
        "Smileys" to listOf(
            "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
            "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙",
            "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏",
            "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", "😫", "😩",
            "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵",
            "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫",
            "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮",
        ),
        "Hearts" to listOf(
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
            "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "✨",
            "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💬", "👁️‍🗨️", "🗨️",
        ),
        "Animals" to listOf(
            "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
            "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦉",
            "🦄", "🐝", "🦋", "🐌", "🐞", "🐢", "🐍", "🐙", "🦑", "🦐",
            "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅",
        ),
        "Food" to listOf(
            "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
            "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍔", "🍟",
            "🍕", "🌭", "🥪", "🌮", "🍜", "🍛", "🍣", "🍩", "🍪", "🎂",
            "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮", "🍯", "🍼", "☕",
        ),
        "Fun" to listOf(
            "⚽", "🏀", "🏐", "🏏", "🎯", "🎮", "🎲", "🎸", "🎤", "🎬",
            "🚀", "🛸", "⭐", "🌟", "💫", "🔥", "💧", "🎉", "🎊", "🎈",
            "🎁", "🏆", "🥇", "👑", "💎", "💯", "👍", "👏", "🙏", "💪",
            "🎨", "🎭", "🎪", "🎢", "🎡", "🎠", "🏖️", "🏝️", "🏜️", "🌋",
        ),
    )
}
