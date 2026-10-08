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
import com.airbnb.lottie.compose.rememberLottieAnimatable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal val emojiFxReplays = SnapshotStateList<String>()

/**
 * r71-4: when each pending mirror arrived. The row a frame names is often not
 * composed at that instant (it can be scrolled off, or the chat may not even be
 * the screen in front) — the replay used to wait in the list and then bite
 * whoever scrolled past that row later. A dance is worth playing only while it
 * is still now; [MIRROR_FRESH_MS] is that window.
 */
internal val emojiFxAt = HashMap<String, Long>()

/** r71-4: how long a mirrored replay stays worth playing. */
internal const val MIRROR_FRESH_MS = 3_000L

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

/**
 * r79-6/r79-8 (owner: "emoji sent hobar por ekhono halka flicking kore" +
 * "first time animates hoi na"): every glyph is a Lottie - until its JSON
 * parses, the box falls back to the SYSTEM glyph and ~100-300 ms in the Noto
 * frame swaps in, which is the flicker; and the blast of that parse ate the
 * birth animation's window, which is why nothing animated. The load now
 * starts the moment the emoji exists in the draft / send / arrival path, so
 * the row is BORN with the real Noto frame already warm in Lottie's cache -
 * no fallback pass, no swap, nothing to wait on.
 */
internal object NotoEmojiWarm {
    // r80-6 (second pass): the r79 warm filled LOTTIE-INTERNAL cache, and the
    // r80 glyph seeded itself from it - but that cache is @RestrictTo(LIBRARY)
    // - internal to Lottie, and its eviction policy is theirs. Our own map
    // holds the parsed compositions instead (bounded, ours, lint-clean), and
    // the warm parses with the PUBLIC Sync factories on a small pool so a
    // glyph's first composition can read the frame synchronously (the whole
    // point: zero frames on the system-emoji fallback).
    private val warmed = java.util.Collections.synchronizedSet(HashSet<String>())
    private val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
    private val comps =
        java.util.Collections.synchronizedMap(
            object :
                java.util.LinkedHashMap<String, com.airbnb.lottie.LottieComposition>(96, 0.75f, true) {
                override fun removeEldestEntry(
                    eldest: MutableMap.MutableEntry<String, com.airbnb.lottie.LottieComposition>?,
                ): Boolean = size > 96
            },
        )

    fun peek(cacheKey: String): com.airbnb.lottie.LottieComposition? =
        synchronized(comps) { comps[cacheKey] }

    fun store(cacheKey: String, comp: com.airbnb.lottie.LottieComposition) {
        synchronized(comps) { comps[cacheKey] = comp }
        warmed.add(cacheKey.removePrefix("noto-emoji/").removeSuffix(".json"))
    }

    fun preload(ctx: android.content.Context, body: String) {
        if (body.isEmpty()) return
        // Cheap guard first: bitmap emoji detection is off-topic here - warm
        // only strings that hold at least one extended-plane codepoint.
        var hasEmoji = false
        for (cp in body.codePoints()) {
            if (cp > 0x2500) { hasEmoji = true; break }
        }
        if (!hasEmoji) return
        val app = ctx.applicationContext
        for (ch in splitEmojiClusters(body)) {
            val code = emojiToCodepoint(ch)
            if (code.isBlank() || !warmed.add(code)) continue
            val bundled = NotoBundled.isBundled(code)
            pool.execute {
                runCatching {
                    val res =
                        if (bundled) {
                            com.airbnb.lottie.LottieCompositionFactory.fromAssetSync(app, "noto-emoji/$code.json")
                        } else {
                            com.airbnb.lottie.LottieCompositionFactory.fromUrlSync(
                                app,
                                "https://fonts.gstatic.com/s/e/notoemoji/latest/$code/lottie.json",
                            )
                        }
                    res.value?.let { store(if (bundled) "noto-emoji/$code.json" else "https://fonts.gstatic.com/s/e/notoemoji/latest/$code/lottie.json", it) }
                }
            }
        }
    }
}

/**
 * r87-1 (owner r87 #1: "sending animation hoi sent hole abar stop hoye
 * animation hoi ... send sending sent zero gap"): the pending echo and the
 * server row that replaces it are TWO DIFFERENT compositions, so the r86
 * per-composition dance restarted from zero at the swap - the emoji froze
 * for a beat and danced again the moment the row became "sent". The birth
 * dance is GLOBAL and TIME-BASED per message key (the FlightAnims pattern):
 * the echo's composition starts the clock exactly once, and the server row
 * that takes the seat RESUMES at the same wall-clock frame - the swap is
 * invisible, one continuous dance from sending to sent.
 */
