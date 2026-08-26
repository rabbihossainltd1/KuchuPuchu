package app.kuchupuchu.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream

object Cache {
    private val mem = LinkedHashMap<String, Pair<Long, JSONObject>>()

    fun ttl(path: String): Long =
        when {
            path.contains("/calls") -> 0
            path.contains("/messages") -> 0
            path.contains("/notifications") || path.contains("/friend-requests") -> 2_000
            path.contains("/conversations") -> 2_500
            else -> 45_000
        }

    @Synchronized
    fun peek(path: String): JSONObject? = mem[path]?.second

    @Synchronized
    fun get(path: String): JSONObject? {
        val ttl = ttl(path)
        if (ttl <= 0) return null
        val hit = mem[path] ?: return null
        if (System.currentTimeMillis() - hit.first > ttl) return null
        return hit.second
    }

    @Synchronized
    fun put(path: String, data: JSONObject) {
        mem[path] = System.currentTimeMillis() to data
        if (mem.size > 80) {
            val first = mem.keys.firstOrNull()
            if (first != null) mem.remove(first)
        }
    }

    @Synchronized
    fun bust(match: String? = null) {
        if (match == null) {
            mem.clear()
            return
        }
        mem.keys.filter { it.contains(match) }.forEach { mem.remove(it) }
    }
}

fun compressPhoto(ctx: Context, uri: Uri): String {
    val raw = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Could not read that photo.")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    var sample = 1
    val longest = maxOf(bounds.outWidth, bounds.outHeight, 1)
    while (longest / sample > 1280) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val src = BitmapFactory.decodeByteArray(raw, 0, raw.size, opts) ?: error("Could not read that photo.")
    var width = src.width
    var height = src.height
    var quality = 82
    var scale = 1f
    var data = ""
    repeat(8) {
        val w = maxOf(1, (width * scale).toInt())
        val h = maxOf(1, (height * scale).toInt())
        val scaled = if (w == src.width && h == src.height) src else Bitmap.createScaledBitmap(src, w, h, true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        val bytes = out.toByteArray()
        data = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
        if (data.length <= 380_000) return data
        if (quality > 55) quality -= 8 else scale *= 0.85f
    }
    if (!data.startsWith("data:image")) error("Could not read that photo.")
    return data
}

fun decodeDataUrl(src: String): Bitmap? {
    val comma = src.indexOf(',')
    if (comma < 0) return null
    return try {
        val bytes = Base64.decode(src.substring(comma + 1), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Exception) {
        null
    }
}

fun replaceList(target: androidx.compose.runtime.snapshots.SnapshotStateList<JSONObject>, next: List<JSONObject>) {
    val old = target.map { it.optString("id") }
    val neu = next.map { it.optString("id") }
    if (old == neu && target.size == next.size) return
    target.clear()
    target.addAll(next)
}

fun mergeChat(target: androidx.compose.runtime.snapshots.SnapshotStateList<JSONObject>, incoming: List<JSONObject>) {
    val pending =
        target.filter { it.optBoolean("pending") || it.optBoolean("failed") || it.optString("id").startsWith("tmp-") }
    val still =
        pending.filter { p ->
            incoming.none { r ->
                r.optString("senderId") == p.optString("senderId") &&
                    r.optString("body") == p.optString("body") &&
                    r.optString("sticker") == p.optString("sticker")
            }
        }
    replaceList(target, incoming + still)
}
