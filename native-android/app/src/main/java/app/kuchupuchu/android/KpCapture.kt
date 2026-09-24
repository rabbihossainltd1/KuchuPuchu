package app.kuchupuchu.android

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * r71-18 (owner item 18): the chat's ⋮ → "Chat privacy".
 *
 * "Screenshot alert" and "Screen record alert" are about being TOLD, so the
 * phone that captures the chat is the one that has to say so: Android 14
 * (API 34) is the first version that tells an app its own screen was captured,
 * and Android 15 added the screen-recording state on top. While the chat is the
 * one on screen this registers those callbacks and reports each capture to the
 * server, which alerts exactly the members who asked to be told (see
 * POST /api/conversations/:id/capture).
 *
 * r72-18 (owner: "screenshot alert ta android 14 newer keno ami to Snapchat a
 * dekhchi eita hocche Android 13/12 a o"): Android 12 and 13 have no capture
 * callback at all, but they do have the system's own Screenshots folder — the
 * phone that takes the shot writes the file, and any app holding the Photos
 * permission (READ_MEDIA_IMAGES on 13, READ_EXTERNAL_STORAGE below) can see it.
 * So on those versions a screenshot is reported by watching MediaStore while the
 * chat is on screen: a NEW screenshot in the system's Screenshots bucket, taken
 * in the last two minutes, is the capture of this chat. It is a folder heuristic
 * — honest about its limits (an OEM that names or stores them elsewhere is
 * missed) — never a pretend callback. Screen RECORDING has no folder to read, so
 * that switch stays Android 15+ and says so.
 */
object KpCapture {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var watched: Activity? = null
    private var convId = ""
    private var shotCallback: Activity.ScreenCaptureCallback? = null
    private var recCallback: java.util.function.Consumer<Int>? = null
    private var lastShot = 0L

    /** Start (or move) the watch — called from the chat that is on screen. */
    fun watch(activity: Activity?, conv: String) {
        if (activity == null || conv.isBlank()) {
            stop()
            return
        }
        if (watched === activity && convId == conv) return
        stop()
        watched = activity
        convId = conv
        if (Build.VERSION.SDK_INT >= 34) {
            val cb = Activity.ScreenCaptureCallback { report("shot") }
            runCatching {
                activity.registerScreenCaptureCallback(activity.mainExecutor, cb)
                shotCallback = cb
            }
        }
        // r72-18: Android 12/13 answer with the folder instead of a callback.
        if (folderPermission() != null && folderGranted(activity)) startFolder(activity)
        if (Build.VERSION.SDK_INT >= 35) {
            val cb = java.util.function.Consumer<Int> { state ->
                if (state == WindowManager.SCREEN_RECORDING_STATE_VISIBLE) report("rec")
            }
            runCatching {
                val wm = activity.getSystemService(WindowManager::class.java)
                // A recording that started BEFORE this chat was opened still
                // counts: the registration call answers the current state.
                val initial = wm.addScreenRecordingCallback(activity.mainExecutor, cb)
                recCallback = cb
                if (initial == WindowManager.SCREEN_RECORDING_STATE_VISIBLE) report("rec")
            }
        }
    }

    /** The chat left the screen — nothing to report for it any more. */
    fun stop() {
        stopFolder()
        val a = watched
        watched = null
        convId = ""
        if (a != null && Build.VERSION.SDK_INT >= 34) {
            shotCallback?.let { cb -> runCatching { a.unregisterScreenCaptureCallback(cb) } }
        }
        if (a != null && Build.VERSION.SDK_INT >= 35) {
            recCallback?.let { cb ->
                runCatching {
                    a.getSystemService(WindowManager::class.java).removeScreenRecordingCallback(cb)
                }
            }
        }
        shotCallback = null
        recCallback = null
    }

    // ---- r72-18: the Android 12/13 half — the Screenshots folder ----

    /** The permission the folder watch needs, or null where the callback exists. */
    fun folderPermission(): String? =
        when {
            Build.VERSION.SDK_INT >= 34 -> null
            Build.VERSION.SDK_INT >= 33 -> android.Manifest.permission.READ_MEDIA_IMAGES
            else -> android.Manifest.permission.READ_EXTERNAL_STORAGE
        }

    /** Has the phone already granted it? (False = the switch explains itself.) */
    fun folderGranted(ctx: android.content.Context?): Boolean {
        val perm = folderPermission() ?: return true
        if (ctx == null) return false
        return androidx.core.content.ContextCompat.checkSelfPermission(ctx, perm) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private var observer: android.database.ContentObserver? = null
    private var handler: android.os.Handler? = null
    private var poll: Runnable? = null
    private var watermark = 0L

    /** Newest screenshot-looking row of the system's image store: (id, seconds). */
    private fun newestShot(ctx: android.content.Context): Pair<Long, Long>? =
        runCatching {
            val uri = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val cols =
                arrayOf(
                    android.provider.MediaStore.Images.Media._ID,
                    android.provider.MediaStore.Images.Media.DATE_ADDED,
                    android.provider.MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                    android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                )
            ctx.contentResolver
                .query(
                    uri,
                    cols,
                    null,
                    null,
                    android.provider.MediaStore.Images.Media._ID + " DESC",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val bucket = c.getString(2)?.lowercase().orEmpty()
                        val name = c.getString(3)?.lowercase().orEmpty()
                        val shot =
                            bucket.contains("screenshot") ||
                                bucket.contains("screen_shot") ||
                                name.startsWith("screenshot") ||
                                name.startsWith("screen_shot") ||
                                name.startsWith("screencap")
                        if (shot) return@use c.getLong(0) to c.getLong(1)
                    }
                    null
                }
        }.getOrNull()

    private fun startFolder(ctx: android.content.Context) {
        // The watermark is TODAY's newest screenshot: the ones already there say
        // nothing about this chat.
        val newest = newestShot(ctx) ?: return
        watermark = newest.first
        val h = android.os.Handler(android.os.Looper.getMainLooper())
        handler = h
        val cb =
            object : android.database.ContentObserver(h) {
                override fun onChange(selfChange: Boolean) {
                    changed(ctx)
                }
            }
        runCatching {
            ctx.contentResolver.registerContentObserver(
                android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                true,
                cb,
            )
            observer = cb
        }
        // Some phones do not announce a fresh screenshot without a media scan —
        // this slow poll is the backstop while (and only while) a chat is open.
        val r =
            object : Runnable {
                override fun run() {
                    changed(ctx)
                    h.postDelayed(this, 5_000)
                }
            }
        poll = r
        h.postDelayed(r, 5_000)
    }

    private fun changed(ctx: android.content.Context) {
        if (convId.isBlank()) return
        val newest = newestShot(ctx) ?: return
        val (id, addedSec) = newest
        if (id <= watermark) return
        watermark = id
        // A shot taken just now is the one being taken of this chat; a file that
        // only became visible late (a media-scan catch-up) says nothing.
        val age = System.currentTimeMillis() / 1000 - addedSec
        if (age in 0..120) report("shot")
    }

    private fun stopFolder() {
        observer?.let { cb -> runCatching { watched?.contentResolver?.unregisterContentObserver(cb) } }
        poll?.let { r -> handler?.removeCallbacks(r) }
        observer = null
        poll = null
        handler = null
    }

    private fun report(kind: String) {
        val id = convId
        if (id.isBlank()) return
        if (kind == "shot") {
            // A burst of screenshots is one event (the server throttles the
            // alert too — this only saves the round trip).
            val now = System.currentTimeMillis()
            if (now - lastShot < 1500L) return
            lastShot = now
        }
        scope.launch {
            runCatching { Api.post("/api/conversations/$id/capture", JSONObject().put("kind", kind)) }
            withContext(Dispatchers.Main) { ScreenStore.pokeInbox() }
        }
    }
}
