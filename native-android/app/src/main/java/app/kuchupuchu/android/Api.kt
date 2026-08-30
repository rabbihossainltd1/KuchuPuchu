package app.kuchupuchu.android

import android.content.Context
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
import java.io.IOException
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
            .retryOnConnectionFailure(true)
            .addInterceptor(AuthInterceptor())
            .addInterceptor(GetRetryInterceptor())
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

    private fun executeJson(req: Request): JSONObject {
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val json = if (text.isBlank()) JSONObject() else JSONObject(text)
            if (!resp.isSuccessful) {
                val msg = json.optJSONObject("error")?.optString("message") ?: "Request failed."
                // An expired/revoked session used to surface as empty screens with
                // no way out. Flip the auth gate so the login screen comes back.
                if (resp.code == 401 && !token.isNullOrBlank()) {
                    token = null
                    Store.authed.value = false
                }
                throw ApiException(resp.code, msg)
            }
            return json
        }
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

    /** Idempotent GET only — POST retries can duplicate messages. */
    private class GetRetryInterceptor : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            if (req.method != "GET") return chain.proceed(req)
            var lastIo: IOException? = null
            repeat(3) { attempt ->
                try {
                    val resp = chain.proceed(req)
                    if (resp.isSuccessful || resp.code in 400..499) return resp
                    resp.close()
                } catch (e: IOException) {
                    lastIo = e
                }
                if (attempt < 2) Thread.sleep(200L * (1 shl attempt))
            }
            lastIo?.let { throw it }
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
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

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
        @Volatile var attempts = 0
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
        if (c.want && c.ws != null) return
        c.want = true
        connect(c)
    }

    fun leave(path: String) {
        val c = conns.remove(path) ?: return
        c.want = false
        c.live.value = false
        runCatching { c.ws?.close(1000, "leave") }
        c.ws = null
    }

    private fun connect(c: Conn) {
        if (!c.want || c.ws != null) return
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
        c.ws = wsHttp.newWebSocket(
            req,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    c.attempts = 0
                    c.live.value = true
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val ev = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (ev.optString("type") == "hello") c.live.value = true
                    listeners.forEach { l -> runCatching { l(ev) } }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    // The socket is DEAD: clear it or every future join()
                    // early-returns on the stale reference and the channel
                    // stays silent for the rest of the process's life.
                    c.ws = null
                    c.live.value = false
                    if (c.want) scheduleReconnect(c)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    // ANY close while we still want the channel reconnects —
                    // including server idle-timeout close(1000). Deliberate
                    // leave() clears `want` first, so it never reconnects.
                    c.ws = null
                    c.live.value = false
                    if (c.want) scheduleReconnect(c)
                }
            },
        )
    }

    private fun scheduleReconnect(c: Conn) {
        if (!c.want) return
        val backoff = minOf(30_000L, 1_000L shl minOf(c.attempts, 5))
        c.attempts += 1
        scope.launch {
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
