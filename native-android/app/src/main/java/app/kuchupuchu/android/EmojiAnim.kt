package app.kuchupuchu.android

/**
 * Item 2 — Noto animated emoji (owner: https://googlefonts.github.io/noto-emoji-animation/)
 *
 * - 881 Lottie assets bundled in assets/noto-emoji/[codepoint].json (68M) — offline-first.
 * - Single-emoji messages: animation plays ONCE on send/receive, then stays normal (static glyph).
 * - Tap replays the animation locally AND via POST /api/messages/{id}/fx to replay on the other side.
 * - Multi-emoji rows (1-3 emojis): each glyph animates independently, phase-shifted by idx.
 * - Fallback: if asset missing or Lottie fails, show normal Text emoji.
 *
 * Old custom 3D palette (FX_PATTERNS, dub, tri, etc.) removed per owner.
 */

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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

/** Shared replay bus — tap on one side fans out via server's emoji_fx frame. */
internal val emojiFxReplays = SnapshotStateList<String>()

/** Convert an emoji cluster (e.g. "👍🏽" or "❤️") to Noto codepoint filename: "1f44d_1f3fd" */
internal fun emojiToCodepoint(emoji: String): String {
    if (emoji.isEmpty()) return ""
    val cps = mutableListOf<String>()
    var i = 0
    while (i < emoji.length) {
        val cp = emoji.codePointAt(i)
        // Noto uses lower-case hex without leading zeros
        cps.add(Integer.toHexString(cp).lowercase())
        i += Character.charCount(cp)
    }
    return cps.joinToString("_")
}

/** Splits a body into emoji clusters (bases keep their joiners / modifiers). */
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
 * One Noto Lottie emoji that plays once per [replayKey] increment, then shows static Text.
 * If the asset doesn't exist (e.g. ©/®) or Lottie fails, falls back to Text immediately.
 */
@Composable
internal fun NotoAnimatedEmoji(
    emoji: String,
    sizeSp: Float,
    replayKey: Int,
    modifier: Modifier = Modifier,
) {
    val codepoint = remember(emoji) { emojiToCodepoint(emoji) }
    val assetPath = remember(codepoint) { "noto-emoji/$codepoint.json" }

    // Lottie composition from assets — offline-first, no network.
    val composition by rememberLottieComposition(
        LottieCompositionSpec.Asset(assetPath)
    )
    val animatable = rememberLottieAnimatable()
    var isPlaying by remember(emoji) { mutableStateOf(false) }

    // When replayKey changes (or first composition with active), play once.
    LaunchedEffect(composition, replayKey) {
        if (composition != null) {
            isPlaying = true
            // One-shot: iterations=1
            animatable.animate(
                composition = composition,
                iterations = 1,
                initialProgress = 0f,
            )
            isPlaying = false
        }
    }

    if (composition != null && isPlaying) {
        LottieAnimation(
            composition = composition,
            progress = { animatable.progress },
            modifier = modifier.size(sizeSp.dp),
        )
    } else {
        // Static fallback — normal emoji after animation, or when asset missing.
        // If composition exists but not playing, we show the static glyph (not frozen Lottie)
        // per owner: "ekbar animation Hobe tarpor normal thakbe"
        Text(
            text = emoji,
            fontSize = sizeSp.sp,
            modifier = modifier,
        )
    }
}

/**
 * One emoji-only row: each glyph uses Noto Lottie, plays once on arrival,
 * then rests. Tap replays here + on the other side via /fx.
 */
@Composable
internal fun EmojiGlyphRow(
    body: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
) {
    Row(
        Modifier.fxPopIn(active).padding(start = 2.dp, end = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        splitEmojiClusters(body).forEachIndexed { i, ch ->
            NotoEmojiGlyph(ch, sizeSp, active, mid, i)
        }
    }
}

@Composable
private fun NotoEmojiGlyph(
    ch: String,
    sizeSp: Float,
    active: Boolean,
    mid: String,
    idx: Int,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val animScale = fxAnimatorScale()
    var replayKey by remember(mid, ch) { mutableStateOf(if (active && animScale > 0f) 1 else 0) }
    var lastTapMs by remember { mutableStateOf(0L) }

    fun replay(local: Boolean) {
        if (animScale <= 0f) return
        // Debounce 300ms to avoid spam
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

    // Remote tap: other side tapped this row
    if (mid.isNotBlank() && emojiFxReplays.contains(mid)) {
        // Consume once
        if (emojiFxReplays.remove(mid)) {
            replay(local = false)
        }
    }

    // Stagger multi-emoji rows so they don't all pop at once
    LaunchedEffect(active) {
        if (active && idx > 0) {
            kotlinx.coroutines.delay((idx * 120).toLong())
            if (replayKey == 0 && animScale > 0f) replayKey = 1
        }
    }

    val tap = Modifier.clickable {
        haptics.tap()
        replay(local = true)
    }

    Box(
        modifier = tap,
        contentAlignment = Alignment.Center,
    ) {
        NotoAnimatedEmoji(
            emoji = ch,
            sizeSp = sizeSp,
            replayKey = replayKey,
        )
    }
}
