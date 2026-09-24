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
import org.json.JSONObject

internal val emojiFxReplays = SnapshotStateList<String>()

/** r71-21: how close two taps have to be to count as the "double tap = ❤️". */
internal const val DOUBLE_TAP_HEART_MS = 320L

/**
 * r68-4 (owner: "ei haptic ta just tokhoni kaj korbe jokhon 2 ta user e same chat
 * screen a thakbe all time na") / r69-4 (owner, on the first fix: "maybe not
 * fixed (only chat screen a thaklei hobe eita)") / r70-4 (owner, after r69:
 * "peer chat screen a na thake ... amar phone e buzz kore").
 *
 * The mirrored reaction is a shared moment: the other phone replays the dance
 * AND buzzes — but only while ITS user has this chat open. "Open" is the route
 * test below; the call sites pair it with `Store.foreground` (r70-4 put the
 * flag back: a backgrounded app is not on the chat screen) and with the
 * `fromChat` proof the tapper's own phone sends inside the frame, so the mirror
 * needs BOTH sides to have been on the chat screen.
 *
 * The route test itself is the boundary-safe shape the notification path uses
 * (`chat/<id>` or `chat/<id>?...`), and since r70-4 the route comes from the
 * nav back stack, so a chat screen buried under the media viewer, another
 * route, or no route at all never mirrors. Pure, so the decision is asserted
 * off-device in EmojiFxPolicyTest.
 */
internal object EmojiFxPolicy {
    fun mirrorsOnScreen(route: String, convId: String): Boolean {
        if (convId.isBlank()) return false
        return route == "chat/$convId" || route.startsWith("chat/$convId?")
    }
}

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
    // r71-21: the second tap of a double tap also drops the heart here — the
    // bubble kind that already spends a tap on the dance itself.
    onDoubleTap: (() -> Unit)? = null,
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
    // r71-21 (owner: "kono massage a double tap korle auto reaction Hobe ♥️"):
    // on an emoji-only bubble the tap already means "replay the dance", and
    // r67-4 made that INSTANT on purpose. So the heart is counted HERE, without
    // deferring anything: a second tap inside [DOUBLE_TAP_HEART_MS] also runs
    // [onDoubleTap] while the replay it already triggered plays on.
    val lastTapAt = remember { longArrayOf(0L) }
    var replayKey by remember(mid, ch) { mutableStateOf(if (active && animScale > 0f && isSingle) 1 else 0) }

    /**
     * r67-4 (owner: "emojis a tap korle animates eita aro enchance koro ami tap
     * korle jeno haptic feedback hobe opponent er o haptic feedback hobe. ar tap
     * tap bar korle ... ekhon full animation complete hole abar hoi rapid tap
     * korleo").
     *
     * Two changes, and both sides get them identically:
     *  - EVERY tap restarts the dance immediately (replayKey bump throws the
     *    running pass away and starts at progress 0). The old 300 ms gate
     *    swallowed a rapid second tap completely, and the running animation had
     *    to finish before a replay could be seen — so a tap-tap-tap thumb saw
     *    one slow pass instead of a stutter.
     *  - BOTH sides buzz: the tap, and the replay that arrives from the other
     *    phone carry the same [Haptics.reaction] — the finger learns the same
     *    thing on both phones.
     *
     * The local tap still posts /fx so the far side replays the same way. It is
     * sent on EVERY tap (no client-side throttle): a throttle here would make
     * the two phones diverge precisely when the owner taps fastest. The worker
     * owns the storm protection (per-user rate limit).
     */
    fun replay(local: Boolean) {
        if (!isSingle) return
        if (animScale <= 0f) return
        haptics.reaction()
        replayKey++

        if (local && mid.isNotBlank() && !mid.startsWith("c_")) {
            // r70-4: the frame carries the tapper's own half of the condition —
            // the tap happened while a chat screen was really in front. The
            // receiving phone mirrors only when BOTH halves are true.
            val onChatNow = Store.foreground && Store.route.startsWith("chat/")
            scope.launch {
                runCatching {
                    withContext(Dispatchers.IO) {
                        Api.post("/api/messages/$mid/fx", JSONObject().put("onChat", onChatNow))
                    }
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
                // r67-4: replay() owns the buzz now (haptics.reaction()) — the
                // tap and the replay from the other phone must feel the same.
                // r71-21: count the taps first, so a double tap drops the heart
                // WITHOUT holding the instant replay back.
                val now = android.os.SystemClock.uptimeMillis()
                if (onDoubleTap != null && now - lastTapAt[0] in 1..DOUBLE_TAP_HEART_MS) onDoubleTap.invoke()
                lastTapAt[0] = now
                if (isSingle) replay(local = true) else haptics.tap()
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
