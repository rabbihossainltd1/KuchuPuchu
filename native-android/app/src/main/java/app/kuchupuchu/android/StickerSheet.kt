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
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Mood
import androidx.compose.material.icons.filled.Pets
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Widgets
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

/**
 * v206 - per screenshot 2026-09-22 15:49
 * - Section headers inside emoji grid (Animals & Nature etc) - blue mark
 * - All emojis (8 packs, 120 each) - not just 160
 * - Recent first category
 * - Emoji animate after sent fixed (ChatScreen + EmojiAnim single only)
 * - GIF tab real Tenor GIFs hardcoded (no API, no size increase) - search works
 * - Cross button removes from composer via onBackspace
 * - Sticker icon Star -> Widgets (proper sticker icon, not star)
 * - Long-press shows message actions (via EmojiGlyphRow onLongPress)
 * - Animate only single emoji, not multiple
 * - Sticker/GIF direct send, emoji inserts
 * - Thin top pill retained, bottom categories restored with recent first
 * - Smooth swipe via AnimatedContent
 */

data class TenorGifItem(val id: String, val url: String, val preview: String, val tags: String)

object TenorGifs {
    val gifs = listOf(
        TenorGifItem(id = "tenor_0", url = "https://media.tenor.com/0LHdVPPzIJMAAAAM/milk-and-mocha-milk-mocha-bear.gif", preview = "https://media.tenor.com/0LHdVPPzIJMAAAAM/milk-and-mocha-milk-mocha-bear.gif", tags = "cat bear cute"),
        TenorGifItem(id = "tenor_1", url = "https://media.tenor.com/28zFStS2V_oAAAAM/batman-hmmm.gif", preview = "https://media.tenor.com/28zFStS2V_oAAAAM/batman-hmmm.gif", tags = "batman hmm"),
        TenorGifItem(id = "tenor_2", url = "https://media.tenor.com/2AZxt_qqBfgAAAAM/hot-dog-glizzy.gif", preview = "https://media.tenor.com/2AZxt_qqBfgAAAAM/hot-dog-glizzy.gif", tags = "hotdog funny"),
        TenorGifItem(id = "tenor_3", url = "https://media.tenor.com/2WToVZnhFPgAAAAM/seagull-man-bhafc.gif", preview = "https://media.tenor.com/2WToVZnhFPgAAAAM/seagull-man-bhafc.gif", tags = "seagull man"),
        TenorGifItem(id = "tenor_4", url = "https://media.tenor.com/3-Lf5BK1KJsAAAAM/philadelphia-eagles-swoop.gif", preview = "https://media.tenor.com/3-Lf5BK1KJsAAAAM/philadelphia-eagles-swoop.gif", tags = "eagles"),
        TenorGifItem(id = "tenor_5", url = "https://media.tenor.com/4mUDTXiFD4sAAAAM/um-weird.gif", preview = "https://media.tenor.com/4mUDTXiFD4sAAAAM/um-weird.gif", tags = "weird"),
        TenorGifItem(id = "tenor_6", url = "https://media.tenor.com/4mdfMI0daCEAAAAM/jen-ok.gif", preview = "https://media.tenor.com/4mdfMI0daCEAAAAM/jen-ok.gif", tags = "ok"),
        TenorGifItem(id = "tenor_7", url = "https://media.tenor.com/4qCkeF6Imd8AAAAM/jamar.gif", preview = "https://media.tenor.com/4qCkeF6Imd8AAAAM/jamar.gif", tags = "jamar"),
        TenorGifItem(id = "tenor_8", url = "https://media.tenor.com/5kpLCujHa9QAAAAM/help.gif", preview = "https://media.tenor.com/5kpLCujHa9QAAAAM/help.gif", tags = "help"),
        TenorGifItem(id = "tenor_9", url = "https://media.tenor.com/6Bjsf4x8xwoAAAAM/smile-lamorne-morris.gif", preview = "https://media.tenor.com/6Bjsf4x8xwoAAAAM/smile-lamorne-morris.gif", tags = "smile"),
        TenorGifItem(id = "tenor_10", url = "https://media.tenor.com/6UxxgUH5Ly8AAAAM/earthwindandfire-do-you-remember.gif", preview = "https://media.tenor.com/6UxxgUH5Ly8AAAAM/earthwindandfire-do-you-remember.gif", tags = "earth wind fire"),
        TenorGifItem(id = "tenor_11", url = "https://media.tenor.com/6XohtHPDVSgAAAAM/penguins-find-gold-gold.gif", preview = "https://media.tenor.com/6XohtHPDVSgAAAAM/penguins-find-gold-gold.gif", tags = "penguins gold"),
        TenorGifItem(id = "tenor_12", url = "https://media.tenor.com/732muAmjmZgAAAAM/belly-jerry-mouse.gif", preview = "https://media.tenor.com/732muAmjmZgAAAAM/belly-jerry-mouse.gif", tags = "belly jerry"),
        TenorGifItem(id = "tenor_13", url = "https://media.tenor.com/76P2Q3mssXcAAAAM/red-panda-day-global-red-panda-day.gif", preview = "https://media.tenor.com/76P2Q3mssXcAAAAM/red-panda-day-global-red-panda-day.gif", tags = "red panda"),
        TenorGifItem(id = "tenor_14", url = "https://media.tenor.com/84J8m6SGZpcAAAAM/no-oh-no.gif", preview = "https://media.tenor.com/84J8m6SGZpcAAAAM/no-oh-no.gif", tags = "no"),
        TenorGifItem(id = "tenor_15", url = "https://media.tenor.com/8AJCue3ChG0AAAAM/la-rams-davante-adams.gif", preview = "https://media.tenor.com/8AJCue3ChG0AAAAM/la-rams-davante-adams.gif", tags = "rams"),
        TenorGifItem(id = "tenor_16", url = "https://media.tenor.com/AapKRNOpG6cAAAAM/ohno-meme-monkey-ohno.gif", preview = "https://media.tenor.com/AapKRNOpG6cAAAAM/ohno-meme-monkey-ohno.gif", tags = "ohno monkey"),
        TenorGifItem(id = "tenor_17", url = "https://media.tenor.com/Bt7VJ0uQlSoAAAAM/cat-mewing-mew-cat.gif", preview = "https://media.tenor.com/Bt7VJ0uQlSoAAAAM/cat-mewing-mew-cat.gif", tags = "cat mewing"),
        TenorGifItem(id = "tenor_18", url = "https://media.tenor.com/CyiTsko8kHoAAAAM/cat-meme.gif", preview = "https://media.tenor.com/CyiTsko8kHoAAAAM/cat-meme.gif", tags = "cat meme"),
        TenorGifItem(id = "tenor_19", url = "https://media.tenor.com/Er7bheRU71oAAAAM/chivas-arriba.gif", preview = "https://media.tenor.com/Er7bheRU71oAAAAM/chivas-arriba.gif", tags = "chivas"),
        TenorGifItem(id = "tenor_20", url = "https://media.tenor.com/FFT4ra-XzRkAAAAM/nose-fur.gif", preview = "https://media.tenor.com/FFT4ra-XzRkAAAAM/nose-fur.gif", tags = "nose fur"),
        TenorGifItem(id = "tenor_21", url = "https://media.tenor.com/HXNFeI6ZG9oAAAAM/fanum-throws.gif", preview = "https://media.tenor.com/HXNFeI6ZG9oAAAAM/fanum-throws.gif", tags = "fanum"),
        TenorGifItem(id = "tenor_22", url = "https://media.tenor.com/I-gdY1yCONIAAAAM/loony-tunes-cat.gif", preview = "https://media.tenor.com/I-gdY1yCONIAAAAM/loony-tunes-cat.gif", tags = "loony cat"),
        TenorGifItem(id = "tenor_23", url = "https://media.tenor.com/JdZVIwYVvB8AAAAM/peepo-nerd-glasses.gif", preview = "https://media.tenor.com/JdZVIwYVvB8AAAAM/peepo-nerd-glasses.gif", tags = "peepo nerd"),
        TenorGifItem(id = "tenor_24", url = "https://media.tenor.com/KGRLk_Dfub0AAAAM/scooby-doo-woof.gif", preview = "https://media.tenor.com/KGRLk_Dfub0AAAAM/scooby-doo-woof.gif", tags = "scooby doo"),
        TenorGifItem(id = "tenor_25", url = "https://media.tenor.com/KqF2RsNybhoAAAAM/karma-om.gif", preview = "https://media.tenor.com/KqF2RsNybhoAAAAM/karma-om.gif", tags = "karma"),
        TenorGifItem(id = "tenor_26", url = "https://media.tenor.com/JZVi8QDJKsIAAAAM/classic-black-and-white.gif", preview = "https://media.tenor.com/JZVi8QDJKsIAAAAM/classic-black-and-white.gif", tags = "classic black white"),
        TenorGifItem(id = "tenor_27", url = "https://media.tenor.com/mg-vFmLUHdUAAAAM/nic-cage-nicolas-cage.gif", preview = "https://media.tenor.com/mg-vFmLUHdUAAAAM/nic-cage-nicolas-cage.gif", tags = "nic cage"),
        TenorGifItem(id = "tenor_28", url = "https://media.tenor.com/9ky5mvBLS0gAAAAM/free-im-free.gif", preview = "https://media.tenor.com/9ky5mvBLS0gAAAAM/free-im-free.gif", tags = "free im free"),
        TenorGifItem(id = "tenor_29", url = "https://media.tenor.com/PZpO3A2UgyYAAAAM/free-i%27m-free.gif", preview = "https://media.tenor.com/PZpO3A2UgyYAAAAM/free-i%27m-free.gif", tags = "free"),
        TenorGifItem(id = "tenor_30", url = "https://media.tenor.com/vWgw9MpbzbQAAAAM/the-sound-of-music-dancing.gif", preview = "https://media.tenor.com/vWgw9MpbzbQAAAAM/the-sound-of-music-dancing.gif", tags = "sound of music"),
    )
}

