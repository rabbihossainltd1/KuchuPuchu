package app.kuchupuchu.android

import android.content.Context
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import okhttp3.ConnectionPool
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * v3 API client — OkHttp (HTTP/2, connection pool, gzip, GET retries).
 */
object Api {
    const val BASE = "https://kuchupuchu-api.kuchupuchu.workers.dev"
    private const val TOKEN_KEY = "kp_session_token"
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private val OCTET = "application/octet-stream".toMediaType()

    @Volatile
    var token: String? = null

    val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))
            // OkHttp's built-in retry safely owns the exchange lifecycle.
            // A custom interceptor previously called chain.proceed() again
            // after an I/O failure; OkHttp can still have that exchange open,
            // causing a fatal "previous response is still open" exception.
            .retryOnConnectionFailure(true)
            .addInterceptor(AuthInterceptor())
            .build()
    }

    fun loadToken(ctx: Context) {
        token = ctx.getSharedPreferences("kp", 0).getString(TOKEN_KEY, null)
    }

    fun saveToken(ctx: Context, value: String?) {
        token = value
        ctx.getSharedPreferences("kp", 0).edit().putString(TOKEN_KEY, value).apply()
    }

    fun get(path: String, force: Boolean = false): JSONObject {
        // Freshness-marker polls differ only by `?marker=...`; they must map
        // to ONE cache key and never evict the last FULL response with a
        // tiny {marker, unchanged} shell (offline fallback still needs items).
        val key = path.substringBefore("?marker=")
        if (!force) Cache.get(key)?.let { return it }
        return try {
            val data = request(path, "GET", null)
            if (!data.has("unchanged")) Cache.put(key, data)
            data
        } catch (e: Exception) {
            Cache.peek(key)?.let { return it }
            throw e
        }
    }

    fun post(path: String, body: JSONObject? = JSONObject()): JSONObject {
        val data = request(path, "POST", body)
        bustFor(path)
        return data
    }

    fun patch(path: String, body: JSONObject): JSONObject {
        val data = request(path, "PATCH", body)
        bustFor(path)
        return data
    }

    fun delete(path: String): JSONObject {
        val data = request(path, "DELETE", JSONObject())
        bustFor(path)
        return data
    }

    fun upload(name: String, mime: String, bytes: ByteArray): JSONObject = upload(name, mime, bytes, null)

    /**
     * Upload with byte-level progress: the body writes itself in 8 KB chunks
     * and reports (written, total) so bubbles can show a real progress ring
     * instead of a spinner that could mean two seconds or two minutes.
     */
    fun upload(name: String, mime: String, bytes: ByteArray, onProgress: ((Long, Long) -> Unit)?): JSONObject {
        val path = "/api/files?name=${q(name)}&type=${q(mime)}"
        val body: RequestBody =
            if (onProgress == null) {
                bytes.toRequestBody(OCTET)
            } else {
                val total = bytes.size.toLong()
                object : RequestBody() {
                    override fun contentType(): MediaType = OCTET

                    override fun contentLength(): Long = total

                    override fun writeTo(sink: BufferedSink) {
                        var written = 0L
                        while (written < total) {
                            val len = minOf(8192, (total - written).toInt())
                            sink.write(bytes, written.toInt(), len)
                            written += len
                            onProgress(written, total)
                        }
                    }
                }
            }
        val req = Request.Builder()
            .url(BASE + path)
            .post(body)
            .header("Accept", "application/json")
            .build()
        return executeJson(req)
    }

    /** Streams a download straight to disk — heavy docs never hit RAM whole. */
    fun downloadToFile(pathOrKey: String, dest: java.io.File): Boolean {
        val url =
            if (pathOrKey.startsWith("http")) pathOrKey
            else if (pathOrKey.startsWith("/")) BASE + pathOrKey
            else "$BASE/api/files/${encodePath(pathOrKey)}"
        val req = Request.Builder().url(url).get().build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return false
            resp.body?.byteStream()?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output, 128 * 1024) }
            } ?: return false
            return true
        }
    }

    fun download(pathOrKey: String): ByteArray {
        val url =
            if (pathOrKey.startsWith("http")) pathOrKey
            else if (pathOrKey.startsWith("/")) BASE + pathOrKey
            else "$BASE/api/files/${encodePath(pathOrKey)}"
        val req = Request.Builder().url(url).get().build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw ApiException(resp.code, "Download failed.")
            return resp.body?.bytes() ?: ByteArray(0)
        }
    }

    private fun bustFor(path: String) {
        if (path.contains("/conversations")) Cache.bust("/api/conversations")
        if (path.contains("/messages")) {
            Cache.bustAll("/messages")
            Cache.bust("/api/conversations")
        }
        if (path.contains("/statuses")) Cache.bustAll("/api/statuses")
        if (path.contains("/api/me")) Cache.bust("/api/me")
    }

    fun request(path: String, method: String, body: JSONObject?): JSONObject {
        val url = if (path.startsWith("http")) path else "$BASE$path"
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        val payload = body?.toString()?.toRequestBody(JSON)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(payload ?: ByteArray(0).toRequestBody(JSON))
            "PATCH" -> builder.patch(payload ?: ByteArray(0).toRequestBody(JSON))
            "DELETE" -> builder.delete(payload ?: ByteArray(0).toRequestBody(JSON))
            else -> builder.method(method, payload)
        }
        return executeJson(builder.build())
    }

    /**
     * Backpressure, honoured.
     *
     * 429 (rate limit) and 503 (the D1 quota guard) carry `Retry-After`; until it
     * passes, pollers ask `inCooldown()` and skip their tick. Without this a
     * throttled client retried on its very next 2s tick — a failing backend plus a
     * fixed-interval poller is a storm, and on 2026-09-01 that storm is what kept
     * the quota dead for the last hour of the day.
     */
    @Volatile private var cooldownUntil = 0L
    fun inCooldown(): Boolean = System.currentTimeMillis() < cooldownUntil

    private fun noteBackpressure(resp: okhttp3.Response) {
        when (resp.code) {
            429, 503 -> {
                val secs = resp.header("retry-after")?.toLongOrNull()?.coerceIn(5, 300) ?: 30
                val until = System.currentTimeMillis() + secs * 1000L
                if (until > cooldownUntil) cooldownUntil = until
            }
            else -> if (resp.isSuccessful) cooldownUntil = 0
        }
    }

    private fun executeJson(req: Request, allowRefresh: Boolean = true): JSONObject {
        http.newCall(req).execute().use { resp ->
            noteBackpressure(resp)
            val text = resp.body?.string().orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!resp.isSuccessful) {
                val msg = json.optJSONObject("error")?.optString("message") ?: "Request failed."
                // §37: a 401 gets ONE silent refresh and then ONE retry of the same
                // request. `allowRefresh` is false on that retry, so the exchange
                // cannot loop, and refreshSession() is single-flight, so a screen
                // that fires five parallel requests does not send five refreshes.
                if (resp.code == 401 && allowRefresh && refreshSession()) {
                    return executeJson(req, allowRefresh = false)
                }
                // An expired/revoked session used to surface as empty screens with
                // no way out. Flip the auth gate so the login screen comes back.
                if (resp.code == 401 && !token.isNullOrBlank()) {
                    token = null
                    // Post to main thread: Compose state must be written on Main.
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        Store.authed.value = false
                    }
                }
                throw ApiException(resp.code, msg)
            }
            return json
        }
    }

    /**
     * §37: ask the API to slide this session's expiry. Returns true only on a 2xx —
     * a failed refresh is the caller's cue to sign out, never a reason to retry.
     *
     * Deliberately dumb about the token itself: the server extends the row this token
     * already points at (no rotation), because a rotated token would have to be
     * persisted from a background thread and every in-flight request would then be
     * authenticated by a value that just stopped working. Nothing here is stored, so
     * there is nothing to get out of sync.
     *
     * `lastRefreshTry` is the loop break for the *other* direction — a session that is
     * really gone gets one attempt per minute instead of one per failed request.
     */
    @Volatile private var lastRefreshTry = 0L
    private val refreshing = java.util.concurrent.atomic.AtomicBoolean(false)

    fun refreshSession(): Boolean {
        if (token.isNullOrBlank()) return false
        if (System.currentTimeMillis() - lastRefreshTry < 60_000) return false
        if (!refreshing.compareAndSet(false, true)) return false
        lastRefreshTry = System.currentTimeMillis()
        return try {
            val req =
                Request.Builder()
                    .url("$BASE/api/auth/refresh")
                    .post(ByteArray(0).toRequestBody(JSON))
                    .build()
            http.newCall(req).execute().use { resp ->
                noteBackpressure(resp)
                resp.isSuccessful
            }
        } catch (e: Exception) {
            false
        } finally {
            refreshing.set(false)
        }
    }

    /**
     * The gap between background poll ticks.
     *
     * A live socket makes the tick irrelevant (10s, just watching for death), so
     * the 2s fallback only ever runs when realtime is down — which is exactly
     * when the API is also likely to be failing. Grow the gap on consecutive
     * failures (2s → 4 → 8 → 15) and reset on the first success: a healthy client
     * never notices, a struggling one stops amplifying itself, and a process that
     * spends all day with a dead socket stops costing 43k requests against a
     * quota it is already failing to hit.
     */
    object PollCadence {
        private val steps = longArrayOf(2_000L, 4_000L, 8_000L, 15_000L)

        @Volatile private var misses = 0

        fun failed() {
            misses = (misses + 1).coerceAtMost(steps.size - 1)
        }

        fun succeeded() {
            misses = 0
        }

        fun tick(live: Boolean): Long =
            if (live) 10_000L else steps[misses.coerceIn(0, steps.size - 1)]
    }

    fun q(value: String) = URLEncoder.encode(value, "UTF-8")

    private fun encodePath(value: String) = value.split("/").joinToString("/") { q(it) }

    private class AuthInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val t = token
            val req =
                if (t.isNullOrBlank()) chain.request()
                else chain.request().newBuilder().header("Authorization", "Bearer $t").build()
            return chain.proceed(req)
        }
    }

}


