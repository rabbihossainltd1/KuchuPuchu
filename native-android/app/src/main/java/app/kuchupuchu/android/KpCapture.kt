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
 * POST /api/conversations/:id/capture). Below those versions there is no signal
 * at all — the switches stay quiet rather than invent one.
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
