package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.Celebration
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Star
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.LottieConstants
import com.airbnb.lottie.compose.rememberLottieComposition

/**
 * WhatsApp-style emoji panel — v203
 * - Top bar: search icon | [emoji | GIF | sticker] pill | backspace icon
 * - Content: Recents header + Smileys & People header, 8-column grid
 * - Bottom bar: category icons (clock, smiley, heart, paw, food, ball, etc) instead of text chips
 * - GIF tab middle, sticker tab right, positions match WhatsApp reference
 * - Composer outer transparent (handled in ChatScreen.kt)
 */
@Composable
fun StickerPanel(
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(0) } // 0 emoji, 1 GIF, 2 sticker
    var query by remember { mutableStateOf("") }
    var isSearchActive by remember { mutableStateOf(false) }
    var selectedCategory by remember { mutableStateOf(0) } // 0 recents, 1 smileys, 2 hearts, 3 animals, 4 food, 5 fun
    var recents by remember { mutableStateOf(listOf<String>()) }
    val searchFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }
    LaunchedEffect(isSearchActive) {
        if (isSearchActive) {
            try { searchFocus.requestFocus() } catch (_: Exception) {}
        }
    }

    val searching = imeShowing()

    Column(
        Modifier
            .fillMaxWidth()
            .background(Card)
            .imePadding()
            .padding(top = 6.dp, bottom = 2.dp),
    ) {
        // ---- TOP BAR: WhatsApp style ----
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isSearchActive) {
                // Search mode: back + text field + clear
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(20.dp))
                        .background(ChipIdle)
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Search, "Search", tint = Muted, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        BasicTextField(
                            value = query,
                            onValueChange = { query = it },
                            singleLine = true,
                            textStyle = TextStyle(color = Ink, fontSize = 14.sp),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(searchFocus),
                            decorationBox = { inner ->
                                Box {
                                    if (query.isEmpty()) Text("Search emoji", color = Muted.copy(alpha = 0.7f), fontSize = 14.sp)
                                    inner()
                                }
                            },
                        )
                        if (query.isNotEmpty()) {
                            Icon(
                                Icons.Filled.Backspace,
                                "Clear",
                                tint = Muted,
                                modifier = Modifier
                                    .size(18.dp)
                                    .clickable { query = "" },
                            )
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .clickable {
                            isSearchActive = false
                            query = ""
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✕", color = Muted, fontSize = 16.sp)
                }
            } else {
                // Normal mode: search icon | centered pill tabs | delete icon
                Icon(
                    Icons.Filled.Search,
                    contentDescription = "Search",
                    tint = Muted,
                    modifier = Modifier
                        .size(22.dp)
                        .clickable {
                            haptics.tap()
                            isSearchActive = true
                        },
                )
                Spacer(Modifier.width(12.dp))
                // Center pill: emoji | GIF | sticker - matches WhatsApp reference
                Row(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(20.dp))
                        .background(ChipIdle)
                        .padding(2.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // Emoji tab
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (tab == 0) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                tab = 0
                            }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            Icons.Filled.Mood,
                            "Emoji",
                            tint = if (tab == 0) ActionBlueDeep else Muted,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    // GIF tab - middle position like WhatsApp
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (tab == 1) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                tab = 1
                            }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "GIF",
                            color = if (tab == 1) ActionBlueDeep else Muted,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    // Sticker tab - right position like WhatsApp
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (tab == 2) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                tab = 2
                            }
                            .padding(vertical = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        // Sticker icon: square with folded corner mimic
                        Text(
                            "▭",
                            color = if (tab == 2) ActionBlueDeep else Muted,
                            fontSize = 18.sp,
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Icon(
                    Icons.Filled.Backspace,
                    contentDescription = "Delete",
                    tint = Muted,
                    modifier = Modifier
                        .size(22.dp)
                        .clickable {
                            haptics.tap()
                            if (query.isNotEmpty()) {
                                query = query.dropLast(1)
                            } else if (isSearchActive) {
                                isSearchActive = false
                            }
                        },
                )
            }
        }

        val matches = stickerMatches(query, selectedCategory.coerceAtLeast(1) - 1)

        if (searching && isSearchActive) {
            // Compact strip when keyboard visible during search
            val strip = if (query.isBlank()) (recents + matches).distinct() else matches
            LazyRow(
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.fillMaxWidth().height(44.dp),
            ) {
                items(strip.size) { i ->
                    val sticker = strip[i]
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box(
                        Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (pressed) ChipIdle else Color.Transparent)
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.confirm()
                                saveStickerRecent(sticker)
                                onSend(sticker)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(sticker, fontSize = 22.sp, modifier = Modifier.scale(if (pressed) 1.25f else 1f))
                    }
                }
            }
        } else if (tab == 0) {
            // ---- EMOJI TAB: WhatsApp style 8-column grid with headers ----
            if (isSearchActive && query.isNotBlank()) {
                // Search results 8-col
                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    modifier = Modifier.fillMaxWidth().height(280.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    items(matches.distinct()) { sticker ->
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(42.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (pressed) ChipIdle else Color.Transparent)
                                .clickable(interactionSource = interaction, indication = null) {
                                    haptics.confirm()
                                    saveStickerRecent(sticker)
                                    onSend(sticker)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(sticker, fontSize = 24.sp, modifier = Modifier.scale(if (pressed) 1.25f else 1f))
                        }
                    }
                }
            } else if (selectedCategory == 0) {
                // Recents + all categories like WhatsApp when clock selected
                val allSections = mutableListOf<Pair<String, List<String>>>()
                if (recents.isNotEmpty()) allSections.add("Recents" to recents.take(16))
                // Map packs to WhatsApp titles
                val titles = listOf("Smileys & People", "Animals & Nature", "Food & Drink", "Activity", "Travel & Places")
                // Our packs: 0 Smileys, 1 Hearts, 2 Animals, 3 Food, 4 Fun
                // For WhatsApp look, we show Smileys as Smileys & People, then others
                allSections.add("Smileys & People" to Stickers.packs[0].second)
                allSections.add("Animals & Nature" to Stickers.packs[2].second)
                allSections.add("Food & Drink" to Stickers.packs[3].second)
                allSections.add("Activity" to Stickers.packs[4].second)
                allSections.add("Symbols" to Stickers.packs[1].second)

                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    modifier = Modifier.fillMaxWidth().height(300.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    allSections.forEach { (title, emojis) ->
                        item(span = { GridItemSpan(8) }) {
                            Text(
                                title,
                                color = Muted,
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                            )
                        }
                        items(emojis.distinct()) { sticker ->
                            val interaction = remember { MutableInteractionSource() }
                            val pressed by interaction.collectIsPressedAsState()
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(42.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (pressed) ChipIdle else Color.Transparent)
                                    .clickable(interactionSource = interaction, indication = null) {
                                        haptics.confirm()
                                        saveStickerRecent(sticker)
                                        onSend(sticker)
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(sticker, fontSize = 24.sp, modifier = Modifier.scale(if (pressed) 1.25f else 1f))
                            }
                        }
                    }
                }
            } else {
                // Single category selected via bottom bar
                val packIndex = (selectedCategory - 1).coerceIn(0, Stickers.packs.size - 1)
                val pack = Stickers.packs[packIndex]
                val titleMap = listOf("Smileys & People", "Symbols", "Animals & Nature", "Food & Drink", "Activity")
                val displayTitle = titleMap.getOrElse(packIndex) { pack.first }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    modifier = Modifier.fillMaxWidth().height(300.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    item(span = { GridItemSpan(8) }) {
                        Text(
                            displayTitle,
                            color = Muted,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                        )
                    }
                    items(pack.second.distinct()) { sticker ->
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(42.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (pressed) ChipIdle else Color.Transparent)
                                .clickable(interactionSource = interaction, indication = null) {
                                    haptics.confirm()
                                    saveStickerRecent(sticker)
                                    onSend(sticker)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(sticker, fontSize = 24.sp, modifier = Modifier.scale(if (pressed) 1.25f else 1f))
                        }
                    }
                }
            }
        } else if (tab == 1) {
            // ---- GIF TAB: middle position like WhatsApp ----
            val gifList = remember { GifRepo.gifs }
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier.fillMaxWidth().height(300.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(gifList.size) { idx ->
                    val item = gifList[idx]
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    val isBundled = remember(item.codepoint) { NotoBundled.isBundled(item.codepoint) }
                    val spec = remember(item.codepoint, isBundled) {
                        if (isBundled) LottieCompositionSpec.Asset(GifRepo.lottieAssetPath(item.codepoint))
                        else LottieCompositionSpec.Url(GifRepo.lottieUrl(item.codepoint))
                    }
                    val composition by rememberLottieComposition(spec)
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(70.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (pressed) ChipIdle else Color(0xFF1A1A1A))
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.confirm()
                                saveStickerRecent(item.emoji)
                                onSend(item.emoji)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (composition != null) {
                            LottieAnimation(
                                composition = composition,
                                iterations = LottieConstants.IterateForever,
                                modifier = Modifier.size(48.dp).scale(if (pressed) 1.2f else 1f),
                            )
                        } else {
                            Text(item.emoji, fontSize = 28.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                        }
                    }
                }
            }
        } else {
            // ---- STICKER TAB: right position like WhatsApp ----
            Column(
                Modifier.fillMaxWidth().height(300.dp).padding(16.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Stickers", color = Ink, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(8.dp))
                Text("Send emojis as stickers", color = Muted, fontSize = 13.sp)
                Spacer(Modifier.height(16.dp))
                LazyVerticalGrid(
                    columns = GridCells.Fixed(4),
                    contentPadding = PaddingValues(4.dp),
                    modifier = Modifier.fillMaxWidth().height(200.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val stickerEmojis = Stickers.packs.flatMap { it.second }.take(20)
                    items(stickerEmojis.distinct()) { sticker ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(56.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(ChipIdle)
                                .clickable {
                                    haptics.confirm()
                                    saveStickerRecent(sticker)
                                    onSend(sticker)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(sticker, fontSize = 28.sp)
                        }
                    }
                }
            }
        }

        if (!searching || !isSearchActive) {
            // ---- BOTTOM CATEGORY BAR: WhatsApp style icon bar, no text chips ----
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp, vertical = 4.dp)
                    .background(Color.Transparent),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                // Category icons matching WhatsApp reference bottom bar
                val categories = listOf(
                    Triple(0, Icons.Filled.Schedule, "Recents"),
                    Triple(1, Icons.Filled.Mood, "Smileys"),
                    Triple(2, Icons.Filled.Pets, "Animals"),
                    Triple(3, Icons.Filled.Restaurant, "Food"),
                    Triple(4, Icons.Filled.SportsSoccer, "Activity"),
                    Triple(5, Icons.Filled.Flight, "Travel"),
                    Triple(6, Icons.Filled.Lightbulb, "Objects"),
                    Triple(7, Icons.Filled.Flag, "Flags"),
                )
                // Show first 6 + scroll for rest? WhatsApp shows 9 with scroll. We'll show 6 main + 2 extra in row
                // For our 5 packs + recents, map 0..5
                val visibleCats = categories.take(8)
                visibleCats.forEach { (idx, icon, desc) ->
                    val sel = selectedCategory == idx && tab == 0
                    Box(
                        Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .background(if (sel) Color(0x33FFFFFF) else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                if (tab != 0) tab = 0
                                selectedCategory = idx
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            icon,
                            contentDescription = desc,
                            tint = if (sel) Color.White else Muted,
                            modifier = Modifier.size(if (sel) 22.dp else 20.dp),
                        )
                    }
                }
            }
        }
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
