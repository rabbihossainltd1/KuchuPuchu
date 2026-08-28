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
        dir = File(ctx.filesDir, "kp-cache").also { it.mkdirs() }
        loadDisk()
    }

    fun ttl(path: String): Long =
        when {
            path.contains("/calls") -> 0L
            path.contains("/messages") -> 0L
            path.contains("/statuses") -> 2_000L
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
        if (flushing) return
        flushing = true
        try {
            for (item in snapshot()) {
                val convId = item.optString("convId")
                val clientId = item.optString("clientId")
                val body = item.optJSONObject("body") ?: continue
                try {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        Api.post("/api/conversations/$convId/messages", body)
                    }
                    remove(clientId)
                } catch (_: Exception) {
                    break
                }
            }
        } finally {
            flushing = false
        }
    }
}
