package app.kuchupuchu.android

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat
import coil.Coil
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache

class MainActivity : ComponentActivity() {

    private var shareCb: ((Int, Intent?) -> Unit)? = null

    private val ask =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}

    private val shareAsk =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            shareCb?.invoke(result.resultCode, result.data)
            shareCb = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Crash evidence trap: if the last session crashed, the exact cause
        // surfaces as a toast (first line + top frames) so it can be
        // screenshotted and fixed instead of a mystery "app crash kore".
        val prevHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching {
                java.io.File(filesDir, "kp_crash.txt").writeText(
                    e.javaClass.name + ": " + (e.message ?: "") + "\n" +
                        e.stackTrace.take(8).joinToString("\n") { it.toString() },
                )
            }
            prevHandler?.uncaughtException(t, e)
        }
        // Edge-to-edge on every API level, so the Compose-side insets are the
        // single source of truth. (targetSdk 35 forces this on Android 15+
        // anyway — setDecorFitsSystemWindows(true) and statusBarColor are
        // ignored there, which used to push the whole UI under the bars.)
        enableEdgeToEdge()
        current = this
        Api.loadToken(this)
        reportPreviousCrash()
        Coil.setImageLoader(
            ImageLoader.Builder(applicationContext)
                .okHttpClient { Api.http }
                // Keep typical chat-photo working sets resident. The default
                // cache evicted earlier bubbles after one fullscreen image.
                .memoryCache {
                    MemoryCache.Builder(applicationContext)
                        .maxSizeBytes(64 * 1024 * 1024)
                        .build()
                }
                // Disk cache: previously every photo re-downloaded after a
                // process restart (or memory-cache eviction), which made
                // scrolling back through a media-heavy chat re-fetch the whole
                // thread and stutter. The worker serves /api/files with
                // cache-control max-age=7d, so disk hits are authoritative.
                .diskCache {
                    DiskCache.Builder()
                        .directory(cacheDir.resolve("kp-image-cache"))
                        .maxSizeBytes(256L * 1024 * 1024)
                        .build()
                }
                // Respect the server's cache directives instead of always
                // revalidating, so cached media costs zero network.
                .respectCacheHeaders(true)
                .crossfade(true)
                .build(),
        )
        Store.init(this)
        Store.authed.value = !Api.token.isNullOrBlank() && Store.me != null
        KpNotify.ensureChannels(this)

        val need = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing =
            need.filter {
                ContextCompat.checkSelfPermission(this, it) != android.content.pm.PackageManager.PERMISSION_GRANTED
            }
        if (missing.isNotEmpty()) ask.launch(missing.toTypedArray())

        // Push mode is live on the v3 worker: init Firebase + register the
        // device token. No always-on service, no permanent notification.
        // boot() owns the retries and loads the session itself — gating on
        // Api.token here used to skip push entirely whenever this ran before
        // the stored session was restored, i.e. most cold starts.
        KpPush.boot(this)
        // Realtime user channel, held for the life of the PROCESS (not tied to
        // any one screen, which is what used to drop it the moment the user left
        // the chat list). This is what makes the worker's push-shape decision
        // trustworthy: while the process is alive (foreground OR background but
        // not frozen) the socket heartbeats, so liveSockets > 0 and the worker
        // sends a DATA-ONLY message whose rich Reply / Like / Mark-as-read card
        // the app can draw. If ColorOS freezes/kills the process the heartbeat
        // stops, the socket is classified dead within STALE_MS, and the worker
        // falls back to the guaranteed system payload — a bare tray card beats
        // silence. No foreground service, no visible notification.
        KpSocket.joinUser()
        // Pre-warm the SoundPool so the first send/receive tick never hits the
        // async-load race (play() on a not-yet-loaded sample is silently
        // dropped - the first message after a cold start used to be mute).
        Thread { runCatching { KpSounds.ensure(this) } }.start()

        // Call engine: polls active calls, rings, drives the call screens.
        if (CallEngine.instance == null) {
            val engine = CallEngine(application)
            engine.start(this)
        }

        handleIntent(intent)
        setContent {
            KpTheme {
                SplashGate {
                    KpApp()
                }
            }
        }
    }

    /**
     * Uploads the previous process' complete uncaught-exception report while
     * the auth token is available. Keep the file until the worker accepts it:
     * this makes the diagnostic reliable even with a short-lived crash loop.
     */
    private fun reportPreviousCrash() {
        val file = java.io.File(filesDir, "kp_crash.txt")
        val text = runCatching { if (file.exists()) file.readText() else "" }.getOrDefault("")
        if (text.isBlank()) return

        // The toast remains a quick visual signal, while clientlog preserves
        // the complete message and stack (Android 12 truncates long toasts).
        android.widget.Toast.makeText(
            this,
            "Previous crash captured; uploading diagnostics",
            android.widget.Toast.LENGTH_LONG,
        ).show()
        Thread {
            val uploaded =
                runCatching {
                    Api.post(
                        "/api/debug/clientlog",
                        org.json.JSONObject()
                            .put("stage", "crash")
                            .put("detail", text.take(12_000)),
                    )
                    true
                }.getOrDefault(false)
            if (uploaded) runCatching { file.delete() }
        }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        // Tapping the ongoing notification restores a previously minimized
        // Compose call overlay without recreating the call/session.
        CallEngine.instance?.restoreCallUi()
        if (intent.getBooleanExtra("kp_accept", false)) {
            CallEngine.instance?.let {
                CallEngine.suppressIncomingFor(15_000)
                it.pendingAccept = true
                it.answer()
            }
        }
        intent.getStringExtra("kp_chat")?.let { pendingChat.value = it }
        // Missed-call "Call back" action: start the call right away.
        intent.getStringExtra("kp_callback")?.let { otherId ->
            if (otherId.isNotBlank()) {
                CallEngine.instance?.startCall(
                    otherId,
                    intent.getStringExtra("kp_callback_kind") ?: "AUDIO",
                    intent.getStringExtra("kp_callback_name") ?: "KuchuPuchu",
                )
            }
        }
        // Incoming-call notification tapped: the always-running engine's
        // next poll (~1s) surfaces the ringing screen with Accept/Decline —
        // nothing else to do here.
    }

    override fun onResume() {
        // A cold start that could not reach the worker (no network yet)
        // left push un-init'd for the whole run; re-arm whenever the app is
        // back in front. No-op once Firebase + registration have succeeded.
        KpPush.boot(this)
        super.onResume()
        Store.foreground = true
        // Returning to the app triggers an instant re-sync of the open screens
        // (they observe ScreenStore.poke) — no waiting for the next poll.
        ScreenStore.pokeInbox()
        if (CallEngine.instance?.active == null) restoreChrome()
    }

    override fun onPause() {
        Store.foreground = false
        super.onPause()
    }

    fun restoreChrome() {
        // Bars are transparent (edge-to-edge); only the icon appearance needs
        // flipping back after the dark call screens.
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }

    /** Screen-share permission flow (video call screens). */
    fun askShare(cb: (Int, Intent?) -> Unit) {
        shareCb = cb
        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as android.media.projection.MediaProjectionManager
        shareAsk.launch(mgr.createScreenCaptureIntent())
    }

    companion object {
        @Volatile
        var current: MainActivity? = null

        /** Conversation to open from a notification tap.
         *
         *  A StateFlow, not a @Volatile var: a tap while the user is ALREADY
         *  signed in (singleTop onNewIntent) used to write the var and then
         *  wait forever — the only consumer was a LaunchedEffect(authed) that
         *  re-runs only when `authed` flips. KpApp now collects this flow, so
         *  every tap is observed; StateFlow replay also picks up taps that
         *  landed before login on a cold start.
         */
        val pendingChat = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    }
}
