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
                        .maxSizeBytes(64L * 1024L * 1024L)
                        .build()
                }
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
        if (!Api.token.isNullOrBlank()) {
            Thread {
                runCatching {
                    if (KpPush.tryInit(this)) KpPush.registerToken(this)
                }
            }.start()
        }
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
        askBackgroundPermissions()
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
        if (intent.getBooleanExtra("kp_accept", false)) {
            CallEngine.instance?.let {
                CallEngine.suppressIncomingFor(15_000)
                it.pendingAccept = true
                it.answer()
            }
        }
        intent.getStringExtra("kp_chat")?.let { pendingChat = it }
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

    /**
     * One-time, gentle setup so messages/calls arrive instantly:
     *  1. the system battery-optimization whitelist dialog
     *  2. MIUI's autostart page when present (no public API — best effort)
     * Skipped forever once handled (and on any device without the activity).
     */
    private fun askBackgroundPermissions() {
        val prefs = getSharedPreferences("kp", 0)
        val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName) && !prefs.getBoolean("bg_asked", false)) {
            prefs.edit().putBoolean("bg_asked", true).apply()
            runCatching {
                startActivity(
                    android.content.Intent(
                        android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        android.net.Uri.parse("package:$packageName"),
                    ),
                )
            }
            return
        }
        if (pm.isIgnoringBatteryOptimizations(packageName) && !prefs.getBoolean("miui_asked", false)) {
            prefs.edit().putBoolean("miui_asked", true).apply()
            runCatching {
                startActivity(
                    android.content.Intent().setClassName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity",
                    ).putExtra("package", packageName),
                )
            }
        }
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

        /** Conversation to open from a notification tap. */
        @Volatile
        var pendingChat: String? = null
    }
}