internal object EmojiDance {
    private val startedAt = java.util.Collections.synchronizedMap(HashMap<String, Long>())

    /** Idempotent - the first live composition owns the start. */
    fun begin(key: String): Long =
        synchronized(startedAt) {
            startedAt.getOrPut(key) { android.os.SystemClock.uptimeMillis() }
        }

    /** 0..1 from the wall clock; 1 when never begun or already finished. */
    fun progress(key: String, durationMs: Int): Float {
        val t = startedAt[key] ?: return 1f
        return ((android.os.SystemClock.uptimeMillis() - t).toFloat() / durationMs).coerceIn(0f, 1f)
    }
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
    // r87-1: the live-birth dance key (the row's stable fxKey). Null = this
    // glyph has no birth dance (history row / multi-glyph / tap-replay only).
    liveDanceKey: String? = null,
) {
    val codepoint = remember(emoji) { emojiToCodepoint(emoji) }
    val isBundled = remember(codepoint) { NotoBundled.isBundled(codepoint) }

    val assetName = "noto-emoji/$codepoint.json"
    val netUrl = "https://fonts.gstatic.com/s/e/notoemoji/latest/$codepoint/lottie.json"
    // The EXACT identifier LottieCompositionFactory caches under (the
    // factories default a null cacheKey to the asset name / the URL string) -
    // r79's NotoEmojiWarm fills the cache under the same keys.
    val cacheKey = if (isBundled) assetName else netUrl

    // r80-6 (owner retest r79: "not fixed" - the flicker survived warming):
    // rememberLottieComposition is ASYNC even on a warm cache - the state is
    // born null and the loader lands a frame or two later. So every glyph
    // painted the SYSTEM emoji first, then swapped the Noto frame in, and
    // from the eye that swap IS the flicker; no amount of pre-warming fixes a
    // null first state. The state now seeds SYNCHRONOUSLY from Lottie's cache
    // at first composition, so a warm glyph's first pixel is already the real
    // Noto frame - there is never a Text pass to swap away from. Cold misses
    // keep the old Text fallback until the async load lands.
    val appCtx = androidx.compose.ui.platform.LocalContext.current.applicationContext
    var composition by remember(codepoint) {
        mutableStateOf<com.airbnb.lottie.LottieComposition?>(
            if (codepoint.isBlank()) null else NotoEmojiWarm.peek(cacheKey),
        )
    }
    LaunchedEffect(codepoint) {
        if (composition != null || codepoint.isBlank()) return@LaunchedEffect
        composition = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
            val task =
                if (isBundled) {
                    com.airbnb.lottie.LottieCompositionFactory.fromAsset(appCtx, assetName)
                } else {
                    com.airbnb.lottie.LottieCompositionFactory.fromUrl(appCtx, netUrl)
                }
            task
                .addListener { comp ->
                    NotoEmojiWarm.store(cacheKey, comp)
                    if (cont.isActive) cont.resumeWith(Result.success(comp))
                }
                .addFailureListener { if (cont.isActive) cont.resumeWith(Result.success(null)) }
        }
    }
    val animatable = rememberLottieAnimatable()
    var isPlaying by remember(emoji) { mutableStateOf(false) }
    LaunchedEffect(composition, replayKey) {
        val comp = composition ?: return@LaunchedEffect
        // r88-1 (owner r88 #1: "first time animates hoi na ... tap korleo
        // animate hoi na majhe majhe hoi"): r87 drove the birth through a
        // separate wall-clock render loop whose branch SHADOWED the tap
        // replay for the whole (seconds-long) birth window - a tap inside
        // the window looked dead - and a 0-duration composition ended the
        // birth before a frame ever showed. ONE driver now: the birth dance
        // and the tap replay are the SAME animatable pass (the library's
        // own frame clock, the machinery a tap has always used on device).
        // A live birth starts at the GLOBAL clock's current frame
        // (EmojiDance): the echo's glyph starts the clock exactly once, and
        // the server row that takes the seat resumes at the same
        // wall-clock frame - the pending->server swap is invisible, sending
        // to sent with zero gap. A tap always restarts from 0 and shows
        // immediately.
        if (liveDanceKey != null && replayKey == 0) {
            EmojiDance.begin(liveDanceKey)
            val durMs = if (comp.duration > 0f) (comp.duration * 1000f).toInt() else 1_200
            val resume = EmojiDance.progress(liveDanceKey, durMs)
            if (resume < 1f) {
                isPlaying = true
                animatable.animate(composition = comp, iterations = 1, initialProgress = resume)
                isPlaying = false
            }
            return@LaunchedEffect
        }
        if (replayKey > 0) {
            isPlaying = true
            animatable.animate(composition = comp, iterations = 1, initialProgress = 0f)
            isPlaying = false
        }
    }

    Box(
        modifier = modifier.size(sizeSp.dp),
        contentAlignment = Alignment.Center,
    ) {
        // r88-1: ONE render path - the library animator's progress (the
        // birth dance and the tap replay both feed it).
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
    // r87-1: the row's stable fxKey (clientId-first) - the birth dance clock
    // is keyed on it so the echo->server swap resumes the same frame.
    danceKey: String = mid,
    onTap: (() -> Unit)? = null,
) {
    val clusters = remember(body) { splitEmojiClusters(body) }
    val isSingle = clusters.size == 1
    // v206: animate only single emoji, not multiple
    val shouldAnimate = isSingle
    Row(
        // r80-8 (updated r85-1): the birth pop belongs to the ROW - the row
        // flight (fxSlotOpen + fxFlyIn) is the ONE entrance a message plays,
        // emoji rows included. This glyph-row fxPopIn scaled the same birth a
        // second time on a second clock, so the entrance read doubled / muddy.
        // Tap replays are untouched (they ride replayKey, not this modifier).
        Modifier.padding(start = 2.dp, end = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        clusters.forEachIndexed { i, ch ->
            NotoEmojiGlyph(
                ch,
                sizeSp,
                active && shouldAnimate,
                mid,
                i,
                isSingle,
                onLongPress,
                onDoubleTap,
                danceKey,
                onTap,
            )
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
    // r71-21: handed down from EmojiGlyphRow — one double tap in a rapid
    // sequence drops the heart without deferring the instant replay.
    onDoubleTap: (() -> Unit)?,
    // r87-1: the row's stable key for the global birth-dance clock.
    danceKey: String = mid,
    onTap: (() -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val animScale = fxAnimatorScale()
    // r71-21: an emoji-only bubble replays immediately on every tap. A fast
    // double tap adds one heart; further taps in the same burst keep replaying
    // but cannot toggle the server reaction repeatedly.
    val lastTapAt = remember { longArrayOf(0L) }
    // One rapid tap burst may contain several taps, but it spends at most one
    // double-tap reaction until the user pauses longer than the gesture window.
    val doubleTapConsumed = remember { booleanArrayOf(false) }
    // r87-1: the birth dance moved OFF the per-composition replayKey (the
    // swap restarted it) - it rides the global EmojiDance clock now, so the
    // seed stays 0 and only a TAP bumps replayKey.
    var replayKey by remember(mid, ch) { mutableStateOf(0) }

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

    // r72 (the owner's crash report): "Unsupported concurrent change during
    // composition — a state object was modified by composition as well as being
    // modified outside composition". [emojiFxReplays] is a SnapshotStateList the
    // socket thread adds to; removing from it HERE, in the composable body, was
    // the write-by-composition half of that pair and the recomposer kills the
    // process for it. The READ stays (it is what makes this row recompose when
    // the mirror lands — the same read the crash did not object to), and the
    // consume moves into the effect, which runs outside composition.
    val mirrorPending = mid.isNotBlank() && emojiFxReplays.contains(mid)
    LaunchedEffect(mirrorPending) {
        if (mirrorPending && emojiFxReplays.remove(mid)) {
            // r71-4: drop a stale one instead of buzzing for a tap from a
            // screen that has since gone away (and keep the map in step).
            val at = emojiFxAt.remove(mid) ?: 0L
            if (System.currentTimeMillis() - at in 0..MIRROR_FRESH_MS) replay(local = false)
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
                onTap?.invoke()
                // r67-4: replay() owns the buzz now (haptics.reaction()) — the
                // tap and the replay from the other phone must feel the same.
                // r71-21: count the taps first, so a double tap drops the heart
                // WITHOUT holding the instant replay back.
                val now = android.os.SystemClock.uptimeMillis()
                val gap = now - lastTapAt[0]
                val isDoubleTap = lastTapAt[0] > 0L && gap in 1..DOUBLE_TAP_HEART_MS
                if (!isDoubleTap) doubleTapConsumed[0] = false
                if (isDoubleTap && !doubleTapConsumed[0] && onDoubleTap != null) {
                    doubleTapConsumed[0] = true
                    onDoubleTap.invoke()
                }
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
            liveDanceKey = if (active && isSingle && animScale > 0f) danceKey else null,
        )
    }
}
