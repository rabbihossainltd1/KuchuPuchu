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
    var tab by remember { mutableStateOf(0) } // 0 emoji, 1 GIF (owner round 33, item 11c: no ⬜ / KP tabs)
    var query by remember { mutableStateOf("") }
    var pack by remember { mutableStateOf(0) }
    var recents by remember { mutableStateOf(listOf<String>()) }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    // Owner round 33 (item 11c): the search box opens the keyboard. The
    // composer used to carry the imePadding while this panel sat BELOW it,
    // so the keyboard covered the search field and the message bar floated a
    // keyboard-height up over a blank gap. Now the PANEL rides on the
    // keyboard (imePadding here, none on the composer while a panel is
    // open) and goes compact — the search row plus one strip of results.
    val searching = imeShowing()
    Column(
        Modifier
            .fillMaxWidth()
            .background(Card)
            .imePadding()
            .padding(top = 6.dp, bottom = 4.dp),
    ) {
        /* top row: search, segmented tabs (emoji | GIF), edit */
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Filled.Search,
                contentDescription = "Search",
                tint = Muted,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(color = Ink, fontSize = 13.sp),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) {
                            Text("Search stickers", color = Muted.copy(alpha = 0.7f), fontSize = 13.sp)
                        }
                        inner()
                    }
                },
            )
            Spacer(Modifier.width(8.dp))
            /* segmented emoji / GIF switch */
            Row(
                Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(ChipIdle)
                    .padding(2.dp),
            ) {
                listOf("🙂", "GIF").forEachIndexed { i, label ->
                    val sel = tab == i
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (sel) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                tab = i
                            }
                            .padding(horizontal = 9.dp, vertical = 3.dp),
                    ) {
                        Text(
                            label,
                            color = if (sel) ActionBlueDeep else Muted,
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
                tint = Muted,
                modifier = Modifier
                    .size(15.dp)
                    .clickable {
                        android.widget.Toast.makeText(ctx, "Sticker creator is coming in a future update", android.widget.Toast.LENGTH_SHORT).show()
                    },
            )
        }

        val matches = stickerMatches(query, pack)
        if (searching) {
            /* Owner round 33 (item 11c): compact — one strip of results on the keyboard */
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
                        Text(sticker, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.25f else 1f))
                    }
                }
            }
        } else if (tab == 0) {
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
                            .background(if (selected) ChipSelected else ChipIdle)
                            .clickable {
                                haptics.tap()
                                pack = i
                            }
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            name,
                            color = if (selected) ActionBlueDeep else Muted,
                            fontSize = 11.5.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                            maxLines = 1,
                        )
                    }
                }
            }
            val list = matches
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
                            .background(if (pressed) ChipIdle else Color.Transparent)
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
        } else {
            // v201 hybrid: 50 bundled (2.7M) + rest remote CDN, no gifs folder (was 104M)
            // GIF tab shows 100+ Lottie, same size, no jump — fixed Box size
            val gifList = remember { GifRepo.gifs }
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(152.dp),
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
                            .height(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (pressed) ChipIdle else Color.Transparent)
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
                                modifier = Modifier
                                    .size(36.dp)
                                    .scale(if (pressed) 1.2f else 1f),
                            )
                        } else {
                            Text(
                                item.emoji,
                                fontSize = 22.sp,
                                modifier = Modifier.scale(if (pressed) 1.2f else 1f),
                            )
                        }
                    }
                }
            }
        }

        if (!searching) {
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
                    tint = Muted,
                    modifier = Modifier.size(18.dp),
                )
                Icon(
                    Icons.Filled.Star,
                    contentDescription = "Favourites",
                    tint = Muted,
                    modifier = Modifier.size(18.dp),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Stickers.packs.forEachIndexed { i, _ ->
                        Box(
                            Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(if (pack == i) ActionBlue else Line),
                        )
                    }
                }
                Box(
                    Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(ChipIdle),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("+", color = Muted, fontSize = 14.sp)
                }
            }
        }
    }
}

/** Owner round 33 (item 11c): the keyboard's visibility, read in composition
 *  (the safe form — see KpImeAutoScroll in ChatScreen). */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun imeShowing(): Boolean = WindowInsets.isImeVisible

/** The stickers for the search box: the chosen pack while it is blank;
 *  otherwise every pack whose NAME matches (heart → Hearts) plus any sticker
 *  containing the typed text (an emoji pasted in). */
private fun stickerMatches(query: String, pack: Int): List<String> {
    val q = query.trim()
    if (q.isBlank()) return Stickers.packs[pack.coerceIn(0, Stickers.packs.size - 1)].second
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