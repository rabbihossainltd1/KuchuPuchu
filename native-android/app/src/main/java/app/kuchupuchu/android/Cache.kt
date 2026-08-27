package app.kuchupuchu.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.util.LruCache
import org.json.JSONArray
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

object Disk {
    private lateinit var root: java.io.File

    fun init(ctx: Context) {
        root = java.io.File(ctx.applicationContext.filesDir, "kp")
        java.io.File(root, "img").mkdirs()
        java.io.File(root, "chat").mkdirs()
    }

    fun ready() = ::root.isInitialized

    fun put(name: String, data: JSONObject) {
        if (!ready()) return
        runCatching { java.io.File(root, "$name.json").writeText(data.toString()) }
    }

    fun get(name: String): JSONObject? {
        if (!ready()) return null
        val f = java.io.File(root, "$name.json")
        if (!f.exists()) return null
        return runCatching { JSONObject(f.readText()) }.getOrNull()
    }

    fun imageFile(id: String) = java.io.File(java.io.File(root, "img"), "$id.jpg")

    fun saveDataUrl(id: String, src: String) {
        if (!ready() || !src.startsWith("data:")) return
        val comma = src.indexOf(',')
        if (comma < 0) return
        runCatching {
            val bytes = Base64.decode(src.substring(comma + 1), Base64.DEFAULT)
            imageFile(id).writeBytes(bytes)
        }
    }

    fun localImage(id: String): String? {
        if (!ready()) return null
        val f = imageFile(id)
        return if (f.exists() && f.length() > 0) f.absolutePath else null
    }

    fun saveChat(cid: String, items: List<JSONObject>, otherReadAt: String = "") {
        val arr = JSONArray()
        items.forEach { raw ->
            val row = JSONObject(raw.toString())
            val id = row.optString("id")
            imageList(row).firstOrNull { it.startsWith("data:") }?.let { saveDataUrl(id, it) }
            if (localImage(id) != null || row.optBoolean("hasImage")) row.put("hasImage", true)
            row.remove("imageUrls")
            if (row.clean("imageUrl").startsWith("data:")) row.put("imageUrl", "inline")
            arr.put(row)
        }
        put("chat/$cid", JSONObject().put("items", arr).put("otherReadAt", otherReadAt))
    }

    fun loadChat(cid: String): JSONObject? = get("chat/$cid")

    fun clear() {
        if (!ready()) return
        root.deleteRecursively()
        root.mkdirs()
        java.io.File(root, "img").mkdirs()
        java.io.File(root, "chat").mkdirs()
    }
}

object ImageMem {
    private val lru = object : LruCache<Int, Bitmap>(16) {}

    private fun key(src: String) = src.hashCode() * 31 + src.length

    fun get(src: String): Bitmap? = synchronized(lru) { lru.get(key(src)) }

    fun decode(src: String): Bitmap? {
        get(src)?.let { return it }
        val bmp = decodeDataUrl(src) ?: return null
        synchronized(lru) { lru.put(key(src), bmp) }
        return bmp
    }
}

fun compressPhoto(ctx: Context, uri: Uri): String {
    val raw = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Could not read that photo.")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    var sample = 1
    val longest = maxOf(bounds.outWidth, bounds.outHeight, 1)
    while (longest / sample > 960) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val src = BitmapFactory.decodeByteArray(raw, 0, raw.size, opts) ?: error("Could not read that photo.")
    var width = src.width
    var height = src.height
    var quality = 72
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
        if (data.length <= 120_000) return data
        if (quality > 48) quality -= 8 else scale *= 0.82f
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

fun JSONObject.clean(key: String): String {
    if (!has(key) || isNull(key)) return ""
    val value = optString(key)
    return if (value == "null" || value == "inline") "" else value
}

fun hydrateMessage(m: JSONObject): JSONObject {
    val id = m.optString("id")
    val local = Disk.localImage(id)
    if (local != null) {
        m.put("imageUrl", local)
        m.put("imageUrls", JSONArray().put(local))
        m.put("hasImage", true)
        return m
    }
    if (m.optBoolean("hasImage") || m.clean("imageUrl") == "inline") {
        m.put("hasImage", true)
    }
    return m
}

fun imageList(m: JSONObject): List<String> {
    val local = Disk.localImage(m.optString("id"))
    if (local != null) return listOf(local)
    val arr = m.optJSONArray("imageUrls")
    if (arr != null && arr.length() > 0) {
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() && it != "inline" && it != "null" }
    }
    val one = m.clean("imageUrl")
    return if (one.isNotBlank() && one != "inline") listOf(one) else emptyList()
}

fun copyImages(from: JSONObject, to: JSONObject): JSONObject {
    val imgs = imageList(from)
    if (imgs.isNotEmpty() && imageList(to).isEmpty()) {
        val arr = JSONArray()
        imgs.forEach { arr.put(it) }
        to.put("imageUrls", arr)
        to.put("imageUrl", imgs[0])
        to.put("hasImage", true)
    } else if (from.optBoolean("hasImage") || to.optBoolean("hasImage")) {
        to.put("hasImage", true)
    }
    return to
}

fun replaceList(target: androidx.compose.runtime.snapshots.SnapshotStateList<JSONObject>, next: List<JSONObject>) {
    val old = target.map { it.optString("id") }
    val neu = next.map { it.optString("id") }
    if (old == neu) {
        for (i in next.indices) {
            val a = target[i]
            val b = next[i]
            if (
                a.clean("reaction") != b.clean("reaction") ||
                    a.optBoolean("pending") != b.optBoolean("pending") ||
                    a.optBoolean("failed") != b.optBoolean("failed") ||
                    a.clean("body") != b.clean("body")
            ) {
                target[i] = copyImages(a, b)
            }
        }
        return
    }
    val keep = LinkedHashMap<String, JSONObject>()
    next.forEach { keep[it.optString("id")] = it }
    var i = 0
    while (i < target.size) {
        if (target[i].optString("id") !in keep) target.removeAt(i) else i++
    }
    next.forEachIndexed { index, item ->
        val id = item.optString("id")
        val cur = target.indexOfFirst { it.optString("id") == id }
        if (cur < 0) {
            target.add(index.coerceAtMost(target.size), item)
        } else if (cur != index) {
            val row = copyImages(target[cur], item)
            target.removeAt(cur)
            target.add(index.coerceAtMost(target.size), row)
        }
    }
}

fun mergeChat(target: androidx.compose.runtime.snapshots.SnapshotStateList<JSONObject>, incoming: List<JSONObject>) {
    val now = System.currentTimeMillis()
    val localById = target.associateBy { it.optString("id") }
    val merged = ArrayList<JSONObject>(incoming.size + 4)
    val seen = HashSet<String>()
    for (row in incoming) {
        val id = row.optString("id")
        val local = localById[id]
        val next = hydrateMessage(if (local != null) copyImages(local, JSONObject(row.toString())) else row)
        merged.add(next)
        if (id.isNotBlank()) seen.add(id)
    }
    for (local in target) {
        val id = local.optString("id")
        if (id in seen) continue
        val pending = local.optBoolean("pending") || local.optBoolean("failed") || id.startsWith("tmp-")
        val created = parseIso(local.clean("createdAt")) ?: now
        val fresh = now - created < 30_000
        val matched =
            incoming.any { r ->
                r.clean("senderId") == local.clean("senderId") &&
                    r.clean("body") == local.clean("body") &&
                    r.clean("sticker") == local.clean("sticker") &&
                    !local.optBoolean("failed")
            }
        if ((pending || fresh) && !matched) merged.add(local)
    }
    replaceList(target, merged)
}
