package app.kuchupuchu.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Memory TTL + disk snapshot so chats/calls/messages still paint offline.
 * Network failures fall back to [peek] which ignores TTL.
 */
object Cache {
    private val mem = LinkedHashMap<String, Pair<Long, JSONObject>>()
    private var dir: File? = null

    fun init(ctx: Context) {
        val app = ctx.applicationContext
        dir = File(app.filesDir, "kp-cache").also { it.mkdirs() }
        // None of this on the calling thread. Every one of these reads a file, and
        // init runs from Activity.onCreate — i.e. directly in front of the first
        // frame. Parsing every cached conversation there is the other half of
        // "the first scroll after opening the app is laggy": the UI thread was
        // busy deserialising JSON while the list was trying to compose.
        // Everything below is a cache, so a miss only means "fetch again".
        Thread {
            runCatching { loadDisk() }
            // Same idea for pixels: the JSON is worthless on screen if the avatar
            // it names still has to be fetched and decoded.
            runCatching { Bitmaps.init(app) }
            runCatching { ImageRatios.init(app) }
            // The avatar ref → data-URI map is read by every row that composes;
            // warming it here means no composition ever touches the prefs file.
            runCatching { AvatarRefs.warm(app) }
        }
            .apply {
                name = "kp-cache-load"
                isDaemon = true
                priority = Thread.MIN_PRIORITY
                start()
            }
    }

    fun ttl(path: String): Long =
        when {
            path.contains("/calls") -> 0L
            path.contains("/messages") -> 0L
            path.contains("/statuses") -> 2_000L
            // A contact's profile is painted from this snapshot and the profile
            // screen force-refreshes right after, so a long TTL cannot go stale —
            // it only removes the "Loading…" frame on every cold start (bug the
            // owner reported as "the profile never stays saved").
            path.contains("/api/users/") -> 24L * 3600_000L
            path.contains("/conversations") -> 1_500L
            else -> 45_000L
        }

    @Synchronized
    fun peek(path: String): JSONObject? = mem[path]?.second

    @Synchronized
    fun get(path: String): JSONObject? {
        val ttl = ttl(path)
        if (ttl <= 0) return null
        val entry = mem[path] ?: return null
        if (System.currentTimeMillis() - entry.first > ttl) return null
        return entry.second
    }

    @Synchronized
    fun put(path: String, data: JSONObject) {
        mem[path] = System.currentTimeMillis() to data
        persist(path, data)
    }

    @Synchronized
    fun bust(path: String) {
        mem.remove(path)
    }

    @Synchronized
    fun bustAll(contains: String) {
        mem.keys.filter { it.contains(contains) }.forEach { mem.remove(it) }
    }

    @Synchronized
    fun clearDisk() {
        mem.clear()
        dir?.listFiles()?.forEach { it.delete() }
    }

    private fun persist(path: String, data: JSONObject) {
        val folder = dir ?: return
        val name = path.hashCode().toUInt().toString(16)
        runCatching { File(folder, name).writeText(JSONObject().put("p", path).put("d", data).toString()) }
    }

    @Synchronized
    private fun loadDisk() {
        val folder = dir ?: return
        folder.listFiles()?.forEach { f ->
            runCatching {
                val o = JSONObject(f.readText())
                val p = o.optString("p")
                val d = o.optJSONObject("d") ?: return@forEach
                if (p.isNotBlank()) mem[p] = 0L to d
            }
        }
    }
}

/** Outgoing messages waiting for a network. Flushed when a request succeeds. */
object Outbox {
    private val items = ArrayList<JSONObject>()
    private var file: File? = null
    @Volatile var flushing = false
    private val flushLock = Any()

    fun init(ctx: Context) {
        file = File(ctx.filesDir, "kp-outbox.json")
        runCatching {
            val raw = file?.takeIf { it.exists() }?.readText() ?: return
            val arr = JSONArray(raw)
            items.clear()
            for (i in 0 until arr.length()) items.add(arr.getJSONObject(i))
        }
    }

    @Synchronized
    fun add(convId: String, clientId: String, body: JSONObject) {
        items.add(JSONObject().put("convId", convId).put("clientId", clientId).put("body", body))
        save()
    }

    @Synchronized
    fun remove(clientId: String) {
        items.removeAll { it.optString("clientId") == clientId }
        save()
    }

    @Synchronized
    fun snapshot(): List<JSONObject> = items.map { JSONObject(it.toString()) }

    private fun save() {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        runCatching { file?.writeText(arr.toString()) }
    }

    suspend fun flush() {
        // A bare check-then-set on a @Volatile let two coroutines in at once and
        // post the same queued message twice.
        synchronized(flushLock) {
            if (flushing) return
            flushing = true
        }
        try {
            for (item in snapshot()) {
                val convId = item.optString("convId")
                val clientId = item.optString("clientId")
                val body = item.optJSONObject("body")
                if (body == null) {
                    remove(clientId)
                    continue
                }
                try {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        Api.post("/api/conversations/$convId/messages", body)
                    }
                    remove(clientId)
                } catch (e: Exception) {
                    // A 4xx will never succeed on retry, so drop that item rather
                    // than blocking the rest of the queue behind it forever.
                    if (e is ApiException && e.status in 400..499) remove(clientId) else break
                }
            }
        } finally {
            flushing = false
        }
    }
}
