package app.kuchupuchu.android

/**
 * v206 - owner feedback:
 * - Animate only single emoji (not multiple)
 * - Long-press shows message actions (delete/forward)
 * - First category recent, all emojis, section headers
 * - Sticker icon fix, search working, Tenor real GIFs
 * - Emoji insert, sticker/gif direct send
 */

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.rememberLottieAnimatable
import com.airbnb.lottie.compose.rememberLottieComposition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal val emojiFxReplays = SnapshotStateList<String>()

/** Top 50 bundled codepoints — Smileys pack (2.7M total). */
internal object NotoBundled {
    val set = setOf(
        "1f600", "1f603", "1f604", "1f601", "1f606", "1f605", "1f923", "1f602",
        "1f642", "1f643", "1f609", "1f60a", "1f607", "1f970", "1f60d", "1f929",
        "1f618", "1f617", "1f61a", "1f619", "1f60b", "1f61b", "1f61c", "1f92a",
        "1f928", "1f9d0", "1f913", "1f60e", "1f973", "1f60f", "1f612", "1f61e",
        "1f614", "1f61f", "1f615", "1f641", "1f623", "1f616", "1f62b", "1f629",
        "1f97a", "1f622", "1f62d", "1f624", "1f620", "1f621", "1f92c", "1f92f",
        "1f633", "1f975",
    )
    fun isBundled(codepoint: String): Boolean = set.contains(codepoint)
}

internal fun emojiToCodepoint(emoji: String): String {
    if (emoji.isEmpty()) return ""
    val cps = mutableListOf<String>()
    var i = 0
    while (i < emoji.length) {
        val cp = emoji.codePointAt(i)
        cps.add(Integer.toHexString(cp).lowercase())
        i += Character.charCount(cp)
    }
    return cps.joinToString("_")
}

internal fun splitEmojiClusters(body: String): List<String> {
    val t = body.trim()
    if (t.isEmpty()) return emptyList()
    val out = ArrayList<String>()
    var cur = StringBuilder()
    var lastCp = -1
    var i = 0
    fun flush() {
        if (cur.isNotEmpty()) {
            out.add(cur.toString())
            cur = StringBuilder()
        }
    }
    while (i < t.length) {
        val cp = t.codePointAt(i)
        val chunk = t.substring(i, i + Character.charCount(cp))
        if (cp == ' '.code) {
            flush()
        } else if (lastCp == 0x200D || cp == 0x200D || cp == 0xFE0F || cp in 0x1F3FB..0x1F3FF) {
            cur.append(chunk)
        } else {
            flush()
            cur.append(chunk)
        }
        lastCp = cp
        i += Character.charCount(cp)
    }
    flush()
    return out
}

/**
 * Hybrid Noto Lottie emoji — fixed size Box to prevent jump.
 */
@Composable
internal fun NotoAnimatedEmoji(
    emoji: String,
    sizeSp: Float,
    replayKey: Int,
    modifier: Modifier = Modifier,
) {
    val codepoint = remember(emoji) { emojiToCodepoint(emoji) }
    val isBundled = remember(codepoint) { NotoBundled.isBundled(codepoint) }

    val spec = remember(codepoint, isBundled) {
        if (isBundled) {
            LottieCompositionSpec.Asset("noto-emoji/$codepoint.json")
        } else {
            LottieCompositionSpec.Url("https://fonts.gstatic.com/s/e/notoemoji/latest/$codepoint/lottie.json")
        }
    }

    val composition by rememberLottieComposition(spec)
    val animatable = rememberLottieAnimatable()
    var isPlaying by remember(emoji) { mutableStateOf(false) }

    LaunchedEffect(composition, replayKey) {
        if (composition != null && replayKey > 0) {
            isPlaying = true
            animatable.animate(
                composition = composition,
                iterations = 1,
                initialProgress = 0f,
            )
            isPlaying = false
        }
    }

    Box(
        modifier = modifier.size(sizeSp.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (composition != null) {
            if (isPlaying) {
                LottieAnimation(
                    composition = composition,
                    progress = { animatable.progress },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                LottieAnimation(
                    composition = composition,
                    progress = { 1f },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        } else {
            Text(
                text = emoji,
                fontSize = sizeSp.sp,
                modifier = Modifier.align(Alignment.Center),
            )
        }
    }
}

@Composable
internal fun EmojiGlyphRow(
    body: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
    onLongPress: (() -> Unit)? = null,
) {
    val clusters = remember(body) { splitEmojiClusters(body) }
    val isSingle = clusters.size == 1
    // v206: animate only single emoji, not multiple
    val shouldAnimate = isSingle
    Row(
        Modifier.fxPopIn(active && shouldAnimate).padding(start = 2.dp, end = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        clusters.forEachIndexed { i, ch ->
            NotoEmojiGlyph(ch, sizeSp, active && shouldAnimate, mid, i, isSingle, onLongPress)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NotoEmojiGlyph(
    ch: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
    idx: Int,
    isSingle: Boolean,
    onLongPress: (() -> Unit)?,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val animScale = fxAnimatorScale()
    var replayKey by remember(mid, ch) { mutableStateOf(if (active && animScale > 0f && isSingle) 1 else 0) }
    var lastTapMs by remember { mutableStateOf(0L) }

    fun replay(local: Boolean) {
        if (!isSingle) return
        if (animScale <= 0f) return
        val now = android.os.SystemClock.uptimeMillis()
        if (now - lastTapMs < 300) return
        lastTapMs = now
        replayKey++

        if (local && mid.isNotBlank() && !mid.startsWith("c_")) {
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) { Api.post("/api/messages/$mid/fx") }
                }
            }
        }
    }

    if (mid.isNotBlank() && emojiFxReplays.contains(mid)) {
        if (emojiFxReplays.remove(mid)) {
            replay(local = false)
        }
    }

    LaunchedEffect(active) {
        if (active && isSingle && idx > 0) {
            kotlinx.coroutines.delay((idx * 120).toLong())
            if (replayKey == 0 && animScale > 0f) replayKey = 1
        }
    }

    Box(
        modifier = Modifier.combinedClickable(
            onClick = {
                haptics.tap()
                if (isSingle) replay(local = true)
            },
            onLongClick = {
                haptics.tap()
                onLongPress?.invoke()
            },
        ),
        contentAlignment = Alignment.Center,
    ) {
        NotoAnimatedEmoji(
            emoji = ch,
            sizeSp = sizeSp,
            replayKey = replayKey,
        )
    }
}
