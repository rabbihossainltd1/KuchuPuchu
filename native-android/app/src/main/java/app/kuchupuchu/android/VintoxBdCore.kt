package app.kuchupuchu.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.os.PersistableBundle
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.net.URLDecoder
import java.util.concurrent.TimeUnit

/**
 * The VintoxBd communication core, seen from the app (plan §13.13).
 *
 * The app IS KuchuPuchu: it signs in against its own API and holds that session.
 * Realm-aware features — the linked-account state, and later the classroom —
 * live in the core, which mints its own credentials. This object is the ONE
 * bridge between the two: the app presents the session it already has, the core
 * asks the legacy API who that is, and answers with an ordinary core session
 * for the KP-realm account that corresponds to it (`/api/auth/app/exchange`).
 *
 * Nothing else about the app changes: if the core is unreachable or the bridge
 * is switched off, every other part of the app keeps working exactly as before.
 * The core token is stored separately from the app's own token, and is never
 * mixed with it.
 */
/**
 * Local memory of "this app WAS linked to VintoxBd", so a link that disappears
 * reads as something that happened to the user (revoked, re-auth needed) and
 * not as a first-time state (plan §13.13).
 */
object LinkMemory {
    private const val KEY = "kp_core_link_seen"

    fun seen(ctx: Context): Boolean = ctx.getSharedPreferences("kp", 0).getBoolean(KEY, false)

    fun markSeen(ctx: Context, value: Boolean) {
        ctx.getSharedPreferences("kp", 0).edit().putBoolean(KEY, value).apply()
    }
}

object CoreApi {
    /** The single core origin for this build (gradle `kpCoreBase`, §13.13). */
    val base: String = BuildConfig.CORE_BASE.trimEnd('/')

    private const val TOKEN_KEY = "kp_core_token"
    private const val SESSION_KEY = "kp_core_session"

    @Volatile
    var token: String? = null
        private set

    /** The core account this app is, once the exchange has answered. */
    @Volatile
    var me: JSONObject? = null
        private set

