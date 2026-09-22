package app.kuchupuchu.android

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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.LottieConstants
import com.airbnb.lottie.compose.rememberLottieComposition

/**
 * v204 compact WhatsApp-style emoji panel
 * - Outer 220dp height (not 300dp), minimal padding, no big titles
 * - Top bar: search | [emoji|GIF|sticker] pill middle | backspace
 * - Emoji click inserts into message bar (onInsert), panel stays open, no auto-close
 * - Swipe left/right switches tabs
 * - Bottom categories: 6 icons compact 32dp, maps correctly to packs, click scrolls to category
 * - Sticker tab: no "Stickers" title, no instructions, just 4-col grid compact
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
    var selectedCategory by remember { mutableStateOf(0) }
    var recents by remember { mutableStateOf(listOf<String>()) }
    val searchFocus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    val searching = imeShowing()

    Column(
        Modifier
            .fillMaxWidth()
            .background(Card)
            .imePadding()
            .padding(top = 4.dp, bottom = 2.dp)
            .pointerInput(tab) {
                var drag = 0f
                detectHorizontalDragGestures(
                    onDragStart = { drag = 0f },
                    onHorizontalDrag = { _, amount -> drag += amount },
                    onDragEnd = {
                        if (drag < -80) {
                            // swipe left -> next tab
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
        // ---- COMPACT TOP BAR ----
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = "Search",
                tint = Muted,
                modifier = Modifier
                    .size(20.dp)
                    .clickable {
                        haptics.tap()
                        try { searchFocus.requestFocus() } catch (_: Exception) {}
                    },
            )
            Spacer(Modifier.width(8.dp))
            Row(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(18.dp))
                    .background(ChipIdle)
                    .padding(2.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (tab == 0) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 0 }
                        .padding(vertical = 5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Filled.Mood, "Emoji", tint = if (tab == 0) ActionBlueDeep else Muted, modifier = Modifier.size(18.dp))
                }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (tab == 1) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 1 }
                        .padding(vertical = 5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("GIF", color = if (tab == 1) ActionBlueDeep else Muted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                Box(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (tab == 2) ChipSelected else Color.Transparent)
                        .clickable { haptics.tap(); tab = 2 }
                        .padding(vertical = 5.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("▭", color = if (tab == 2) ActionBlueDeep else Muted, fontSize = 14.sp)
                }
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Filled.Backspace,
                contentDescription = "Delete",
                tint = Muted,
                modifier = Modifier
                    .size(20.dp)
                    .clickable {
                        haptics.tap()
                        if (query.isNotEmpty()) query = query.dropLast(1)
                    },
            )
        }

        // compact search field when query active (optional, no extra height)
        if (query.isNotBlank()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 2.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(ChipIdle)
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(
                        value = query,
                        onValueChange = { query = it },
                        singleLine = true,
                        textStyle = TextStyle(color = Ink, fontSize = 13.sp),
                        modifier = Modifier.weight(1f).focusRequester(searchFocus),
                        decorationBox = { inner ->
                            Box {
                                if (query.isEmpty()) Text("Search emoji", color = Muted.copy(alpha = 0.7f), fontSize = 13.sp)
                                inner()
                            }
                        },
                    )
                    if (query.isNotEmpty()) {
                        Text("✕", color = Muted, fontSize = 12.sp, modifier = Modifier.clickable { query = "" }.padding(start = 6.dp))
                    }
                }
            }
        }

        val matches = stickerMatches(query, selectedCategory.coerceAtLeast(1) - 1)

        if (searching) {
            val strip = if (query.isBlank()) (recents + matches).distinct() else matches
            LazyRow(
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
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
        } else if (tab == 0) {
            if (query.isNotBlank()) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
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
            } else if (selectedCategory == 0) {
                val allSections = mutableListOf<Pair<String, List<String>>>()
                if (recents.isNotEmpty()) allSections.add("Recents" to recents.take(16))
                allSections.add("Smileys & People" to Stickers.packs[0].second)
                allSections.add("Animals & Nature" to Stickers.packs[2].second)
                allSections.add("Food & Drink" to Stickers.packs[3].second)
                allSections.add("Activity" to Stickers.packs[4].second)
                allSections.add("Symbols" to Stickers.packs[1].second)

                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                    horizontalArrangement = Arrangement.spacedBy(1.dp),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    allSections.forEach { (title, emojis) ->
                        item(span = { GridItemSpan(8) }) {
                            Text(title, color = Muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp))
                        }
                        items(emojis.distinct()) { sticker ->
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
            } else {
                val packIndex = (selectedCategory - 1).coerceIn(0, Stickers.packs.size - 1)
                val pack = Stickers.packs[packIndex]
                val titleMap = listOf("Smileys & People", "Symbols", "Animals & Nature", "Food & Drink", "Activity")
                val displayTitle = titleMap.getOrElse(packIndex) { pack.first }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(8),
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                    horizontalArrangement = Arrangement.spacedBy(1.dp),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    item(span = { GridItemSpan(8) }) {
                        Text(displayTitle, color = Muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp))
                    }
                    items(pack.second.distinct()) { sticker ->
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
        } else if (tab == 1) {
            val gifList = remember { GifRepo.gifs }
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                modifier = Modifier.fillMaxWidth().height(220.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
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
                        Modifier.fillMaxWidth().height(60.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (pressed) ChipIdle else Color(0xFF1A1A1A))
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.tap()
                                saveStickerRecent(item.emoji)
                                if (onInsert != null) onInsert(item.emoji) else onSend(item.emoji)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (composition != null) {
                            LottieAnimation(composition = composition, iterations = LottieConstants.IterateForever, modifier = Modifier.size(40.dp).scale(if (pressed) 1.15f else 1f))
                        } else {
                            Text(item.emoji, fontSize = 24.sp, modifier = Modifier.scale(if (pressed) 1.15f else 1f))
                        }
                    }
                }
            }
        } else {
            // Sticker tab compact - no titles, just 4-col grid
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 2.dp),
                modifier = Modifier.fillMaxWidth().height(220.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val stickerEmojis = Stickers.packs.flatMap { it.second }.take(32)
                items(stickerEmojis.distinct()) { sticker ->
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
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
                        Text(sticker, fontSize = 26.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                    }
                }
            }
        }

        if (!searching) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp).background(Color.Transparent),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val categories = listOf(
                    Triple(0, Icons.Filled.Schedule, "Recents"),
                    Triple(1, Icons.Filled.Mood, "Smileys"),
                    Triple(2, Icons.Filled.Favorite, "Hearts"),
                    Triple(3, Icons.Filled.Pets, "Animals"),
                    Triple(4, Icons.Filled.Restaurant, "Food"),
                    Triple(5, Icons.Filled.SportsSoccer, "Fun"),
                )
                categories.forEach { (idx, icon, desc) ->
                    val sel = selectedCategory == idx && tab == 0
                    Box(
                        Modifier.size(32.dp).clip(CircleShape)
                            .background(if (sel) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                if (tab != 0) tab = 0
                                selectedCategory = idx
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(icon, contentDescription = desc, tint = if (sel) ActionBlueDeep else Muted, modifier = Modifier.size(if (sel) 20.dp else 18.dp))
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