/**
 * v3.7 realtime layer: foreground delivery over WebSockets instead of timer
 * polling. One connection per channel — the open chat, the user's list
 * channel, the live call — each with exponential-backoff reconnect.
 *
 * Events are TRIGGERS, not data: a listener that gets {type:"message"} runs
 * the exact sync it always ran (a marker GET), just instantly. A socket that
 * is down changes nothing — callers fall back to their legacy poll loops, so
 * the worst case is the behaviour the app shipped with.
 */
object KpSocket {
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, throwable ->
                android.util.Log.e("KP_CRASH", "KpSocket uncaught", throwable)
            }
    )

    /**
     * The API client's config plus a WS ping every 20s. Cloudflare closes
     * idle sockets; without pings a quiet chat socket dies to an idle
     * timeout and every frame after that is lost until reconnect.
     */
    private val wsHttp: OkHttpClient by lazy {
        Api.http.newBuilder().pingInterval(20, TimeUnit.SECONDS).build()
    }

    private class Conn(val path: String) {
        @Volatile var ws: WebSocket? = null
        @Volatile var want = false
        // True while newWebSocket() is in flight (before onOpen/onFailure).
        // Without it, a join() arriving mid-handshake starts a SECOND socket
        // on the same channel; leave() then closes only the latest one and
        // the older stays open (duplicate events + server-side leak until
        // the Cloudflare idle timeout).
        @Volatile var connecting = false
        @Volatile var attempts = 0
        @Volatile var reconnectJob: kotlinx.coroutines.Job? = null
        @Volatile var hbJob: kotlinx.coroutines.Job? = null
        val live = MutableStateFlow(false)
    }

    private val conns = ConcurrentHashMap<String, Conn>()
    private val listeners = CopyOnWriteArrayList<(JSONObject) -> Unit>()

    /** Register an event listener; the returned closure unregisters it. */
    fun onEvent(fn: (JSONObject) -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    fun isLive(path: String): Boolean = conns[path]?.live?.value == true

    fun join(path: String) {
        val c = conns.getOrPut(path) { Conn(path) }
        // `connecting` in the guard: a socket can be wanted-but-not-yet-open
        // (handshake in flight, or backoff pending); joining again there used
        // to spawn a parallel WebSocket on the same channel.
        if (c.want && (c.ws != null || c.connecting)) return
        c.want = true
        connect(c)
    }

    fun leave(path: String) {
        val c = conns.remove(path) ?: return
        c.want = false
        c.live.value = false
        c.reconnectJob?.cancel()
        c.hbJob?.cancel()
        c.hbJob = null
        runCatching { c.ws?.close(1000, "leave") }
        c.ws = null
        c.connecting = false
    }

    private fun connect(c: Conn) {
        if (!c.want || c.ws != null || c.connecting) return
        val token = Api.token
        if (token.isNullOrBlank()) {
            scheduleReconnect(c)
            return
        }
        val req =
            Request.Builder()
                .url(Api.BASE + c.path)
                .header("Authorization", "Bearer $token")
                .build()
        c.connecting = true
        c.ws = wsHttp.newWebSocket(
            req,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    c.connecting = false
                    c.attempts = 0
                    c.live.value = true
                    startHeartbeat(c, webSocket)
                    // Proven-reachable network, right now: the cheapest possible
                    // signal that anything sitting in the outbox should go out.
                    Outbox.kick(300, force = true)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val ev = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (ev.optString("type") == "hello") c.live.value = true
                    listeners.forEach { l -> runCatching { l(ev) } }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    // Stale socket (a newer one already replaced it): ignore
                    // — acting on a dead socket's late callback is what used
                    // to schedule a second reconnect and double-connect.
                    if (webSocket !== c.ws) return
                    // The socket is DEAD: clear it or every future join()
                    // early-returns on the stale reference and the channel
                    // stays silent for the rest of the process's life.
                    c.hbJob?.cancel()
                    c.hbJob = null
                    c.ws = null
                    c.connecting = false
                    c.live.value = false
                    if (c.want) scheduleReconnect(c)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (webSocket !== c.ws) return
                    // ANY close while we still want the channel reconnects —
                    // including server idle-timeout close(1000). Deliberate
                    // leave() clears `want` first, so it never reconnects.
                    c.hbJob?.cancel()
                    c.hbJob = null
                    c.ws = null
                    c.connecting = false
                    c.live.value = false
                    if (c.want) scheduleReconnect(c)
                }
            },
        )
    }

    /**
     * App-level heartbeat. The OkHttp pingInterval(20s) sends a WebSocket
     * *control* Ping frame, which Cloudflare's Durable-Object Hibernation API
     * answers automatically at the protocol level — it does NOT surface to the
     * DO's webSocketMessage handler. So the server cannot use it to tell a live
     * process from a frozen/killed one, which is exactly the "swipe but the
     * socket half-open" false positive that made push choose the wrong shape.
     * We send a real data frame instead: the DO records it (webSocketMessage)
     * and only counts a socket as alive if it heartbeated within STALE_MS. A
     * process the OEM froze/killed stops sending immediately, so the socket is
     * correctly classified as dead and the push falls back to the guaranteed
     * system payload instead of a silent data-only send.
     */
    private fun startHeartbeat(c: Conn, ws: WebSocket) {
        c.hbJob?.cancel()
        c.hbJob = scope.launch {
            while (true) {
                kotlinx.coroutines.delay(20_000)
                if (!c.live.value) break
                runCatching { ws.send("{\"type\":\"hb\",\"at\":${System.currentTimeMillis()}}") }
            }
        }
    }

    private fun scheduleReconnect(c: Conn) {
        if (!c.want) return
        // One pending reconnect per channel: overlapping timers each used to
        // call connect() and create extra sockets on the same path.
        c.reconnectJob?.cancel()
        val backoff = minOf(30_000L, 1_000L shl minOf(c.attempts, 5))
        c.attempts += 1
        c.reconnectJob = scope.launch {
            delay(backoff)
            connect(c)
        }
    }

    /* channel helpers */

    fun joinChat(convId: String) = join("/ws/chat/$convId")
    fun leaveChat(convId: String) = leave("/ws/chat/$convId")
    fun chatLive(convId: String) = isLive("/ws/chat/$convId")

    fun joinUser() = join("/ws/user")
    fun leaveUser() = leave("/ws/user")
    fun userLive() = isLive("/ws/user")

    fun joinCall(callId: String) = join("/ws/call/$callId")
    fun leaveCall(callId: String) = leave("/ws/call/$callId")
    fun callLive(callId: String) = isLive("/ws/call/$callId")
}

class ApiException(val status: Int, override val message: String) : Exception(message)

fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

/** Android org.json turns JSON null into the string "null" via optString. */
fun JSONObject.optIso(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val s = optString(key)
    return s.takeIf { it.isNotBlank() && it != "null" }
}

/** optString() for DISPLAY text: JSON null and missing keys both become "". */
fun JSONObject.optText(key: String): String = optIso(key).orEmpty()