    private val JSON_MT = "application/json; charset=utf-8".toMediaType()
    private val http: OkHttpClient by lazy {
        // Its own client on purpose: Api.http carries the app's bearer in an
        // interceptor, and the core must only ever receive the core's own.
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /** A refusal that carries the core's own words for the screen. */
    class CoreError(message: String, val code: String = "", val status: Int = 0) :
        Exception(message)

    fun load(ctx: Context) {
        val prefs = ctx.getSharedPreferences("kp", 0)
        token = prefs.getString(TOKEN_KEY, null)
        me = prefs.getString(SESSION_KEY, null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    }

    fun forget(ctx: Context) {
        token = null
        me = null
        ctx.getSharedPreferences("kp", 0).edit().remove(TOKEN_KEY).remove(SESSION_KEY).apply()
    }

    private fun save(ctx: Context, value: String, user: JSONObject?) {
        token = value
        me = user
        ctx.getSharedPreferences("kp", 0)
            .edit()
            .putString(TOKEN_KEY, value)
            .putString(SESSION_KEY, user?.toString())
            .apply()
    }

    /**
     * A core session, minted on first use and reused afterwards. `force`
     * re-exchanges (an expired or revoked core session), which is exactly what
     * "link again" means on the screen.
     */
    fun session(ctx: Context, force: Boolean = false): String {
        if (!force) token?.takeIf { it.isNotBlank() }?.let { return it }
        load(ctx)
        if (!force) token?.takeIf { it.isNotBlank() }?.let { return it }
        val legacy = Api.token
        if (legacy.isNullOrBlank())
            throw CoreError("Sign in to the app again to connect VintoxBd.", "NO_APP_SESSION")
        val answer = send(
            "/api/auth/app/exchange",
            "POST",
            JSONObject().put("token", legacy).put("deviceId", KpPush.deviceId(ctx)),
            null,
        )
        val minted = answer.optString("token")
        if (minted.isBlank())
            throw CoreError("The link service did not return a session.", "NO_CORE_SESSION")
        save(ctx, minted, answer.optJSONObject("user"))
        return minted
    }

    fun get(ctx: Context, path: String): JSONObject = send(path, "GET", null, session(ctx))

    fun post(ctx: Context, path: String, body: JSONObject = JSONObject()): JSONObject =
        send(path, "POST", body, session(ctx))

    private fun send(path: String, method: String, body: JSONObject?, bearer: String?): JSONObject {
        val builder = Request.Builder().url(base + path).header("Accept", "application/json")
        if (bearer != null) builder.header("Authorization", "Bearer $bearer")
        val payload = if (method == "GET") null else (body ?: JSONObject()).toString()
        builder.method(method, payload?.toRequestBody(JSON_MT))
        val answer = try {
            http.newCall(builder.build()).execute()
        } catch (e: Exception) {
            throw CoreError("Can't reach VintoxBd right now. Check your connection.", "UNREACHABLE")
        }
        answer.use { response ->
            val text = response.body?.string().orEmpty()
            val json = runCatching { if (text.isBlank()) JSONObject() else JSONObject(text) }
                .getOrDefault(JSONObject())
            if (!response.isSuccessful) {
                val error = json.optJSONObject("error")
                throw CoreError(
                    error?.optString("message")?.takeIf { it.isNotBlank() }
                        ?: "VintoxBd refused that (${response.code}).",
                    error?.optString("code").orEmpty(),
                    response.code,
                )
            }
            return json
        }
    }

    /** Stream an authenticated first-party classroom material into Downloads. */
    suspend fun downloadToDownloads(ctx: Context, path: String, fallbackName: String): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(base + path)
                .header("Accept", "application/octet-stream")
                .header("Authorization", "Bearer ${session(ctx)}")
                .get()
                .build()
            val answer = try {
                http.newCall(request).execute()
            } catch (_: Exception) {
                throw CoreError("Can't download that material. Check your connection.", "UNREACHABLE")
            }
            answer.use { response ->
                if (!response.isSuccessful) {
                    val text = response.body?.string().orEmpty()
                    val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
                    val failure = json.optJSONObject("error")
                    throw CoreError(
                        failure?.optString("message")?.takeIf { it.isNotBlank() }
                            ?: "VintoxBd refused that download (${response.code}).",
                        failure?.optString("code").orEmpty(),
                        response.code,
                    )
                }
                val encodedName = Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE)
                    .find(response.header("Content-Disposition").orEmpty())?.groupValues?.getOrNull(1)
                val plainName = Regex("filename=\\\"?([^\\\";]+)", RegexOption.IGNORE_CASE)
                    .find(response.header("Content-Disposition").orEmpty())?.groupValues?.getOrNull(1)
                val received = encodedName?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
                    ?: plainName
                    ?: fallbackName
                val safe = received.replace(Regex("[^A-Za-z0-9._ -]"), "_")
                    .take(120)
                    .ifBlank { "class-material" }
                val mime = response.header("Content-Type").orEmpty()
                    .substringBefore(';')
                    .ifBlank { FilesUtil.mimeFor(safe, "") }
                val body = response.body ?: throw CoreError("That material was empty.", "EMPTY_MATERIAL")

                if (Build.VERSION.SDK_INT < 29) {
                    val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "KuchuPuchu")
                    if (!dir.exists()) dir.mkdirs()
                    val target = File(dir, safe)
                    body.byteStream().use { input -> target.outputStream().use { output -> input.copyTo(output, 64 * 1024) } }
                    return@withContext target.absolutePath
                }

                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safe)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/KuchuPuchu")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val target = ctx.contentResolver.insert(
                    MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                    values,
                ) ?: throw CoreError("Android could not create the download.", "DOWNLOAD_STORAGE")
                try {
                    val copied = body.byteStream().use { input ->
                        ctx.contentResolver.openOutputStream(target)?.use { output -> input.copyTo(output, 64 * 1024) }
                            ?: 0L
                    }
                    if (copied <= 0L) throw CoreError("That material was empty.", "EMPTY_MATERIAL")
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    ctx.contentResolver.update(target, values, null, null)
                    "Downloads/KuchuPuchu/$safe"
                } catch (error: Exception) {
                    runCatching { ctx.contentResolver.delete(target, null, null) }
                    throw error
                }
            }
        }

    /**
     * Put a one-time link code on the clipboard as SENSITIVE, so Android hides
     * it from the clipboard preview and from other apps' clipboard reads
     * (API 33+; older systems simply show it). The code is a credential: it is
     * never stored by the app and never logged.
     */
    fun copyCode(ctx: Context, label: String, value: String) {
        val clip = ClipData.newPlainText(label, value)
        clip.description.extras = PersistableBundle().apply {
            putBoolean("android.content.extra.IS_SENSITIVE", true)
        }
        runCatching {
            (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                .setPrimaryClip(clip)
        }
    }

    /** Blocking fetch for a screen: runs off the main thread. */
    suspend fun getAsync(ctx: Context, path: String): JSONObject =
        withContext(Dispatchers.IO) { get(ctx, path) }

    suspend fun postAsync(ctx: Context, path: String, body: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) { post(ctx, path, body) }
}
