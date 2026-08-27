package app.kuchupuchu.android

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
    var pack by remember { mutableStateOf(0) }
    val haptics = rememberHaptics()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = androidx.compose.ui.graphics.Color.White,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 14.dp)) {
            Text(
                "Stickers",
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Ink,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            /* category tabs */
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Stickers.packs.forEachIndexed { i, (name, _) ->
                    val selected = pack == i
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(18.dp))
                            .background(if (selected) Gold else GoldSoft)
                            .clickable {
                                haptics.tap()
                                pack = i
                            }
                            .padding(horizontal = 13.dp, vertical = 6.dp),
                    ) {
                        Text(
                            name,
                            color = if (selected) AmberInk else GoldDeep,
                            fontSize = 13.sp,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        )
                    }
                }
            }
            val list = Stickers.packs[pack].second
            LazyVerticalGrid(
                columns = GridCells.Fixed(5),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(300.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(list) { sticker ->
                    val interaction = remember { MutableInteractionSource() }
                    val pressed by interaction.collectIsPressedAsState()
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(64.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (pressed) GoldSoft else androidx.compose.ui.graphics.Color(0xFFF7F6F4))
                            .clickable(interactionSource = interaction, indication = null) {
                                haptics.confirm()
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
        }
    }
}
