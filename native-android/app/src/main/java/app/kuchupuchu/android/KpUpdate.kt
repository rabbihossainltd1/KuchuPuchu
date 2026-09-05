package app.kuchupuchu.android

import android.app.PackageInstaller
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * Owner round 16 (2026-09-05): in-app updates.
 *
 * The APK is released on GitHub (rabbihossainltd1/KuchuPuchu, releases/latest,
 * tag = v<versionCode> with the debug apk attached). On open — and from
 * Settings — the app checks that release, and when the tag is newer than the
 * installed versionCode it offers the update IN the app: the popup downloads
 * with a live progress bar + percentage (no browser), and when the bytes are
 * complete a PackageInstaller session installs it right over the app.
 */
object KpUpdate {
    private const val REPO = "rabbihossainltd1/KuchuPuchu"
    private const val API = "https://api.github.com/repos/$REPO/releases/latest"

    /** null while checking; a pair when a NEWER release exists. */
    var available by mutableStateOf<Pair<Int, String>?>(null) // versionCode to apk url
    var checking by mutableStateOf(false)
    var downloading by mutableStateOf(false)
    var progress by mutableStateOf(0f) // 0..1
    var downloadError by mutableStateOf("")

    fun installedVersionCode(ctx: Context): Int =
        runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).let { it.longVersionCode.toInt() } }
            .getOrDefault(0)

    /** Best-effort check; never throws. Call off the main thread. */
    suspend fun check(ctx: Context) {
        if (checking || downloading) return
        checking = true
        try {
            withContext(Dispatchers.IO) {
                runCatching {
                    val req = okhttp3.Request.Builder()
                        .url(API)
                        .header("Accept", "application/vnd.github+json")
                        .build()
                    Api.http.newCall(req).execute().use { res ->
                        if (!res.isSuccessful) return@runCatching
                        val body = res.body?.string() ?: return@runCatching
                        val rel = JSONObject(body)
                        val tag = rel.optString("tag_name").trimStart('v', 'V')
                        val remoteCode = tag.toIntOrNull() ?: return@runCatching
                        val assets = rel.optJSONArray("assets") ?: return@runCatching
                        var apkUrl: String? = null
                        for (i in 0 until assets.length()) {
                            val a = assets.getJSONObject(i)
                            val name = a.optString("name")
                            if (name.endsWith(".apk")) apkUrl = a.optString("browser_download_url")
                        }
                        if (apkUrl != null && remoteCode > installedVersionCode(ctx)) {
                            available = remoteCode to apkUrl
                        } else {
                            available = null
                        }
                    }
                }
            }
        } finally {
            checking = false
        }
    }

    /** Streams the APK to app storage with progress, then hands it to the
     *  system installer — the whole flow stays inside the app. */
    suspend fun downloadAndInstall(ctx: Context) {
        val pair = available ?: return
        val (_, url) = pair
        downloading = true
        progress = 0f
        downloadError = ""
        try {
            val apk = withContext(Dispatchers.IO) {
                val req = okhttp3.Request.Builder().url(url).build()
                Api.http.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) error("Download failed (${res.code})")
                    val total = res.body?.contentLength() ?: -1L
                    val out = File(ctx.filesDir, "kp-update.apk")
                    var read = 0L
                    res.body?.byteStream()?.use { input ->
                        out.outputStream().use { output ->
                            val buf = ByteArray(32 * 1024)
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                output.write(buf, 0, n)
                                read += n
                                if (total > 0) progress = (read.toFloat() / total).coerceIn(0f, 1f)
                            }
                        }
                    }
                    progress = 1f
                    out
                }
            }
            withContext(Dispatchers.IO) { install(ctx, apk) }
            available = null
        } catch (e: Exception) {
            downloadError = e.message ?: "Download failed"
        } finally {
            downloading = false
        }
    }

    /** PackageInstaller session — Android shows its confirm sheet ON TOP of
     *  the app; confirming installs the update in place. */
    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        session.openWrite("apk", 0, -1).use { out ->
            apk.inputStream().use { it.copyTo(out) }
            session.fsync(out)
        }
        // Commit with a minimal status receiver: the system's own confirm
        // dialog is the visible step, we only clean up after it.
        val receiverIntent = Intent(ctx, KpUpdateReceiver::class.java)
        val pending = android.app.PendingIntent.getBroadcast(
            ctx,
            sessionId,
            receiverIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE,
        )
        session.commit(pending.intentSender)
        session.close()
    }
}

/** Silently absorbs the installer session result (success or otherwise — the
 *  system UI already told the user; failures just leave the app as it was). */
class KpUpdateReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_SUCCESS) {
            ctx.filesDir.resolve("kp-update.apk").delete()
        }
    }
}
