package app.kuchupuchu.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

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
        if (path.contains("/conversations")) Cache.bust("/api/conversations")
        if (path.contains("/posts") || path.contains("/feed") || path.contains("/stories")) {
            Cache.bust("/api/feed")
            Cache.bust("/api/stories")
        }
        if (path.contains("/notifications") || path.contains("/friend")) {
            Cache.bust("/api/notifications")
            Cache.bust("/api/friend")
        }
        if (path.contains("/api/me") || path.contains("/wallet") || path.contains("/store")) {
            Cache.bust("/api/me")
        }
        return data
    }

    fun patch(path: String, body: JSONObject): JSONObject = request(path, "PATCH", body)

    fun delete(path: String): JSONObject = request(path, "DELETE", JSONObject())

    fun request(path: String, method: String, body: JSONObject?): JSONObject {
        val url = if (path.startsWith("http")) path else "$BASE$path"
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20000
            readTimeout = 25000
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
}

class ApiException(val status: Int, override val message: String) : Exception(message)

fun JSONObject.arr(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
