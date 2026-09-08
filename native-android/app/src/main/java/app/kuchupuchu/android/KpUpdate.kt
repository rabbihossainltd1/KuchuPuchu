package app.kuchupuchu.android

import android.content.pm.PackageInstaller
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

    // Owner round 31: the downloaded APK waits here until the user taps
    // Install — the sheet never vanishes on its own after the download.
    var ready by mutableStateOf<File?>(null)

    fun installedVersionCode(ctx: Context): Int =
        runCatching {
                val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
                // longVersionCode needs API 28; versionCode (int) covers 24-27.
                if (android.os.Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else @Suppress("DEPRECATION") pi.versionCode
            }
            .getOrDefault(0)

    /** Best-effort check; never throws. Call off the main thread. */
    suspend fun check(ctx: Context) {
        if (checking || downloading) return
        checking = true
        try {
            withContext(Dispatchers.IO) {
                runCatching {
                    // Owner round 28: conditional request. GitHub's anonymous
                    // API budget is 60/hour per IP and a 304 does not count
                    // against it — carrier NAT puts many phones behind one IP,
                    // so every check that can be a 304 should be one.
                    val prefs = ctx.getSharedPreferences("kp_update", Context.MODE_PRIVATE)
                    val etag = prefs.getString("etag", null)
                    val req = okhttp3.Request.Builder()
                        .url(API)
                        .header("Accept", "application/vnd.github+json")
                        // Belt and braces with Api.isOwnHost(): whatever the
                        // shared client does, GitHub must never see a bearer.
                        .removeHeader("Authorization")
                        .apply { if (!etag.isNullOrBlank()) header("If-None-Match", etag) }
                        .build()
                    Api.http.newCall(req).execute().use { res ->
                        val remoteCode: Int
                        val apkUrl: String
                        if (res.code == 304 && prefs.contains("code")) {
                            remoteCode = prefs.getInt("code", 0)
                            apkUrl = prefs.getString("url", "") ?: ""
                        } else {
                            if (!res.isSuccessful) return@runCatching
                            val body = res.body?.string() ?: return@runCatching
                            val rel = JSONObject(body)
                            val tag = rel.optString("tag_name").trimStart('v', 'V')
                            remoteCode = tag.toIntOrNull() ?: return@runCatching
                            val assets = rel.optJSONArray("assets") ?: return@runCatching
                            var url: String? = null
                            for (i in 0 until assets.length()) {
                                val a = assets.getJSONObject(i)
                                val name = a.optString("name")
                                if (name.endsWith(".apk")) url = a.optString("browser_download_url")
                            }
                            apkUrl = url ?: return@runCatching
                            prefs.edit()
                                .putString("etag", res.header("ETag"))
                                .putInt("code", remoteCode)
                                .putString("url", apkUrl)
                                .apply()
                        }
                        if (apkUrl.isNotBlank() && remoteCode > installedVersionCode(ctx)) {
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

    /** Streams the APK to app storage with progress; the sheet then offers
     *  Install (owner round 31 — it used to fire the installer and hide). */
    suspend fun downloadAndInstall(ctx: Context) {
        val pair = available ?: return
        val (_, url) = pair
        downloading = true
        progress = 0f
        downloadError = ""
        ready = null
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
            ready = apk
        } catch (e: Exception) {
            downloadError = e.message ?: "Download failed"
        } finally {
            downloading = false
        }
    }

    /** The Install tap: hands the downloaded APK to the system installer. */
    suspend fun installReady(ctx: Context) {
        val apk = ready ?: return
        // Owner round 32 (item 1C): on Android 8+ REQUEST_INSTALL_PACKAGES only
        // lets the app ASK — the user grants "install unknown apps" per source
        // in system settings. Without it PackageInstaller.commit() is refused
        // with nothing visible ("Install e click korle kichu hoy na"). Take
        // the user to that exact page; coming back, Install works.
        if (android.os.Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            downloadError = ""
            runCatching {
                ctx.startActivity(
                    Intent(
                        android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        android.net.Uri.parse("package:${ctx.packageName}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }.onFailure { downloadError = "Allow installs from KuchuPuchu in Settings" }
            return
        }
        runCatching { withContext(Dispatchers.IO) { install(ctx, apk) } }
            .onFailure { downloadError = it.message ?: "Install failed" }
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

/**
 * Installer session status receiver.
 *
 * Owner round 32 (item 1C): the system's "Install this update?" sheet is NOT
 * shown by commit() itself. The platform answers the commit with
 * STATUS_PENDING_USER_ACTION and hands the confirmation activity to this
 * receiver as EXTRA_INTENT; the app must start it. This receiver only ever
 * handled STATUS_SUCCESS, so the confirm intent was dropped on the floor and
 * Install visibly did nothing. A failure now surfaces through downloadError
 * (the sheet is still up) instead of vanishing.
 */
class KpUpdateReceiver : android.content.BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm =
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                    } else {
                        intent.getParcelableExtra(Intent.EXTRA_INTENT)
                    }
                if (confirm == null) {
                    KpUpdate.downloadError = "Install failed"
                    return
                }
                runCatching { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    .onFailure { KpUpdate.downloadError = "Install failed" }
            }
            PackageInstaller.STATUS_SUCCESS -> ctx.filesDir.resolve("kp-update.apk").delete()
            // The user dismissed the system sheet: keep the APK, no error text.
            PackageInstaller.STATUS_FAILURE_ABORTED -> {}
            else ->
                KpUpdate.downloadError =
                    intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install failed"
        }
    }
}
