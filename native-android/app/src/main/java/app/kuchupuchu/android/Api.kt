package app.kuchupuchu.android

import android.content.Context
import okhttp3.ConnectionPool
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
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