@Composable
fun StickerPanel(
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
    onInsert: ((String) -> Unit)? = null,
    onBackspace: (() -> Unit)? = null,
) {
    val haptics = rememberHaptics()
    var tab by remember { mutableStateOf(0) } // 0 emoji, 1 GIF, 2 sticker
    var query by remember { mutableStateOf("") }
    var recents by remember { mutableStateOf(listOf<String>()) }
    var selectedCategory by remember { mutableStateOf(0) } // 0 recent, 1 smileys, 2 animals etc
    val searchFocus = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    var showSearchInput by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        recents = loadStickerRecents()
    }

    val searching = imeShowing()

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
                detectHorizontalDragGestures(
                    onDragStart = { drag = 0f },
                    onHorizontalDrag = { _, amount -> drag += amount },
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
        // Thin top bar
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
                    // v206: Widgets icon = sticker icon, not star
                    Icon(Icons.Filled.Widgets, "Sticker", tint = if (tab == 2) ActionBlueDeep else Muted, modifier = Modifier.size(16.dp))
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
                        if (query.isNotEmpty()) {
                            query = query.dropLast(1)
                        } else {
                            // v206: cross removes from composer
                            onBackspace?.invoke()
                        }
                    },
            )
        }

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
                        Text("✕", color = Muted, fontSize = 11.sp, modifier = Modifier.clickable {
                            query = ""
                            showSearchInput = false
                            keyboardController?.hide()
                        }.padding(start = 6.dp))
                    }
                }
            }
        }

        if (searching) {
            val strip = if (query.isBlank()) (recents + stickerMatches(query, 0)).distinct().take(30) else stickerMatches(query, 0).take(30)
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
                                // Emoji inserts, sticker/gif direct send handled in grids, but search strip is emoji -> insert
                                if (onInsert != null) onInsert(sticker) else onSend(sticker)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(sticker, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
                    }
                }
            }
        } else {
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
                    0 -> EmojiGridWithSections(query = query, recents = recents, selectedCategory = selectedCategory, onInsert = onInsert, onSend = onSend)
                    1 -> TenorGifGrid(query = query, onSend = onSend)
                    else -> StickerGrid(query = query, onSend = onSend)
                }
            }

            // Bottom categories - recent first, restored per latest screenshot
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 2.dp, vertical = 2.dp).background(Color.Transparent),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                val categories = listOf(
                    Triple(0, Icons.Filled.Schedule, "Recents"),
                    Triple(1, Icons.Filled.Mood, "Smileys"),
                    Triple(2, Icons.Filled.Pets, "Animals"),
                    Triple(3, Icons.Filled.Restaurant, "Food"),
                    Triple(4, Icons.Filled.SportsSoccer, "Activities"),
                    Triple(5, Icons.Filled.Flight, "Travel"),
                    Triple(6, Icons.Filled.Lightbulb, "Objects"),
                    Triple(7, Icons.Filled.Star, "Symbols"),
                    Triple(8, Icons.Filled.Flag, "Flags"),
                )
                categories.forEach { (idx, icon, desc) ->
                    val sel = selectedCategory == idx && tab == 0
                    Box(
                        Modifier.size(30.dp).clip(CircleShape)
                            .background(if (sel) ChipSelected else Color.Transparent)
                            .clickable {
                                haptics.tap()
                                if (tab != 0) tab = 0
                                selectedCategory = idx
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(icon, contentDescription = desc, tint = if (sel) ActionBlueDeep else Muted, modifier = Modifier.size(if (sel) 18.dp else 16.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun PanelEmoji(emoji: String, pressed: Boolean) {
    // v207: panel emojis loop animate always
    val codepoint = remember(emoji) { emojiToCodepoint(emoji) }
    val isBundled = remember(codepoint) { NotoBundled.isBundled(codepoint) }
    val spec = remember(codepoint, isBundled) {
        if (isBundled) LottieCompositionSpec.Asset("noto-emoji/$codepoint.json")
        else LottieCompositionSpec.Url("https://fonts.gstatic.com/s/e/notoemoji/latest/$codepoint/lottie.json")
    }
    val composition by rememberLottieComposition(spec)
    if (composition != null) {
        LottieAnimation(
            composition = composition,
            iterations = LottieConstants.IterateForever,
            modifier = Modifier.size(22.dp).scale(if (pressed) 1.2f else 1f)
        )
    } else {
        Text(emoji, fontSize = 20.sp, modifier = Modifier.scale(if (pressed) 1.2f else 1f))
    }
}

@Composable
private fun EmojiGridWithSections(query: String, recents: List<String>, selectedCategory: Int, onInsert: ((String) -> Unit)?, onSend: (String) -> Unit) {
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
                    PanelEmoji(emoji = sticker, pressed = pressed)
                }
            }
        }
    } else {
        // Sectioned grid with headers, recent first
        val sections = mutableListOf<Pair<String, List<String>>>()
        if (selectedCategory == 0) {
            if (recents.isNotEmpty()) sections.add("Recents" to recents.take(24))
            Stickers.packs.forEach { (name, emojis) ->
                sections.add(name to emojis)
            }
        } else {
            val idx = (selectedCategory - 1).coerceIn(0, Stickers.packs.size - 1)
            val pack = Stickers.packs[idx]
            sections.add(pack.first to pack.second)
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(8),
            contentPadding = PaddingValues(horizontal = 2.dp, vertical = 1.dp),
            modifier = Modifier.fillMaxWidth().height(220.dp),
            horizontalArrangement = Arrangement.spacedBy(1.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            sections.forEach { (title, emojis) ->
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
                                // v206: emoji inserts into bar, not direct send
                                // v207: panel emojis loop animate always
                                if (onInsert != null) onInsert(sticker) else onSend(sticker)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        PanelEmoji(emoji = sticker, pressed = pressed)
                    }
                }
            }
        }
    }
}

