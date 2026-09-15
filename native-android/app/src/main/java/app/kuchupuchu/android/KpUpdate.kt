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
    // Owner round 37 (item 4): a commit is in the system's hands — the
    // sheet says Installing until the status broadcast lands.
    var installing by mutableStateOf(false)
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
                            // Owner round 34 (item 2): the release carries both
                            // apks — fetch the one matching this install, so a
                            // release build never tries to swallow the debug
                            // file (or the other way round); either mismatch
                            // answers INSTALL_FAILED_UPDATE_INCOMPATIBLE.
                            val wantDebug =
                                (ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
                            var url: String? = null
                            var fallback: String? = null
                            for (i in 0 until assets.length()) {
                                val a = assets.getJSONObject(i)
                                val name = a.optString("name")
                                if (!name.endsWith(".apk")) continue
                                val assetUrl = a.optString("browser_download_url")
                                fallback = assetUrl
                                if (name.contains("debug", ignoreCase = true) == wantDebug) url = assetUrl
                            }
                            apkUrl = url ?: fallback ?: return@runCatching
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
        if (downloading) return
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
                    // Owner round 34 (item 2): a dropped connection can
                    // end the stream cleanly — short of the promised bytes.
                    if (total > 0 && out.length() != total) {
                        error("Update file was damaged — tap Update to download again")
                    }
                    verifyUpdateApk(ctx, out)
                    progress = 1f
                    out
                }
            }
            ready = apk
            // Release solidity: the crash report's crumbs must say which
            // update phase was last — a blind installer crash is undebuggable.
            KpCrash.mark("update_ready")
        } catch (e: Exception) {
            // Never leave a partial or rejected file behind for the next run.
            runCatching { File(ctx.filesDir, "kp-update.apk").delete() }
            KpCrash.mark("update_dl_failed:${e.javaClass.simpleName}")
            downloadError = e.message ?: "Download failed"
        } finally {
            downloading = false
        }
    }

    /**
     * Owner round 34 (item 2): the downloaded bytes are guilty until proven
     * innocent. NOTHING unverified may reach the system installer — a
     * truncated or mis-signed file turns the Update tap into a crash on some
     * OEM builds instead of an error card. Throws with the exact words the
     * sheet should show; every throw path deletes the bad file via the
     * download catch.
     */
    private fun verifyUpdateApk(ctx: Context, apk: File) {
        val damaged = "Update file was damaged — tap Update to download again"
        if (!apk.exists() || apk.length() <= 0) error(damaged)
        val pm = ctx.packageManager
        val archive = parseArchive(pm, apk) ?: error(damaged)
        if (archive.packageName != ctx.packageName) error(damaged)
        val archiveCode =
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                archive.longVersionCode
            } else {
                @Suppress("DEPRECATION") archive.versionCode.toLong()
            }
        if (archiveCode <= installedVersionCode(ctx)) {
            error("holds no newer build — try again later")
        }
        // Same package + newer build is not enough: the bytes must carry the
        // install's own signing key (a CI debug key rotates every build, so a
        // debug install can never swallow another CI's apk — correctly
        // refused here with words, not as an installer crash). Keys rotate
        // nowhere in this project, so a plain set-equality holds; if either
        // side's certs are unreadable we fail OPEN and let the system's own
        // check be the judge.
        val mine = signingSet(pm, ctx.packageName)
        val theirs = archiveCerts(archive)
        if (mine != null && theirs != null && mine != theirs) {
            error("This update wasn't built for your install — grab the full APK from the release page")
        }
    }

    private fun parseArchive(
        pm: android.content.pm.PackageManager,
        apk: File,
    ): android.content.pm.PackageInfo? =
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                pm.getPackageArchiveInfo(
                    apk.absolutePath,
                    android.content.pm.PackageManager.PackageInfoFlags.of(
                        android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES.toLong(),
                    ),
                )
            } else if (android.os.Build.VERSION.SDK_INT >= 28) {
                @Suppress("DEPRECATION")
                pm.getPackageArchiveInfo(apk.absolutePath, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageArchiveInfo(apk.absolutePath, android.content.pm.PackageManager.GET_SIGNATURES)
            }
        }.getOrNull()

    private fun signingSet(
        pm: android.content.pm.PackageManager,
        packageName: String,
    ): Set<android.content.pm.Signature>? =
        runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                val pi =
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        pm.getPackageInfo(
                            packageName,
                            android.content.pm.PackageManager.PackageInfoFlags.of(
                                android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES.toLong(),
                            ),
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES)
                    }
                pi.signingInfo?.apkContentsSigners?.toSet()
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES)?.signatures?.toSet()
            }
        }.getOrNull()

    private fun archiveCerts(archive: android.content.pm.PackageInfo): Set<android.content.pm.Signature>? =
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            archive.signingInfo?.apkContentsSigners?.toSet()
        } else {
            @Suppress("DEPRECATION") archive.signatures?.toSet()
        }

    /** The Install tap: hands the downloaded APK to the system installer. */
    suspend fun installReady(ctx: Context) {
        val apk = ready ?: return
        // A second Install tap mid-commit used to open a second session —
        // two commits, two confirms, chaos. One flight at a time.
        if (installing) return
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
        installing = true
        runCatching { withContext(Dispatchers.IO) { install(ctx, apk) } }
            .onFailure {
                installing = false
                KpCrash.mark("update_install_failed:${it.javaClass.simpleName}")
                downloadError = it.message ?: "Install failed"
            }
    }

    /** Prefs-backed install outcome — survives the process dying mid-install.
     *  A kill looks like a crash and wipes every in-memory error with it, so
     *  the commit + every terminal status land in prefs, and the next launch
     *  explains what happened instead of showing nothing (owner r37 item 4). */
    fun noteCommitted(ctx: Context) {
        ctx.getSharedPreferences("kp_update", Context.MODE_PRIVATE).edit()
            .putBoolean("inflight", true)
            .putLong("at", System.currentTimeMillis())
            .remove("lastMsg")
            .apply()
    }

    fun noteStatus(ctx: Context, code: Int, msg: String?) {
        // Only PENDING_USER_ACTION is non-terminal — everything else ends it.
        ctx.getSharedPreferences("kp_update", Context.MODE_PRIVATE).edit()
            .putInt("lastCode", code)
            .putString("lastMsg", msg ?: "")
            .putBoolean("inflight", code == PackageInstaller.STATUS_PENDING_USER_ACTION)
            .apply()
    }

    /** Next launch after a commit: what happened? Null = nothing to say. */
    fun consumeInstallResult(ctx: Context): String? =
        runCatching {
            val prefs = ctx.getSharedPreferences("kp_update", Context.MODE_PRIVATE)
            if (!prefs.getBoolean("inflight", false)) return@runCatching null
            prefs.edit().putBoolean("inflight", false).apply()
            if (prefs.getInt("lastCode", -999) == PackageInstaller.STATUS_SUCCESS) return@runCatching null
            val msg = prefs.getString("lastMsg", "").orEmpty()
            if (msg.isNotBlank()) "Update didn't install: $msg"
            else "The update was interrupted — tap Update to try again."
        }.getOrNull()

    /** PackageInstaller session — Android shows its confirm sheet ON TOP of
     *  the app; confirming installs the update in place. */
    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        // Owner round 34 (item 2): attribute the session — some OEM confirm
        // screens only label (and finish) sessions that name their package.
        params.setAppPackageName(ctx.packageName)
        val sessionId = installer.createSession(params)
        try {
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
            noteCommitted(ctx)
            KpCrash.mark("update_committed")
            session.close()
        } catch (e: Exception) {
            KpCrash.mark("update_session_failed:${e.javaClass.simpleName}")
            runCatching { installer.abandonSession(sessionId) }
            throw e
        }
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
        // Owner round 34 (item 2): a system status broadcast must never take
        // the app down with it — last-resort guard; the branches stay exact.
        // (runCatching is inline, so the early return below still leaves
        // onReceive itself, exactly as before.)
        runCatching {
            val code = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            when (code) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    @Suppress("DEPRECATION")
                    val confirm =
                        if (android.os.Build.VERSION.SDK_INT >= 33) {
                            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                        } else {
                            intent.getParcelableExtra(Intent.EXTRA_INTENT)
                        }
                    if (confirm == null) {
                        KpUpdate.installing = false
                        KpUpdate.noteStatus(ctx, PackageInstaller.STATUS_FAILURE, "Install failed")
                        KpUpdate.downloadError = "Install failed"
                        return
                    }
                    KpCrash.mark("update_confirm_shown")
                    runCatching { ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        .onFailure {
                            KpUpdate.installing = false
                            KpUpdate.noteStatus(ctx, PackageInstaller.STATUS_FAILURE, "Install failed")
                            KpUpdate.downloadError = "Install failed"
                        }
                }
                PackageInstaller.STATUS_SUCCESS -> {
                    KpUpdate.installing = false
                    KpUpdate.noteStatus(ctx, code, null)
                    ctx.filesDir.resolve("kp-update.apk").delete()
                }
                // The user dismissed the system sheet: keep the APK, no error text.
                PackageInstaller.STATUS_FAILURE_ABORTED -> {
                    KpUpdate.installing = false
                    KpUpdate.noteStatus(ctx, code, null)
                }
                else -> {
                    // Owner round 37 (item 4): a FAILED install used to die
                    // silently in a backgrounded (often reclaimed) process —
                    // no toast, no report, update just never happened. Now it
                    // persists to prefs, toasts LOUDLY, and names itself.
                    val msg =
                        intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                            ?: "Install failed ($code)"
                    KpUpdate.installing = false
                    KpUpdate.noteStatus(ctx, code, msg)
                    KpCrash.mark("update_rx_failed:$code")
                    KpUpdate.downloadError = msg
                    runCatching {
                        android.widget.Toast.makeText(ctx, msg, android.widget.Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }
}
