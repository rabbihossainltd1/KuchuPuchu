package app.kuchupuchu.android

import org.json.JSONObject

/** Tiny in-memory TTL cache for GET responses (per session, per path). */
object Cache {
    private val mem = LinkedHashMap<String, Pair<Long, JSONObject>>()

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
    }

    @Synchronized
    fun bust(path: String) {
        mem.remove(path)
    }

    @Synchronized
    fun bustAll(contains: String) {
        mem.keys.filter { it.contains(contains) }.forEach { mem.remove(it) }
    }
}
