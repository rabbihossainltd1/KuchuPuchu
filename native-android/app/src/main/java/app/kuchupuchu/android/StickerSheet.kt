package app.kuchupuchu.android

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Sticker panel — INLINE above the chat input bar (WhatsApp-style): search,
 * emoji/GIF/sticker tabs, recents strip, pack chips + 5-column grid, and the
 * bottom pack-indicator row. Tap = send. NO bottom-sheet wrapper, NO drag
 * handle — it is glued to the composer.
 */
@Composable
fun StickerPanel(
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(0) } // 0 emoji-stickers, 1 GIF, 2 sticker-art
    var query by remember { mutableStateOf("") }
    var pack by remember { mutableStateOf(0) }
    var recents by remember { mutableStateOf(listOf<String>()) }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(Cream)
            .padding(top = 6.dp, bottom = 4.dp),
    ) {
        /* top row: search, segmented tabs (emoji | GIF | stickers), edit */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = "Search",
                tint = Color(0x991C1917),
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(color = Color.White, fontSize = 13.sp),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) {
                            Text("Search stickers", color = Color(0x661C1917), fontSize = 13.sp)
                        }
                        inner()
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            /* segmented emoji / GIF / sticker switch */
            Row(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0x141C1917))
                    .padding(2.dp),
            ) {
                listOf("🙂", "GIF", "⬜", "KP").forEachIndexed { i, label ->
                    val sel = tab == i
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (sel) Color(0xFFFEF3C7) else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                tab = i
                            }
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                    ) {
                        Text(
                            label,
                            color = if (sel) GoldDeep else Color(0x991C1917),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                        )
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Filled.Edit,
                contentDescription = "Create",
                tint = Color(0x991C1917),
                modifier = Modifier
                    .size(15.dp)
                    .clickable {
                        android.widget.Toast.makeText(ctx, "Sticker creator is coming in a future update", android.widget.Toast.LENGTH_SHORT).show()
                    },
            )
        }

        if (tab == 0 || tab == 2) {
            /* recents strip */
            if (recents.isNotEmpty()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 1.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    recents.take(6).forEach { s ->
                        Text(
                            s,
                            fontSize = 21.sp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .clickable {
                                    haptics.confirm()
                                    saveStickerRecent(s)
                                    onSend(s)
                                }
                                .padding(3.dp),
                        )
                    }
                    Icon(
                        Icons.Filled.Schedule,
                        contentDescription = "Recents",
                        tint = Color(0x66FFFFFF),
                        modifier = Modifier
                            .align(Alignment.CenterVertically)
                            .size(14.dp),
                    )
                }
            }
            /* pack chips */
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 1.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Stickers.packs.forEachIndexed { i, (name, _) ->
                    val selected = pack == i
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (selected) Color(0xFFFEF3C7) else Color(0x0F1C1917))
                            .clickable {
                                haptics.tap()
                                pack = i
                            }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            name,
                            color = if (selected) GoldDeep else Color(0x991C1917),
                            fontSize = 11.5.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
            val list =
                if (query.isBlank()) {
                    Stickers.packs[pack.coerceIn(0, Stickers.packs.size - 1)].second
                } else {
                    Stickers.packs.asSequence()
                        .flatMap { it.second }
                        .filter { it.contains(query) }
                        .distinct()
                        .take(40)
                        .toList()
                }
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(152.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(list.distinct()) { sticker ->
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(36.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (pressed) Color(0x1A1C1917) else Color.Transparent)
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.confirm()
                                saveStickerRecent(sticker)
                                onSend(sticker)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            sticker,
                            fontSize = 20.sp,
                            modifier = Modifier.scale(if (pressed) 1.25f else 1f),
                        )
                    }
                }
            }
        } else if (tab == 3) {
            /* KP custom emoji: bundled pack, category chips + recents */
            val emojis =
                remember(query) {
                    if (query.isBlank()) EmojiRepo.all(ctx)
                    else EmojiRepo.search(ctx, query)
                }
            val cats = remember { EmojiRepo.categories(ctx) }
            var emojiCat by remember { mutableStateOf("") } // "" = recent/all view
            val emojiRecents = remember { mutableStateOf(EmojiRepo.recent(ctx)) }
            if (emojiRecents.value.isNotEmpty() && emojiCat.isEmpty() && query.isBlank()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 1.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    emojiRecents.value.take(6).forEach { id ->
                        val bmp = rememberEmojiBitmap(id)
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .clickable {
                                    haptics.confirm()
                                    EmojiRepo.recordRecent(ctx, id)
                                    emojiRecents.value = EmojiRepo.recent(ctx)
                                    onSend(id)
                                }
                                .padding(3.dp),
                        ) {
                            if (bmp != null) {
                                Image(bitmap = bmp.asImageBitmap(), contentDescription = id, modifier = Modifier.size(24.dp))
                            } else {
                                Text("🙂", fontSize = 18.sp)
                            }
                        }
                    }
                    Icon(
                        Icons.Filled.Schedule,
                        contentDescription = "Recents",
                        tint = Color(0x66FFFFFF),
                        modifier = Modifier
                            .align(Alignment.CenterVertically)
                            .size(14.dp),
                    )
                }
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 1.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                listOf("" to "All") + cats.map { it to it.replaceFirstChar { c -> c.uppercase() } }.forEach { (cat, label) ->
                    val selected = emojiCat == cat
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (selected) Color(0xFFFEF3C7) else Color(0x0F1C1917))
                            .clickable {
                                haptics.tap()
                                emojiCat = cat
                            }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            label,
                            color = if (selected) GoldDeep else Color(0x991C1917),
                            fontSize = 11.5.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
            val gridList =
                when {
                    query.isNotBlank() -> emojis
                    emojiCat.isBlank() -> emojis
                    else -> EmojiRepo.inCategory(ctx, emojiCat)
                }
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(152.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(gridList) { e ->
                    val bmp = rememberEmojiBitmap(e.id)
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(36.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (pressed) Color(0x1A1C1917) else Color.Transparent)
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.confirm()
                                EmojiRepo.recordRecent(ctx, e.id)
                                emojiRecents.value = EmojiRepo.recent(ctx)
                                onSend(e.id)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (bmp != null) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = e.id,
                                modifier = Modifier
                                    .size(30.dp)
                                    .scale(if (pressed) 1.25f else 1f),
                            )
                        } else {
                            Text("🙂", fontSize = 20.sp)
                        }
                    }
                }
            }
        } else {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(152.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("GIFs are coming in a future update", color = Color(0x801C1917), fontSize = 13.sp)
            }
        }

        /* bottom row: recents / star / pack dots / add */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Icon(
                Icons.Filled.Schedule,
                contentDescription = "Recent",
                tint = Color(0x991C1917),
                modifier = Modifier.size(18.dp),
            )
            Icon(
                Icons.Filled.Star,
                contentDescription = "Favourites",
                tint = Color(0x991C1917),
                modifier = Modifier.size(18.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Stickers.packs.forEachIndexed { i, _ ->
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(if (pack == i) Gold else Color(0x331C1917)),
                    )
                }
            }
            Box(
                Modifier
                    .size(24.dp)
                    .clip(CircleShape)
                    .background(Color(0x141C1917)),
                contentAlignment = Alignment.Center,
            ) {
                Text("+", color = Color(0xB31C1917), fontSize = 14.sp)
            }
        }
    }
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
        ),
        "Hearts" to listOf(
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
            "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "✨",
        ),
        "Animals" to listOf(
            "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
            "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦉",
            "🦄", "🐝", "🦋", "🐌", "🐞", "🐢", "🐍", "🐙", "🦑", "🦐",
        ),
        "Food" to listOf(
            "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
            "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍔", "🍟",
            "🍕", "🌭", "🥪", "🌮", "🍜", "🍛", "🍣", "🍩", "🍪", "🎂",
        ),
        "Fun" to listOf(
            "⚽", "🏀", "🏐", "🏏", "🎯", "🎮", "🎲", "🎸", "🎤", "🎬",
            "🚀", "🛸", "⭐", "🌟", "💫", "🔥", "💧", "🎉", "🎊", "🎈",
            "🎁", "🏆", "🥇", "👑", "💎", "💯", "👍", "👏", "🙏", "💪",
        ),
    )
}