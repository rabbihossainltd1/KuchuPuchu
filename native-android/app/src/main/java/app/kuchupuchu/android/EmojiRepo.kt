package app.kuchupuchu.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Bundled custom-emoji system (offline-first).
 *
 * - Ids look like `kcp_name_01` and travel as ordinary STICKER message bodies.
 * - Assets live in `assets/emojis/<category>/<id>.webp`; the ONLY way to
 *   resolve an id to an asset is the bundled `index.json` (loaded once, then
 *   cached). A message body is never used as a file path.
 * - Unknown / malformed ids fall back gracefully - callers render a text or
 *   placeholder fallback instead of crashing.
 */
object EmojiRepo {
    private const val INDEX_ASSET = "emojis/index.json"
    private const val ID_PREFIX = "kcp_"
    private const val ID_PATTERN = "^kcp_[a-z0-9_]{3,16}$"
    private const val RECENTS_KEY = "emoji_recents"
    private const val RECENTS_MAX = 24

    data class Emoji(val id: String, val category: String, val asset: String, val tags: List<String>)

    private val lock = Any()
    private var emojis: List<Emoji> = emptyList()
    private val byId = HashMap<String, Emoji>()

    // Pre-indexed search tokens (id parts, category, tag words) -> emojis.
    // Search used to full-scan + substring-filter the whole pack on every
    // keystroke; the index answers exact token hits instantly and only rare
    // partial prefixes fall back to the scan.
    private val tokenIndex = HashMap<String, MutableList<Emoji>>()
    private var loaded = false

    private fun indexToken(token: String, e: Emoji) {
        if (token.isBlank()) return
        tokenIndex.getOrPut(token) { ArrayList() }.add(e)
    }

    private val mem = object : LruCache<String, Bitmap>(16 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    fun isCustomId(body: String): Boolean = body.startsWith(ID_PREFIX) && body.matches(ID_PATTERN.toRegex())

    fun ensure(ctx: Context) {
        synchronized(lock) {
            if (loaded) return
            try {
                val raw = ctx.assets.open(INDEX_ASSET).bufferedReader().use { it.readText() }
                val arr = JSONObject(raw).optJSONArray("emojis")
                if (arr != null) {
                    val list = ArrayList<Emoji>(arr.length())
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        val id = o.optString("id")
                        val asset = o.optString("asset")
                        if (!id.matches(ID_PATTERN.toRegex())) continue
                        // Defence in depth: the asset must be a plain relative
                        // webp path under emojis/ - never absolute or `..`.
                        if (asset.isBlank() || asset.contains("..") || asset.startsWith("/")) continue
                        val tags = ArrayList<String>()
                        val ta = o.optJSONArray("tags")
                        if (ta != null) for (j in 0 until ta.length()) tags.add(ta.optString(j))
                        list.add(Emoji(id, o.optString("category"), asset, tags))
                    }
                    emojis = list
                    byId.clear()
                    tokenIndex.clear()
                    for (e in list) {
                        byId[e.id] = e
                        e.id.split('_').forEach { part -> indexToken(part.lowercase(), e) }
                        indexToken(e.id.lowercase(), e)
                        indexToken(e.category.lowercase(), e)
                        for (tag in e.tags) {
                            indexToken(tag.lowercase(), e)
                            tag.lowercase().split(' ').forEach { word -> indexToken(word, e) }
                        }
                    }
                }
            } catch (_: Exception) {
                // Broken/missing index: keep empty registry, app still works.
            }
            loaded = true
        }
    }

    fun all(ctx: Context): List<Emoji> {
        ensure(ctx)
        return emojis
    }

    fun find(ctx: Context, id: String): Emoji? {
        ensure(ctx)
        return byId[id]
    }

    fun has(ctx: Context, id: String): Boolean = find(ctx, id) != null

    fun categories(ctx: Context): List<String> = all(ctx).map { it.category }.distinct()

    fun inCategory(ctx: Context, category: String): List<Emoji> = all(ctx).filter { it.category == category }

    fun search(ctx: Context, query: String): List<Emoji> {
        val tokens = query.trim().lowercase().split(' ').filter { it.isNotBlank() }
        if (tokens.isEmpty()) return all(ctx)
        ensure(ctx)
        // Every token must match (AND). Exact token hits come from the index;
        // a token with no exact entry falls back to a prefix scan over the
        // known tokens, then over the pack itself (covers partial words).
        var candidates: Set<Emoji>? = null
        for (token in tokens) {
            var hits = tokenIndex[token]?.toSet()
            if (hits == null) {
                hits = tokenIndex.entries.filter { it.key.startsWith(token) }.flatMap { it.value }.toSet()
            }
            if (hits == null || hits.isEmpty()) {
                hits = emojis.filter {
                    it.id.lowercase().contains(token) || it.tags.any { t -> t.lowercase().contains(token) } ||
                        it.category.lowercase().contains(token)
                }.toSet()
            }
            candidates = candidates?.intersect(hits) ?: hits
            if (candidates.isEmpty()) return emptyList()
        }
        val order = emojis
        return candidates!!.sortedBy { order.indexOf(it) }
    }

    /** Decode with LruCache; returns null for unknown ids or bad assets. */
    fun bitmap(ctx: Context, id: String): Bitmap? {
        mem.get(id)?.let { return it }
        val e = find(ctx, id) ?: return null
        return try {
            val b = BitmapFactory.decodeStream(ctx.assets.open("emojis/" + e.asset)) ?: return null
            mem.put(id, b)
            b
        } catch (_: Exception) {
            null
        }
    }

    fun peek(id: String): Bitmap? = mem.get(id)

    fun recent(ctx: Context): List<String> =
        runCatching {
            val raw = ctx.getSharedPreferences("kp", 0).getString(RECENTS_KEY, null) ?: return emptyList()
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { arr.optString(it) }.filter { isCustomId(it) }
        }.getOrDefault(emptyList())

    fun recordRecent(ctx: Context, id: String) {
        if (!isCustomId(id)) return
        runCatching {
            val prefs = ctx.getSharedPreferences("kp", 0)
            val current = ArrayDeque(recent(ctx))
            current.remove(id)
            current.addFirst(id)
            while (current.size > RECENTS_MAX) current.removeLast()
            prefs.edit().putString(RECENTS_KEY, org.json.JSONArray(current.toList()).toString()).apply()
        }
    }
}

/** Decodes a custom emoji bitmap off the main thread with a cache-first read. */
@Composable
fun rememberEmojiBitmap(id: String): Bitmap? {
    val ctx = LocalContext.current
    var bmp by remember(id) { mutableStateOf(EmojiRepo.peek(id)) }
    LaunchedEffect(id) {
        if (bmp == null) bmp = withContext(Dispatchers.IO) { EmojiRepo.bitmap(ctx, id) }
    }
    return bmp
}

/** Render helper used by message rows: image for known ids, fallback otherwise. */
@Composable
fun CustomEmojiOrFallback(body: String, fallback: androidx.compose.ui.graphics.painter.Painter? = null) {
    val bmp = rememberEmojiBitmap(body)
    if (bmp != null) {
        Image(bitmap = bmp.asImageBitmap(), contentDescription = body, modifier = Modifier.size(72.dp))
    } else if (fallback != null) {
        Image(painter = fallback, contentDescription = body, modifier = Modifier.size(72.dp))
    } else {
        androidx.compose.material3.Text(body, fontSize = 40.sp)
    }
}
