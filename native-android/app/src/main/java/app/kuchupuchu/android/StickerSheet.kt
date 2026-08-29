package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState

/** Built-in sticker packs (big-emoji stickers, WhatsApp-style tabs). */
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

/**
 * Sticker picker — WhatsApp-style bottom sheet: category tabs on top,
 * big-emoji grid below. Tap = send (with haptic).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StickerSheet(
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
) {
    val haptics = rememberHaptics()
    var tab by remember { mutableStateOf(0) } // 0 emoji-stickers, 1 GIF, 2 sticker-art
    var query by remember { mutableStateOf("") }
    var pack by remember { mutableStateOf(0) }
    var recents by remember { mutableStateOf(listOf<String>()) }

    androidx.compose.runtime.LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = androidx.compose.ui.graphics.Color(0xFF201E1B),
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
            /* drag handle */
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(top = 2.dp, bottom = 8.dp)
                    .size(width = 44.dp, height = 4.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(androidx.compose.ui.graphics.Color(0x40FFFFFF)),
            )

            /* top row: search, segmented tabs (emoji | GIF | stickers), edit */
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    androidx.compose.material.icons.Icons.Filled.Search,
                    contentDescription = "Search",
                    tint = androidx.compose.ui.graphics.Color(0x99FFFFFF),
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.width(10.dp))
                androidx.compose.foundation.text.BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = androidx.compose.ui.text.TextStyle(
                        color = androidx.compose.ui.graphics.Color.White,
                        fontSize = 14.sp,
                    ),
                    modifier = Modifier.weight(1f),
                    decorationBox = { inner ->
                        Box {
                            if (query.isEmpty()) {
                                Text(
                                    "Search stickers",
                                    color = androidx.compose.ui.graphics.Color(0x66FFFFFF),
                                    fontSize = 14.sp,
                                )
                            }
                            inner()
                        }
                    },
                )
                Spacer(Modifier.width(10.dp))
                /* segmented emoji / GIF / sticker switch */
                Row(
                    Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .background(androidx.compose.ui.graphics.Color(0x1AFFFFFF))
                        .padding(2.dp),
                ) {
                    listOf("🙂", "GIF", "⬜").forEachIndexed { i, label ->
                        val sel = tab == i
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(14.dp))
                                .background(
                                    if (sel) androidx.compose.ui.graphics.Color(0x33FFFFFF)
                                    else androidx.compose.ui.graphics.Color.Transparent,
                                )
                                .clickable {
                                    haptics.tap()
                                    tab = i
                                }
                                .padding(horizontal = 12.dp, vertical = 4.dp),
                        ) {
                            Text(
                                label,
                                color = if (sel) androidx.compose.ui.graphics.Color.White
                                else androidx.compose.ui.graphics.Color(0x99FFFFFF),
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
                Spacer(Modifier.width(10.dp))
                val ctx = LocalContext.current
                Icon(
                    androidx.compose.material.icons.Icons.Filled.Edit,
                    contentDescription = "Create",
                    tint = androidx.compose.ui.graphics.Color(0x99FFFFFF),
                    modifier = Modifier
                        .size(18.dp)
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
                            .padding(horizontal = 14.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        recents.take(6).forEach { s2 ->
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable {
                                        haptics.confirm()
                                        onSend(s2)
                                    }
                                    .padding(4.dp),
                            ) {
                                Text(s2, fontSize = 26.sp)
                            }
                        }
                        Icon(
                            androidx.compose.material.icons.Icons.Filled.Schedule,
                            contentDescription = "Recents",
                            tint = androidx.compose.ui.graphics.Color(0x66FFFFFF),
                            modifier = Modifier
                                .align(Alignment.CenterVertically)
                                .size(16.dp),
                        )
                    }
                }
                /* pack chips */
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Stickers.packs.forEachIndexed { i, (name, _) ->
                        val selected = pack == i
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .background(
                                    if (selected) androidx.compose.ui.graphics.Color(0x33FFFFFF)
                                    else androidx.compose.ui.graphics.Color(0x14FFFFFF),
                                )
                                .clickable {
                                    haptics.tap()
                                    pack = i
                                }
                                .padding(horizontal = 12.dp, vertical = 5.dp),
                        ) {
                            Text(
                                name,
                                color = if (selected) androidx.compose.ui.graphics.Color.White
                                else androidx.compose.ui.graphics.Color(0x99FFFFFF),
                                fontSize = 12.5.sp,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            )
                        }
                    }
                }
                val all = Stickers.packs[pack.coerceIn(0, Stickers.packs.size - 1)].second
                val list =
                    if (query.isBlank()) all
                    else all.filter { it.contains(query) } +
                        Stickers.packs.asSequence().flatMap { it.second }.filter { it.contains(query) }.distinct().take(40)
                LazyVerticalGrid(
                    columns = GridCells.Fixed(5),
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(300.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(list.distinct()) { sticker ->
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(64.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(
                                    if (pressed) androidx.compose.ui.graphics.Color(0x2EFFFFFF)
                                    else androidx.compose.ui.graphics.Color.Transparent,
                                )
                                .clickable(interactionSource = interaction, indication = null) {
                                    haptics.confirm()
                                    saveStickerRecent(sticker)
                                    onSend(sticker)
                                },
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                sticker,
                                fontSize = 36.sp,
                                modifier = Modifier.scale(if (pressed) 1.25f else 1f),
                            )
                        }
                    }
                }
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(300.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "GIFs are coming in a future update",
                        color = androidx.compose.ui.graphics.Color(0x80FFFFFF),
                        fontSize = 14.sp,
                    )
                }
            }

            /* bottom row: recents / star / pack dots / add */
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Icon(
                    androidx.compose.material.icons.Icons.Filled.Schedule,
                    contentDescription = "Recent",
                    tint = androidx.compose.ui.graphics.Color(0x99FFFFFF),
                    modifier = Modifier.size(22.dp),
                )
                Icon(
                    androidx.compose.material.icons.Icons.Filled.Star,
                    contentDescription = "Favourites",
                    tint = androidx.compose.ui.graphics.Color(0x99FFFFFF),
                    modifier = Modifier.size(22.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Stickers.packs.forEachIndexed { i, (_, _) ->
                        Box(
                            Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(
                                    if (pack == i) androidx.compose.ui.graphics.Color(0xFFFFFFFF)
                                    else androidx.compose.ui.graphics.Color(0x40FFFFFF),
                                ),
                        )
                    }
                }
                Box(
                    Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(androidx.compose.ui.graphics.Color(0x1AFFFFFF)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+", color = androidx.compose.ui.graphics.Color(0xB3FFFFFF), fontSize = 16.sp)
                }
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
