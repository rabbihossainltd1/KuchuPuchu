package app.kuchupuchu.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * v3 API client — talks to the KuchuPuchu v3 worker
 * (https://kuchupuchu-api.kuchupuchu.workers.dev).
 *
 * Same tiny HttpURLConnection + org.json approach as v2 (no extra
 * dependencies), with a short-lived per-path response cache so tab
 * switches feel instant without hammering D1.
 */
object Api {
    const val BASE = "https://kuchupuchu-api.kuchupuchu.workers.dev"
    private const val TOKEN_KEY = "kp_session_token"

    @Volatile
    var token: String? = null

    fun loadToken(ctx: Context) {
        token = ctx.getSharedPreferences("kp", 0).getString(TOKEN_KEY, null)
    }

    fun saveToken(ctx: Context, value: String?) {
        token = value
        ctx.getSharedPreferences("kp", 0).edit().putString(TOKEN_KEY, value).apply()
    }

    fun get(path: String, force: Boolean = false): JSONObject {
        if (!force) Cache.get(path)?.let { return it }
        val data = request(path, "GET", null)
        Cache.put(path, data)
        return data
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

    /** Uploads a raw file to R2 via the worker. Returns { fileKey } . */
    fun upload(name: String, mime: String, bytes: ByteArray): JSONObject {
        val path = "/api/files?name=${q(name)}&type=${q(mime)}"
        val conn = (URL(BASE + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 60_000
            readTimeout = 120_000
            setRequestProperty("Authorization", "Bearer ${token ?: ""}")
            setRequestProperty("Content-Type", "application/octet-stream")
            doOutput = true
            outputStream.use { it.write(bytes) }
        }
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.readText().orEmpty()
        val json = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (code !in 200..299) {
            throw ApiException(code, json.optJSONObject("error")?.optString("message") ?: "Upload failed.")
        }
        return json
    }

    /** Downloads bytes for an R2 file key or an API path ("/api/messages/x/media"). */
    fun download(pathOrKey: String): ByteArray {
        val url =
            if (pathOrKey.startsWith("http")) pathOrKey
            else if (pathOrKey.startsWith("/")) BASE + pathOrKey
            else "$BASE/api/files/${encodePath(pathOrKey)}"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 30_000
            readTimeout = 60_000
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        val code = conn.responseCode
        if (code !in 200..299) throw ApiException(code, "Download failed.")
        return conn.inputStream.use { ins ->
            val buf = ByteArrayOutputStream(maxOf(8192, conn.contentLength))
            val chunk = ByteArray(64 * 1024)
            while (true) {
                val n = ins.read(chunk)
                if (n < 0) break
                buf.write(chunk, 0, n)
            }
            buf.toByteArray()
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
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20_000
            readTimeout = 25_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
            if (body != null && method != "GET") {
                doOutput = true
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.readText().orEmpty()
        val json = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (code !in 200..299) {
            val msg = json.optJSONObject("error")?.optString("message") ?: "Request failed."
            throw ApiException(code, msg)
        }
        return json
    }

    fun q(value: String) = URLEncoder.encode(value, "UTF-8")

    private fun encodePath(value: String) = value.split("/").joinToString("/") { q(it) }
}

class ApiException(val status: Int, override val message: String) : Exception(message)

fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