@Composable
private fun StickerGrid(query: String, onSend: (String) -> Unit) {
    val haptics = rememberHaptics()
    val lottieStickers = remember { GifRepo.gifs }
    val allStickers = remember(query) {
        val base = lottieStickers.map { it.emoji }.distinct()
        val emojiStickers = Stickers.packs.flatMap { it.second }.take(32).distinct()
        val combined = (base + emojiStickers).distinct()
        if (query.isBlank()) combined
        else combined.filter { it.contains(query, ignoreCase = true) }.take(60)
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
            val gifItem = lottieStickers.find { it.emoji == sticker }
            Box(
                Modifier.fillMaxWidth().height(52.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (pressed) ChipSelected else ChipIdle)
                    .clickable(interactionSource = interaction, indication = null) {
                        haptics.tap()
                        saveStickerRecent(sticker)
                        // v206: sticker direct send, not insert
                        onSend(sticker)
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

@Composable
private fun TenorGifGrid(query: String, onSend: (String) -> Unit) {
    val haptics = rememberHaptics()
    val filtered = remember(query) {
        if (query.isBlank()) TenorGifs.gifs
        else TenorGifs.gifs.filter { it.tags.contains(query, ignoreCase = true) || it.url.contains(query, ignoreCase = true) }
    }

    if (filtered.isEmpty()) {
        Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("No GIFs for \"${query}\"", color = Muted, fontSize = 12.sp)
                Text("Try cat, dog, funny, love", color = Muted.copy(alpha = 0.7f), fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp))
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
        items(filtered.size) { idx ->
            val item = filtered[idx]
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            Box(
                Modifier.fillMaxWidth().height(70.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(if (pressed) ChipIdle else Color(0xFF1A1A1A))
                    .clickable(interactionSource = interaction, indication = null) {
                        haptics.tap()
                        // v206: GIF direct send
                        onSend(item.url)
                    },
                contentAlignment = Alignment.Center,
            ) {
                AsyncImage(
                    model = item.preview,
                    contentDescription = "GIF ${item.tags}",
                    modifier = Modifier.fillMaxWidth().height(70.dp).clip(RoundedCornerShape(8.dp)).scale(if (pressed) 1.05f else 1f),
                )
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
    // Also search Tenor tags
    val tenorByTag = TenorGifs.gifs.filter { it.tags.contains(q, ignoreCase = true) }.map { "🎬" }
    return (byName + byGlyph + tenorByTag).distinct().take(60)
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
        while (current.size > 24) current.removeLast()
        prefs.edit().putString("sticker_recents", org.json.JSONArray(current.toList()).toString()).apply()
    }
}

object Stickers {
    val packs = listOf(
        "Smileys & People" to listOf("😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🙈", "🙉", "🙊", "💋", "💌", "💘", "💝", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💔", "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍"),
        "Animals & Nature" to listOf("🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨", "🐯", "🦁", "🐮", "🐷", "🐽", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔", "🐧", "🐦", "🐤", "🐣", "🐥", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🪱", "🐛", "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🪳", "🦟", "🦗", "🕷️", "🕸️", "🦂", "🐢", "🐍", "🦎", "🦖", "🦕", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🦣", "🐘", "🦛", "🦏", "🐪", "🐫", "🦒", "🦘", "🦬", "🐃", "🐂", "🐄", "🐎", "🐖", "🐏", "🐑", "🦙", "🐐", "🦌", "🐕", "🐩", "🦮", "🐕‍🦺", "🐈", "🐈‍⬛", "🪶", "🐓", "🦃", "🦤", "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡", "🦫", "🦦", "🦥", "🐁", "🐀", "🐿️", "🦔", "🌵", "🎄", "🌲", "🌳", "🌴", "🌱", "🌿", "☘️", "🍀", "🎍", "🎋", "🍃", "🍂", "🍁", "🍄", "🐚", "🪸", "🌾", "💐", "🌷", "🌹", "🥀", "🌺", "🌸", "🌼", "🌻", "🌞", "🌝", "🌛", "🌜", "🌚", "🌕", "🌖", "🌗", "🌘", "🌑", "🌒", "🌓", "🌔", "🌙", "🌎", "🌍", "🌏", "🪐", "💫", "⭐", "🌟", "✨", "⚡", "☄️", "💥", "🔥", "🌪️", "🌈", "☀️", "🌤️", "⛅", "🌥️", "☁️", "🌦️", "🌧️", "⛈️", "🌩️", "🌨️", "❄️", "☃️", "⛄", "🌬️", "💨", "💧", "💦", "☔", "☂️", "🌊", "🌫️"),
        "Food & Drink" to listOf("🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒", "🌶️", "🫑", "🌽", "🥕", "🫒", "🧄", "🧅", "🥔", "🍠", "🥐", "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🦴", "🌭", "🍔", "🍟", "🍕", "🫓", "🥪", "🥙", "🧆", "🌮", "🌯", "🫔", "🥗", "🍲", "🫕", "🥘", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🥮", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰", "🥜", "🍯", "🥛", "🍼", "🫖", "☕", "🍵", "🧃", "🥤", "🧋", "🍶", "🍺", "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🧉", "🍾", "🧊", "🥄", "🍴", "🍽️", "🥢", "🧂"),
        "Activities" to listOf("⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🥏", "🎱", "🪀", "🏓", "🏸", "🥅", "🏒", "🏑", "🥍", "🏏", "🪃", "🥊", "🥋", "🥋", "🛹", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️", "🎫", "🎟️", "🎪", "🤹", "🎭", "🩰", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁", "🪘", "🎷", "🎺", "🎸", "🪕", "🎻", "🎲", "♟️", "🎯", "🎳", "🎮", "🎰", "🧩"),
        "Travel & Places" to listOf("🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚐", "🛻", "🚚", "🚛", "🚜", "🦯", "🦽", "🦼", "🛴", "🚲", "🛵", "🏍️", "🛺", "🚨", "🚔", "🚍", "🚘", "🚖", "🚡", "🚠", "🚟", "🚃", "🚋", "🚞", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇", "🚊", "🚉", "✈️", "🛫", "🛬", "🛩️", "💺", "🛰️", "🚀", "🛸", "🚁", "🛶", "⛵", "🚤", "🛥️", "🛳️", "⛴️", "🚢", "⚓", "🪝", "⛽", "🚧", "🚦", "🚥", "🚏", "🗺️", "🗿", "🗽", "🗼", "🏰", "🏯", "🏟️", "🎡", "🎢", "🎠", "⛲", "⛱️", "🏖️", "🏝️", "🏜️", "🌋", "⛰️", "🏔️", "🗻", "🏕️", "⛺", "🛖", "🏠", "🏡", "🏘️", "🏚️", "🏗️", "🏭", "🏢", "🏬", "🏣", "🏤", "🏥", "🏦", "🏨", "🏪", "🏫", "🏩", "💒", "🏛️", "⛪", "🕌", "🕍", "🛕", "🕋", "⛩️", "🛤️", "🛣️", "🗾", "🎑", "🏞️", "🌅", "🌄", "🌠", "🎇", "🎆", "🌇", "🌆", "🏙️", "🌃", "🌌", "🌉", "🌁"),
        "Objects" to listOf("⌚", "📱", "💻", "⌨️", "🖥️", "🖨️", "🖱️", "🖲️", "🕹️", "🗜️", "💽", "💾", "💿", "📀", "📼", "📷", "📸", "📹", "🎥", "📽️", "🎞️", "📞", "☎️", "📟", "📠", "📺", "📻", "🎙️", "🎚️", "🎛️", "🧭", "⏱️", "⏲️", "⏰", "🕰️", "⌛", "⏳", "📡", "🔋", "🪫", "🔌", "💡", "🔦", "🕯️", "🪔", "🧯", "🛢️", "💸", "💵", "💴", "💶", "💷", "🪙", "💰", "💳", "💎", "⚖️", "🪜", "🧰", "🪛", "🔧", "🔨", "⚒️", "🛠️", "⛏️", "🪚", "🔩", "⚙️", "🪤", "🧱", "⛓️", "🧲", "🔫", "💣", "🧨", "🪓", "🔪", "🗡️", "⚔️", "🛡️", "🚬", "⚰️", "🪦", "⚱️", "🏺", "🔮", "📿", "🧿", "💈", "⚗️", "🔭", "🔬", "🕳️", "🩹", "🩺", "💊", "💉", "🩸", "🧬", "🦠", "🧫", "🧪", "🌡️", "🧹", "🪠", "🧺", "🧻", "🚽", "🚰", "🚿", "🛁", "🛀", "🧼", "🪥", "🪒", "🧽", "🪣", "🧴", "🛎️", "🔑", "🗝️", "🚪", "🪑", "🛋️", "🛏️", "🛌", "🧸", "🪆", "🖼️", "🪞", "🪟", "🛍️", "🛒", "🎁", "🎈", "🎏", "🎀", "🪄", "🪅", "🎊", "🎉", "🎎", "🏮", "🎐", "🧧", "✉️", "📩", "📨", "📧", "💌", "📥", "📤", "📦", "🏷️", "🪧", "📪", "📫", "📬", "📭", "📮", "📯", "📜", "📃", "📄", "📑", "🧾", "📊", "📈", "📉", "🗒️", "📅", "📆", "🗓️", "📇", "🗃️", "🗳️", "🗄️", "📋", "🗂️", "📂", "📁", "🗞️", "📰", "📓", "📔", "📒", "📕", "📗", "📘", "📙", "📚", "📖", "🔖", "🧷", "🔗", "📎", "🖇️", "📐", "📏", "🧮", "📌", "📍", "✂️", "🖊️", "🖋️", "✒️", "🖌️", "🖍️", "📝", "✏️", "🔍", "🔎", "🔏", "🔐", "🔒", "🔓"),
        "Symbols" to listOf("❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🅾️", "🆑", "🅿️", "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️", "⚠️", "🚸", "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎", "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗", "🈳", "🈂️", "🛂", "🛃", "🛄", "🛅", "🚹", "🚺", "🚼", "⚧️", "🚻", "🚮", "🎦", "📶", "🈁", "🔣", "ℹ️", "🔤", "🔡", "🔠", "🆖", "🆗", "🆙", "🆒", "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟", "🔢", "#️⃣", "*️⃣", "⏏️", "▶️", "⏸️", "⏯️", "⏹️", "⏺️", "⏭️", "⏮️", "⏩", "⏪", "⏫", "⏬", "◀️", "🔼", "🔽", "➡️", "⬅️", "⬆️", "⬇️", "↗️", "↘️", "↙️", "↖️", "↕️", "↔️", "↪️", "↩️", "⤴️", "⤵️", "🔀", "🔁", "🔂", "🔄", "🔃", "🎵", "🎶", "➕", "➖", "➗", "✖️", "♾️", "💲", "💱", "™️", "©️", "®️", "〰️", "➰", "➿", "🔚", "🔙", "🔛", "🔝", "🔜"),
        "Flags" to listOf("🏳️", "🏴", "🏁", "🚩", "🎌", "🏴‍☠️", "🇧🇩", "🇺🇸", "🇬🇧", "🇮🇳", "🇵🇰", "🇯🇵", "🇰🇷", "🇨🇳", "🇫🇷", "🇩🇪", "🇮🇹", "🇪🇸", "🇧🇷", "🇦🇺", "🇨🇦", "🇷🇺", "🇸🇦", "🇦🇪", "🇹🇷", "🇮🇩", "🇲🇾", "🇸🇬", "🇹🇭", "🇻🇳", "🇳🇵", "🇱🇰", "🇲🇲", "🇧🇹", "🇲🇻", "🇦🇫", "🇮🇷", "🇮🇶", "🇶🇦", "🇰🇼", "🇴🇲", "🇾🇪", "🇸🇾", "🇱🇧", "🇯🇴", "🇮🇱", "🇪🇬", "🇲🇦", "🇩🇿", "🇹🇳", "🇱🇾", "🇸🇩", "🇿🇦", "🇳🇬", "🇰🇪", "🇪🇹", "🇬🇭", "🇲🇽", "🇦🇷", "🇨🇱", "🇨🇴", "🇵🇪", "🇻🇪", "🇵🇭", "🇰🇭", "🇱🇦", "🇧🇳"),
    )
}
